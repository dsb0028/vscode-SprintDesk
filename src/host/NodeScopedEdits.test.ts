import assert from 'node:assert/strict';
import test from 'node:test';
import { fork } from 'node:child_process';
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NodeScopedEdits, ScopedEditError, ScopedEditRequest, ScopedLease, ScopedReadRequest,
} from './NodeScopedEdits';
import { ISecureStore } from './ISecureStore';
import { NodeSecureStore } from './NodeSecureStore';

interface Fixture {
  readonly base: string;
  readonly root: string;
  readonly state: string;
  readonly service: NodeScopedEdits;
}

function createFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), 'scoped-edits-'));
  const root = join(base, 'code');
  const state = join(base, 'state');
  mkdirSync(root);
  mkdirSync(state, { mode: 0o700 });
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/a.txt'), 'alpha\n', { mode: 0o644 });
  writeFileSync(join(root, 'src/b.txt'), 'beta\n', { mode: 0o644 });
  return { base, root, state, service: new NodeScopedEdits(state, root) };
}

/**
 * Builds an isolated fixture, runs the synchronous test body against it, and
 * always removes the temporary directory afterwards (equivalent to node:test
 * TestContext#after, which the pinned @types/node@16 definitions do not expose).
 */
function withFixture(run: (f: Fixture) => void): void {
  const f = createFixture();
  try {
    run(f);
  } finally {
    rmSync(f.base, { recursive: true, force: true });
  }
}

async function withFixtureAsync(run: (f: Fixture) => Promise<void>): Promise<void> {
  const f = createFixture();
  try {
    await run(f);
  } finally {
    rmSync(f.base, { recursive: true, force: true });
  }
}

function editRequest(
  lease: ScopedLease, overrides: Partial<ScopedEditRequest> = {},
): ScopedEditRequest {
  return {
    leaseId: lease.id,
    fence: lease.fence,
    owner: 'writer-a',
    path: 'src/a.txt',
    expectedHash: lease.targets[0].hash,
    oldText: 'alpha',
    newText: 'changed',
    ...overrides,
  };
}

function readRequest(
  lease: ScopedLease, overrides: Partial<ScopedReadRequest> = {},
): ScopedReadRequest {
  return { leaseId: lease.id, fence: lease.fence, owner: 'writer-a', path: 'src/a.txt', ...overrides };
}

function scopedError(operation: () => unknown): ScopedEditError {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof ScopedEditError, `expected a ScopedEditError, received ${String(error)}`);
    return error as ScopedEditError;
  }
  throw new Error('Expected operation to throw');
}

/**
 * Asserts on the error's actual `.code` property (per the contract's
 * error-vocabulary decision) rather than pattern-matching the free-form
 * message string, which the contract explicitly leaves flexible.
 */
function assertCode(operation: () => unknown, code: string): ScopedEditError {
  const error = scopedError(operation);
  assert.equal(error.code, code, `expected code ${code}, received ${error.code}`);
  return error;
}

/**
 * Delegates every call to a real NodeSecureStore until the exact post-edit
 * source content is observed on disk, then fails the next write. This models
 * "inject the failure only after observing the actual source replacement"
 * without assuming a particular internal write ordering: whatever
 * preliminary journaling the implementation performs before replacing the
 * source succeeds normally, and only a write that happens after the source
 * has visibly changed is turned into a synthetic failure. `failTriggered`
 * lets the test assert the injected store was actually exercised.
 */
class ObservingFailAfterSourceChangeStore implements Pick<ISecureStore, 'readSecureText' | 'writeSecureText'> {
  private readonly real = new NodeSecureStore();
  private sourceObservedChanged = false;
  public failTriggered = false;

  constructor(private readonly sourcePath: string, private readonly changedContent: string) {}

  readSecureText(filePath: string): string | undefined {
    return this.real.readSecureText(filePath);
  }

  writeSecureText(filePath: string, content: string): void {
    if (!this.sourceObservedChanged && readFileSync(this.sourcePath, 'utf8') === this.changedContent) {
      this.sourceObservedChanged = true;
    }
    if (this.sourceObservedChanged) {
      this.failTriggered = true;
      throw new Error('synthetic state write failure injected after observed source replacement');
    }
    this.real.writeSecureText(filePath, content);
  }
}

