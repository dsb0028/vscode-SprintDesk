import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { setSecureStore } from '../../host';
import { NodeSecureStore } from '../../host/NodeSecureStore';
import { ISecureStore } from '../../host/ISecureStore';
import { ReviewerStore, normalizeReviewerDisplayName, normalizeReviewerId } from './ReviewerStore';

const ROOT = join(process.cwd(), 'out', '.sprintdesk-reviewer-test-workspace');
const IS_POSIX = process.platform !== 'win32';
const IS_ROOT = IS_POSIX && typeof process.getuid === 'function' && process.getuid() === 0;

function registryPath(workspace: string): string {
  return join(workspace, '.SprintDesk', 'data', 'reviewers.yml');
}

function employeesPath(workspace: string): string {
  return join(workspace, '.SprintDesk', 'workforce', 'employees.yml');
}

function createWorkspace(name: string): string {
  const workspace = join(ROOT, name);
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(join(workspace, '.SprintDesk', 'data'), { recursive: true });
  return workspace;
}

function writeEmployees(workspace: string, content: string): void {
  mkdirSync(join(workspace, '.SprintDesk', 'workforce'), { recursive: true });
  writeFileSync(employeesPath(workspace), content, 'utf8');
}

function writeRegistry(workspace: string, content: string): void {
  writeFileSync(registryPath(workspace), content, 'utf8');
  if (IS_POSIX) {chmodSync(registryPath(workspace), 0o600);}
}

function expectError(operation: () => unknown, pattern: RegExp): Error {
  try {
    operation();
  } catch (error: unknown) {
    assert.ok(error instanceof Error);
    assert.match(error.message, pattern);
    return error;
  }
  throw new assert.AssertionError({ message: `Expected an error matching ${pattern}` });
}

function testNormalization(): void {
  assert.equal(normalizeReviewerId('  reviewer-1  '), 'reviewer-1');
  assert.equal(normalizeReviewerId(undefined), '');
  assert.equal(normalizeReviewerDisplayName('  First   Reviewer '), 'First Reviewer');
  assert.equal(normalizeReviewerDisplayName(42), '');
}

function testFreshInstallEmptyRegistry(): void {
  const workspace = createWorkspace('fresh-install');
  const store = new ReviewerStore(workspace);

  assert.deepEqual(store.list(), []);
  assert.equal(store.count(), 0);
  assert.equal(store.find('nobody'), undefined);
  assert.equal(store.has('nobody'), false);
  // Reading never creates the registry; only registration does.
  assert.equal(existsSync(registryPath(workspace)), false);

  store.register({ reviewerId: 'reviewer-1', displayName: 'First Reviewer' });
  assert.equal(readFileSync(registryPath(workspace), 'utf8'), 'reviewers:\n  - id: reviewer-1\n    displayName: First Reviewer\n');
}

function testExplicitEmptyRegistryIsAccepted(): void {
  const workspace = createWorkspace('explicit-empty');
  writeRegistry(workspace, 'reviewers: []\n');
  const store = new ReviewerStore(workspace);

  assert.deepEqual(store.list(), []);
  assert.equal(store.count(), 0);
  assert.equal(store.find('reviewer-1'), undefined);
}

function testRegistrationReadbackAndRestart(): void {
  const workspace = createWorkspace('registration');
  const store = new ReviewerStore(workspace);

  const registered = store.register({ reviewerId: ' reviewer-1 ', displayName: '  First   Reviewer ' });
  assert.deepEqual(registered, { id: 'reviewer-1', displayName: 'First Reviewer' });
  store.register({ reviewerId: 'reviewer-2', displayName: 'Second Reviewer' });

  assert.deepEqual(yaml.load(readFileSync(registryPath(workspace), 'utf8')), {
    reviewers: [
      { id: 'reviewer-1', displayName: 'First Reviewer' },
      { id: 'reviewer-2', displayName: 'Second Reviewer' },
    ],
  });

  // A new store instance stands in for a restarted process.
  const restarted = new ReviewerStore(workspace);
  assert.deepEqual(restarted.list().map(reviewer => reviewer.id), ['reviewer-1', 'reviewer-2']);
  assert.deepEqual(restarted.find('reviewer-1'), { id: 'reviewer-1', displayName: 'First Reviewer' });
  assert.deepEqual(restarted.find('  reviewer-1  '), { id: 'reviewer-1', displayName: 'First Reviewer' });
  assert.deepEqual(restarted.find('Second Reviewer'), { id: 'reviewer-2', displayName: 'Second Reviewer' });
  assert.equal(restarted.find('reviewer-3'), undefined);
  assert.equal(restarted.has('reviewer-2'), true);
  assert.equal(restarted.has('reviewer-3'), false);
}

