/**
 * Test-first Red-phase coverage for the planned NodeTaskWorkflowHistory module
 * (contract.json, src/review/NodeTaskWorkflowHistory.ts — not yet implemented,
 * production_phase_approved: false). This file intentionally imports a module
 * that does not exist yet; until a separately-approved production increment
 * adds it, the whole suite is expected to fail to *compile*, not merely fail
 * at runtime. That compiler Red is the authorized outcome of this increment
 * (contract.json "reporting" -> "baseline": "All419 prior tests should pass
 * before authoring; missing new module is compile Red only, zero new runtime
 * cases.").
 *
 * Scope reminder (contract.json "scope"/"trust_boundary"/"deferred"): this
 * module is a task-bound custody adapter over the already-independently
 * tested NodeWorkflowIdentities (canonical task context) and
 * NodeWorkflowHistory (bounded artifact/revision ledger) libraries, gated by
 * a trusted constructor-injected WorkflowMutationAuthority. It is never a
 * human approval, a signed reviewer receipt, a live task-mutation API, or
 * proof of authentic host capture; this increment does not implement a real
 * host authority adapter.
 *
 * Every WorkflowMutationAuthority implementation below is a narrow,
 * explicitly-labelled SYNTHETIC test fixture. None of them are, prove, or
 * substitute for a real human approval, signed consent, or operational host
 * trace -- see contract.json "trust_boundary". Tests never assert on any
 * deferred behavior (real host adapter, cryptographic provenance, creation-
 * event journal, etc.).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fork } from 'node:child_process';
import {
  linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import {
  NodeTaskWorkflowHistory, WorkflowCustodyError, WorkflowMutationAuthority, WorkflowMutationRequest,
} from './NodeTaskWorkflowHistory';
import { NodeWorkflowIdentities, WorkflowTaskContext } from './NodeWorkflowIdentities';
import {
  HISTORY_ARTIFACT_MAX_BYTES, HistoryAppend, HistoryArtifactKind, HistoryPublisher, HistoryRevision, NodeWorkflowHistory,
} from './NodeWorkflowHistory';
import { WorkflowBinding } from './workflowBinding';
import { digest as protocolDigest } from './protocol';
import { Task, TaskStatus } from '../data/types';

// ---------------------------------------------------------------------------
// Fixture scaffolding: a real, isolated synthetic .SprintDesk/data directory
// tree and a real, separately-tested identities registry per test. Never any
// live tracking state; always cleaned up.
// ---------------------------------------------------------------------------

interface Fixture {
  readonly base: string;
  readonly workspaceRoot: string;
  readonly dataDir: string;
  readonly tasksPath: string;
  readonly registryPath: string;
}

function tasksLockPath(f: Fixture): string {
  return `${f.tasksPath}.lock`;
}

function createFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), 'task-workflow-history-'));
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

function writeTasksYaml(f: Fixture, tasks: Task[]): void {
  writeFileSync(f.tasksPath, yaml.dump({ tasks }), 'utf8');
}

/** Initializes a real identities registry and registers one real in-progress task, returning its context. */
function registerInProgressTask(f: Fixture, overrides: Partial<Task> = {}): { task: Task; context: WorkflowTaskContext } {
  const task = buildTask({ status: 'in-progress', ...overrides });
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  const context = identities.registerTask(task.id, snapshot.digest);
  return { task, context };
}

/** Rewrites tasks.yml for the exact same task id/createdAt, changing only its status in place. */
function rewriteTaskStatus(f: Fixture, task: Task, status: TaskStatus): void {
  writeTasksYaml(f, [{ ...task, status }]);
}

/** Rewrites tasks.yml for the exact same task id/createdAt/status, drifting only unrelated metadata (title). */
function rewriteTaskTitle(f: Fixture, task: Task, title: string): void {
  writeTasksYaml(f, [{ ...task, title }]);
}

function registerSecondUnrelatedTask(f: Fixture): void {
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const second = buildTask({ status: 'in-progress' });
  const current = identities.read();
  const existingTasks = (yaml.load(readFileSync(f.tasksPath, 'utf8')) as { tasks: Task[] }).tasks;
  writeTasksYaml(f, [...existingTasks, second]);
  identities.registerTask(second.id, current.digest);
}

function custodyDirectory(f: Fixture, context: WorkflowTaskContext): string {
  const tupleDigest = protocolDigest({
    projectId: context.projectId, taskId: context.taskId, incarnation: context.incarnation,
  });
  return join(f.workspaceRoot, '.SprintDesk', 'workflow', 'history', tupleDigest);
}