test('writes only through an active bound lease and preserves file mode', () => withFixture(f => {
  const lease = f.service.acquire('writer-a', ['src/a.txt']);
  const outcome = f.service.edit(editRequest(lease));
  assert.equal(readFileSync(join(f.root, 'src/a.txt'), 'utf8'), 'changed\n');
  assert.equal(statSync(join(f.root, 'src/a.txt')).mode & 0o777, 0o644);
  assert.notEqual(outcome.hash, lease.targets[0].hash);
  assert.equal(f.service.list()[0].operations.length, 1);
  const second = f.service.edit(editRequest(lease, {
    expectedHash: outcome.hash, oldText: 'changed', newText: 'final',
  }));
  assert.notEqual(second.hash, outcome.hash);
  assert.equal(readFileSync(join(f.root, 'src/a.txt'), 'utf8'), 'final\n');
}));

test('allows independent scopes but refuses an overlapping lease', () => withFixture(f => {
  f.service.acquire('writer-a', ['src/a.txt']);
  f.service.acquire('writer-b', ['src/b.txt']);
  const error = scopedError(() => f.service.acquire('writer-c', ['src/a.txt']));
  assert.equal(error.code, 'LEASE_CONFLICT');
  assert.equal(f.service.list().length, 2);
}));

test('multi-file acquisition is all or none', () => withFixture(f => {
  f.service.acquire('writer-b', ['src/b.txt']);
  assertCode(() => f.service.acquire('writer-a', ['src/a.txt', 'src/b.txt']), 'LEASE_CONFLICT');
  assert.equal(f.service.list().length, 1);
  f.service.acquire('writer-c', ['src/a.txt']);
  assert.equal(f.service.list().length, 2);
}));

const editRejections: ReadonlyArray<[string, Partial<ScopedEditRequest>, RegExp]> = [
  ['foreign owner', { owner: 'writer-b' }, /LEASE_BINDING/],
  ['foreign lease', { leaseId: 'not-the-lease' }, /LEASE_BINDING/],
  ['stale fence', { fence: 0 }, /LEASE_BINDING/],
  ['stale expected hash', { expectedHash: '0'.repeat(64) }, /EXPECTED_HASH_MISMATCH/],
  ['unleased file', { path: 'src/b.txt', oldText: 'beta' }, /PATH_OUT_OF_SCOPE/],
  ['parent traversal', { path: '../outside.txt' }, /PATH_OUT_OF_SCOPE/],
  ['absolute path', { path: '/tmp/forbidden.txt' }, /PATH_OUT_OF_SCOPE/],
  ['empty match', { oldText: '' }, /EDIT_INVALID/],
  ['absent match', { oldText: 'not present' }, /MATCH_NOT_FOUND/],
  ['wrong replacement type', { newText: 12 as unknown as string }, /EDIT_INVALID/],
];

for (const [label, overrides, pattern] of editRejections) {
  test(`rejects ${label} without changing either source`, () => withFixture(f => {
    const lease = f.service.acquire('writer-a', ['src/a.txt']);
    const error = scopedError(() => f.service.edit(editRequest(lease, overrides)));
    assert.match(error.code, pattern);
    assert.equal(error.sourceMayHaveChanged, false);
    assert.equal(readFileSync(join(f.root, 'src/a.txt'), 'utf8'), 'alpha\n');
    assert.equal(readFileSync(join(f.root, 'src/b.txt'), 'utf8'), 'beta\n');
    assert.equal(f.service.list()[0].operations.length, 0);
  }));
}

const readRejections: ReadonlyArray<[string, Partial<ScopedReadRequest>, RegExp]> = [
  ['foreign owner', { owner: 'writer-b' }, /LEASE_BINDING/],
  ['foreign lease', { leaseId: 'not-the-lease' }, /LEASE_BINDING/],
  ['stale fence', { fence: 0 }, /LEASE_BINDING/],
  ['unleased file', { path: 'src/b.txt' }, /PATH_OUT_OF_SCOPE/],
];