function testDuplicateRegistrationRejected(): void {
  const workspace = createWorkspace('duplicates');
  const store = new ReviewerStore(workspace);
  store.register({ reviewerId: 'reviewer-1', displayName: 'First Reviewer' });

  const before = readFileSync(registryPath(workspace), 'utf8');
  const error = expectError(
    () => store.register({ reviewerId: '  reviewer-1  ', displayName: 'Renamed Reviewer' }),
    /already registered/,
  );
  assert.ok(!error.message.includes('reviewer-1'));
  assert.ok(!error.message.includes('Renamed Reviewer'));
  assert.equal(readFileSync(registryPath(workspace), 'utf8'), before);

  const nameError = expectError(
    () => store.register({ reviewerId: 'reviewer-2', displayName: '  First   Reviewer  ' }),
    /name is already in use/,
  );
  assert.ok(!nameError.message.includes('First Reviewer'));
  assert.equal(readFileSync(registryPath(workspace), 'utf8'), before);
}

function testInvalidRegistrationInput(): void {
  const workspace = createWorkspace('invalid-input');
  const store = new ReviewerStore(workspace);

  expectError(() => store.register({ reviewerId: '   ', displayName: 'Reviewer' }), /id between 1 and 128/);
  expectError(() => store.register({ reviewerId: 'reviewer-1', displayName: '  ' }), /displayName between 1 and 200/);
  expectError(() => store.register({ reviewerId: 'r'.repeat(129), displayName: 'Reviewer' }), /id between 1 and 128/);
  expectError(
    () => store.register({ reviewerId: 'reviewer-1', displayName: 'n'.repeat(201) }),
    /displayName between 1 and 200/,
  );
  assert.deepEqual(store.list(), []);
  assert.equal(existsSync(registryPath(workspace)), false);
}

function testEmployeesAreNotReviewers(): void {
  const workspace = createWorkspace('registry-independence');
  const legacyEmployees = `employees:
  - id: reviewer-1
    name: Human Reviewer
    role: human
  - id: agent-1
    name: Build Agent
    role: agent
`;
  writeEmployees(workspace, legacyEmployees);

  const store = new ReviewerStore(workspace);
  // The employee registry is maintained independently and confers no reviewer authority.
  assert.deepEqual(store.list(), []);
  assert.equal(store.find('reviewer-1'), undefined);
  assert.equal(store.has('Human Reviewer'), false);
  assert.equal(existsSync(registryPath(workspace)), false);

  store.register({ reviewerId: 'reviewer-2', displayName: 'Second Reviewer' });
  assert.deepEqual(store.list(), [{ id: 'reviewer-2', displayName: 'Second Reviewer' }]);
  assert.equal(store.find('reviewer-1'), undefined);
  // The employee registry is never read, rewritten, or pruned by the reviewer registry.
  assert.equal(readFileSync(employeesPath(workspace), 'utf8'), legacyEmployees);
}

function testMalformedEmployeesDoNotAffectRegistry(): void {
  const workspace = createWorkspace('employees-malformed');
  const brokenEmployees = 'employees: [\n';
  writeEmployees(workspace, brokenEmployees);

  const store = new ReviewerStore(workspace);
  assert.deepEqual(store.list(), []);
  assert.deepEqual(store.register({ reviewerId: 'reviewer-1', displayName: 'First Reviewer' }), {
    id: 'reviewer-1',
    displayName: 'First Reviewer',
  });
  assert.equal(readFileSync(employeesPath(workspace), 'utf8'), brokenEmployees);
}

function testMalformedRegistryRejected(): void {
  const cases: Array<[string, RegExp]> = [
    ['reviewers: [\n', /malformed YAML/],
    ['[]\n', /must be a mapping/],
    ['reviewers: []\nextra: 1\n', /unsupported top-level keys/],
    ['reviewers: {}\n', /must be a list/],
    ['reviewers:\n  - reviewer-1\n', /must be a mapping/],
    ['reviewers:\n  - id: reviewer-1\n    displayName: R\n    role: human\n', /unsupported fields/],
    ['reviewers:\n  - id: 7\n    displayName: R\n', /must define string/],
    ['reviewers:\n  - id: reviewer-1\n    displayName: R\n  - id: " reviewer-1 "\n    displayName: S\n', /duplicates/],
    ['reviewers:\n  - id: "   "\n    displayName: R\n', /id between 1 and 128/],
  ];

  cases.forEach(([content, pattern], index) => {
    const workspace = createWorkspace(`malformed-${index}`);
    writeRegistry(workspace, content);
    const store = new ReviewerStore(workspace);
    expectError(() => store.list(), pattern);
    expectError(() => store.register({ reviewerId: 'reviewer-9', displayName: 'Ninth' }), pattern);
    assert.equal(readFileSync(registryPath(workspace), 'utf8'), content);
  });
}