function workflowRootExists(f: Fixture): boolean {
  try {
    statSync(join(f.workspaceRoot, '.SprintDesk', 'workflow'));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Binding/append fixtures, mirroring the already-tested sibling conventions.
// ---------------------------------------------------------------------------

function buildBinding(context: WorkflowTaskContext, overrides: Partial<WorkflowBinding> = {}): WorkflowBinding {
  return {
    version: 1,
    stage: 'planning',
    projectId: context.projectId,
    taskId: context.taskId,
    incarnation: context.incarnation,
    criterionId: 'criterion-1',
    criterionRevision: 'rev-1',
    sourceRevision: 'source-rev-1',
    sourceDigest: protocolDigest({ source: 'fixture-source-content' }),
    policyDigest: protocolDigest({ policy: 'fixture-policy' }),
    attemptId: 'attempt-1',
    ...overrides,
  };
}

function buildAppend(context: WorkflowTaskContext, overrides: Partial<HistoryAppend> = {}): HistoryAppend {
  return {
    operationId: randomUUID(),
    expectedLatest: 0,
    binding: buildBinding(context),
    kind: 'scenario' as HistoryArtifactKind,
    bytes: new TextEncoder().encode('fixture-artifact-content'),
    ...overrides,
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

// ---------------------------------------------------------------------------
// SYNTHETIC authority doubles. Every implementation here is an explicitly
// labelled test fixture exercising the trusted-adapter boundary described in
// contract.json "trust_boundary" -- never a model of, or stand-in for, real
// human approval, host capture, or operational workflow authority.
// ---------------------------------------------------------------------------

class SyntheticAllowAuthority implements WorkflowMutationAuthority {
  public readonly calls: WorkflowMutationRequest[] = [];

  assertAllowed(request: WorkflowMutationRequest): void {
    this.calls.push(request);
  }
}

class SyntheticRejectAuthority implements WorkflowMutationAuthority {
  constructor(private readonly secretDetail: string = 'synthetic-secret-provider-detail-should-not-leak') {}

  assertAllowed(): void {
    throw new Error(this.secretDetail);
  }
}

/** Captures the exact request and attempts (but must fail) to mutate it in place, proving it is an immutable copy. */
class SyntheticCapturingAuthority implements WorkflowMutationAuthority {
  public readonly captured: WorkflowMutationRequest[] = [];

  assertAllowed(request: WorkflowMutationRequest): void {
    this.captured.push(request);
    assert.throws(
      () => { (request as unknown as { workspaceRoot: string }).workspaceRoot = 'tampered-workspace-root'; },
      'the request handed to authority must be frozen, not a mutable live reference',
    );
  }
}

/**
 * SYNTHETIC authority that mutates the real canonical task store from
 * *within its own callback* before returning normally (allowing). This
 * models a misbehaving/untrusted adapter for the sole purpose of proving the
 * post-authority re-resolve guard in contract.json rule 12 -- it is never a
 * model of real host capture or legitimate authority behavior.
 */
class SyntheticSourceMutatingAuthority implements WorkflowMutationAuthority {
  constructor(private readonly f: Fixture, private readonly task: Task) {}

  assertAllowed(): void {
    rewriteTaskTitle(this.f, this.task, 'tampered-by-authority-during-callback');
  }
}

/**
 * SYNTHETIC authority that -- during its own assertAllowed() callback, for
 * 'append' operations only -- mutates the caller's own original bytes array
 * (the very same Uint8Array reference the caller passed into append(), held
 * here only via a constructor-injected reference, never read back out of the
 * request itself). This models a misbehaving/untrusted adapter callback for
 * the sole purpose of proving that the operation's contentDigest and the
 * eventually persisted bytes are both already fixed from an ORIGINAL
 * pre-callback snapshot -- never a model of real host capture, consent, or
 * legitimate authority behavior (contract.json "trust_boundary").
 */
class SyntheticAppendOriginalBytesMutatingAuthority implements WorkflowMutationAuthority {
  public appendCalls = 0;
  public lastAppendRequest: WorkflowMutationRequest | undefined;

  constructor(private readonly originalBytes: Uint8Array) {}

  assertAllowed(request: WorkflowMutationRequest): void {
    if (request.operation.kind === 'append') {
      this.appendCalls += 1;
      this.lastAppendRequest = request;
      this.originalBytes.fill(0xff);
    }
  }
}

// ---------------------------------------------------------------------------
// Shared error helpers, mirroring the established sibling convention.
// ---------------------------------------------------------------------------

function custodyError(operation: () => unknown): WorkflowCustodyError {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof WorkflowCustodyError, `expected a WorkflowCustodyError, received ${String(error)}`);
    return error as WorkflowCustodyError;
  }
  throw new Error('Expected operation to throw');
}

/**
 * Reserved for prewrite rejections (request validation, context drift
 * detected before any mutation, task-state/binding mismatches, missing
 * authority, authority rejection, contention) which must report
 * commitMayHaveChanged=false, since nothing was ever attempted to be
 * published.
 */
function assertCode(operation: () => unknown, code: string): WorkflowCustodyError {
  const error = custodyError(operation);
  assert.equal(error.code, code, `expected code ${code}, received ${error.code}`);
  assert.equal(
    error.commitMayHaveChanged, false,
    'a prewrite-rejected operation must report commitMayHaveChanged=false',
  );
  return error;
}

/** Reserved for genuine post-attempt uncertain outcomes, asserted with their own explicit true flag. */
function assertUncertain(operation: () => unknown, code: string): WorkflowCustodyError {
  const error = custodyError(operation);
  assert.equal(error.code, code, `expected code ${code}, received ${error.code}`);
  assert.equal(error.commitMayHaveChanged, true, 'a post-attempt uncertain outcome must report commitMayHaveChanged=true');
  return error;
}

// ---------------------------------------------------------------------------
// context(): independent immutable verified current context; accurate
// propagation of underlying identity errors.
// ---------------------------------------------------------------------------

test('context() returns an independent, deeply frozen snapshot matching the real registered task', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId);
  const first = history.context();
  assert.deepEqual(first, context);
  assert.ok(Object.isFrozen(first), 'context() must return a frozen snapshot');
  const second = history.context();
  assert.deepEqual(second, first, 'repeated context() calls must independently re-verify, not cache');
}));

test('context() propagates the accurate underlying identity error when the canonical task has been replaced', () => withFixture(f => {
  const { task, context } = registerInProgressTask(f);
  // A genuine replacement: same id, different createdAt -- the registry's
  // own TASK_REPLACED detection, never duplicated or reworded here.
  writeTasksYaml(f, [{ ...task, createdAt: new Date(Date.now() + 60000).toISOString() }]);
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId);
  assert.throws(() => history.context(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as { code?: string }).code, 'TASK_REPLACED');
    return true;
  });
}));

// ---------------------------------------------------------------------------
// Default missing authority: denies all writes without allocating custody
// directories. Read-only operations are a separate concern tested below.
// ---------------------------------------------------------------------------

test('initialize() with no authority denies the write and allocates no custody directories', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId);
  assertCode(() => history.initialize(context), 'CUSTODY_AUTHORITY_UNAVAILABLE');
  assert.equal(workflowRootExists(f), false, 'no .SprintDesk/workflow tree may be created without authority');
}));

test('append() with no authority denies the write and leaves an already-initialized ledger unchanged', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow).initialize(context);
  const directory = custodyDirectory(f, context);
  const before = readFileSync(join(directory, 'ledger.json'), 'utf8');
  const unauthorized = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId);
  assertCode(() => unauthorized.append(context, buildAppend(context)), 'CUSTODY_AUTHORITY_UNAVAILABLE');
  assert.equal(readFileSync(join(directory, 'ledger.json'), 'utf8'), before, 'the ledger must remain byte-for-byte unchanged');
}));

// ---------------------------------------------------------------------------
// Explicit SYNTHETIC providers: accept/reject, and exact immutable
// context+operation delivery.
// ---------------------------------------------------------------------------

test('initialize() with an explicit SYNTHETIC allow authority succeeds and creates the canonical digest directory', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
  const head = history.initialize(context);
  assert.equal(head.latestSequence, 0);
  const expectedDirectory = custodyDirectory(f, context);
  assert.equal(statSync(expectedDirectory).isDirectory(), true);
  assert.equal(statSync(expectedDirectory).mode & 0o777, 0o700, 'the custody directory must be owner-only');
  assert.equal(allow.calls.length, 1, 'the authority must actually have been invoked exactly once');
}));

test('a rejecting SYNTHETIC authority yields CUSTODY_AUTHORITY_REJECTED with a static sanitized message and no directories', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const reject = new SyntheticRejectAuthority();
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, reject);
  const error = assertCode(() => history.initialize(context), 'CUSTODY_AUTHORITY_REJECTED');
  assert.ok(!error.message.includes('synthetic-secret-provider-detail-should-not-leak'), 'thrown provider detail must never leak into the error message');
  assert.equal(workflowRootExists(f), false, 'a rejected authority must never allocate any custody directory');
}));

test('the SYNTHETIC authority receives an exact, frozen, immutable copy of the current context and operation', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const capturing = new SyntheticCapturingAuthority();
  new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, capturing).initialize(context);
  assert.equal(capturing.captured.length, 1);
  const request = capturing.captured[0];
  assert.deepEqual(request.context, context);
  assert.deepEqual(request.operation, { kind: 'initialize' });
  assert.equal(request.workspaceRoot, f.workspaceRoot);
  assert.ok(Object.isFrozen(request), 'the request itself must be frozen');
  assert.ok(Object.isFrozen(request.context), "the request's context must be frozen");
}));

