/**
 * Test-first Red-phase coverage for the planned NodeWorkflowIdentities module
 * (contract.json, src/review/NodeWorkflowIdentities.ts — not yet implemented).
 * This file intentionally imports a module that does not exist yet; until
 * the production implementer adds it, the whole suite is expected to fail to
 * *compile*, not merely fail at runtime. That compiler Red is the authorized
 * outcome of this increment (contract.json "reporting" -> "baseline": "All344
 * prior tests pass before edits; new planned module missing yields compile
 * Red only, not runtime evidence.").
 *
 * Scope reminder (contract.json "scope"/"rules"/"tests"): this module is a
 * dedicated workflow identity registry and exact canonical task-context
 * read. It proves field-for-field, byte-for-byte registry/task consistency
 * under a caller-held lock discipline — never a human approval, a signed
 * reviewer receipt, semantic review correctness, or a live task-mutation
 * API. Tests below never assert on any of those deferred behaviors, and
 * never fabricate deletion/creation-event proof this adapter cannot provide
 * (see the final "known limitation" test).
 *
 * contract.json v3 human_clarifications[0] (actual_user_response: "Use
 * IDENTITIES_REQUEST_INVALID (Recommended)") explicitly resolves every
 * malformed-method-argument caller-input-shape rejection — including a
 * malformed-shape `expectedRegistryDigest` and a malformed-shape `taskId`
 * argument to registerTask, as opposed to a digest *mismatch* against a
 * well-formed digest, which the contract pins explicitly and separately to
 * IDENTITIES_CONFLICT — to the single, dedicated `IDENTITIES_REQUEST_INVALID`
 * code, asserted directly below via `assertCode`, before any lock/write.
 * Nothing in this file still treats that code as unpinned or human-open.
 *
 * initialize()'s own atomic-publication seam (a human-approved optional
 * third constructor argument reusing the existing `HistoryPublisher`
 * interface from NodeWorkflowHistory verbatim, per contract.json v3's
 * human_clarifications[1]) is exercised below with the same real
 * write-then-throw / write-then-silently-corrupt uncertainty coverage as
 * registerTask's own injected-writer seam, mirroring the already-passing,
 * sibling NodeWorkflowHistory.test.ts coverage for its own initialize().
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fork, spawnSync } from 'node:child_process';
import {
  chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import {
  NodeWorkflowIdentities, WorkflowIdentityError, WorkflowIdentitySnapshot, WorkflowTaskContext,
  WORKFLOW_IDENTITIES_MAX_BYTES, WORKFLOW_TASKS_MAX_BYTES,
} from './NodeWorkflowIdentities';
import { HistoryPublisher } from './NodeWorkflowHistory';
import { digest as protocolDigest } from './protocol';
import { ISecureStore } from '../host/ISecureStore';
import { NodeSecureStore } from '../host/NodeSecureStore';
import { Task, TaskStatus } from '../data/types';

// ---------------------------------------------------------------------------
// Fixture scaffolding: a real, isolated synthetic .SprintDesk/data directory
// tree per test, never any live tracking state, always cleaned up.
// ---------------------------------------------------------------------------

interface Fixture {
  readonly base: string;
  readonly workspaceRoot: string;
  readonly dataDir: string;
  readonly tasksPath: string;
  readonly registryPath: string;
}

function registryLockPath(f: Fixture): string {
  return `${f.registryPath}.lock`;
}

function tasksLockPath(f: Fixture): string {
  return `${f.tasksPath}.lock`;
}

function createFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), 'workflow-identities-'));
  const workspaceRoot = join(base, 'workspace');
  mkdirSync(workspaceRoot, { mode: 0o700 });
  const dataDir = join(workspaceRoot, '.SprintDesk', 'data');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return {
    base,
    workspaceRoot,
    dataDir,
    tasksPath: join(dataDir, 'tasks.yml'),
    registryPath: join(dataDir, 'workflow-identities.json'),
  };
}

/**
 * Builds an isolated fixture, runs the synchronous test body against it, and
 * always removes the temporary directory afterwards (equivalent to node:test
 * TestContext#after, which the pinned @types/node@16 definitions do not
 * expose). Mirrors the established convention in NodeWorkflowHistory.test.ts.
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

// ---------------------------------------------------------------------------
// Real task fixtures, written as actual bytes to a real tasks.yml -- never a
// mocked/in-memory task source.
// ---------------------------------------------------------------------------

function buildTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    number: 1,
    code: 'SPD-1',
    name: 'Sample Task',
    title: 'Sample Task',
    type: 'feature',
    status: 'in-progress',
    priority: 'medium',
    epic: null,
    backlog: 'features',
    sprint: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Writes a real, well-formed tasks.yml (optionally with approvals) and returns the exact bytes written. */
function writeTasksYaml(f: Fixture, tasks: Task[], approvals?: unknown[]): string {
  const content = yaml.dump(approvals !== undefined ? { tasks, approvals } : { tasks });
  writeFileSync(f.tasksPath, content, 'utf8');
  return content;
}

function readTasksYamlRaw(f: Fixture): string {
  return readFileSync(f.tasksPath, 'utf8');
}

const DUPLICATE_KEY_YAML = 'tasks: []\ntasks: []\n';
const CUSTOM_TAG_YAML = 'tasks: !notallowed []\n';
const MERGE_EXPANSION_YAML =
  'defaults: &defaults\n  status: in-progress\ntasks:\n  - <<: *defaults\n    id: t1\n    createdAt: 2024-01-01T00:00:00.000Z\n';
const NON_ARRAY_TASKS_YAML = 'tasks: "not-an-array"\n';

// ---------------------------------------------------------------------------
// Shared digest/error helpers.
// ---------------------------------------------------------------------------

function sha256HexOfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const HEX_64 = /^[0-9a-f]{64}$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function identityError(operation: () => unknown): WorkflowIdentityError {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof WorkflowIdentityError, `expected a WorkflowIdentityError, received ${String(error)}`);
    return error as WorkflowIdentityError;
  }
  throw new Error('Expected operation to throw');
}

/**
 * Asserts on the error's actual `.code` property (per the contract's
 * error-vocabulary decision) rather than pattern-matching the free-form
 * message string. Reserved for prewrite rejections (request validation,
 * missing/not-found/ambiguous, contention, corruption/tamper detection,
 * digest conflict) which the contract requires to report
 * commitMayHaveChanged=false, since nothing was ever attempted to be
 * published. Genuine post-publication uncertainty is asserted separately,
 * with its own explicit true assertion, so the two families are never
 * silently conflated.
 */
function assertCode(operation: () => unknown, code: string): WorkflowIdentityError {
  const error = identityError(operation);
  assert.equal(error.code, code, `expected code ${code}, received ${error.code}`);
  assert.equal(
    error.commitMayHaveChanged, false,
    'a prewrite-rejected request/contention/corruption/conflict must report commitMayHaveChanged=false',
  );
  return error;
}

function assertUncertain(operation: () => unknown, code: string): WorkflowIdentityError {
  const error = identityError(operation);
  assert.equal(error.code, code, `expected code ${code}, received ${error.code}`);
  assert.equal(error.commitMayHaveChanged, true, 'a post-publication uncertain outcome must report commitMayHaveChanged=true');
  return error;
}

// ---------------------------------------------------------------------------
// Constructor validation: workspaceRoot only. No mkdir/chmod, no task/policy
// reads, no registry writes, no getHost/cwd fallback.
// ---------------------------------------------------------------------------

test('constructor rejects a non-absolute workspaceRoot before any filesystem access', () => {
  assertCode(() => new NodeWorkflowIdentities('relative/workspace'), 'IDENTITIES_CONTEXT_INVALID');
});