for (const [label, overrides, pattern] of readRejections) {
  test(`read rejects ${label}`, () => withFixture(f => {
    const lease = f.service.acquire('writer-a', ['src/a.txt']);
    const error = scopedError(() => f.service.read(readRequest(lease, overrides)));
    assert.match(error.code, pattern);
  }));
}

test('rejects content drift and preserves the external edit', () => withFixture(f => {
  const lease = f.service.acquire('writer-a', ['src/a.txt']);
  writeFileSync(join(f.root, 'src/a.txt'), 'external change\n');
  const error = scopedError(() => f.service.edit(editRequest(lease)));
  assert.equal(error.code, 'SOURCE_DRIFT');
  assert.equal(error.sourceMayHaveChanged, false);
  assert.equal(readFileSync(join(f.root, 'src/a.txt'), 'utf8'), 'external change\n');
}));

test('rejects inode replacement even when bytes are unchanged', () => withFixture(f => {
  const lease = f.service.acquire('writer-a', ['src/a.txt']);
  writeFileSync(join(f.root, 'src/replacement.txt'), 'alpha\n');
  renameSync(join(f.root, 'src/replacement.txt'), join(f.root, 'src/a.txt'));
  assertCode(() => f.service.edit(editRequest(lease)), 'SOURCE_DRIFT');
}));

test('rejects permission drift', () => withFixture(f => {
  const lease = f.service.acquire('writer-a', ['src/a.txt']);
  chmodSync(join(f.root, 'src/a.txt'), 0o600);
  assertCode(() => f.service.edit(editRequest(lease)), 'SOURCE_DRIFT');
}));

test('rejects symlink targets and symlinked parents', () => withFixture(f => {
  writeFileSync(join(f.base, 'outside.txt'), 'private synthetic value\n');
  symlinkSync(join(f.base, 'outside.txt'), join(f.root, 'src/link.txt'));
  symlinkSync(f.base, join(f.root, 'alias'));
  assertCode(() => f.service.acquire('writer-a', ['src/link.txt']), 'SOURCE_SYMLINK');
  assertCode(() => f.service.acquire('writer-a', ['alias/outside.txt']), 'SOURCE_SYMLINK');
}));

test('rejects a symlink introduced after acquisition', () => withFixture(f => {
  const lease = f.service.acquire('writer-a', ['src/a.txt']);
  writeFileSync(join(f.base, 'outside.txt'), 'outside\n');
  rmSync(join(f.root, 'src/a.txt'));
  symlinkSync(join(f.base, 'outside.txt'), join(f.root, 'src/a.txt'));
  assertCode(() => f.service.edit(editRequest(lease)), 'SOURCE_SYMLINK');
  assert.equal(readFileSync(join(f.base, 'outside.txt'), 'utf8'), 'outside\n');
}));

test('release retains history and a new grant has a higher fence', () => withFixture(f => {
  const lease = f.service.acquire('writer-a', ['src/a.txt']);
  assertCode(() => f.service.release(lease.id, lease.fence, 'writer-b'), 'LEASE_BINDING');
  f.service.release(lease.id, lease.fence, 'writer-a');
  assertCode(() => f.service.edit(editRequest(lease)), 'LEASE_INACTIVE');
  const next = f.service.acquire('writer-a', ['src/a.txt']);
  assert.ok(next.fence > lease.fence);
  assert.equal(f.service.list()[0].status, 'released');
}));

test('an occupied mutex blocks instead of expiring or replacing it', () => withFixture(f => {
  writeFileSync(join(f.state, 'leases.lock'), 'held by another process\n');
  assertCode(() => f.service.acquire('writer-a', ['src/a.txt']), 'STATE_BUSY');
  assert.equal(readFileSync(join(f.state, 'leases.lock'), 'utf8'), 'held by another process\n');
}));