test('the SYNTHETIC authority receives exact immutable append operation fields including a real content digest', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
  history.initialize(context);
  const capturing = new SyntheticCapturingAuthority();
  const captor = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, capturing);
  const append = buildAppend(context, { expectedLatest: 0 });
  captor.append(context, append);
  assert.equal(capturing.captured.length, 1);
  const operation = capturing.captured[0].operation as {
    kind: string; operationId: string; expectedLatest: number; binding: WorkflowBinding;
    artifactKind: HistoryArtifactKind; contentDigest: string;
  };
  assert.equal(operation.kind, 'append');
  assert.equal(operation.operationId, append.operationId);
  assert.equal(operation.expectedLatest, 0);
  assert.deepEqual(operation.binding, append.binding);
  assert.equal(operation.artifactKind, append.kind);
  assert.equal(operation.contentDigest, sha256Hex(append.bytes));
}));

// ---------------------------------------------------------------------------
// Canonical fixed-location derivation: exact protocol.digest tuple; no path
// injection, symlink or permissive-namespace fallback.
// ---------------------------------------------------------------------------

test('the custody directory is exactly workspaceRoot/.SprintDesk/workflow/history/<protocol.digest(identity tuple)>', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow).initialize(context);
  const historyRoot = join(f.workspaceRoot, '.SprintDesk', 'workflow', 'history');
  const entries = readdirSync(historyRoot);
  const expectedTuple = protocolDigest({ projectId: context.projectId, taskId: context.taskId, incarnation: context.incarnation });
  assert.deepEqual(entries, [expectedTuple], 'exactly one directory, named the protocol digest of the identity tuple, must exist');
}));

test('a pre-existing symlink at the exact digest directory path blocks initialize() without ever following it', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const expectedDirectory = custodyDirectory(f, context);
  mkdirSync(join(f.workspaceRoot, '.SprintDesk', 'workflow', 'history'), { recursive: true, mode: 0o700 });
  const externalTarget = join(f.base, 'external-escape-target');
  mkdirSync(externalTarget, { mode: 0o700 });
  symlinkSync(externalTarget, expectedDirectory);
  const allow = new SyntheticAllowAuthority();
  assertCode(() => new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow).initialize(context), 'CUSTODY_PATH_INVALID');
  assert.deepEqual(readdirSync(externalTarget), [], 'the symlink target must never be written into');
}));

test('a pre-existing permissive-mode directory at the digest path is rejected without chmod-ing it', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const expectedDirectory = custodyDirectory(f, context);
  mkdirSync(expectedDirectory, { recursive: true, mode: 0o755 });
  const allow = new SyntheticAllowAuthority();
  assertCode(() => new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow).initialize(context), 'CUSTODY_PATH_INVALID');
  assert.equal(statSync(expectedDirectory).mode & 0o777, 0o755, 'a permissive pre-existing directory must never be chmod-recovered');
}));

test('a pre-existing strict owner-only-mode empty digest directory is reused rather than rejected', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const expectedDirectory = custodyDirectory(f, context);
  mkdirSync(expectedDirectory, { recursive: true, mode: 0o700 });
  const allow = new SyntheticAllowAuthority();
  const head = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow).initialize(context);
  assert.equal(head.latestSequence, 0);
}));

// ---------------------------------------------------------------------------
// Malformed seven-field expected contexts / extra consent flags; no caller
// object freezing.
// ---------------------------------------------------------------------------

function omitField(context: WorkflowTaskContext, field: keyof WorkflowTaskContext): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...context };
  delete clone[field as string];
  return clone;
}

function malformedContextCases(context: WorkflowTaskContext): ReadonlyArray<[string, unknown]> {
  return [
    ['missing projectId', omitField(context, 'projectId')],
    ['missing taskDigest', omitField(context, 'taskDigest')],
    ['extra unknown field', { ...context, extra: 'nope' }],
    ['extra approved flag', { ...context, approved: true }],
    ['extra confirmed flag', { ...context, confirmed: true }],
    ['non-string taskDigest', { ...context, taskDigest: 12345 }],
    ['non-hex registryDigest', { ...context, registryDigest: 'not-a-valid-hex-digest-value-padded-to-length-xx' }],
    ['invalid status value', { ...context, status: 'not-a-real-status' }],
    ['null context', null],
    ['array context', [context]],
  ];
}

/** Mirrors omitField() above, but for the five-field HistoryAppend shape (F4 gap). */
function omitAppendField(append: HistoryAppend, field: keyof HistoryAppend): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...append };
  delete clone[field as string];
  return clone;
}

/**
 * Malformed five-field HistoryAppend cases (F4 gap): extra unsolicited
 * confirmation flags, an unsupported artifact kind, wrong-typed bytes, and
 * non-safe-integer/negative expectedLatest values, plus a missing required
 * field and an entirely non-object request. None of these may ever reach
 * authority or mutate the ledger; every one must be rejected as
 * CUSTODY_REQUEST_INVALID before either.
 */
function malformedAppendCases(context: WorkflowTaskContext): ReadonlyArray<[string, unknown]> {
  const base = buildAppend(context);
  return [
    ['extra unknown field', { ...base, extra: 'nope' }],
    ['extra approved flag', { ...base, approved: true }],
    ['extra confirmed flag', { ...base, confirmed: true }],
    ['invalid artifact kind', { ...base, kind: 'not-a-real-kind' }],
    ['wrong-typed bytes (string, not Uint8Array)', { ...base, bytes: 'not-bytes' }],
    ['unsafe-integer expectedLatest', { ...base, expectedLatest: Number.MAX_SAFE_INTEGER + 1 }],
    ['non-integer expectedLatest', { ...base, expectedLatest: 1.5 }],
    ['negative expectedLatest', { ...base, expectedLatest: -1 }],
    ['missing bytes field', omitAppendField(base, 'bytes')],
    ['null append request', null],
  ];
}

test('initialize() rejects every malformed seven-field expected context before touching authority or disk', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const capturing = new SyntheticCapturingAuthority();
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, capturing);
  for (const [label, malformed] of malformedContextCases(context)) {
    try {
      assertCode(() => history.initialize(malformed as unknown as WorkflowTaskContext), 'CUSTODY_CONTEXT_INVALID');
    } catch (error) {
      throw new Error(`case "${label}" must be rejected as CUSTODY_CONTEXT_INVALID: ${String(error)}`);
    }
  }
  assert.equal(capturing.captured.length, 0, 'authority must never be consulted for a malformed expected context');
  assert.equal(workflowRootExists(f), false, 'no custody directory may ever be created for a malformed expected context');
}));

test('initialize() never freezes or mutates the caller-supplied expected context object', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const mutableExpected: WorkflowTaskContext = { ...context };
  const allow = new SyntheticAllowAuthority();
  new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow).initialize(mutableExpected);
  assert.equal(Object.isFrozen(mutableExpected), false, 'the caller object must never be frozen by initialize()');
  assert.deepEqual(mutableExpected, context, 'the caller object must never be mutated by initialize()');
}));

test('append() never freezes or mutates the caller-supplied expected context object', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
  history.initialize(context);
  const mutableExpected: WorkflowTaskContext = { ...context };
  history.append(mutableExpected, buildAppend(context));
  assert.equal(Object.isFrozen(mutableExpected), false, 'the caller object must never be frozen by append()');
  assert.deepEqual(mutableExpected, context, 'the caller object must never be mutated by append()');
}));