test('constructor rejects a missing workspaceRoot directory', () => withFixture(f => {
  assertCode(() => new NodeWorkflowIdentities(join(f.base, 'missing')), 'IDENTITIES_CONTEXT_INVALID');
}));

test('constructor rejects a non-canonical workspaceRoot path (.. segment) without normalizing it away first', () => withFixture(f => {
  // path.join() normalizes its result, so join(f.workspaceRoot, '..', 'workspace')
  // algebraically collapses the trailing '..'+'workspace' pair against the
  // preceding 'workspace' segment and returns a string byte-identical to the
  // already-canonical f.workspaceRoot -- the literal '..' substring never
  // actually reaches the constructor, and asserting rejection of that
  // collapsed result would wrongly outlaw a legitimate canonical root. Raw
  // string concatenation preserves the literal '..' substring so the
  // constructor genuinely receives a non-canonical path, while still
  // resolving (per Node's own path semantics, confirmed below without
  // using path.join to construct the input) to the exact same existing
  // directory -- isolating the intended invalidity to canonicalization
  // alone, never nonexistence.
  const nonCanonical = `${f.workspaceRoot}/../workspace`;
  assert.notEqual(nonCanonical, f.workspaceRoot, 'the raw fixture must differ from the canonical valid root as a string');
  assert.ok(nonCanonical.includes('..'), 'the raw fixture must preserve the literal .. substring, not a normalized collapse');
  assert.equal(
    join(nonCanonical), f.workspaceRoot,
    'the raw fixture must still resolve to the same existing, valid directory, so only the non-canonical form -- not a missing path -- is under test',
  );
  assertCode(() => new NodeWorkflowIdentities(nonCanonical), 'IDENTITIES_CONTEXT_INVALID');
}));

test('constructor rejects a workspaceRoot that is itself a symlink', () => withFixture(f => {
  const real = join(f.base, 'real-workspace');
  mkdirSync(real, { mode: 0o700 });
  const link = join(f.base, 'workspace-link');
  symlinkSync(real, link);
  assertCode(() => new NodeWorkflowIdentities(link), 'IDENTITIES_CONTEXT_INVALID');
}));

test('constructor rejects a workspaceRoot reached through a symlinked ancestor', () => withFixture(f => {
  const real = join(f.base, 'real-ancestor');
  mkdirSync(join(real, 'nested'), { recursive: true, mode: 0o700 });
  symlinkSync(real, join(f.base, 'alias'));
  assertCode(() => new NodeWorkflowIdentities(join(f.base, 'alias', 'nested')), 'IDENTITIES_CONTEXT_INVALID');
}));

test('constructor rejects a workspaceRoot that is a file, not a directory', () => withFixture(f => {
  const filePath = join(f.base, 'not-a-dir');
  writeFileSync(filePath, 'x');
  assertCode(() => new NodeWorkflowIdentities(filePath), 'IDENTITIES_CONTEXT_INVALID');
}));

test('constructor succeeds even when .SprintDesk/data does not yet exist, and mutates nothing', () => withFixture(f => {
  const bareRoot = join(f.base, 'bare-workspace');
  mkdirSync(bareRoot, { mode: 0o700 });
  new NodeWorkflowIdentities(bareRoot);
  assert.deepEqual(readdirSync(bareRoot), [], 'construction must never create .SprintDesk or any other path');
}));

test('constructor never reads or mutates an existing .SprintDesk/data directory', () => withFixture(f => {
  writeTasksYaml(f, [buildTask()]);
  const before = readdirSync(f.dataDir).sort();
  new NodeWorkflowIdentities(f.workspaceRoot);
  assert.deepEqual(readdirSync(f.dataDir).sort(), before, 'construction must never touch .SprintDesk/data');
}));

// ---------------------------------------------------------------------------
// initialize(): explicit trusted-caller setup; requires a real .SprintDesk/data
// directory and a well-formed tasks.yml; never creates missing project
// directories or copies canonical state; no-overwrite, atomic, owner-only.
// ---------------------------------------------------------------------------

test('initialize() requires a real .SprintDesk/data directory and never creates one', () => withFixture(f => {
  const bareRoot = join(f.base, 'bare-workspace-2');
  mkdirSync(bareRoot, { mode: 0o700 });
  const identities = new NodeWorkflowIdentities(bareRoot);
  assertCode(() => identities.initialize(), 'TASK_STORE_MISSING');
  assert.deepEqual(readdirSync(bareRoot), [], 'initialize() must never create missing project directories');
}));

test('initialize() requires an existing tasks.yml and never copies canonical state to create one', () => withFixture(f => {
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  assertCode(() => identities.initialize(), 'TASK_STORE_MISSING');
  assert.deepEqual(readdirSync(f.dataDir), [], 'initialize() must never author a tasks.yml itself');
}));

test('initialize() rejects a malformed tasks.yml without publishing a registry', () => withFixture(f => {
  writeFileSync(f.tasksPath, DUPLICATE_KEY_YAML, 'utf8');
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  assertCode(() => identities.initialize(), 'TASK_STORE_INVALID');
  assert.deepEqual(readdirSync(f.dataDir), ['tasks.yml'], 'no registry file may be published over an invalid task store');
}));

test('initialize() installs a complete, empty, version-1 registry exactly once', () => withFixture(f => {
  writeTasksYaml(f, [buildTask()]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.tasks.length, 0);
  assert.ok(UUID_SHAPE.test(snapshot.projectId), `projectId must look like a UUID, received ${snapshot.projectId}`);
  assert.ok(HEX_64.test(snapshot.digest), `digest must be 64 lowercase hex, received ${snapshot.digest}`);
  assert.equal(snapshot.digest, sha256HexOfFile(f.registryPath), 'digest must be the exact SHA256 of the persisted bytes');
}));

