import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_STALE_LOCK_MS,
  FileLockOptions,
  ISecureStore
} from './ISecureStore';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const NON_OWNER_MASK = 0o077;
const LOCK_RETRY_INTERVAL_MS = 20;

let temporaryFileCounter = 0;

function isPosixHost(): boolean {
  return process.platform !== 'win32';
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export class NodeSecureStore implements ISecureStore {
  readSecureText(filePath: string): string | undefined {
    this.rejectSymbolicLink(filePath);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (error: unknown) {
      if (errorCode(error) === 'ENOENT') {return undefined;}
      throw new Error(`Unable to read ${path.basename(filePath)}: ${errorCode(error) || 'read failure'}`);
    }
    this.enforceOwnerOnlyFileMode(filePath);
    return content;
  }

  writeSecureText(filePath: string, content: string): void {
    this.ensureSecureDirectory(path.dirname(filePath));
    this.rejectSymbolicLink(filePath);

    temporaryFileCounter += 1;
    const temporaryPath = `${filePath}.${process.pid}.${temporaryFileCounter}.tmp`;
    let descriptor: number;
    try {
      descriptor = fs.openSync(temporaryPath, 'wx', FILE_MODE);
    } catch (error: unknown) {
      throw new Error(`Unable to stage ${path.basename(filePath)}: ${errorCode(error) || 'write failure'}`);
    }

    try {
      fs.writeFileSync(descriptor, content, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      fs.renameSync(temporaryPath, filePath);
    } catch (error: unknown) {
      try { fs.closeSync(descriptor); } catch { /* already closed */ }
      try { fs.unlinkSync(temporaryPath); } catch { /* nothing staged */ }
      throw new Error(`Unable to write ${path.basename(filePath)}: ${errorCode(error) || 'write failure'}`);
    }

    if (isPosixHost()) {
      fs.chmodSync(filePath, FILE_MODE);
    }
  }

  withFileLock<T>(lockPath: string, operation: () => T, options: FileLockOptions = {}): T {
    const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    const staleMs = options.staleMs ?? DEFAULT_STALE_LOCK_MS;
    this.ensureSecureDirectory(path.dirname(lockPath));

    const descriptor = this.acquireLock(lockPath, timeoutMs, staleMs);
    try {
      return operation();
    } finally {
      try { fs.closeSync(descriptor); } catch { /* already closed */ }
      try { fs.unlinkSync(lockPath); } catch { /* already released */ }
    }
  }

  private acquireLock(lockPath: string, timeoutMs: number, staleMs: number): number {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const descriptor = fs.openSync(lockPath, 'wx', FILE_MODE);
        fs.writeFileSync(descriptor, `${process.pid}\n`, 'utf8');
        return descriptor;
      } catch (error: unknown) {
        if (errorCode(error) !== 'EEXIST') {
          throw new Error(`Unable to acquire the ${path.basename(lockPath)} lock: ${errorCode(error) || 'lock failure'}`);
        }
        if (this.releaseStaleLock(lockPath, staleMs)) {continue;}
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for the ${path.basename(lockPath)} lock`);
        }
        sleepSync(LOCK_RETRY_INTERVAL_MS);
      }
    }
  }

  private releaseStaleLock(lockPath: string, staleMs: number): boolean {
    let lockStats: fs.Stats;
    try {
      lockStats = fs.statSync(lockPath);
    } catch {
      return true;
    }
    if (Date.now() - lockStats.mtimeMs < staleMs) {return false;}
    try {
      fs.unlinkSync(lockPath);
      return true;
    } catch {
      return false;
    }
  }

  private ensureSecureDirectory(directoryPath: string): void {
    this.rejectSymbolicLink(directoryPath);
    fs.mkdirSync(directoryPath, { recursive: true, mode: DIRECTORY_MODE });
    if (!isPosixHost()) {return;}
    const directoryStats = fs.statSync(directoryPath);
    if ((directoryStats.mode & NON_OWNER_MASK) === 0) {return;}
    try {
      fs.chmodSync(directoryPath, DIRECTORY_MODE);
    } catch {
      throw new Error(
        `Refusing to use ${path.basename(directoryPath)} because it is not owner-only; run chmod 700 on it`
      );
    }
  }

  private enforceOwnerOnlyFileMode(filePath: string): void {
    if (!isPosixHost()) {return;}
    const fileStats = fs.statSync(filePath);
    if ((fileStats.mode & NON_OWNER_MASK) === 0) {return;}
    try {
      fs.chmodSync(filePath, FILE_MODE);
    } catch {
      throw new Error(
        `Refusing to use ${path.basename(filePath)} because it is not owner-only; run chmod 600 on it`
      );
    }
  }

  private rejectSymbolicLink(targetPath: string): void {
    let linkStats: fs.Stats;
    try {
      linkStats = fs.lstatSync(targetPath);
    } catch (error: unknown) {
      if (errorCode(error) === 'ENOENT') {return;}
      throw new Error(`Unable to inspect ${path.basename(targetPath)}: ${errorCode(error) || 'stat failure'}`);
    }
    if (linkStats.isSymbolicLink()) {
      throw new Error(`Refusing to follow the symbolic link at ${path.basename(targetPath)}`);
    }
  }
}