// ---------------------------------------------------------------------------
// Whole task/registry digest/createdAt/status drift detected before mutation.
// ---------------------------------------------------------------------------

test('a status drift between the captured expected context and the live source blocks CUSTODY_CONTEXT_CHANGED (false) before any write', () => withFixture(f => {
  const { task, context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
  rewriteTaskStatus(f, task, 'blocked');
  assertCode(() => history.initialize(context), 'CUSTODY_CONTEXT_CHANGED');
  assert.equal(workflowRootExists(f), false, 'drift detected before mutation must never allocate the custody directory');
  assert.equal(allow.calls.length, 0, 'authority must never be consulted once drift is already detected');
}));

test('a taskDigest drift from unrelated metadata changes (status unchanged) is still blocked CUSTODY_CONTEXT_CHANGED', () => withFixture(f => {
  const { task, context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
  rewriteTaskTitle(f, task, 'A completely different title');
  assertCode(() => history.initialize(context), 'CUSTODY_CONTEXT_CHANGED');
  assert.equal(workflowRootExists(f), false);
}));

test('a registryDigest drift from an unrelated concurrently-registered task is blocked CUSTODY_CONTEXT_CHANGED', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
  registerSecondUnrelatedTask(f);
  assertCode(() => history.initialize(context), 'CUSTODY_CONTEXT_CHANGED');
  assert.equal(workflowRootExists(f), false);
}));

// ---------------------------------------------------------------------------
// Foreign binding rejected before allocation/write.
// ---------------------------------------------------------------------------

test('append() rejects a binding bound to a foreign taskId as CUSTODY_BINDING_MISMATCH without writing', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
  history.initialize(context);
  const foreignBinding = buildBinding(context, { taskId: randomUUID() });
  assertCode(() => history.append(context, buildAppend(context, { binding: foreignBinding })), 'CUSTODY_BINDING_MISMATCH');
  assert.equal(history.head().latestSequence, 0, 'a binding mismatch must never advance the ledger');
}));

// ---------------------------------------------------------------------------
// Old-operation replay remains status/context/authority guarded.
// ---------------------------------------------------------------------------

test('an old-operation append retry with unchanged context reconciles to the identical revision without a duplicate write', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
  history.initialize(context);
  const append = buildAppend(context, { expectedLatest: 0 });
  const first = history.append(context, append);
  const second = history.append(context, { ...append });
  assert.deepEqual(second, first);
  assert.equal(history.head().latestSequence, 1, 'the retry must never create a duplicate revision');
}));

test('an old-operation append retry is still CUSTODY_TASK_STATE_INVALID once the task has left in-progress', () => withFixture(f => {
  const { task, context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
  history.initialize(context);
  const append = buildAppend(context, { expectedLatest: 0 });
  history.append(context, append);
  rewriteTaskStatus(f, task, 'under-review');
  // Even though this is byte-for-byte the exact same previously-stored
  // operation, the contract requires the status guard to still apply to a
  // replay, never short-circuiting straight to the cached ledger result.
  assertCode(() => history.append(context, append), 'CUSTODY_TASK_STATE_INVALID');
  assert.equal(history.head().latestSequence, 1, 'the blocked replay must never create a second revision');
}));

// ---------------------------------------------------------------------------
// Reads never require write authority; known non-in-progress statuses
// (under-review, done) still permit reads.
// ---------------------------------------------------------------------------

test('read operations succeed without any authority once the task has moved to under-review', () => withFixture(f => {
  const { task, context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  const writerHistory = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
  writerHistory.initialize(context);
  writerHistory.append(context, buildAppend(context, { expectedLatest: 0 }));
  rewriteTaskStatus(f, task, 'under-review');
  const reader = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId);
  assert.equal(reader.head().latestSequence, 1);
  assert.equal(reader.list(0, 10).length, 1);
  const revision: HistoryRevision = reader.read(1);
  assert.equal(revision.sequence, 1);
  assert.ok(reader.readBytes(1) instanceof Uint8Array);
}));

test('read operations succeed without any authority once the task has moved to done', () => withFixture(f => {
  const { task, context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  const writerHistory = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
  writerHistory.initialize(context);
  rewriteTaskStatus(f, task, 'done');
  const reader = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId);
  assert.equal(reader.head().latestSequence, 0);
  assert.deepEqual(reader.list(0, 10), []);
}));

test('read operations on a never-initialized task propagate HISTORY_MISSING and allocate nothing', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const reader = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId);
  assert.throws(() => reader.head(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as { code?: string }).code, 'HISTORY_MISSING');
    return true;
  });
  assert.equal(workflowRootExists(f), false, 'a missing-history read must never allocate the custody directory');
}));

test('append() before initialize() propagates HISTORY_MISSING rather than implicitly initializing', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
  assert.throws(() => history.append(context, buildAppend(context)), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as { code?: string }).code, 'HISTORY_MISSING');
    return true;
  });
  assert.equal(workflowRootExists(f), false, 'append() must never mkdir/initialize an absent ledger');
}));

// ---------------------------------------------------------------------------
// Task mutex (.SprintDesk/data/tasks.yml.lock) held across authority and
// custody write; a foreign holder blocks cleanly with truthful flags.
// ---------------------------------------------------------------------------

test('initialize() blocked by a foreign-held tasks.yml.lock reports CUSTODY_BUSY(false) without consulting authority', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  writeFileSync(tasksLockPath(f), 'held by another process\n', { mode: 0o600 });
  const capturing = new SyntheticCapturingAuthority();
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, capturing);
  assertCode(() => history.initialize(context), 'CUSTODY_BUSY');
  assert.equal(capturing.captured.length, 0, 'authority must never be consulted while a foreign task lock is held');
  assert.equal(workflowRootExists(f), false);
  assert.equal(readFileSync(tasksLockPath(f), 'utf8'), 'held by another process\n', 'the foreign lock must be left untouched');
}));

test('append() blocked by a foreign-held tasks.yml.lock leaves an already-initialized ledger unchanged', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
  history.initialize(context);
  const directory = custodyDirectory(f, context);
  const before = readFileSync(join(directory, 'ledger.json'), 'utf8');
  writeFileSync(tasksLockPath(f), 'held by another process\n', { mode: 0o600 });
  assertCode(() => history.append(context, buildAppend(context)), 'CUSTODY_BUSY');
  assert.equal(readFileSync(join(directory, 'ledger.json'), 'utf8'), before);
}));

// ---------------------------------------------------------------------------
// An authority that mutates the real task source from within its own
// callback is blocked (false) before any custody setup -- "false blocked"
// per the task description.
// ---------------------------------------------------------------------------

test('a SYNTHETIC authority that mutates the real task source during its own callback is blocked CUSTODY_CONTEXT_CHANGED(false) with no setup', () => withFixture(f => {
  const { task, context } = registerInProgressTask(f);
  const mutating = new SyntheticSourceMutatingAuthority(f, task);
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, mutating);
  assertCode(() => history.initialize(context), 'CUSTODY_CONTEXT_CHANGED');
  assert.equal(workflowRootExists(f), false, 'an authority-induced drift must still block before any custody directory is created');
}));

// ---------------------------------------------------------------------------
// A real writer/publisher that changes the task source *during* publication
// (after setup/mutation has begun) triggers true postcommit uncertainty, and
// the actual bytes already committed are preserved rather than rolled back.
// ---------------------------------------------------------------------------

