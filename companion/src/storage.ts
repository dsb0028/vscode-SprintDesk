import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { LocalRoot } from './state';

export function assertStorageLocation(
  scheme: string, authority: string, query: string, fragment: string, directory: string,
): void {
  if (!['file', 'vscode-userdata'].includes(scheme) || authority || query || fragment
    || !path.isAbsolute(directory)) {
    throw new Error('Local filesystem storage required: unsupported or ambiguous storage URI.');
  }
}

export async function verifyLocalStorageMapping(
  directory: string, readProvider: (name: string) => Promise<Uint8Array>,
): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const name = `.storage-probe-${randomUUID()}`;
  const file = path.join(directory, name);
  const challenge = Buffer.from(randomUUID());
  const handle = await fs.open(file, 'wx', 0o600);
  try {
    await handle.writeFile(challenge);
    await handle.sync();
    const observed = await readProvider(name);
    if (!challenge.equals(Buffer.from(observed))) {
      throw new Error('VS Code storage does not match this host filesystem. Enrollment refused.');
    }
  } finally {
    await handle.close();
    await fs.unlink(file);
  }
}

interface Owner { version: 1; token: string; pid: number; createdAt: string; }
function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code;
}
async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') { return; }
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function exclusive(file: string, value: string): Promise<void> {
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(value, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  await syncDirectory(path.dirname(file));
}

export class LocalLease {
  private released = false;
  private constructor(readonly file: string, private readonly owner: Owner) {}

  static async acquire(file: string): Promise<LocalLease> {
    const owner: Owner = { version: 1, token: randomUUID(), pid: process.pid, createdAt: new Date().toISOString() };
    try {
      await exclusive(file, JSON.stringify(owner));
    } catch (error) {
      if (errorCode(error) === 'EEXIST') {
        throw new Error('Local review lease already held. No second window may read/write/sign this authority.');
      }
      throw error;
    }
    return new LocalLease(file, owner);
  }

  static async recover(file: string, humanConfirmed: boolean): Promise<LocalLease> {
    if (!humanConfirmed) { throw new Error('Stale lease recovery requires explicit human confirmation.'); }
    const guard = `${file}.recovery`;
    await exclusive(guard, JSON.stringify({ token: randomUUID(), pid: process.pid }));
    try {
      const owner = JSON.parse(await fs.readFile(file, 'utf8')) as Owner;
      if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || !owner.token) {
        throw new Error('Malformed lease: close all VS Code windows and explicitly repair local storage.');
      }
      try {
        process.kill(owner.pid, 0);
        throw new Error('Lease owner is still alive. Concurrent signing is refused.');
      } catch (error) {
        if (errorCode(error) !== 'ESRCH') { throw error; }
      }
      // One recovery guard prevents two recoverers from unlinking a newly acquired lease.
      await fs.unlink(file);
      await syncDirectory(path.dirname(file));
      return await LocalLease.acquire(file);
    } finally {
      await fs.unlink(guard);
      await syncDirectory(path.dirname(file));
    }
  }

  async assertHeld(): Promise<void> {
    if (this.released || JSON.parse(await fs.readFile(this.file, 'utf8')).token !== this.owner.token) {
      throw new Error('Local signing lease lost. Refusing local write/sign/delivery.');
    }
  }

  async release(): Promise<void> {
    await this.assertHeld();
    this.released = true;
    await fs.unlink(this.file);
    await syncDirectory(path.dirname(this.file));
  }
}

export class RootStore {
  constructor(readonly file: string, private readonly lease: LocalLease) {}
  async read(): Promise<LocalRoot | undefined> {
    await this.lease.assertHeld();
    try { return JSON.parse(await fs.readFile(this.file, 'utf8')) as LocalRoot; }
    catch (error) {
      if (errorCode(error) === 'ENOENT') { return undefined; }
      throw error;
    }
  }
  async write(root: LocalRoot): Promise<void> {
    await this.lease.assertHeld();
    const staging = `${this.file}.${randomUUID()}.pending`;
    try {
      await exclusive(staging, JSON.stringify(root));
      await this.lease.assertHeld();
      await fs.rename(staging, this.file);
      await syncDirectory(path.dirname(this.file));
    } finally {
      try { await fs.unlink(staging); } catch (error) {
        if (errorCode(error) !== 'ENOENT') { throw error; }
      }
    }
  }
}