test('missing or malformed registry never becomes a passing read', () => withFixture(f => {
  assertCode(() => f.service.list(), 'STATE_MISSING');
  writeFileSync(join(f.state, 'leases.json'), '{broken');
  assertCode(() => f.service.acquire('writer-a', ['src/a.txt']), 'STATE_INVALID');
  assert.equal(readFileSync(join(f.state, 'leases.json'), 'utf8'), '{broken');
}));

test('rejects duplicate, empty and nonexistent scopes', () => withFixture(f => {
  assertCode(() => f.service.acquire('writer-a', []), 'SCOPE_INVALID');
  assertCode(() => f.service.acquire('writer-a', ['src/a.txt', 'src/a.txt']), 'SCOPE_INVALID');
  assertCode(() => f.service.acquire('', ['src/a.txt']), 'SCOPE_INVALID');
  assertCode(() => f.service.acquire('writer-a', ['src/missing.txt']), 'SOURCE_MISSING');
}));

test('ambiguous matches are rejected rather than replacing an arbitrary occurrence', () => withFixture(f => {
  writeFileSync(join(f.root, 'src/a.txt'), 'alpha alpha\n');
  const lease = f.service.acquire('writer-a', ['src/a.txt']);
  assertCode(() => f.service.edit(editRequest(lease)), 'MATCH_NOT_UNIQUE');
  assert.equal(readFileSync(join(f.root, 'src/a.txt'), 'utf8'), 'alpha alpha\n');
}));

test('preserves the original mode under a restrictive process umask', () => withFixture(f => {
  const lease = f.service.acquire('writer-a', ['src/a.txt']);
  const previous = process.umask(0o077);
  try {
    f.service.edit(editRequest(lease));
  } finally {
    process.umask(previous);
  }
  assert.equal(statSync(join(f.root, 'src/a.txt')).mode & 0o777, 0o644);
}));