class RealLinkThenMutateSourcePublisher implements HistoryPublisher {
  public invoked = false;

  constructor(private readonly f: Fixture, private readonly task: Task) {}

  publish(stagedPath: string, ledgerPath: string): void {
    this.invoked = true;
    // Perform the real publication first -- a genuine, complete commit --
    // then simulate an external writer changing the real task source in the
    // narrow window before this operation's own post-attempt recheck runs.
    linkSync(stagedPath, ledgerPath);
    rewriteTaskTitle(this.f, this.task, 'drifted-during-real-publication');
  }
}

test('a real writer that changes the task source during ledger publication surfaces CUSTODY_CONTEXT_CHANGED(true), preserving the committed bytes', () => withFixture(f => {
  const { task, context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  const publisher = new RealLinkThenMutateSourcePublisher(f, task);
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow, undefined, publisher);
  assertUncertain(() => history.initialize(context), 'CUSTODY_CONTEXT_CHANGED');
  assert.ok(publisher.invoked, 'the injected publisher must actually have been invoked');
  const directory = custodyDirectory(f, context);
  const independent = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId);
  // The ledger's own real custody content must remain exactly as genuinely
  // published -- never rolled back -- even though the overall operation
  // reports uncertainty due to the detected source drift.
  assert.doesNotThrow(() => statSync(join(directory, 'ledger.json')));
  assert.equal(independent.head().latestSequence, 0, 'the genuinely published empty ledger must remain independently readable');
}));

// ---------------------------------------------------------------------------
// Task-mutex replacement through an injected trusted mutation seam is
// preserved untouched, with a truthful post-mutation-attempt flag.
// ---------------------------------------------------------------------------

class RealLinkThenSwapTaskLockPublisher implements HistoryPublisher {
  public invoked = false;
  public replacementMarker = 'replacement-lock-owned-by-another-process\n';

  constructor(private readonly lockFilePath: string) {}

  publish(stagedPath: string, ledgerPath: string): void {
    this.invoked = true;
    linkSync(stagedPath, ledgerPath);
    // Simulate another legitimate process re-creating the task mutex in the
    // narrow window between this operation's own write and its release.
    rmSync(this.lockFilePath, { force: true });
    writeFileSync(this.lockFilePath, this.replacementMarker, { mode: 0o600 });
  }
}

test('a task lock replaced via an injected trusted mutation seam during publication is preserved untouched, with CUSTODY_BUSY(true)', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  const publisher = new RealLinkThenSwapTaskLockPublisher(tasksLockPath(f));
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow, undefined, publisher);
  assertUncertain(() => history.initialize(context), 'CUSTODY_BUSY');
  assert.ok(publisher.invoked, 'the injected publisher must actually have been invoked');
  assert.equal(
    readFileSync(tasksLockPath(f), 'utf8'), publisher.replacementMarker,
    "the replacement task lock must survive release untouched -- it is not this operation's to delete",
  );
  const directory = custodyDirectory(f, context);
  assert.doesNotThrow(() => statSync(join(directory, 'ledger.json')), 'the genuinely published ledger must be preserved, never rolled back');
}));

// ---------------------------------------------------------------------------
// Error hygiene: no secret/artifact echoing even on drift/rejection paths.
// ---------------------------------------------------------------------------

test('error messages never echo artifact bytes, binding digests or malformed context values', () => withFixture(f => {
  const { task, context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
  history.initialize(context);
  const secretBytes = new TextEncoder().encode('super-secret-payload-marker-xyz');
  rewriteTaskStatus(f, task, 'blocked');
  const error = custodyError(() => history.append(context, buildAppend(context, { bytes: secretBytes })));
  const serialized = JSON.stringify({ message: error.message, code: error.code });
  assert.ok(!serialized.includes('super-secret-payload-marker-xyz'));
  assert.ok(!serialized.includes('tampered-workspace-root'));
}));

// ---------------------------------------------------------------------------
// F2: Happy-path exact bytes, verified independently via a brand-new reader
// instance AND direct inspection of the underlying NodeWorkflowHistory
// ledger -- never a type-only Uint8Array check.
// ---------------------------------------------------------------------------

test(
  'append() persists the exact caller bytes, verified independently via a fresh reader instance and direct NodeWorkflowHistory inspection',
  () => withFixture(f => {
    const { context } = registerInProgressTask(f);
    const allow = new SyntheticAllowAuthority();
    const writer = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
    writer.initialize(context);
    const originalBytes = new TextEncoder().encode('exact-roundtrip-content-9f3c');
    const originalSnapshot = Uint8Array.from(originalBytes);
    const revision = writer.append(context, buildAppend(context, { bytes: originalBytes }));

    // Independent read path 1: a brand-new reader instance -- no authority,
    // never shares any in-memory state with the writer instance above.
    const independentReader = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId);
    assert.deepEqual(
      independentReader.readBytes(revision.sequence), originalSnapshot,
      'the independently re-read bytes must exactly equal the original caller bytes',
    );

    // Independent read path 2: direct inspection of the underlying
    // NodeWorkflowHistory ledger at the canonical custody directory,
    // bypassing the task-bound wrapper entirely.
    const directory = custodyDirectory(f, context);
    const directHistory = new NodeWorkflowHistory(directory, {
      projectId: context.projectId, taskId: context.taskId, incarnation: context.incarnation,
    });
    const directRevision = directHistory.read(revision.sequence);
    assert.equal(directRevision.digest, sha256Hex(originalSnapshot), 'the directly inspected ledger digest must match the original bytes');
    assert.deepEqual(
      Uint8Array.from(Buffer.from(directRevision.contentBase64, 'base64')), originalSnapshot,
      'the directly inspected ledger content must decode to exactly the original caller bytes',
    );
  }),
);

// ---------------------------------------------------------------------------
// F3: Binding mismatch dimensions isolated -- projectId and incarnation,
// each tested independently of the already-covered foreign-taskId case.
// ---------------------------------------------------------------------------

test('append() rejects a binding bound to a foreign projectId as CUSTODY_BINDING_MISMATCH without writing', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
  history.initialize(context);
  const foreignBinding = buildBinding(context, { projectId: randomUUID() });
  assertCode(() => history.append(context, buildAppend(context, { binding: foreignBinding })), 'CUSTODY_BINDING_MISMATCH');
  assert.equal(history.head().latestSequence, 0, 'a binding mismatch must never advance the ledger');
}));

test('append() rejects a binding bound to a foreign incarnation as CUSTODY_BINDING_MISMATCH without writing', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const allow = new SyntheticAllowAuthority();
  const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
  history.initialize(context);
  const foreignBinding = buildBinding(context, { incarnation: randomUUID() });
  assertCode(() => history.append(context, buildAppend(context, { binding: foreignBinding })), 'CUSTODY_BINDING_MISMATCH');
  assert.equal(history.head().latestSequence, 0, 'a binding mismatch must never advance the ledger');
}));

// ---------------------------------------------------------------------------
// F4: Malformed five-field HistoryAppend requests rejected before authority
// or mutation. Reflect.apply carries each genuinely malformed runtime value
// to the real append() signature -- the only untyped surface is Reflect's
// own `argumentsList: ArrayLike<any>` parameter, never an `any`/double cast
// on the malformed value itself, and never a stub replacement of append().
// ---------------------------------------------------------------------------

