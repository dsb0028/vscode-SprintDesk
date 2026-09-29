import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { keyId } from '../../src/review/protocol';
import { LocalRoot } from '../src/state';
import { LocalLease, RootStore } from '../src/storage';

async function main(): Promise<void> {
  const directory = path.join(process.cwd(), `.storage-test-${randomUUID()}`);
  await fs.mkdir(directory);
  let lease: LocalLease | undefined;
  try {
    const file = path.join(directory, 'authority.lock');
    const acquisition = await Promise.allSettled([LocalLease.acquire(file), LocalLease.acquire(file)]);
    const winners = acquisition.filter(result => result.status === 'fulfilled');
    assert.equal(winners.length, 1);
    const success = winners[0] as PromiseFulfilledResult<LocalLease>;
    lease = success.value;
    assert.equal(acquisition.filter(result => result.status === 'rejected').length, 1);
    await assert.rejects(LocalLease.recover(file, false), /human/);
    await assert.rejects(LocalLease.recover(file, true), /still alive/);
    await lease.assertHeld();
    console.log('PASS concurrent acquisition yields exactly one signing lease; live lease cannot be human-overridden');
    const pair = generateKeyPairSync('ed25519');
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const enrollment = { version: 1 as const, projectId: 'project', reviewerId: 'human',
      reviewerName: 'Human', publicKey, keyId: keyId(publicKey) };
    const root: LocalRoot = { version: 1, workspace: 'file:///workspace', enrollment,
      keys: [enrollment], revoked: false, tasks: {}, archives: [] };
    const store = new RootStore(path.join(directory, 'authority.json'), lease);
    await store.write(root);
    assert.deepEqual(await store.read(), root);
    root.revoked = true; await store.write(root);
    assert.equal((await store.read())!.revoked, true);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['authority.json', 'authority.lock']);
    console.log('PASS fsynced atomic ledger replacement persists and leaves no staging files');
    await lease.release(); lease = undefined;
    await assert.rejects(store.write(root), /lost/);
    console.log('PASS released/missing lease refuses ledger writes');
    let deadPid = 2147483647;
    while (true) {
      try { process.kill(deadPid, 0); deadPid--; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') break; throw error; }
    }
    await fs.writeFile(file, JSON.stringify({ version: 1, token: 'stale', pid: deadPid,
      createdAt: '2026-01-01T00:00:00Z' }));
    lease = await LocalLease.recover(file, true);
    await lease.assertHeld();
    await assert.rejects(LocalLease.acquire(file), /already held/);
    console.log('PASS dead lease recovery requires human confirmation and returns one exclusive lease');
  } finally {
    if (lease) await lease.release();
    await fs.rm(directory, { recursive: true, force: true });
  }
  console.log('4 local filesystem lease/durability tests passed; no installed UI evidence claimed.');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