function testFailedWritePreservesRegistry(): void {
  const workspace = createWorkspace('failed-write');
  const seedStore = new ReviewerStore(workspace);
  seedStore.register({ reviewerId: 'reviewer-1', displayName: 'First Reviewer' });
  const before = readFileSync(registryPath(workspace), 'utf8');

  const delegate = new NodeSecureStore();
  const failingStore: ISecureStore = {
    readSecureText: filePath => delegate.readSecureText(filePath),
    writeSecureText: () => {
      throw new Error('Unable to write reviewers.yml: ENOSPC');
    },
    withFileLock: (lockPath, operation, options) => delegate.withFileLock(lockPath, operation, options),
  };

  setSecureStore(failingStore);
  try {
    const store = new ReviewerStore(workspace);
    expectError(() => store.register({ reviewerId: 'reviewer-2', displayName: 'Second Reviewer' }), /Unable to write/);
  } finally {
    setSecureStore(delegate);
  }

  assert.equal(readFileSync(registryPath(workspace), 'utf8'), before);
  assert.deepEqual(new ReviewerStore(workspace).list(), [{ id: 'reviewer-1', displayName: 'First Reviewer' }]);
}

function testAtomicWriteLeavesNoTemporaryFiles(): void {
  const workspace = createWorkspace('atomic-write');
  const store = new ReviewerStore(workspace);
  store.register({ reviewerId: 'reviewer-1', displayName: 'First Reviewer' });

  const dataDirectory = join(workspace, '.SprintDesk', 'data');
  const leftovers = readFileSync(registryPath(workspace), 'utf8');
  assert.match(leftovers, /reviewer-1/);
  assert.deepEqual(
    require('node:fs').readdirSync(dataDirectory).filter((entry: string) => entry !== 'reviewers.yml'),
    [],
  );
}

function testSymlinkRejected(): void {
  if (!IS_POSIX) {return;}
  const workspace = createWorkspace('symlink');
  const decoy = join(workspace, 'decoy.yml');
  writeFileSync(decoy, 'reviewers: []\n', 'utf8');
  symlinkSync(decoy, registryPath(workspace));

  const store = new ReviewerStore(workspace);
  expectError(() => store.list(), /symbolic link/);
  expectError(() => store.register({ reviewerId: 'reviewer-1', displayName: 'First Reviewer' }), /symbolic link/);
  assert.equal(readFileSync(decoy, 'utf8'), 'reviewers: []\n');
}

function testPermissionsTightenedAndEnforced(): void {
  if (!IS_POSIX) {return;}
  const workspace = createWorkspace('permissions');
  const store = new ReviewerStore(workspace);
  store.register({ reviewerId: 'reviewer-1', displayName: 'First Reviewer' });

  assert.equal(statSync(registryPath(workspace)).mode & 0o777, 0o600);
  assert.equal(statSync(join(workspace, '.SprintDesk', 'data')).mode & 0o777, 0o700);

  // A world-readable registry is tightened back to owner-only on the next read.
  chmodSync(registryPath(workspace), 0o644);
  assert.deepEqual(new ReviewerStore(workspace).list(), [{ id: 'reviewer-1', displayName: 'First Reviewer' }]);
  assert.equal(statSync(registryPath(workspace)).mode & 0o777, 0o600);
}

function testUnreadableRegistryFailsExplicitly(): void {
  if (!IS_POSIX || IS_ROOT) {return;}
  const workspace = createWorkspace('unreadable');
  const store = new ReviewerStore(workspace);
  store.register({ reviewerId: 'reviewer-1', displayName: 'First Reviewer' });

  chmodSync(registryPath(workspace), 0o000);
  try {
    expectError(() => new ReviewerStore(workspace).list(), /Unable to read reviewers\.yml/);
  } finally {
    chmodSync(registryPath(workspace), 0o600);
  }
}