test(
  'append() rejects every malformed five-field HistoryAppend request as CUSTODY_REQUEST_INVALID before touching authority or the ledger',
  () => withFixture(f => {
    const { context } = registerInProgressTask(f);
    const capturing = new SyntheticCapturingAuthority();
    const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, capturing);
    history.initialize(context);
    const callsBeforeMalformed = capturing.captured.length;
    for (const [label, malformed] of malformedAppendCases(context)) {
      try {
        assertCode(() => Reflect.apply(history.append, history, [context, malformed]), 'CUSTODY_REQUEST_INVALID');
      } catch (error) {
        throw new Error(`case "${label}" must be rejected as CUSTODY_REQUEST_INVALID: ${String(error)}`);
      }
    }
    assert.equal(capturing.captured.length, callsBeforeMalformed, 'authority must never be consulted for a malformed append request');
    assert.equal(history.head().latestSequence, 0, 'no malformed append request may ever advance the ledger');
  }),
);

// ---------------------------------------------------------------------------
// F5: The exported HISTORY_ARTIFACT_MAX_BYTES cap is reused exactly, with no
// duplicated/arbitrary size rule -- exact-cap bytes succeed, one byte beyond
// the cap fails, all other fields held valid.
// ---------------------------------------------------------------------------

test(
  'append() accepts bytes exactly at HISTORY_ARTIFACT_MAX_BYTES and rejects bytes one byte beyond it',
  () => withFixture(f => {
    const { context } = registerInProgressTask(f);
    const allow = new SyntheticAllowAuthority();
    const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
    history.initialize(context);

    const atCapBytes = new Uint8Array(HISTORY_ARTIFACT_MAX_BYTES);
    const atCapRevision = history.append(context, buildAppend(context, { bytes: atCapBytes, expectedLatest: 0 }));
    assert.equal(atCapRevision.byteLength, HISTORY_ARTIFACT_MAX_BYTES, 'an artifact exactly at the exported cap must be accepted');

    const overCapBytes = new Uint8Array(HISTORY_ARTIFACT_MAX_BYTES + 1);
    assert.throws(
      () => history.append(context, buildAppend(context, { bytes: overCapBytes, expectedLatest: 1 })),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as { code?: string }).code, 'HISTORY_TOO_LARGE');
        return true;
      },
    );
    assert.equal(
      history.head().latestSequence, 1,
      'the oversized rejected append must never advance the ledger beyond the already-accepted exact-cap revision',
    );
  }),
);

// ---------------------------------------------------------------------------
// F6: Constructor-time CUSTODY_CONTEXT_INVALID -- relative workspaceRoot, a
// raw non-canonical root (".." left genuinely unnormalized, never collapsed
// via path.join/path.normalize), blank/oversized taskId, and a malformed
// authority adapter shape. Reflect.construct carries the malformed authority
// value to the real constructor without any `any`/double cast.
// ---------------------------------------------------------------------------

test('the constructor immediately rejects a relative workspaceRoot as CUSTODY_CONTEXT_INVALID', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const relativeRoot = `./relative-${context.taskId}`;
  assertCode(() => new NodeTaskWorkflowHistory(relativeRoot, context.taskId), 'CUSTODY_CONTEXT_INVALID');
}));

test('the constructor immediately rejects a raw non-canonical root containing ".." without normalizing it away first', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  // Built by direct string concatenation -- never path.join/path.normalize --
  // so the literal ".." segment genuinely reaches the constructor instead of
  // being silently collapsed away before the guard can ever see it.
  const rawNonCanonicalRoot = `${f.workspaceRoot}/../escape-${context.taskId}`;
  assertCode(() => new NodeTaskWorkflowHistory(rawNonCanonicalRoot, context.taskId), 'CUSTODY_CONTEXT_INVALID');
}));

test('the constructor immediately rejects a blank taskId as CUSTODY_CONTEXT_INVALID', () => withFixture(f => {
  registerInProgressTask(f);
  assertCode(() => new NodeTaskWorkflowHistory(f.workspaceRoot, '   '), 'CUSTODY_CONTEXT_INVALID');
}));

test('the constructor immediately rejects a taskId exceeding 256 UTF-16 code units as CUSTODY_CONTEXT_INVALID', () => withFixture(f => {
  registerInProgressTask(f);
  assertCode(() => new NodeTaskWorkflowHistory(f.workspaceRoot, 'x'.repeat(257)), 'CUSTODY_CONTEXT_INVALID');
}));

test('the constructor immediately rejects a malformed-shape authority adapter as CUSTODY_CONTEXT_INVALID', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const malformedAuthority = { assertAllowed: 'not-a-function' };
  assertCode(
    () => Reflect.construct(NodeTaskWorkflowHistory, [f.workspaceRoot, context.taskId, malformedAuthority]),
    'CUSTODY_CONTEXT_INVALID',
  );
  assert.equal(workflowRootExists(f), false, 'a rejected constructor must never allocate any custody directory');
}));

// ---------------------------------------------------------------------------
// F6b: Constructor-time CUSTODY_CONTEXT_INVALID for a workspaceRoot that is
// already absolute and already normalized (so it passes the string-equality
// canonicalization guard above) but is not an existing, real, non-symlinked
// directory on the real filesystem: a nonexistent root, a root that is
// itself a symlink, and a root reached only through a symlinked ancestor
// segment (even though the final path component is a genuine directory).
// None of these may be deferred to a later context()/read/write call -- the
// constructor itself must reject them synchronously, before any identity
// resolution, authority consultation, or filesystem mutation. A SYNTHETIC
// authority is supplied solely to prove assertAllowed() is never invoked; it
// is never evidence of real human approval or host capture. No synthetic
// task/registry source setup is needed for any of these three cases -- only
// a real temp rootfs.
// ---------------------------------------------------------------------------

const VALID_TASK_ID_FOR_CONSTRUCTOR_CASES = 'constructor-regression-valid-task-id';

test(
  'the constructor immediately rejects a nonexistent absolute workspace root as CUSTODY_CONTEXT_INVALID, with no context/read/write/authority invocation',
  () => withFixture(f => {
    const nonexistentRoot = join(f.base, 'does-not-exist-workspace-root');
    const authority = new SyntheticCapturingAuthority();
    const before = readdirSync(f.base).slice().sort();
    assertCode(
      () => new NodeTaskWorkflowHistory(nonexistentRoot, VALID_TASK_ID_FOR_CONSTRUCTOR_CASES, authority),
      'CUSTODY_CONTEXT_INVALID',
    );
    assert.equal(authority.captured.length, 0, 'authority.assertAllowed must never be invoked by a rejected constructor');
    assert.deepEqual(
      readdirSync(f.base).slice().sort(), before,
      'the real temp fixture listing must remain byte-for-byte unchanged after a rejected constructor',
    );
  }),
);