test('rejects invalid and symbolic root or state directories', () => {
  const base = mkdtempSync(join(tmpdir(), 'scoped-edits-roots-'));
  const root = join(base, 'code');
  const state = join(base, 'state');
  mkdirSync(root);
  mkdirSync(state, { mode: 0o700 });
  try {
    assertCode(() => new NodeScopedEdits(state, 'relative/root'), 'ROOT_INVALID');
    assertCode(() => new NodeScopedEdits('relative/state', root), 'ROOT_INVALID');
    symlinkSync(root, join(base, 'root-link'));
    symlinkSync(state, join(base, 'state-link'));
    assertCode(() => new NodeScopedEdits(state, join(base, 'root-link')), 'ROOT_SYMLINK');
    assertCode(() => new NodeScopedEdits(join(base, 'state-link'), root), 'ROOT_SYMLINK');
    assertCode(() => new NodeScopedEdits(join(base, 'missing'), root), 'ROOT_INVALID');
    assertCode(() => new NodeScopedEdits(join(root, 'nested-state'), root), 'STATE_INSIDE_ROOT');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

const invalidScopes: ReadonlyArray<string | null> = [
  '../outside.txt', '/tmp/outside.txt', '.git/config', '.SprintDesk/state',
  'src/./a.txt', 'src//a.txt', 'src\\a.txt', null,
];

for (const scope of invalidScopes) {
  test(`rejects invalid acquisition scope ${JSON.stringify(scope)}`, () => withFixture(f => {
    assertCode(
      () => f.service.acquire('writer-a', [scope as unknown as string]),
      'PATH_OUT_OF_SCOPE',
    );
  }));
}

test('rejects binary and directory sources', () => withFixture(f => {
  writeFileSync(join(f.root, 'src/binary.txt'), Buffer.from([0xff, 0xfe]));
  assertCode(() => f.service.acquire('writer-a', ['src/binary.txt']), 'SOURCE_NOT_UTF8');
  assertCode(() => f.service.acquire('writer-a', ['src']), 'SOURCE_UNSUPPORTED');
}));

test('rejects root replacement', () => withFixture(f => {
  const lease = f.service.acquire('writer-a', ['src/a.txt']);
  renameSync(f.root, join(f.base, 'old-code'));
  mkdirSync(f.root);
  assertCode(() => f.service.edit(editRequest(lease)), 'ROOT_DRIFT');
}));

test('rejects unsupported registry state and exhausted fences', () => withFixture(f => {
  f.service.acquire('writer-a', ['src/a.txt']);
  const file = join(f.state, 'leases.json');
  const initial = readFileSync(file, 'utf8');
  const mutations: ReadonlyArray<(state: { version: number; leases: Array<{ status: string; targets: Array<{ hash: string }> }> }) => void> = [
    state => { state.version = 99; },
    state => { state.leases[0].status = 'invented'; },
    state => { state.leases[0].targets[0].hash = 'not-a-hash'; },
  ];
  for (const mutate of mutations) {
    const state = JSON.parse(initial) as { version: number; leases: Array<{ status: string; targets: Array<{ hash: string }> }> };
    mutate(state);
    writeFileSync(file, JSON.stringify(state));
    assertCode(() => f.service.list(), 'STATE_INVALID');
  }
  const exhausted = JSON.parse(initial) as { nextFence: number };
  exhausted.nextFence = Number.MAX_SAFE_INTEGER;
  writeFileSync(file, JSON.stringify(exhausted));
  assertCode(() => f.service.acquire('writer-b', ['src/b.txt']), 'FENCE_EXHAUSTED');
}));

test('a state persistence failure exposes partial work, confirms injection occurred, and prevents stale retries', () => {
  const base = mkdtempSync(join(tmpdir(), 'scoped-edits-partial-'));
  const root = join(base, 'code');
  const state = join(base, 'state');
  mkdirSync(root);
  mkdirSync(state, { mode: 0o700 });
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/a.txt'), 'alpha\n', { mode: 0o644 });
  const sourcePath = join(root, 'src/a.txt');
  const observingStore = new ObservingFailAfterSourceChangeStore(sourcePath, 'changed\n');
  const service = new NodeScopedEdits(state, root, observingStore);
  try {
    const lease = service.acquire('writer-a', ['src/a.txt']);
    const error = scopedError(() => service.edit(editRequest(lease)));
    assert.equal(error.sourceMayHaveChanged, true);
    assert.ok(
      observingStore.failTriggered,
      'expected the constructor-injected store to have been invoked after the source was replaced',
    );
    assert.equal(readFileSync(sourcePath, 'utf8'), 'changed\n');
    assert.equal(service.list()[0].operations.length, 0);
    assertCode(() => service.edit(editRequest(lease)), 'SOURCE_DRIFT');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test(
  'rejects a lease replayed against a different constructor-pinned root sharing the same registry',
  () => {
    const base = mkdtempSync(join(tmpdir(), 'scoped-edits-cross-root-'));
    const state = join(base, 'state');
    const rootA = join(base, 'code-a');
    const rootB = join(base, 'code-b');
    mkdirSync(state, { mode: 0o700 });
    mkdirSync(rootA);
    mkdirSync(join(rootA, 'src'));
    writeFileSync(join(rootA, 'src/a.txt'), 'alpha\n', { mode: 0o644 });
    mkdirSync(rootB);
    mkdirSync(join(rootB, 'src'));
    writeFileSync(join(rootB, 'src/a.txt'), 'alpha\n', { mode: 0o644 });
    const serviceA = new NodeScopedEdits(state, rootA);
    const serviceB = new NodeScopedEdits(state, rootB);
    try {
      const lease = serviceA.acquire('writer-a', ['src/a.txt']);

      // Replaying the lease against a service pinned to a different root must
      // be a binding failure for every operation, must not touch either
      // root's source file, and must not release the rightful lease.
      assertCode(() => serviceB.read(readRequest(lease)), 'LEASE_BINDING');
      assertCode(() => serviceB.edit(editRequest(lease)), 'LEASE_BINDING');
      assertCode(() => serviceB.release(lease.id, lease.fence, 'writer-a'), 'LEASE_BINDING');

      assert.equal(readFileSync(join(rootA, 'src/a.txt'), 'utf8'), 'alpha\n');
      assert.equal(readFileSync(join(rootB, 'src/a.txt'), 'utf8'), 'alpha\n');

      // The rightful lease must still be active under its owning service:
      // the foreign-root replay did not release or otherwise invalidate it.
      const outcome = serviceA.edit(editRequest(lease));
      assert.notEqual(outcome.hash, lease.targets[0].hash);
      assert.equal(readFileSync(join(rootA, 'src/a.txt'), 'utf8'), 'changed\n');
      serviceA.release(lease.id, lease.fence, 'writer-a');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);

interface WorkerOutcome {
  readonly kind: 'ready' | 'result';
  readonly ok?: boolean;
  readonly error?: string;
  /** The contractual error code, propagated from the worker's IPC payload. */
  readonly code?: string;
  readonly pid: number;
}

function startWorker(
  f: Fixture, owner: string,
): { child: ReturnType<typeof fork>; ready: Promise<void>; complete: Promise<WorkerOutcome> } {
  const child = fork(
    join(__dirname, 'scopedEditLeaseWorker.js'),
    [f.state, f.root, owner, JSON.stringify(['src/a.txt'])],
    { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
  );
  let outcome: WorkerOutcome | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    child.on('message', (message: WorkerOutcome) => {
      if (message.kind === 'ready') { resolve(); }
      if (message.kind === 'result') { outcome = message; }
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Worker exited before readiness')));
  });
  const complete = new Promise<WorkerOutcome>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => {
      if (code !== 0 || !outcome) { reject(new Error(`Worker failed with exit ${code}`)); } else { resolve(outcome); }
    });
  });
  return { child, ready, complete };
}

test('concurrent processes cannot acquire the same scope', () => withFixtureAsync(async f => {
  const first = startWorker(f, 'writer-a');
  const second = startWorker(f, 'writer-b');
  try {
    await Promise.all([first.ready, second.ready]);
    first.child.send('go');
    second.child.send('go');
    const results = await Promise.all([first.complete, second.complete]);
    assert.equal(results.filter(result => result.ok).length, 1);
    const failed = results.find(result => !result.ok);
    assert.ok(failed);
    assert.ok(
      failed.code === 'STATE_BUSY' || failed.code === 'LEASE_CONFLICT',
      `expected STATE_BUSY or LEASE_CONFLICT, received ${failed.code}`,
    );
    assert.equal(f.service.list().length, 1);
    assert.equal(new Set(results.map(result => result.pid)).size, 2);
  } finally {
    if (first.child.exitCode === null) { first.child.kill('SIGTERM'); }
    if (second.child.exitCode === null) { second.child.kill('SIGTERM'); }
  }
}));

test('scoped reads return current source and reject unleased or inactive access', () => withFixture(f => {
  const lease = f.service.acquire('writer-a', ['src/a.txt']);
  const request = readRequest(lease);
  assert.deepEqual(
    f.service.read(request),
    { path: 'src/a.txt', hash: lease.targets[0].hash, text: 'alpha\n' },
  );
  assertCode(() => f.service.read(readRequest(lease, { path: 'src/b.txt' })), 'PATH_OUT_OF_SCOPE');
  f.service.release(lease.id, lease.fence, 'writer-a');
  assertCode(() => f.service.read(request), 'LEASE_INACTIVE');
}));

/**
 * Delegates every write to a real NodeSecureStore so the registry actually
 * commits, then — once armed, and only on the first write after arming —
 * simulates another legitimate process having re-created the ownership
 * mutex in the narrow window between this process's registry write and its
 * own mutex release: the lock file this process currently holds is renamed
 * aside to a fixture-owned path (so the test can inspect the original), and
 * a brand-new `leases.lock` is written in its place with content only this
 * store controls. A correct mutex release must recognize that the lock file
 * it is about to remove is no longer the one it created and must refuse to
 * delete someone else's lock; it must not treat an unconditional unlink of
 * whatever currently sits at that path as "releasing its own lock".
 */
class LockSwapAfterWriteStore implements Pick<ISecureStore, 'readSecureText' | 'writeSecureText'> {
  private readonly real = new NodeSecureStore();
  private armed = false;
  public triggered = false;

  constructor(
    private readonly lockPath: string,
    private readonly savedLockPath: string,
    private readonly replacementMarker: string,
  ) {}

  arm(): void {
    this.armed = true;
  }

  readSecureText(filePath: string): string | undefined {
    return this.real.readSecureText(filePath);
  }

  writeSecureText(filePath: string, content: string): void {
    this.real.writeSecureText(filePath, content);
    if (this.armed && !this.triggered) {
      this.triggered = true;
      renameSync(this.lockPath, this.savedLockPath);
      writeFileSync(this.lockPath, this.replacementMarker, { mode: 0o600 });
    }
  }
}

test(
  'a mutex replaced by another process during acquire persistence is never silently deleted',
  () => {
    const base = mkdtempSync(join(tmpdir(), 'scoped-edits-lock-swap-acquire-'));
    const root = join(base, 'code');
    const state = join(base, 'state');
    mkdirSync(root);
    mkdirSync(state, { mode: 0o700 });
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/a.txt'), 'alpha\n', { mode: 0o644 });
    const lockPath = join(state, 'leases.lock');
    const savedLockPath = join(base, 'saved-acquire.lock');
    const replacementMarker = 'replacement-lock-acquire\n';
    const store = new LockSwapAfterWriteStore(lockPath, savedLockPath, replacementMarker);
    const service = new NodeScopedEdits(state, root, store);
    store.arm();
    try {
      const error = scopedError(() => service.acquire('writer-a', ['src/a.txt']));
      assert.equal(error.code, 'STATE_BUSY');
      assert.equal(error.sourceMayHaveChanged, false);
      assert.ok(store.triggered, 'expected the injected store to have swapped the lock file');
      assert.ok(
        readFileSync(savedLockPath, 'utf8').length > 0,
        'the original lock this process created must have been preserved under the saved path',
      );
      assert.equal(
        readFileSync(lockPath, 'utf8'), replacementMarker,
        "the replacement lock must survive mutex release untouched — it is not this process's to delete",
      );
      assert.equal(readFileSync(join(root, 'src/a.txt'), 'utf8'), 'alpha\n');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);

test(
  'a mutex replaced by another process during edit persistence after source changed '
  + 'is never silently deleted',
  () => {
    const base = mkdtempSync(join(tmpdir(), 'scoped-edits-lock-swap-edit-'));
    const root = join(base, 'code');
    const state = join(base, 'state');
    mkdirSync(root);
    mkdirSync(state, { mode: 0o700 });
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/a.txt'), 'alpha\n', { mode: 0o644 });
    const lockPath = join(state, 'leases.lock');
    const savedLockPath = join(base, 'saved-edit.lock');
    const replacementMarker = 'replacement-lock-edit\n';
    const store = new LockSwapAfterWriteStore(lockPath, savedLockPath, replacementMarker);
    const service = new NodeScopedEdits(state, root, store);
    try {
      const lease = service.acquire('writer-a', ['src/a.txt']);
      // Arm only now: the acquisition above must commit normally, and only
      // the edit's own persistence write below is subject to the swap.
      store.arm();
      const error = scopedError(() => service.edit(editRequest(lease)));
      assert.equal(error.code, 'STATE_BUSY');
      assert.equal(error.sourceMayHaveChanged, true);
      assert.ok(store.triggered, 'expected the injected store to have swapped the lock file');
      assert.ok(
        readFileSync(savedLockPath, 'utf8').length > 0,
        'the original lock this process created must have been preserved under the saved path',
      );
      assert.equal(
        readFileSync(lockPath, 'utf8'), replacementMarker,
        "the replacement lock must survive mutex release untouched — it is not this process's to delete",
      );
      assert.equal(
        readFileSync(join(root, 'src/a.txt'), 'utf8'), 'changed\n',
        'the already-committed source replacement must be preserved despite the mutex failure',
      );
      const [committedLease] = service.list();
      assert.equal(
        committedLease.operations.length, 1,
        'the registry write actually committed before the mutex was found replaced, '
        + 'so its history must remain observable',
      );
      assert.equal(committedLease.operations[0].beforeHash, lease.targets[0].hash);
      assert.notEqual(committedLease.targets[0].hash, lease.targets[0].hash);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);