function testLockTimeoutIsExplicit(): void {
  const workspace = createWorkspace('lock-timeout');
  const secureStore = new NodeSecureStore();
  const lockPath = join(workspace, '.SprintDesk', 'data', 'reviewers.yml.lock');

  secureStore.withFileLock(lockPath, () => {
    expectError(
      () => secureStore.withFileLock(lockPath, () => undefined, { timeoutMs: 60, staleMs: 60_000 }),
      /Timed out waiting for the reviewers\.yml\.lock lock/,
    );
  });

  // A stale lock is reclaimed instead of blocking forever.
  writeFileSync(lockPath, '1\n', 'utf8');
  assert.equal(secureStore.withFileLock(lockPath, () => 'reclaimed', { timeoutMs: 200, staleMs: 0 }), 'reclaimed');
  assert.equal(existsSync(lockPath), false);
}

function workerScriptPath(): string {
  return join(process.cwd(), 'out', 'data', 'stores', 'reviewerConcurrencyWorker.js');
}

function runWorker(workspace: string, prefix: string, count: number): Promise<{ code: number; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [workerScriptPath(), workspace, prefix, String(count)]);
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });
    child.on('close', code => resolve({ code: code ?? -1, stderr }));
  });
}

async function testConcurrentRegistrationsFromSeparateProcesses(): Promise<void> {
  const workspace = createWorkspace('concurrency');
  const perWorker = 25;

  // Both workers run at the same time so the lock sees real contention.
  const results = await Promise.all([
    runWorker(workspace, 'alpha', perWorker),
    runWorker(workspace, 'beta', perWorker),
  ]);
  results.forEach(result => assert.equal(result.code, 0, result.stderr));

  const persisted = yaml.load(readFileSync(registryPath(workspace), 'utf8')) as {
    reviewers: Array<{ id: string; displayName: string }>;
  };
  assert.equal(persisted.reviewers.length, perWorker * 2);
  assert.equal(new Set(persisted.reviewers.map(reviewer => reviewer.id)).size, perWorker * 2);
  assert.ok(persisted.reviewers.some(reviewer => reviewer.id === 'alpha-0'));
  assert.ok(persisted.reviewers.some(reviewer => reviewer.id === 'beta-24'));
  // The registry still parses through the strict loader after contention.
  assert.equal(new ReviewerStore(workspace).list().length, perWorker * 2);
  assert.equal(existsSync(`${registryPath(workspace)}.lock`), false);
}

async function testHeldLockSerializesAnotherProcess(): Promise<void> {
  const workspace = createWorkspace('lock-serialization');
  const secureStore = new NodeSecureStore();
  const store = new ReviewerStore(workspace);
  store.register({ reviewerId: 'reviewer-1', displayName: 'First Reviewer' });

  let released = 0;
  let workerFinished = 0;

  const pending = secureStore.withFileLock(`${registryPath(workspace)}.lock`, () => {
    const worker = runWorker(workspace, 'blocked', 1).then(result => {
      workerFinished = Date.now();
      return result;
    });
    // Hold the lock long enough that an unserialized worker would finish early.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    assert.equal(workerFinished, 0, 'worker completed while the registry lock was held');
    released = Date.now();
    return worker;
  });

  const result = await pending;
  assert.equal(result.code, 0, result.stderr);
  assert.ok(workerFinished >= released, 'worker finished before the lock was released');
  assert.deepEqual(new ReviewerStore(workspace).list().map(reviewer => reviewer.id), [
    'reviewer-1',
    'blocked-0',
  ]);
}

async function runReviewerStoreTests(): Promise<void> {
  try {
    setSecureStore(new NodeSecureStore());
    testNormalization();
    testFreshInstallEmptyRegistry();
    testExplicitEmptyRegistryIsAccepted();
    testRegistrationReadbackAndRestart();
    testDuplicateRegistrationRejected();
    testInvalidRegistrationInput();
    testEmployeesAreNotReviewers();
    testMalformedEmployeesDoNotAffectRegistry();
    testMalformedRegistryRejected();
    testFailedWritePreservesRegistry();
    testAtomicWriteLeavesNoTemporaryFiles();
    testSymlinkRejected();
    testPermissionsTightenedAndEnforced();
    testUnreadableRegistryFailsExplicitly();
    testLockTimeoutIsExplicit();
    await testConcurrentRegistrationsFromSeparateProcesses();
    await testHeldLockSerializesAnotherProcess();
  } finally {
    rmSync(ROOT, { recursive: true, force: true });
  }
}

runReviewerStoreTests()
  .then(() => console.log('Reviewer registry tests passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