test(
  'the constructor immediately rejects a workspace root that is itself a symlink as CUSTODY_CONTEXT_INVALID, with no context/read/write/authority invocation',
  () => withFixture(f => {
    const realTarget = join(f.base, 'real-symlink-target-directory');
    mkdirSync(realTarget, { mode: 0o700 });
    const symlinkRoot = join(f.base, 'symlinked-workspace-root');
    symlinkSync(realTarget, symlinkRoot);
    const authority = new SyntheticCapturingAuthority();
    const before = readdirSync(f.base).slice().sort();
    assertCode(
      () => new NodeTaskWorkflowHistory(symlinkRoot, VALID_TASK_ID_FOR_CONSTRUCTOR_CASES, authority),
      'CUSTODY_CONTEXT_INVALID',
    );
    assert.equal(authority.captured.length, 0, 'authority.assertAllowed must never be invoked by a rejected constructor');
    assert.deepEqual(
      readdirSync(f.base).slice().sort(), before,
      'the real temp fixture listing must remain byte-for-byte unchanged after a rejected constructor',
    );
  }),
);

test(
  'the constructor immediately rejects a workspace root reached only through a symlinked ancestor segment (ending in an actual directory) as CUSTODY_CONTEXT_INVALID, with no context/read/write/authority invocation',
  () => withFixture(f => {
    const realAncestor = join(f.base, 'real-ancestor-directory');
    mkdirSync(realAncestor, { mode: 0o700 });
    const realWorkspaceLeaf = join(realAncestor, 'actual-workspace-directory');
    mkdirSync(realWorkspaceLeaf, { mode: 0o700 });
    const symlinkedAncestor = join(f.base, 'symlinked-ancestor-directory');
    symlinkSync(realAncestor, symlinkedAncestor);
    const rootViaSymlinkedAncestor = join(symlinkedAncestor, 'actual-workspace-directory');
    const authority = new SyntheticCapturingAuthority();
    const before = readdirSync(f.base).slice().sort();
    assertCode(
      () => new NodeTaskWorkflowHistory(rootViaSymlinkedAncestor, VALID_TASK_ID_FOR_CONSTRUCTOR_CASES, authority),
      'CUSTODY_CONTEXT_INVALID',
    );
    assert.equal(authority.captured.length, 0, 'authority.assertAllowed must never be invoked by a rejected constructor');
    assert.deepEqual(
      readdirSync(f.base).slice().sort(), before,
      'the real temp fixture listing must remain byte-for-byte unchanged after a rejected constructor',
    );
  }),
);

// ---------------------------------------------------------------------------
// F7: Old-operation replay still genuinely re-consults the SYNTHETIC
// authority (never short-circuiting straight to the cached ledger result),
// verified both by call count and by a toggling authority that rejects the
// replay specifically.
// ---------------------------------------------------------------------------

test(
  'an old-operation append retry still consults the SYNTHETIC authority again, exactly once per attempt',
  () => withFixture(f => {
    const { context } = registerInProgressTask(f);
    const allow = new SyntheticAllowAuthority();
    const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
    history.initialize(context);
    const append = buildAppend(context, { expectedLatest: 0 });
    history.append(context, append);
    const callsAfterFirst = allow.calls.length;
    const second = history.append(context, { ...append });
    assert.deepEqual(second, history.read(1));
    assert.equal(
      allow.calls.length, callsAfterFirst + 1,
      'a replayed old-operation append must genuinely re-consult the authority again, never short-circuiting straight to the cached ledger result',
    );
    assert.equal(history.head().latestSequence, 1, 'the retry must never create a duplicate revision');
  }),
);

/**
 * SYNTHETIC authority that allows exactly its first two invocations
 * (initialize + the original append) and rejects every subsequent one. Used
 * solely to prove a replay genuinely re-invokes authority rather than
 * bypassing it -- never a model of real human approval or host capture.
 */
class SyntheticAllowTwiceThenRejectAuthority implements WorkflowMutationAuthority {
  public calls = 0;

  assertAllowed(): void {
    this.calls += 1;
    if (this.calls > 2) {
      throw new Error('synthetic-reject-on-replay');
    }
  }
}

test(
  'an old-operation append retry is genuinely blocked once the authority now rejects it, never bypassing straight to the cached result',
  () => withFixture(f => {
    const { context } = registerInProgressTask(f);
    const toggling = new SyntheticAllowTwiceThenRejectAuthority();
    const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, toggling);
    history.initialize(context);
    const append = buildAppend(context, { expectedLatest: 0 });
    history.append(context, append);
    assert.equal(toggling.calls, 2, 'initialize() and the original append() must each have consulted authority once');
    assertCode(() => history.append(context, { ...append }), 'CUSTODY_AUTHORITY_REJECTED');
    assert.equal(toggling.calls, 3, 'the replay must genuinely re-invoke the authority a third time rather than skip it');
    assert.equal(history.head().latestSequence, 1, 'a replay blocked by authority must never create a duplicate revision');
  }),
);

// ---------------------------------------------------------------------------
// F8: Symlink/permissive-mode/non-directory rejection at the intermediate
// .SprintDesk/workflow and .SprintDesk/workflow/history boundaries, not just
// the leaf digest directory. Deliberately never touches .SprintDesk/data, so
// the canonical identity source used for context()/resolveTask remains
// valid throughout -- only the custody path guard is under test here.
// ---------------------------------------------------------------------------

test('a pre-existing symlink at the intermediate .SprintDesk/workflow boundary blocks initialize() without following it', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const workflowPath = join(f.workspaceRoot, '.SprintDesk', 'workflow');
  const externalTarget = join(f.base, 'external-workflow-escape-target');
  mkdirSync(externalTarget, { mode: 0o700 });
  symlinkSync(externalTarget, workflowPath);
  const allow = new SyntheticAllowAuthority();
  assertCode(() => new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow).initialize(context), 'CUSTODY_PATH_INVALID');
  assert.deepEqual(readdirSync(externalTarget), [], 'the symlinked intermediate boundary target must never be written into');
}));

test('a pre-existing permissive-mode directory at the intermediate .SprintDesk/workflow boundary is rejected without chmod-ing it', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const workflowPath = join(f.workspaceRoot, '.SprintDesk', 'workflow');
  mkdirSync(workflowPath, { recursive: true, mode: 0o755 });
  const allow = new SyntheticAllowAuthority();
  assertCode(() => new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow).initialize(context), 'CUSTODY_PATH_INVALID');
  assert.equal(statSync(workflowPath).mode & 0o777, 0o755, 'a permissive intermediate boundary directory must never be chmod-recovered');
}));

test('a pre-existing symlink at the intermediate .SprintDesk/workflow/history boundary blocks initialize() without following it', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const workflowPath = join(f.workspaceRoot, '.SprintDesk', 'workflow');
  mkdirSync(workflowPath, { recursive: true, mode: 0o700 });
  const historyPath = join(workflowPath, 'history');
  const externalTarget = join(f.base, 'external-history-escape-target');
  mkdirSync(externalTarget, { mode: 0o700 });
  symlinkSync(externalTarget, historyPath);
  const allow = new SyntheticAllowAuthority();
  assertCode(() => new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow).initialize(context), 'CUSTODY_PATH_INVALID');
  assert.deepEqual(readdirSync(externalTarget), [], 'the symlinked intermediate boundary target must never be written into');
}));