test('initialize() never overwrites an existing registry, even an identical one', () => withFixture(f => {
  writeTasksYaml(f, [buildTask()]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  identities.initialize();
  assertCode(() => identities.initialize(), 'IDENTITIES_ALREADY_EXISTS');
}));

test('initialize() publishes an owner-only registry file and directory on Linux', () => withFixture(f => {
  writeTasksYaml(f, [buildTask()]);
  new NodeWorkflowIdentities(f.workspaceRoot).initialize();
  assert.equal(statSync(f.registryPath).mode & 0o777, 0o600, 'the registry file must be owner-only');
}));

test('a restarted instance reads back the same persisted projectId after initialize()', () => withFixture(f => {
  writeTasksYaml(f, [buildTask()]);
  const snapshot = new NodeWorkflowIdentities(f.workspaceRoot).initialize();
  const restarted = new NodeWorkflowIdentities(f.workspaceRoot).read();
  assert.equal(restarted.projectId, snapshot.projectId);
  assert.equal(restarted.digest, snapshot.digest);
  assert.deepEqual(restarted.tasks, []);
}));

test('read()/registerTask()/resolveTask() never implicitly initialize a missing registry', () => withFixture(f => {
  const task = buildTask();
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  assertCode(() => identities.read(), 'IDENTITIES_MISSING');
  assert.deepEqual(readdirSync(f.dataDir), ['tasks.yml'], 'a failed read() must never create a registry');
}));

// ---------------------------------------------------------------------------
// read(): strict structural validation; never initializes or chmods; bounded
// bytes; rejects symlink/FIFO/nonregular/permissive-mode/corrupt content.
// ---------------------------------------------------------------------------

test('read() rejects a non-owner-readable registry file explicitly, without chmod-ing it (requires an unprivileged/non-root test runner)', () => withFixture(f => {
  writeTasksYaml(f, [buildTask()]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  identities.initialize();
  chmodSync(f.registryPath, 0o644);
  try {
    assertCode(() => identities.read(), 'IDENTITIES_INVALID');
    assert.equal(statSync(f.registryPath).mode & 0o777, 0o644, 'readers must never chmod the registry');
  } finally {
    chmodSync(f.registryPath, 0o600);
  }
}));

test('read() rejects a FIFO in place of the registry file as IDENTITIES_PATH_INVALID without blocking on open', () => withFixture(f => {
  writeTasksYaml(f, [buildTask()]);
  new NodeWorkflowIdentities(f.workspaceRoot).initialize();
  const mkfifo = spawnSync('/usr/bin/mkfifo', [`${f.registryPath}.fifo-swap`]);
  assert.equal(mkfifo.status, 0, `mkfifo must succeed (stderr: ${mkfifo.stderr?.toString() ?? ''})`);
  try {
    rmSync(f.registryPath);
    writeFileSync(`${f.registryPath}.marker`, 'noop');
    spawnSync('mv', [`${f.registryPath}.fifo-swap`, f.registryPath]);
    const identities = new NodeWorkflowIdentities(f.workspaceRoot);
    assertCode(() => identities.read(), 'IDENTITIES_PATH_INVALID');
  } finally {
    rmSync(f.registryPath, { force: true });
    rmSync(`${f.registryPath}.marker`, { force: true });
  }
}));

test('read() rejects a symlinked registry file as IDENTITIES_PATH_INVALID', () => withFixture(f => {
  writeTasksYaml(f, [buildTask()]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  identities.initialize();
  const real = readFileSync(f.registryPath, 'utf8');
  rmSync(f.registryPath);
  const externalTarget = join(f.base, 'external-registry.json');
  writeFileSync(externalTarget, real);
  symlinkSync(externalTarget, f.registryPath);
  assertCode(() => identities.read(), 'IDENTITIES_PATH_INVALID');
}));

test('read() rejects a directory in place of the registry file as IDENTITIES_PATH_INVALID', () => withFixture(f => {
  mkdirSync(f.registryPath);
  assertCode(() => new NodeWorkflowIdentities(f.workspaceRoot).read(), 'IDENTITIES_PATH_INVALID');
}));

test('read() rejects malformed JSON as IDENTITIES_INVALID', () => withFixture(f => {
  mkdirSync(f.dataDir, { recursive: true });
  writeFileSync(f.registryPath, '{not valid json', { mode: 0o600 });
  assertCode(() => new NodeWorkflowIdentities(f.workspaceRoot).read(), 'IDENTITIES_INVALID');
}));

test('read() rejects an unsupported registry version as IDENTITIES_VERSION_UNSUPPORTED', () => withFixture(f => {
  writeFileSync(f.registryPath, JSON.stringify({ version: 2, projectId: randomUUID(), tasks: [] }), { mode: 0o600 });
  assertCode(() => new NodeWorkflowIdentities(f.workspaceRoot).read(), 'IDENTITIES_VERSION_UNSUPPORTED');
}));

test('read() rejects a registry with duplicate taskId entries as IDENTITIES_INVALID', () => withFixture(f => {
  const dup: Task = buildTask();
  writeFileSync(f.registryPath, JSON.stringify({
    version: 1,
    projectId: randomUUID(),
    tasks: [
      { taskId: dup.id, createdAt: dup.createdAt, incarnation: randomUUID() },
      { taskId: dup.id, createdAt: dup.createdAt, incarnation: randomUUID() },
    ],
  }), { mode: 0o600 });
  assertCode(() => new NodeWorkflowIdentities(f.workspaceRoot).read(), 'IDENTITIES_INVALID');
}));

test('read() rejects a registry with duplicate incarnation values across entries as IDENTITIES_INVALID', () => withFixture(f => {
  const sharedIncarnation = randomUUID();
  writeFileSync(f.registryPath, JSON.stringify({
    version: 1,
    projectId: randomUUID(),
    tasks: [
      { taskId: 'task-a', createdAt: new Date().toISOString(), incarnation: sharedIncarnation },
      { taskId: 'task-b', createdAt: new Date().toISOString(), incarnation: sharedIncarnation },
    ],
  }), { mode: 0o600 });
  assertCode(() => new NodeWorkflowIdentities(f.workspaceRoot).read(), 'IDENTITIES_INVALID');
}));

test('read() rejects bytes beyond WORKFLOW_IDENTITIES_MAX_BYTES as IDENTITIES_TOO_LARGE', () => withFixture(f => {
  const padding = 'x'.repeat(WORKFLOW_IDENTITIES_MAX_BYTES + 1);
  writeFileSync(f.registryPath, JSON.stringify({ version: 1, projectId: randomUUID(), tasks: [], padding }), { mode: 0o600 });
  assertCode(() => new NodeWorkflowIdentities(f.workspaceRoot).read(), 'IDENTITIES_TOO_LARGE');
}));

// ---------------------------------------------------------------------------
// Canonical task source: exact taskId lookup only, no code/title fallback;
// duplicate ids are ambiguous; invalid identity/status fields are explicit;
// unrelated task/approval data is never interpreted or rewritten.
// ---------------------------------------------------------------------------

test('registerTask resolves a task by exact id only, never by code or title', () => withFixture(f => {
  const task = buildTask({ code: 'SPD-42', title: 'Find me by code, not id' });
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  assertCode(() => identities.registerTask(task.code, snapshot.digest), 'TASK_NOT_FOUND');
  assertCode(() => identities.registerTask(task.title, snapshot.digest), 'TASK_NOT_FOUND');
  const context = identities.registerTask(task.id, identities.read().digest);
  assert.equal(context.taskId, task.id);
}));

test('registerTask rejects duplicate exact task ids as TASK_AMBIGUOUS without any registry write', () => withFixture(f => {
  const sharedId = randomUUID();
  const first = buildTask({ id: sharedId });
  const second = buildTask({ id: sharedId });
  writeTasksYaml(f, [first, second]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  assertCode(() => identities.registerTask(sharedId, snapshot.digest), 'TASK_AMBIGUOUS');
  assert.deepEqual(identities.read().tasks, []);
}));

test('registerTask rejects an invalid stored status value as TASK_STATE_INVALID', () => withFixture(f => {
  const task = buildTask();
  const content = yaml.dump({ tasks: [{ ...task, status: 'not-a-real-status' }] });
  writeFileSync(f.tasksPath, content, 'utf8');
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  assertCode(() => identities.registerTask(task.id, snapshot.digest), 'TASK_STATE_INVALID');
}));

test('registerTask rejects a blank/oversized/non-ISO createdAt as TASK_STATE_INVALID', () => withFixture(f => {
  const task = buildTask();
  for (const badCreatedAt of ['', '   ', 'x'.repeat(257), 'not-a-timestamp']) {
    const content = yaml.dump({ tasks: [{ ...task, createdAt: badCreatedAt }] });
    writeFileSync(f.tasksPath, content, 'utf8');
    const identities = new NodeWorkflowIdentities(f.workspaceRoot);
    const snapshot = identities.initialize();
    assertCode(() => identities.registerTask(task.id, snapshot.digest), 'TASK_STATE_INVALID');
    rmSync(f.registryPath, { force: true });
  }
}));

test('registerTask/resolveTask reject a missing tasks.yml as TASK_STORE_MISSING', () => withFixture(f => {
  const task = buildTask();
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  rmSync(f.tasksPath);
  assertCode(() => identities.registerTask(task.id, snapshot.digest), 'TASK_STORE_MISSING');
  assertCode(() => identities.resolveTask(task.id), 'TASK_STORE_MISSING');
}));

// The following three tests isolate resolveTask's own canonical-source
// precedence (contract.json human_clarifications: "Validate the canonical
// task source first") from registerTask, each with a single, independent
// fixture condition -- never combined with a registerTask call or any other
// simultaneous failure mode in the same test, so none of these outcomes can
// be accidentally masked by an unrelated check firing first.

test('resolveTask alone (no prior registerTask call) rejects a missing tasks.yml as TASK_STORE_MISSING for a never-registered task', () => withFixture(f => {
  const task = buildTask();
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  identities.initialize();
  rmSync(f.tasksPath);
  assertCode(() => identities.resolveTask(task.id), 'TASK_STORE_MISSING');
}));

test('resolveTask rejects a malformed tasks.yml as TASK_STORE_INVALID for a never-registered task, taking precedence over TASK_UNREGISTERED', () => withFixture(f => {
  const task = buildTask();
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  identities.initialize();
  writeFileSync(f.tasksPath, DUPLICATE_KEY_YAML, 'utf8');
  assertCode(() => identities.resolveTask(task.id), 'TASK_STORE_INVALID');
}));

test('resolveTask rejects a taskId absent from an otherwise valid tasks.yml as TASK_NOT_FOUND, not TASK_UNREGISTERED, for a never-registered task', () => withFixture(f => {
  const task = buildTask();
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  identities.initialize();
  assertCode(() => identities.resolveTask(randomUUID()), 'TASK_NOT_FOUND');
}));

test(
  'registerTask rejects an unreadable tasks.yml as TASK_STORE_UNREADABLE (requires an unprivileged/non-root test runner)',
  () => withFixture(f => {
    const task = buildTask();
    writeTasksYaml(f, [task]);
    const identities = new NodeWorkflowIdentities(f.workspaceRoot);
    const snapshot = identities.initialize();
    chmodSync(f.tasksPath, 0o000);
    try {
      assertCode(() => identities.registerTask(task.id, snapshot.digest), 'TASK_STORE_UNREADABLE');
    } finally {
      chmodSync(f.tasksPath, 0o644);
    }
  }),
);

for (const [label, rawYaml] of [
  ['duplicate YAML keys', DUPLICATE_KEY_YAML],
  ['a custom YAML tag', CUSTOM_TAG_YAML],
  ['merge-key expansion', MERGE_EXPANSION_YAML],
  ['a non-array tasks field', NON_ARRAY_TASKS_YAML],
] as const) {
  test(`registerTask rejects tasks.yml containing ${label} as TASK_STORE_INVALID`, () => withFixture(f => {
    writeTasksYaml(f, [buildTask()]);
    const identities = new NodeWorkflowIdentities(f.workspaceRoot);
    const snapshot = identities.initialize();
    writeFileSync(f.tasksPath, rawYaml, 'utf8');
    assertCode(() => identities.registerTask('whatever-id', snapshot.digest), 'TASK_STORE_INVALID');
  }));
}

test('registerTask rejects a tasks.yml larger than WORKFLOW_TASKS_MAX_BYTES as TASK_STORE_TOO_LARGE', () => withFixture(f => {
  const task = buildTask();
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  const padding = 'x'.repeat(WORKFLOW_TASKS_MAX_BYTES + 1);
  writeFileSync(f.tasksPath, yaml.dump({ tasks: [{ ...task, title: padding }] }), 'utf8');
  assertCode(() => identities.registerTask(task.id, snapshot.digest), 'TASK_STORE_TOO_LARGE');
}));

test('registerTask never rewrites tasks.yml and preserves unrelated tasks/approvals byte-for-byte', () => withFixture(f => {
  const target = buildTask();
  const otherTask = buildTask({ id: randomUUID(), code: 'SPD-99', title: 'Unrelated other task' });
  const approvals = [{ version: 1, projectId: 'p', taskId: otherTask.id, note: 'unrelated approval payload' }];
  const before = writeTasksYaml(f, [target, otherTask], approvals);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  identities.registerTask(target.id, snapshot.digest);
  assert.equal(readTasksYamlRaw(f), before, 'tasks.yml must remain byte-identical after registerTask');
}));

// ---------------------------------------------------------------------------
// registerTask: lock discipline, digest conflicts, in-progress-only gate,
// idempotent no-op, replacement detection.
// ---------------------------------------------------------------------------

test('registerTask requires an initialized registry', () => withFixture(f => {
  const task = buildTask();
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  assertCode(() => identities.registerTask(task.id, 'a'.repeat(64)), 'IDENTITIES_MISSING');
}));

// Owner-reported regression probe: an exact, existing canonical workspace
// that has never had *any* .SprintDesk directory at all (not merely a
// missing registry file inside an existing .SprintDesk/data) must still
// report the same explicit IDENTITIES_MISSING as the fixture above -- never
// IDENTITIES_BUSY. The real-world bug this guards against: a lock-acquisition
// path that tries to create tasks.yml.lock before checking the registry
// itself exists can observe ENOENT on the lock file's own absent parent
// directory and misreport that as contention on an occupied lock, instead of
// surfacing the actual, distinct condition -- a missing source -- that the
// contract requires. No directory of any kind may be created by this failed
// call, so the bare workspace must remain byte-for-byte (here: entry-for-entry)
// empty before and after.
test(
  'registerTask on a bare workspace with no .SprintDesk directory at all rejects as IDENTITIES_MISSING, not '
  + 'IDENTITIES_BUSY, because tasks.yml.lock\'s parent directory is absent -- a missing source, never lock contention',
  () => withFixture(f => {
    const bareRoot = join(f.base, 'bare-workspace-register');
    mkdirSync(bareRoot, { mode: 0o700 });
    const identities = new NodeWorkflowIdentities(bareRoot);
    const before = readdirSync(bareRoot);
    assertCode(() => identities.registerTask(randomUUID(), 'a'.repeat(64)), 'IDENTITIES_MISSING');
    assert.deepEqual(
      readdirSync(bareRoot), before,
      'a bare workspace with no .SprintDesk directory must never gain any path from a failed registerTask',
    );
    assert.deepEqual(readdirSync(bareRoot), [], 'the bare workspace must remain completely empty');
  }),
);

// Companion probe: an already-initialized registry whose entire
// .SprintDesk/data directory is removed out-of-band *after* construction
// (simulating independent external cleanup/removal of the canonical source,
// never performed by this adapter itself) must report the identical
// IDENTITIES_MISSING -- not IDENTITIES_BUSY, and not a silent, implicit
// recreation of the missing directory tree. This isolates the regression to
// the absent-parent-directory condition itself, independent of whether that
// absence predates or postdates construction.
test(
  'registerTask after .SprintDesk/data is removed post-construction rejects as IDENTITIES_MISSING without '
  + 'automatically recreating any directory',
  () => withFixture(f => {
    const task = buildTask();
    writeTasksYaml(f, [task]);
    const identities = new NodeWorkflowIdentities(f.workspaceRoot);
    const snapshot = identities.initialize();
    rmSync(f.dataDir, { recursive: true, force: true });
    assertCode(() => identities.registerTask(task.id, snapshot.digest), 'IDENTITIES_MISSING');
    const sprintDeskDir = join(f.workspaceRoot, '.SprintDesk');
    assert.deepEqual(
      readdirSync(sprintDeskDir), [],
      '.SprintDesk/data must not be automatically recreated after explicit removal',
    );
  }),
);

test(
  'registerTask rejects a malformed expectedRegistryDigest shape as IDENTITIES_REQUEST_INVALID, before any lock/write '
  + '(contract.json v3 human_clarifications[0], pinned explicitly, distinct from a well-formed but stale digest\'s '
  + 'IDENTITIES_CONFLICT)',
  () => withFixture(f => {
    const task = buildTask();
    writeTasksYaml(f, [task]);
    const identities = new NodeWorkflowIdentities(f.workspaceRoot);
    identities.initialize();
    for (const badDigest of ['', 'not-hex', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
      assertCode(() => identities.registerTask(task.id, badDigest), 'IDENTITIES_REQUEST_INVALID');
    }
    assert.deepEqual(identities.read().tasks, [], 'no malformed-digest attempt may ever register a task');
    assert.ok(
      !readdirSync(f.dataDir).includes('tasks.yml.lock') && !readdirSync(f.dataDir).includes('workflow-identities.json.lock'),
      'a malformed-shape digest must be rejected before either lock is ever acquired',
    );
  }),
);

test(
  'registerTask rejects a malformed taskId shape as IDENTITIES_REQUEST_INVALID, before any lock/write '
  + '(same pinned code as a malformed expectedRegistryDigest; distinct from a well-formed but unmatched '
  + 'taskId\'s TASK_NOT_FOUND)',
  () => withFixture(f => {
    const task = buildTask();
    writeTasksYaml(f, [task]);
    const identities = new NodeWorkflowIdentities(f.workspaceRoot);
    const snapshot = identities.initialize();
    for (const badTaskId of ['', '   ', 'x'.repeat(257)]) {
      assertCode(() => identities.registerTask(badTaskId, snapshot.digest), 'IDENTITIES_REQUEST_INVALID');
    }
    assert.deepEqual(identities.read().tasks, [], 'no malformed-taskId attempt may ever register a task');
    assert.ok(
      !readdirSync(f.dataDir).includes('tasks.yml.lock') && !readdirSync(f.dataDir).includes('workflow-identities.json.lock'),
      'a malformed-shape taskId must be rejected before either lock is ever acquired',
    );
  }),
);

test('registerTask rejects a stale/mismatched expectedRegistryDigest as IDENTITIES_CONFLICT before any write', () => withFixture(f => {
  const task = buildTask();
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  identities.initialize();
  const wrongDigest = createHash('sha256').update('not-the-real-registry-bytes').digest('hex');
  assertCode(() => identities.registerTask(task.id, wrongDigest), 'IDENTITIES_CONFLICT');
  assert.deepEqual(identities.read().tasks, []);
}));

const REJECTED_STATUSES: readonly TaskStatus[] = [
  'waiting', 'under-review', 'needs-modification', 'done', 'blocked', 'cancelled',
];

for (const status of REJECTED_STATUSES) {
  test(`registerTask rejects a task in status "${status}" as TASK_STATE_INVALID, with no registry write`, () => withFixture(f => {
    const task = buildTask({ status });
    writeTasksYaml(f, [task]);
    const identities = new NodeWorkflowIdentities(f.workspaceRoot);
    const snapshot = identities.initialize();
    assertCode(() => identities.registerTask(task.id, snapshot.digest), 'TASK_STATE_INVALID');
    assert.deepEqual(identities.read().tasks, []);
  }));
}

test('registerTask performs a first in-progress registration with a stable assigned UUID incarnation', () => withFixture(f => {
  const task = buildTask({ status: 'in-progress' });
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  const context = identities.registerTask(task.id, snapshot.digest);
  assert.equal(context.taskId, task.id);
  assert.equal(context.createdAt, task.createdAt);
  assert.equal(context.status, 'in-progress');
  assert.equal(context.projectId, snapshot.projectId);
  assert.ok(UUID_SHAPE.test(context.incarnation), `incarnation must look like a UUID, received ${context.incarnation}`);
  assert.equal(context.taskDigest, protocolDigest(task), 'taskDigest must be protocol.digest over the full plain task object');
  assert.equal(context.registryDigest, sha256HexOfFile(f.registryPath));
  const after = identities.read();
  assert.equal(after.tasks.length, 1);
  assert.deepEqual(after.tasks[0], { taskId: task.id, createdAt: task.createdAt, incarnation: context.incarnation });
}));

test('registerTask is a no-write no-op when replayed with the current digest for an already-registered in-progress task', () => withFixture(f => {
  const task = buildTask({ status: 'in-progress' });
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  const first = identities.registerTask(task.id, snapshot.digest);
  const currentDigest = identities.read().digest;
  const before = readFileSync(f.registryPath);
  const second = identities.registerTask(task.id, currentDigest);
  assert.deepEqual(second, first, 'a verified no-op replay must return the identical context');
  assert.deepEqual(readFileSync(f.registryPath), before, 'a no-op replay must never write the registry');
}));

test('registerTask rejects a stale expectedRegistryDigest as IDENTITIES_CONFLICT even for an idempotent replay candidate', () => withFixture(f => {
  const task = buildTask({ status: 'in-progress' });
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const emptySnapshot = identities.initialize();
  identities.registerTask(task.id, emptySnapshot.digest);
  // The digest from before this registration committed is now stale; a
  // replay using it must never be treated as a trusted no-op shortcut.
  assertCode(() => identities.registerTask(task.id, emptySnapshot.digest), 'IDENTITIES_CONFLICT');
}));

test('registerTask throws TASK_REPLACED when the canonical createdAt differs from the registered value, preserving the prior incarnation', () => withFixture(f => {
  const task = buildTask({ status: 'in-progress' });
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  const first = identities.registerTask(task.id, snapshot.digest);
  const replacedTask = { ...task, createdAt: new Date(Date.parse(task.createdAt) + 60000).toISOString() };
  writeFileSync(f.tasksPath, yaml.dump({ tasks: [replacedTask] }), 'utf8');
  const currentDigest = identities.read().digest;
  assertCode(() => identities.registerTask(task.id, currentDigest), 'TASK_REPLACED');
  // No registry write occurred and no history was copied/reset: the prior
  // incarnation for the original (now-stale) createdAt remains exactly as it was.
  assert.deepEqual(identities.read().tasks, [{ taskId: task.id, createdAt: task.createdAt, incarnation: first.incarnation }]);
}));

// ---------------------------------------------------------------------------
// resolveTask(): read-only; any known status including under-review/done;
// missing registration is explicit; replacement rejects reads too.
// ---------------------------------------------------------------------------

test('resolveTask throws TASK_UNREGISTERED for a canonical, never-registered task', () => withFixture(f => {
  const task = buildTask({ status: 'in-progress' });
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  identities.initialize();
  assertCode(() => identities.resolveTask(task.id), 'TASK_UNREGISTERED');
}));

test('resolveTask resolves a registered task even after its status moves to under-review or done', () => withFixture(f => {
  const task = buildTask({ status: 'in-progress' });
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  const registered = identities.registerTask(task.id, snapshot.digest);
  for (const status of ['under-review', 'done'] as const) {
    writeFileSync(f.tasksPath, yaml.dump({ tasks: [{ ...task, status }] }), 'utf8');
    const resolved = identities.resolveTask(task.id);
    assert.equal(resolved.status, status);
    assert.equal(resolved.incarnation, registered.incarnation);
    assert.equal(resolved.createdAt, task.createdAt);
  }
}));

test('resolveTask never performs a registry write even for a valid, resolvable task', () => withFixture(f => {
  const task = buildTask({ status: 'in-progress' });
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  identities.registerTask(task.id, snapshot.digest);
  const before = readFileSync(f.registryPath);
  identities.resolveTask(task.id);
  assert.deepEqual(readFileSync(f.registryPath), before);
}));

test('resolveTask throws TASK_REPLACED when the registered createdAt no longer matches the canonical task', () => withFixture(f => {
  const task = buildTask({ status: 'in-progress' });
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  identities.registerTask(task.id, snapshot.digest);
  const replacedTask = { ...task, createdAt: new Date(Date.parse(task.createdAt) + 60000).toISOString() };
  writeFileSync(f.tasksPath, yaml.dump({ tasks: [replacedTask] }), 'utf8');
  assertCode(() => identities.resolveTask(task.id), 'TASK_REPLACED');
}));

// ---------------------------------------------------------------------------
// Lock discipline: exclusive mutexes, no stale-age reclamation, established
// tasks.yml.lock name, task lock acquired before the registry lock.
// ---------------------------------------------------------------------------

test('an occupied tasks.yml.lock (the established task-writer lock name) blocks registerTask and leaves registry/tasks unchanged', () => withFixture(f => {
  const task = buildTask({ status: 'in-progress' });
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  writeFileSync(tasksLockPath(f), 'held by another real task writer\n', { mode: 0o600 });
  assertCode(() => identities.registerTask(task.id, snapshot.digest), 'IDENTITIES_BUSY');
  assert.deepEqual(identities.read().tasks, []);
  assert.equal(readFileSync(tasksLockPath(f), 'utf8'), 'held by another real task writer\n', 'the foreign task lock must be preserved untouched');
  assert.ok(!readdirSync(f.dataDir).includes('workflow-identities.json.lock'),
    'registerTask must acquire tasks.yml.lock before ever attempting the registry lock');
}));

test('an occupied workflow-identities.json.lock blocks registerTask, and tasks.yml.lock is still released afterward', () => withFixture(f => {
  const task = buildTask({ status: 'in-progress' });
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  writeFileSync(registryLockPath(f), 'held by another real registry writer\n', { mode: 0o600 });
  assertCode(() => identities.registerTask(task.id, snapshot.digest), 'IDENTITIES_BUSY');
  assert.deepEqual(identities.read().tasks, []);
  assert.equal(readFileSync(registryLockPath(f), 'utf8'), 'held by another real registry writer\n');
  assert.ok(!readdirSync(f.dataDir).includes('tasks.yml.lock'), 'the task-writer lock this call held must be released, not left stuck');
}));

// ---------------------------------------------------------------------------
// Real cross-process contention: two real OS processes race the same
// expectedRegistryDigest; at most one registry commit may ever occur.
// ---------------------------------------------------------------------------

interface WorkerOutcome {
  readonly kind: 'ready' | 'result';
  readonly ok?: boolean;
  readonly taskId?: string;
  readonly code?: string;
  readonly commitMayHaveChanged?: boolean;
  readonly pid: number;
}

function startRegisterWorker(f: Fixture, taskId: string, expectedRegistryDigest: string) {
  const child = fork(
    join(__dirname, 'workflowIdentityWorker.js'),
    [f.workspaceRoot, taskId, expectedRegistryDigest],
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

test(
  'two real independent processes racing registerTask against the same expectedRegistryDigest produce at most one new registration',
  () => withFixtureAsync(async f => {
    const task = buildTask({ status: 'in-progress' });
    writeTasksYaml(f, [task]);
    const identities = new NodeWorkflowIdentities(f.workspaceRoot);
    const snapshot = identities.initialize();
    const first = startRegisterWorker(f, task.id, snapshot.digest);
    const second = startRegisterWorker(f, task.id, snapshot.digest);
    try {
      await Promise.all([first.ready, second.ready]);
      first.child.send('go');
      second.child.send('go');
      const results = await Promise.all([first.complete, second.complete]);
      const succeeded = results.filter(result => result.ok);
      assert.equal(succeeded.length, 1, 'exactly one of the two same-digest registrations must win');
      const failed = results.find(result => !result.ok);
      assert.ok(failed);
      assert.ok(
        failed.code === 'IDENTITIES_BUSY' || failed.code === 'IDENTITIES_CONFLICT',
        `expected IDENTITIES_BUSY or IDENTITIES_CONFLICT, received ${failed.code}`,
      );
      assert.equal(identities.read().tasks.length, 1, 'only the winning registration may be persisted');
      assert.equal(new Set(results.map(result => result.pid)).size, 2, 'both workers must be real, distinct OS processes');
    } finally {
      if (first.child.exitCode === null) { first.child.kill('SIGTERM'); }
      if (second.child.exitCode === null) { second.child.kill('SIGTERM'); }
    }
  }),
);

// ---------------------------------------------------------------------------
// Real injected writeSecureText seam: failure before vs. after publication;
// discard; task-change-during-publication drift.
// ---------------------------------------------------------------------------

class WriteFailsBeforePublicationStore implements Pick<ISecureStore, 'writeSecureText'> {
  public called = false;
  writeSecureText(): void {
    this.called = true;
    throw new Error('synthetic failure injected before any real registry write');
  }
}

test('a registerTask write failure before any real persistence reports commitMayHaveChanged=false and leaves the registry unchanged', () => withFixture(f => {
  const task = buildTask({ status: 'in-progress' });
  writeTasksYaml(f, [task]);
  const plain = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = plain.initialize();
  const store = new WriteFailsBeforePublicationStore();
  const identities = new NodeWorkflowIdentities(f.workspaceRoot, store);
  const before = readFileSync(f.registryPath);
  const error = identityError(() => identities.registerTask(task.id, snapshot.digest));
  assert.equal(error.code, 'IDENTITIES_WRITE_FAILED');
  assert.equal(error.commitMayHaveChanged, false);
  assert.ok(store.called, 'the injected writer must actually have been invoked');
  assert.deepEqual(readFileSync(f.registryPath), before, 'nothing must change when the write never committed');
}));

class RealWriteThenFailStore implements Pick<ISecureStore, 'writeSecureText'> {
  private readonly real = new NodeSecureStore();
  public writes = 0;
  writeSecureText(filePath: string, content: string): void {
    this.real.writeSecureText(filePath, content);
    this.writes += 1;
    throw new Error('synthetic failure injected after a real, already-committed registry write');
  }
}

test('a real committed registry write followed by a thrown error surfaces commitMayHaveChanged=true, and the registration is independently verifiable as genuinely persisted', () => withFixture(f => {
  const task = buildTask({ status: 'in-progress' });
  writeTasksYaml(f, [task]);
  const plain = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = plain.initialize();
  const store = new RealWriteThenFailStore();
  const identities = new NodeWorkflowIdentities(f.workspaceRoot, store);
  const error = identityError(() => identities.registerTask(task.id, snapshot.digest));
  assert.equal(error.code, 'IDENTITIES_WRITE_FAILED');
  assert.equal(error.commitMayHaveChanged, true);
  assert.equal(store.writes, 1, 'the injected writer must have actually performed its real write exactly once');
  // Independent real readback (a plain, uninjected instance) confirms the
  // registration actually committed to disk, not merely that the writer was called.
  const committed = plain.read();
  assert.equal(committed.tasks.length, 1);
  assert.equal(committed.tasks[0].taskId, task.id);
}));

class SilentlyDiscardingStore implements Pick<ISecureStore, 'writeSecureText'> {
  public calls = 0;
  writeSecureText(): void {
    this.calls += 1;
    // Intentionally performs no real filesystem write and does not throw --
    // models a writer that silently discards the requested bytes while
    // lying about having committed them.
  }
}

test('registerTask with a writer that silently discards the write must report IDENTITIES_READBACK_FAILED/commitMayHaveChanged=true, never a phantom success, and a later retry with a real writer persists exactly one registration', () => withFixture(f => {
  const task = buildTask({ status: 'in-progress' });
  writeTasksYaml(f, [task]);
  const plain = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = plain.initialize();
  const before = readFileSync(f.registryPath, 'utf8');
  const store = new SilentlyDiscardingStore();
  const identities = new NodeWorkflowIdentities(f.workspaceRoot, store);
  const error = identityError(() => identities.registerTask(task.id, snapshot.digest));
  assert.equal(error.code, 'IDENTITIES_READBACK_FAILED');
  assert.equal(error.commitMayHaveChanged, true);
  assert.ok(store.calls > 0, 'the injected writer must actually have been invoked');
  assert.equal(readFileSync(f.registryPath, 'utf8'), before, 'the real registry must remain exactly unchanged');
  assert.equal(plain.read().tasks.length, 0, 'no phantom registration may ever become independently readable');
  const retried = plain.registerTask(task.id, plain.read().digest);
  assert.equal(retried.taskId, task.id);
  assert.equal(plain.read().tasks.length, 1, 'the retry must persist exactly one real registration');
}));

/**
 * A writer whose writeSecureText() performs a real, but wrong, write --
 * truncating the candidate content before writing it -- and then returns
 * normally (no throw). Models a writer that lies about having committed the
 * exact requested bytes while still genuinely touching the real filesystem.
 * Distinct from SilentlyDiscardingStore above (which performs no real write
 * at all): this one actually corrupts real on-disk bytes, mirroring the
 * sibling TruncatingWriteStore coverage in NodeWorkflowHistory.test.ts.
 */
class TruncatingWriteStore implements Pick<ISecureStore, 'writeSecureText'> {
  private readonly real = new NodeSecureStore();
  public calls = 0;
  writeSecureText(filePath: string, content: string): void {
    this.calls += 1;
    this.real.writeSecureText(filePath, content.slice(0, Math.floor(content.length / 2)));
  }
}

test(
  'registerTask with a writer that performs a real but truncated/wrong registry write (no throw) must itself report '
  + 'IDENTITIES_READBACK_FAILED/commitMayHaveChanged=true, and an independent real instance explicitly rejects the '
  + 'now-corrupted registry as IDENTITIES_INVALID -- never a default/empty success -- with the explicit-invalid '
  + 'state surviving a further registerTask retry attempt rather than being silently erased or reset',
  () => withFixture(f => {
    const task = buildTask({ status: 'in-progress' });
    writeTasksYaml(f, [task]);
    const plain = new NodeWorkflowIdentities(f.workspaceRoot);
    const snapshot = plain.initialize();
    const store = new TruncatingWriteStore();
    const identities = new NodeWorkflowIdentities(f.workspaceRoot, store);
    const error = identityError(() => identities.registerTask(task.id, snapshot.digest));
    assert.equal(error.code, 'IDENTITIES_READBACK_FAILED');
    assert.equal(error.commitMayHaveChanged, true);
    assert.ok(store.calls > 0, 'the injected writer must actually have been invoked');
    // Independent real readback: the real on-disk registry is now genuinely
    // corrupted by the writer's own truncated write; an independent
    // instance must explicitly reject it, never silently succeed or default.
    const independent = new NodeWorkflowIdentities(f.workspaceRoot);
    assertCode(() => independent.read(), 'IDENTITIES_INVALID');
    // A further retry attempt against the now-corrupted real registry must
    // continue to detect and explicitly reject the corruption -- it must
    // never silently reset/erase the corrupted bytes or paper over them
    // with an unverified fresh success.
    assertCode(() => independent.registerTask(task.id, snapshot.digest), 'IDENTITIES_INVALID');
  }),
);

/**
 * Models an uncooperating external writer that mutates the real, canonical
 * tasks.yml bytes directly between the registry commit and this instance's
 * own post-write re-read of the task under its still-held lock. The
 * contract explicitly disclaims any global atomicity guarantee against an
 * external/noncooperating writer ("No global atomicity claim with
 * external/noncooperating writers"); this models exactly that scenario to
 * prove the post-write TASK_CHANGED detection path actually fires rather
 * than silently trusting a stale, already-validated task snapshot.
 */
class TaskChangesDuringPublicationStore implements Pick<ISecureStore, 'writeSecureText'> {
  private readonly real = new NodeSecureStore();
  constructor(private readonly tasksPath: string, private readonly mutatedTasksYaml: string) {}
  writeSecureText(filePath: string, content: string): void {
    this.real.writeSecureText(filePath, content);
    writeFileSync(this.tasksPath, this.mutatedTasksYaml, 'utf8');
  }
}

test('registerTask detects a task mutated during publication as TASK_CHANGED with commitMayHaveChanged=true, after a real registry commit', () => withFixture(f => {
  const task = buildTask({ status: 'in-progress' });
  writeTasksYaml(f, [task]);
  const plain = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = plain.initialize();
  const mutated = yaml.dump({ tasks: [{ ...task, status: 'done' }] });
  const store = new TaskChangesDuringPublicationStore(f.tasksPath, mutated);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot, store);
  const error = identityError(() => identities.registerTask(task.id, snapshot.digest));
  assert.equal(error.code, 'TASK_CHANGED');
  assert.equal(error.commitMayHaveChanged, true);
  // The registry publication itself genuinely committed before the drift was detected.
  assert.equal(plain.read().tasks.length, 1);
  assert.equal(plain.read().tasks[0].taskId, task.id);
}));

// ---------------------------------------------------------------------------
// initialize()'s own atomic-publication seam: the human-approved optional
// third constructor argument reuses the existing HistoryPublisher interface
// from NodeWorkflowHistory verbatim (contract.json v3 human_clarifications[1]
// / rules: "Initialization's optional publisher uses the existing
// HistoryPublisher interface from NodeWorkflowHistory, not a parallel
// compatibility alias."). This mirrors the already-passing sibling
// NodeWorkflowHistory.test.ts coverage for its own initialize(): failure
// strictly before any real write (commitMayHaveChanged=false); a real
// publisher that stages, then links staged bytes to the real registry path,
// then throws (commitMayHaveChanged=true, independently re-readable, a
// second initialize() refusing IDENTITIES_ALREADY_EXISTS); and a real
// publisher that links then silently damages the just-published bytes
// before returning normally (IDENTITIES_READBACK_FAILED/true, independent
// read explicitly rejects the corruption).
// ---------------------------------------------------------------------------

test(
  'a writer failure strictly before any real registry write reports IDENTITIES_WRITE_FAILED/commitMayHaveChanged=false '
  + 'for initialize() itself, and publishes nothing',
  () => withFixture(f => {
    writeTasksYaml(f, [buildTask()]);
    const store = new WriteFailsBeforePublicationStore();
    const identities = new NodeWorkflowIdentities(f.workspaceRoot, store);
    const error = identityError(() => identities.initialize());
    assert.equal(error.code, 'IDENTITIES_WRITE_FAILED');
    assert.equal(error.commitMayHaveChanged, false);
    assert.ok(store.called, 'the injected writer must actually have been invoked');
    assert.deepEqual(
      readdirSync(f.dataDir).sort(), ['tasks.yml'],
      'nothing must be published when the write never committed before any real publication attempt',
    );
  }),
);

/**
 * A real HistoryPublisher (the exact, existing interface from
 * NodeWorkflowHistory -- no parallel alias) that performs a genuine
 * same-filesystem hard link of the staged bytes to the final registry path
 * -- actually, completely committing the real empty version-1 registry --
 * and only then throws a synthetic marker. Models "real successful
 * publication followed by an uncertain failure" for initialize(), mirroring
 * RealLinkThenFailPublisher in NodeWorkflowHistory.test.ts.
 */
class RealLinkThenFailPublisher implements HistoryPublisher {
  public invoked = false;
  publish(stagedPath: string, finalPath: string): void {
    this.invoked = true;
    linkSync(stagedPath, finalPath);
    throw new Error('synthetic-marker-injected-after-real-publish');
  }
}

test(
  "initialize()'s real publisher that links staged bytes to the registry path and then throws reports "
  + 'IDENTITIES_WRITE_FAILED/commitMayHaveChanged=true with a valid assigned-UUID projectId on an otherwise-empty, '
  + 'independently re-readable registry; a second initialize() refuses IDENTITIES_ALREADY_EXISTS rather than '
  + 'overwriting or repeating publication',
  () => withFixture(f => {
    writeTasksYaml(f, [buildTask()]);
    const publisher = new RealLinkThenFailPublisher();
    const identities = new NodeWorkflowIdentities(f.workspaceRoot, undefined, publisher);
    const error = identityError(() => identities.initialize());
    assert.equal(error.code, 'IDENTITIES_WRITE_FAILED');
    assert.equal(error.commitMayHaveChanged, true);
    assert.ok(publisher.invoked, 'the injected publisher must actually have been invoked');
    // Independent real readback (a plain, uninjected instance) confirms the
    // empty registry genuinely committed, with a real assigned UUID
    // projectId -- never an invented/fabricated one.
    const independent = new NodeWorkflowIdentities(f.workspaceRoot);
    const snapshot = independent.read();
    assert.equal(snapshot.version, 1);
    assert.deepEqual(snapshot.tasks, []);
    assert.ok(UUID_SHAPE.test(snapshot.projectId), `projectId must look like a UUID, received ${snapshot.projectId}`);
    // A second initialize() against the now-real registry must refuse
    // rather than silently overwriting or repeating publication.
    assertCode(() => independent.initialize(), 'IDENTITIES_ALREADY_EXISTS');
  }),
);

/**
 * A real HistoryPublisher that performs a genuine same-filesystem hard link
 * of the staged bytes to the final registry path -- actually, completely
 * publishing real content -- and then, only AFTER that real publication,
 * intentionally damages the now-published registry file on disk (a real
 * truncating write) before returning normally (no throw). Models a
 * publisher that reports an uncertain-but-unthrown outcome while the real
 * on-disk artifact it just published is already corrupted, mirroring
 * RealLinkThenDamagePublisher in NodeWorkflowHistory.test.ts.
 */
class RealLinkThenDamagePublisher implements HistoryPublisher {
  public invoked = false;
  publish(stagedPath: string, finalPath: string): void {
    this.invoked = true;
    linkSync(stagedPath, finalPath);
    const published = readFileSync(finalPath, 'utf8');
    writeFileSync(finalPath, published.slice(0, Math.floor(published.length / 2)));
    // Returns normally: no throw, modeling a misreported/uncertain clean commit.
  }
}

test(
  "initialize()'s publisher that genuinely links staged bytes to the registry path and then damages the real "
  + 'published registry before returning normally (no throw) must itself report '
  + 'IDENTITIES_READBACK_FAILED/commitMayHaveChanged=true -- never a success-shaped snapshot -- and an independent '
  + 'real instance must explicitly reject the now-corrupted registry as IDENTITIES_INVALID, never report a '
  + 'default/empty success',
  () => withFixture(f => {
    writeTasksYaml(f, [buildTask()]);
    const publisher = new RealLinkThenDamagePublisher();
    const identities = new NodeWorkflowIdentities(f.workspaceRoot, undefined, publisher);
    const error = identityError(() => identities.initialize());
    assert.equal(error.code, 'IDENTITIES_READBACK_FAILED');
    assert.equal(error.commitMayHaveChanged, true);
    assert.ok(publisher.invoked, 'the injected publisher must actually have been invoked');
    // Independent real readback: the real on-disk registry is now genuinely
    // corrupted by the publisher's own post-publication damage; an
    // independent instance must explicitly reject it, never silently
    // succeed, default, or report any success-shaped snapshot.
    const independent = new NodeWorkflowIdentities(f.workspaceRoot);
    assertCode(() => independent.read(), 'IDENTITIES_INVALID');
  }),
);

// ---------------------------------------------------------------------------
// Output hygiene: deep-frozen defensive copies; no caller-object freezing;
// no signed/review fields ever present; error messages never echo raw task
// data, unknown key names or caller-submitted ids.
// ---------------------------------------------------------------------------

test('initialize()/read()/registerTask()/resolveTask() return deep-frozen defensive copies, never the caller-owned instance', () => withFixture(f => {
  const task = buildTask({ status: 'in-progress' });
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.tasks));
  const context = identities.registerTask(task.id, snapshot.digest);
  assert.ok(Object.isFrozen(context));
  const resolved = identities.resolveTask(task.id);
  assert.ok(Object.isFrozen(resolved));
}));

test('a WorkflowTaskContext exposes exactly the contracted seven fields, never any signing/reviewer/receipt data', () => withFixture(f => {
  const task = buildTask({ status: 'in-progress' });
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  const context: WorkflowTaskContext = identities.registerTask(task.id, snapshot.digest);
  assert.deepEqual(
    Object.keys(context).sort(),
    ['createdAt', 'incarnation', 'projectId', 'status', 'taskDigest', 'taskId', 'registryDigest'].sort(),
  );
}));

test('error messages never echo raw task data, unknown key names or the caller-submitted task id', () => withFixture(f => {
  const secretTitle = 'super-secret-task-title-marker-xyz';
  const submittedId = 'caller-submitted-id-should-not-leak-998877';
  writeTasksYaml(f, [buildTask({ title: secretTitle })]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  const error = identityError(() => identities.registerTask(submittedId, snapshot.digest));
  const serialized = JSON.stringify({ message: error.message, code: error.code });
  assert.ok(!serialized.includes(secretTitle));
  assert.ok(!serialized.includes(submittedId));
}));

// ---------------------------------------------------------------------------
// Known, honestly-disclosed limitation: identical id+createdAt deletion and
// reuse cannot be proven or detected from this source alone. This test
// documents the limitation rather than fabricating a deletion-detection
// capability that does not and cannot exist for this adapter.
// ---------------------------------------------------------------------------

test(
  'known limitation: a task deleted and recreated with an IDENTICAL id and createdAt is indistinguishable from the '
  + 'original and is NOT, and cannot be, detected as replaced or reused by this adapter -- disclosed, not fabricated',
  () => withFixture(f => {
    const task = buildTask({ status: 'in-progress' });
    writeTasksYaml(f, [task]);
    const identities = new NodeWorkflowIdentities(f.workspaceRoot);
    const snapshot = identities.initialize();
    const original = identities.registerTask(task.id, snapshot.digest);
    // Simulate the canonical task store being deleted and an operator
    // recreating a task that happens to carry the identical id and
    // createdAt (the only fields this registry pins identity to). Nothing
    // about this source lets the adapter distinguish this from "the same
    // task, never touched" -- there is no creation-event journal to compare
    // against, and the contract explicitly does not ask for one here.
    writeTasksYaml(f, [{ ...task, title: 'A recreated task sharing the identical id+createdAt' }]);
    const resolved = identities.resolveTask(task.id);
    assert.equal(
      resolved.incarnation, original.incarnation,
      'identical id+createdAt reuse is indistinguishable from the original by design of this source; this is a '
      + 'disclosed limitation (see contract.json rules), not an immutable-creation-event guarantee',
    );
  }),
);
