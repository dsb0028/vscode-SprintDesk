import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { dirname } from 'path';
import { IFileSystem } from './IFileSystem';

export class NodeFileSystem implements IFileSystem {
  readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf8');
  }

  writeFile(filePath: string, content: string): void {
    fs.writeFileSync(filePath, content, 'utf8');
  }

  realPath(filePath: string): string {
    return fs.realpathSync(filePath);
  }

  withLock(filePath: string, operation: () => void): void {
    const lockPath = `${filePath}.lock`;
    let fd: number;
    try {
      fd = fs.openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        throw new Error('Task store is locked by another writer; reconcile readback before retry. Recover stale locks explicitly.');
      }
      throw error;
    }
    try {
      operation();
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(lockPath);
    }
  }

  writeAtomic(filePath: string, content: string): void {
    const staging = `${filePath}.${randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(staging, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, content, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(staging, filePath);
      if (process.platform !== 'win32') {
        const directory = fs.openSync(dirname(filePath), 'r');
        try {
          fs.fsyncSync(directory);
        } finally {
          fs.closeSync(directory);
        }
      }
    } finally {
      if (fs.existsSync(staging)) {
        fs.unlinkSync(staging);
      }
    }
  }

  exists(filePath: string): boolean {
    try { return fs.existsSync(filePath); } catch { return false; }
  }

  mkdir(dirPath: string, options?: { recursive?: boolean }): void {
    fs.mkdirSync(dirPath, options);
  }

  delete(filePath: string): void {
    fs.unlinkSync(filePath);
  }

  list(dirPath: string): string[] {
    return fs.readdirSync(dirPath);
  }
}