test('a pre-existing non-directory file at the intermediate .SprintDesk/workflow/history boundary is rejected', () => withFixture(f => {
  const { context } = registerInProgressTask(f);
  const workflowPath = join(f.workspaceRoot, '.SprintDesk', 'workflow');
  mkdirSync(workflowPath, { recursive: true, mode: 0o700 });
  const historyPath = join(workflowPath, 'history');
  writeFileSync(historyPath, 'not-a-directory', { mode: 0o600 });
  const allow = new SyntheticAllowAuthority();
  assertCode(() => new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow).initialize(context), 'CUSTODY_PATH_INVALID');
  assert.equal(readFileSync(historyPath, 'utf8'), 'not-a-directory', 'a non-directory boundary node must never be replaced/overwritten');
}));

// ---------------------------------------------------------------------------
// F9: Caller bytes are copied before authority/mutation; a later mutation of
// the caller's own original array must never affect the stored/persisted
// bytes, which must match the ORIGINAL pre-mutation snapshot exactly.
// ---------------------------------------------------------------------------

test(
  'append() copies the caller bytes before authority/mutation; a later caller mutation of the original array never affects the persisted bytes',
  () => withFixture(f => {
    const { context } = registerInProgressTask(f);
    const allow = new SyntheticAllowAuthority();
    const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
    history.initialize(context);
    const callerBytes = new TextEncoder().encode('caller-owned-original-bytes-marker');
    const originalSnapshot = Uint8Array.from(callerBytes);
    const revision = history.append(context, buildAppend(context, { bytes: callerBytes }));

    // Mutate the caller's own original array only *after* append() returns.
    callerBytes.fill(0);
    assert.notDeepEqual(callerBytes, originalSnapshot, 'the fixture must genuinely mutate the caller array to prove anything at all');

    assert.equal(
      revision.digest, sha256Hex(originalSnapshot),
      'the returned revision digest must reflect the ORIGINAL bytes, unaffected by the later caller mutation',
    );
    const independentReader = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId);
    assert.deepEqual(
      independentReader.readBytes(revision.sequence), originalSnapshot,
      'the independently persisted/read-back bytes must match the ORIGINAL snapshot, never the post-call mutated caller array',
    );
  }),
);

// ---------------------------------------------------------------------------
// F10: The defensive byte-copy guard must already be in effect BEFORE
// authority ever sees the request -- not merely after append() returns (that
// half is F9, above). A SYNTHETIC authority that mutates the caller's own
// original bytes array *during* its own assertAllowed() callback must never
// be able to affect the operation's contentDigest or the eventually
// persisted bytes, both of which must already reflect an ORIGINAL
// pre-callback snapshot.
// ---------------------------------------------------------------------------

test(
  'a SYNTHETIC authority that mutates the caller\'s original append bytes in place during assertAllowed() never affects the already-computed contentDigest or persisted bytes',
  () => withFixture(f => {
    const { context } = registerInProgressTask(f);
    const callerBytes = new TextEncoder().encode('caller-owned-bytes-mutated-by-authority-callback');
    const originalSnapshot = Uint8Array.from(callerBytes);
    const originalDigest = sha256Hex(originalSnapshot);
    const mutatingAuthority = new SyntheticAppendOriginalBytesMutatingAuthority(callerBytes);
    const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, mutatingAuthority);
    history.initialize(context);

    const revision = history.append(context, buildAppend(context, { bytes: callerBytes }));

    assert.equal(mutatingAuthority.appendCalls, 1, 'the synthetic append-mutating authority callback must have actually run exactly once');
    assert.notDeepEqual(
      callerBytes, originalSnapshot,
      'the callback must genuinely mutate the caller\'s own original array in place to prove anything at all',
    );
    assert.ok(mutatingAuthority.lastAppendRequest, 'the append callback must have actually run and captured a request');
    const { operation } = mutatingAuthority.lastAppendRequest!;
    assert.equal(operation.kind, 'append');
    if (operation.kind === 'append') {
      assert.equal(
        operation.contentDigest, originalDigest,
        'the operation contentDigest handed to authority must already equal the pre-callback ORIGINAL bytes digest, unaffected by the in-callback mutation',
      );
    }

    assert.equal(
      revision.digest, originalDigest,
      'the returned revision digest must equal the pre-callback ORIGINAL bytes digest, unaffected by the in-callback mutation',
    );
    const independentReader = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId);
    assert.deepEqual(
      independentReader.readBytes(revision.sequence), originalSnapshot,
      'the independently persisted/read-back bytes must match the pre-callback ORIGINAL snapshot, never the in-callback mutated caller array',
    );
  }),
);

// ---------------------------------------------------------------------------
// Real cross-process contention: two real OS processes race the task lock
// for the same task-bound ledger. No sleeps-as-proof -- synchronization is
// via an explicit IPC "ready" barrier before both are released together.
// ---------------------------------------------------------------------------

interface WorkerOutcome {
  readonly kind: 'ready' | 'result';
  readonly ok?: boolean;
  readonly sequence?: number;
  readonly error?: string;
  readonly code?: string;
  readonly commitMayHaveChanged?: boolean;
  readonly pid: number;
}

function startTaskAppendWorker(
  f: Fixture, context: WorkflowTaskContext, operationId: string, expectedLatest: number,
): { child: ReturnType<typeof fork>; ready: Promise<void>; complete: Promise<WorkerOutcome> } {
  const payload = {
    operationId,
    expectedLatest,
    binding: buildBinding(context),
    artifactKind: 'scenario' as HistoryArtifactKind,
    bytesBase64: Buffer.from('cross-process-task-bound-content').toString('base64'),
  };
  const child = fork(
    join(__dirname, 'taskWorkflowHistoryWorker.js'),
    [f.workspaceRoot, context.taskId, JSON.stringify(payload)],
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
  'two real independent processes racing an append against the same task-bound ledger produce at most one new revision',
  () => withFixtureAsync(async f => {
    const { context } = registerInProgressTask(f);
    const allow = new SyntheticAllowAuthority();
    const history = new NodeTaskWorkflowHistory(f.workspaceRoot, context.taskId, allow);
    history.initialize(context);
    const first = startTaskAppendWorker(f, context, randomUUID(), 0);
    const second = startTaskAppendWorker(f, context, randomUUID(), 0);
    try {
      await Promise.all([first.ready, second.ready]);
      first.child.send('go');
      second.child.send('go');
      const results = await Promise.all([first.complete, second.complete]);
      const succeeded = results.filter(result => result.ok);
      assert.equal(succeeded.length, 1, 'exactly one of the two same-expectedLatest appends must win the task lock');
      const failed = results.find(result => !result.ok);
      assert.ok(failed);
      assert.ok(
        failed.code === 'CUSTODY_BUSY' || failed.code === 'HISTORY_CONFLICT',
        `expected CUSTODY_BUSY or HISTORY_CONFLICT, received ${failed.code}`,
      );
      assert.equal(history.head().latestSequence, 1, 'only the winning append may be persisted');
      assert.equal(new Set(results.map(result => result.pid)).size, 2, 'both workers must be real, distinct OS processes');
    } finally {
      if (first.child.exitCode === null) { first.child.kill('SIGTERM'); }
      if (second.child.exitCode === null) { second.child.kill('SIGTERM'); }
    }
  }),
);
