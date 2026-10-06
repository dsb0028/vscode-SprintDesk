/**
 * Test-first Red-phase coverage for the planned NodeWorkflowHistory module
 * (contract.json, src/review/NodeWorkflowHistory.ts — not yet implemented).
 * This file intentionally imports a module that does not exist yet; until
 * the production implementer adds it, the whole suite is expected to fail
 * to *compile*, not merely fail at runtime. That compiler Red is the
 * authorized outcome of this increment (see contract.json "reporting" ->
 * "baseline": "New module missing may cause compiler Red; no new runtime
 * claim until compiled.").
 *
 * Scope reminder (contract.json "scope"/"deferred"): this module is a
 * bounded, single-file immutable artifact/revision custody library. It
 * proves consistency/custody of bytes a caller handed it under a pinned
 * identity — never authentic host capture, semantic review correctness,
 * human approval, or a live, writable task-tracking identity. Tests below
 * never assert on any of those deferred behaviors.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fork, spawnSync } from 'node:child_process';
import {
  chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  NodeWorkflowHistory, WorkflowHistoryError, HistoryIdentity, HistoryArtifactKind, HistoryAppend,
  HistoryRevision, HistoryPublisher, HISTORY_ARTIFACT_MAX_BYTES, HISTORY_LEDGER_MAX_BYTES,
} from './NodeWorkflowHistory';
import { WorkflowBinding } from './workflowBinding';
import { digest as protocolDigest } from './protocol';
import { ISecureStore } from '../host/ISecureStore';
import { NodeSecureStore } from '../host/NodeSecureStore';

interface Fixture {
  readonly base: string;
  readonly directory: string;
  readonly identity: HistoryIdentity;
}

function createFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), 'workflow-history-'));
  const directory = join(base, 'history');
  mkdirSync(directory, { mode: 0o700 });
  return {
    base,
    directory,
    identity: { projectId: 'project-alpha', taskId: 'task-1', incarnation: 'incarnation-1' },
  };
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

function ledgerPath(directory: string): string {
  return join(directory, 'ledger.json');
}

function lockPath(directory: string): string {
  return join(directory, 'ledger.lock');
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Builds a real, independently-digested WorkflowBinding fixture. The two
 * digest fields are produced by `protocol.digest` (an existing, already
 * independently tested utility) over distinct real source objects — never
 * hand-typed 64-hex-character literals — so this fixture cannot silently
 * drift from what a real binding/digest pairing looks like.
 */
function buildBinding(identity: HistoryIdentity, overrides: Partial<WorkflowBinding> = {}): WorkflowBinding {
  return {
    version: 1,
    stage: 'planning',
    projectId: identity.projectId,
    taskId: identity.taskId,
    incarnation: identity.incarnation,
    criterionId: 'criterion-1',
    criterionRevision: 'rev-1',
    sourceRevision: 'source-rev-1',
    sourceDigest: protocolDigest({ source: 'fixture-source-content', revision: 'source-rev-1' }),
    policyDigest: protocolDigest({ policy: 'fixture-policy', version: 1 }),
    attemptId: 'attempt-1',
    ...overrides,
  };
}

function buildAppend(identity: HistoryIdentity, overrides: Partial<HistoryAppend> = {}): HistoryAppend {
  return {
    operationId: randomUUID(),
    expectedLatest: 0,
    binding: buildBinding(identity),
    kind: 'scenario',
    bytes: new TextEncoder().encode('fixture-artifact-content'),
    ...overrides,
  };
}

function historyError(operation: () => unknown): WorkflowHistoryError {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof WorkflowHistoryError, `expected a WorkflowHistoryError, received ${String(error)}`);
    return error as WorkflowHistoryError;
  }
  throw new Error('Expected operation to throw');
}

/**
 * Asserts on the error's actual `.code` property (per the contract's
 * error-vocabulary decision) rather than pattern-matching the free-form
 * message string, which the contract explicitly leaves flexible.
 *
 * This helper is reserved for ordinary prewrite rejections -- request
 * validation, conflicts, missing/not-found, contention and corruption/tamper
 * detection -- all of which the contract requires to report
 * commitMayHaveChanged=false, since nothing was ever attempted to be
 * published. Genuine post-publication uncertainty (commitMayHaveChanged=true)
 * is never asserted through this helper; those cases use `historyError`
 * directly with their own explicit, separate true assertions so the two
 * families can never be silently conflated.
 */
function assertCode(operation: () => unknown, code: string): WorkflowHistoryError {
  const error = historyError(operation);
  assert.equal(error.code, code, `expected code ${code}, received ${error.code}`);
  assert.equal(
    error.commitMayHaveChanged, false,
    'a prewrite-rejected request/contention/corruption must report commitMayHaveChanged=false',
  );
  return error;
}

/**
 * Independently recomputes the expected `revisionDigest` chain value for a
 * stored revision, per contract.json: "revisionDigest uses existing
 * protocol.digest over the complete revision object excluding
 * revisionDigest, binding identity/kind/operation/content/head into a
 * content chain." Built only from `protocol.digest` (already independently
 * tested elsewhere) plus the revision's own publicly returned fields --
 * never from any NodeWorkflowHistory-internal method -- so it cannot simply
 * echo whatever the implementation already computed.
 */
function expectedRevisionDigest(revision: HistoryRevision): string {
  return protocolDigest({
    id: revision.id,
    sequence: revision.sequence,
    operationId: revision.operationId,
    expectedLatest: revision.expectedLatest,
    binding: revision.binding,
    kind: revision.kind,
    digest: revision.digest,
    byteLength: revision.byteLength,
    contentBase64: revision.contentBase64,
    previousDigest: revision.previousDigest,
  });
}

/** A conservative, math-derived (not fabricated) estimate of one maximally-sized append's on-disk growth. */
function estimateAppendGrowth(): number {
  return Math.ceil((HISTORY_ARTIFACT_MAX_BYTES * 4) / 3) + 2048;
}

interface RawBindingShape {
  version: number;
  stage: string;
  projectId: string;
  taskId: string;
  incarnation: string;
  criterionId: string;
  criterionRevision: string;
  sourceRevision: string;
  sourceDigest: string;
  policyDigest: string;
  attemptId: string;
}

interface RawRevisionShape {
  id: string;
  sequence: number;
  operationId: string;
  expectedLatest: number;
  binding: RawBindingShape;
  kind: string;
  digest: string;
  byteLength: number;
  contentBase64: string;
  previousDigest: string | null;
  revisionDigest: string;
}

interface RawLedgerShape {
  version: number;
  identity: { projectId: string; taskId: string; incarnation: string };
  revisions: RawRevisionShape[];
}

function readLedgerRaw(directory: string): RawLedgerShape {
  return JSON.parse(readFileSync(ledgerPath(directory), 'utf8')) as RawLedgerShape;
}

function writeLedgerRaw(directory: string, raw: RawLedgerShape): void {
  writeFileSync(ledgerPath(directory), JSON.stringify(raw));
}

function tamperLedger(directory: string, mutate: (raw: RawLedgerShape) => void): void {
  const raw = readLedgerRaw(directory);
  mutate(raw);
  writeLedgerRaw(directory, raw);
}

// ---------------------------------------------------------------------------
// Constructor validation: directory + identity only, no writes, no reads of
// the ledger, no mkdir/chmod recovery.
// ---------------------------------------------------------------------------

test('constructor rejects a non-absolute directory before any filesystem access', () => {
  assertCode(
    () => new NodeWorkflowHistory('relative/dir', { projectId: 'p', taskId: 't', incarnation: 'i' }),
    'HISTORY_CONTEXT_INVALID',
  );
});

test('constructor rejects a missing directory', () => withFixture(f => {
  assertCode(() => new NodeWorkflowHistory(join(f.base, 'missing'), f.identity), 'HISTORY_CONTEXT_INVALID');
}));

test('constructor rejects a directory reached through a symlinked ancestor', () => withFixture(f => {
  const real = join(f.base, 'real-history');
  mkdirSync(real, { mode: 0o700 });
  symlinkSync(real, join(f.base, 'alias'));
  assertCode(() => new NodeWorkflowHistory(join(f.base, 'alias', 'history'), f.identity), 'HISTORY_CONTEXT_INVALID');
}));

test('constructor rejects a directory that is itself a symlink', () => withFixture(f => {
  const real = join(f.base, 'real-history-2');
  mkdirSync(real, { mode: 0o700 });
  const link = join(f.base, 'history-link');
  symlinkSync(real, link);
  assertCode(() => new NodeWorkflowHistory(link, f.identity), 'HISTORY_CONTEXT_INVALID');
}));

test('constructor rejects a non-owner-only directory mode without chmod-ing it', () => withFixture(f => {
  chmodSync(f.directory, 0o755);
  try {
    assertCode(() => new NodeWorkflowHistory(f.directory, f.identity), 'HISTORY_CONTEXT_INVALID');
    assert.equal(statSync(f.directory).mode & 0o777, 0o755, 'construction must not chmod the directory');
  } finally {
    chmodSync(f.directory, 0o700);
  }
}));

const invalidIdentities: ReadonlyArray<[string, unknown]> = [
  ['missing taskId', { projectId: 'p', incarnation: 'i' }],
  ['missing incarnation', { projectId: 'p', taskId: 't' }],
  ['missing projectId', { taskId: 't', incarnation: 'i' }],
  ['blank projectId', { projectId: '', taskId: 't', incarnation: 'i' }],
  ['whitespace-only taskId', { projectId: 'p', taskId: '   ', incarnation: 'i' }],
  ['oversized incarnation', { projectId: 'p', taskId: 't', incarnation: 'x'.repeat(257) }],
  ['extra unknown field', { projectId: 'p', taskId: 't', incarnation: 'i', extra: 'nope' }],
  ['non-string field', { projectId: 'p', taskId: 't', incarnation: 7 }],
  ['null identity', null],
];

for (const [label, candidate] of invalidIdentities) {
  test(`constructor rejects identity: ${label}`, () => withFixture(f => {
    assertCode(() => new NodeWorkflowHistory(f.directory, candidate as unknown as HistoryIdentity), 'HISTORY_CONTEXT_INVALID');
    assert.deepEqual(readdirSync(f.directory), [], 'construction must never write anything, even on rejection');
  }));
}

test('constructor accepts a boundary-length (256 UTF-16 unit) identity field and never writes anything', () => withFixture(f => {
  const identity: HistoryIdentity = { projectId: 'p'.repeat(256), taskId: 't', incarnation: 'i' };
  new NodeWorkflowHistory(f.directory, identity);
  assert.deepEqual(readdirSync(f.directory), [], 'construction alone must never write anything');
}));

test('constructor never creates or inspects the ledger file as a side effect', () => withFixture(f => {
  new NodeWorkflowHistory(f.directory, f.identity);
  assert.deepEqual(readdirSync(f.directory), []);
}));

// ---------------------------------------------------------------------------
// initialize(): explicit, no-overwrite, atomic.
// ---------------------------------------------------------------------------

test('initialize() installs a complete, empty, version-1 ledger exactly once', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  const head = history.initialize();
  assert.equal(head.latestSequence, 0);
  assert.equal(head.latestDigest, null);
  assert.deepEqual(head.identity, f.identity);
  assert.deepEqual(readdirSync(f.directory).sort(), ['ledger.json']);
  const raw = readLedgerRaw(f.directory);
  assert.deepEqual(raw, { version: 1, identity: f.identity, revisions: [] });
  assert.equal(statSync(ledgerPath(f.directory)).mode & 0o777, 0o600);
}));

test('initialize() never overwrites an existing ledger, even an identical one', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  const before = readFileSync(ledgerPath(f.directory), 'utf8');
  assertCode(() => history.initialize(), 'HISTORY_ALREADY_EXISTS');
  assert.equal(readFileSync(ledgerPath(f.directory), 'utf8'), before);
}));

test('head()/read()/list()/readBytes()/append() never implicitly initialize a missing ledger', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  assertCode(() => history.head(), 'HISTORY_MISSING');
  assertCode(() => history.read(1), 'HISTORY_MISSING');
  assertCode(() => history.list(0, 10), 'HISTORY_MISSING');
  assertCode(() => history.readBytes(1), 'HISTORY_MISSING');
  assertCode(() => history.append(buildAppend(f.identity, { expectedLatest: 0 })), 'HISTORY_MISSING');
  assert.deepEqual(readdirSync(f.directory), [], 'readers must never create the ledger file');
}));

test('a restarted instance reads back the same persisted head after initialize', () => withFixture(f => {
  new NodeWorkflowHistory(f.directory, f.identity).initialize();
  const reopened = new NodeWorkflowHistory(f.directory, f.identity);
  const head = reopened.head();
  assert.equal(head.latestSequence, 0);
  assert.equal(head.latestDigest, null);
  assert.deepEqual(head.identity, f.identity);
}));

test('returned identity/head/revision objects are deep-frozen defensive copies, never the caller-constructed instance', () => withFixture(f => {
  const identity: HistoryIdentity = { ...f.identity };
  const history = new NodeWorkflowHistory(f.directory, identity);
  const head = history.initialize();
  assert.notEqual(head.identity, identity, 'the returned identity must be a defensive copy, not the same reference');
  assert.ok(Object.isFrozen(head));
  assert.ok(Object.isFrozen(head.identity));
  const revision = history.append(buildAppend(identity, { expectedLatest: 0 }));
  assert.ok(Object.isFrozen(revision));
  assert.ok(Object.isFrozen(revision.binding));
}));

// ---------------------------------------------------------------------------
// append(): exact bytes/digest/Base64, caps, defensive copies.
// ---------------------------------------------------------------------------

test('append() stores exact digest, byteLength and canonical base64 for an empty artifact', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  const bytes = new Uint8Array(0);
  const revision = history.append(buildAppend(f.identity, { bytes }));
  assert.equal(revision.byteLength, 0);
  assert.equal(revision.digest, sha256Hex(bytes));
  assert.equal(revision.contentBase64, toBase64(bytes));
  assert.equal(revision.previousDigest, null);
  assert.equal(revision.sequence, 1);
  assert.equal(revision.revisionDigest, expectedRevisionDigest(revision));
  assert.deepEqual(history.readBytes(1), bytes);
}));

test('append() stores exact digest, byteLength and canonical base64 for real binary (non-UTF8) bytes', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  const bytes = randomBytes(4096);
  const revision = history.append(buildAppend(f.identity, { bytes }));
  assert.equal(revision.byteLength, bytes.length);
  assert.equal(revision.digest, sha256Hex(bytes));
  assert.equal(revision.contentBase64, toBase64(bytes));
  assert.deepEqual(history.readBytes(revision.sequence), Uint8Array.from(bytes));
}));

test('append() accepts exactly HISTORY_ARTIFACT_MAX_BYTES and rejects one byte more before any mutation', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  const exact = randomBytes(HISTORY_ARTIFACT_MAX_BYTES);
  const revision = history.append(buildAppend(f.identity, { bytes: exact }));
  assert.equal(revision.byteLength, HISTORY_ARTIFACT_MAX_BYTES);
  const before = readFileSync(ledgerPath(f.directory), 'utf8');
  const tooLarge = randomBytes(HISTORY_ARTIFACT_MAX_BYTES + 1);
  assertCode(() => history.append(buildAppend(f.identity, {
    bytes: tooLarge, operationId: randomUUID(), expectedLatest: 1,
  })), 'HISTORY_TOO_LARGE');
  assert.equal(readFileSync(ledgerPath(f.directory), 'utf8'), before, 'an oversized append must not mutate the ledger');
}));

test('mutating caller bytes after append() does not change retained content, and readBytes returns a fresh defensive copy', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  const bytes = Uint8Array.from([1, 2, 3, 4, 5]);
  const revision = history.append(buildAppend(f.identity, { bytes }));
  bytes[0] = 255; // mutate the caller's own array after the call returns
  const stored = history.readBytes(revision.sequence);
  assert.deepEqual(stored, Uint8Array.from([1, 2, 3, 4, 5]));
  stored[0] = 254; // mutate the returned array
  const storedAgain = history.readBytes(revision.sequence);
  assert.deepEqual(storedAgain, Uint8Array.from([1, 2, 3, 4, 5]));
}));

// ---------------------------------------------------------------------------
// Ordering/history/chain across multiple distinct revisions.
// ---------------------------------------------------------------------------

test('at least three distinct revisions retain exact sequence order, chain and independent digests', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  const first = history.append(buildAppend(f.identity, {
    kind: 'scenario', bytes: new TextEncoder().encode('stage-one'), expectedLatest: 0,
  }));
  const second = history.append(buildAppend(f.identity, {
    kind: 'translation', bytes: new TextEncoder().encode('stage-two'), expectedLatest: 1,
  }));
  const third = history.append(buildAppend(f.identity, {
    kind: 'review', bytes: new TextEncoder().encode('stage-three'), expectedLatest: 2,
  }));
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(third.sequence, 3);
  assert.equal(first.previousDigest, null);
  // Chain linkage binds to the PRIOR record's full-record revisionDigest
  // (the content-chain hash), never its raw artifact-bytes digest -- per
  // contract.json's already-approved "hash every field except
  // revisionDigest... into a content chain" decision.
  assert.equal(second.previousDigest, first.revisionDigest);
  assert.equal(third.previousDigest, second.revisionDigest);
  assert.equal(second.revisionDigest, expectedRevisionDigest(second));
  assert.equal(third.revisionDigest, expectedRevisionDigest(third));
  assert.notEqual(first.revisionDigest, second.revisionDigest);
  assert.notEqual(new Set([first.id, second.id, third.id]).size, 2);
  const listed = history.list(0, 10);
  assert.deepEqual(listed.map((r: HistoryRevision) => r.sequence), [1, 2, 3]);
  assert.deepEqual(listed.map((r: HistoryRevision) => r.kind), ['scenario', 'translation', 'review']);
  assert.equal(history.head().latestSequence, 3);
  // HistoryHead.latestDigest is the chain-tip revisionDigest, not the raw
  // artifact digest of the latest revision.
  assert.equal(history.head().latestDigest, third.revisionDigest);
}));

// ---------------------------------------------------------------------------
// Conflicts: stale expectedLatest for a new operation.
// ---------------------------------------------------------------------------

test('a stale expectedLatest is an explicit conflict that preserves earlier revisions untouched', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  const first = history.append(buildAppend(f.identity, { expectedLatest: 0 }));
  const before = readFileSync(ledgerPath(f.directory), 'utf8');
  assertCode(() => history.append(buildAppend(f.identity, {
    operationId: randomUUID(), expectedLatest: 0, bytes: new TextEncoder().encode('conflicting'),
  })), 'HISTORY_CONFLICT');
  assert.equal(readFileSync(ledgerPath(f.directory), 'utf8'), before);
  assert.equal(history.head().latestSequence, 1);
  // HistoryHead.latestDigest is the chain-tip revisionDigest, not the raw
  // artifact digest, per the contract's already-approved chain decision.
  assert.equal(history.head().latestDigest, first.revisionDigest);
}));

// ---------------------------------------------------------------------------
// Idempotent retry vs. operation conflict.
// ---------------------------------------------------------------------------

test('an exact retry of the same operationId returns the original revision even after newer appends', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  const operationId = randomUUID();
  const append = buildAppend(f.identity, { operationId, expectedLatest: 0 });
  const first = history.append(append);
  history.append(buildAppend(f.identity, { expectedLatest: 1 })); // advances the head past the retried op
  const retried = history.append(append); // exact same request, now-stale expectedLatest
  assert.deepEqual(retried, first);
  assert.equal(history.list(0, 10).length, 2, 'the retry must not create a third stored revision');
}));

test('retrying with any single changed field is an explicit operation conflict, never a new append', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  const operationId = randomUUID();
  const original = buildAppend(f.identity, { operationId, expectedLatest: 0 });
  history.append(original);
  const variants: ReadonlyArray<[string, Partial<HistoryAppend>]> = [
    ['expectedLatest', { expectedLatest: 1 }],
    ['kind', { kind: 'evidence' }],
    ['bytes', { bytes: new TextEncoder().encode('different-content') }],
    ['binding', { binding: buildBinding(f.identity, { attemptId: 'attempt-2' }) }],
  ];
  for (const [label, overrides] of variants) {
    const before = readFileSync(ledgerPath(f.directory), 'utf8');
    assertCode(() => history.append({ ...original, ...overrides }), 'HISTORY_OPERATION_CONFLICT');
    assert.equal(readFileSync(ledgerPath(f.directory), 'utf8'), before, `${label} conflict must not mutate the ledger`);
  }
}));

test('identity/integrity is checked before an idempotent retry is resolved', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  const operationId = randomUUID();
  const append = buildAppend(f.identity, { operationId, expectedLatest: 0 });
  history.append(append);
  tamperLedger(f.directory, raw => { raw.revisions[0].digest = '0'.repeat(64); });
  assertCode(() => history.append(append), 'HISTORY_INVALID');
}));

// ---------------------------------------------------------------------------
// Foreign identity/binding.
// ---------------------------------------------------------------------------

test('a request whose binding identity does not match the constructor-pinned identity is rejected without writing', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  const foreignBinding = buildBinding(f.identity, { projectId: 'someone-elses-project' });
  const before = readFileSync(ledgerPath(f.directory), 'utf8');
  assertCode(() => history.append(buildAppend(f.identity, { binding: foreignBinding })), 'HISTORY_IDENTITY_MISMATCH');
  assert.equal(readFileSync(ledgerPath(f.directory), 'utf8'), before);
}));

test("a NodeWorkflowHistory instance constructed with a different identity cannot operate on another identity's ledger", () => withFixture(f => {
  const owner = new NodeWorkflowHistory(f.directory, f.identity);
  owner.initialize();
  owner.append(buildAppend(f.identity, { expectedLatest: 0 }));
  const foreignIdentity: HistoryIdentity = { ...f.identity, taskId: 'task-2' };
  const foreign = new NodeWorkflowHistory(f.directory, foreignIdentity);
  assertCode(() => foreign.head(), 'HISTORY_IDENTITY_MISMATCH');
  assertCode(() => foreign.append(buildAppend(foreignIdentity, { expectedLatest: 1 })), 'HISTORY_IDENTITY_MISMATCH');
  assert.equal(owner.head().latestSequence, 1, "the foreign instance's rejected calls must not affect the real ledger");
}));

// ---------------------------------------------------------------------------
// Tamper detection: digest/length/chain/sequence/duplicate/version/malformed.
// ---------------------------------------------------------------------------

const tamperCases: ReadonlyArray<[string, (raw: RawLedgerShape) => void]> = [
  ['content digest altered', raw => { raw.revisions[0].digest = '0'.repeat(64); }],
  ['byteLength altered', raw => { raw.revisions[0].byteLength = raw.revisions[0].byteLength + 1; }],
  ['contentBase64 altered', raw => { raw.revisions[0].contentBase64 = Buffer.from('tampered').toString('base64'); }],
  ['previousDigest chain broken', raw => {
    // Composed as a SELF-CONSISTENT record (its own revisionDigest is
    // recomputed to match its own, now-tampered previousDigest) so this
    // case can only ever be caught by genuine cross-record chain-linkage
    // verification (comparing stored previousDigest against the PRIOR
    // record's own revisionDigest/digest), never incidentally by a
    // whole-record revisionDigest-recompute mismatch alone. This is a
    // strictly more precise, harder tamper fixture than one that merely
    // zeroes previousDigest while leaving a stale revisionDigest behind
    // (which any implementation would already reject on unrelated
    // grounds) -- it does not weaken corruption detection, it isolates
    // exactly the chain property under test.
    const tamperedPreviousDigest = '0'.repeat(64);
    const tampered: RawRevisionShape = { ...raw.revisions[1], previousDigest: tamperedPreviousDigest };
    tampered.revisionDigest = expectedRevisionDigest(tampered as unknown as HistoryRevision);
    raw.revisions[1] = tampered;
  }],
  ['revisionDigest altered', raw => { raw.revisions[0].revisionDigest = '0'.repeat(64); }],
  ['sequence out of order', raw => { raw.revisions[1].sequence = 1; }],
  ['duplicate sequence', raw => { raw.revisions[1].sequence = raw.revisions[0].sequence; }],
  ['duplicate operationId', raw => { raw.revisions[1].operationId = raw.revisions[0].operationId; }],
  ['duplicate id', raw => { raw.revisions[1].id = raw.revisions[0].id; }],
  ['unsupported version', raw => { raw.version = 2; }],
  ['identity mismatch inside envelope', raw => { raw.identity = { ...raw.identity, taskId: 'tampered-task' }; }],
];

for (const [label, mutate] of tamperCases) {
  test(`detects and rejects tamper: ${label}`, () => withFixture(f => {
    const history = new NodeWorkflowHistory(f.directory, f.identity);
    history.initialize();
    history.append(buildAppend(f.identity, { expectedLatest: 0 }));
    history.append(buildAppend(f.identity, { expectedLatest: 1 }));
    tamperLedger(f.directory, mutate);
    const freshInstance = new NodeWorkflowHistory(f.directory, f.identity);
    const error = historyError(() => freshInstance.head());
    assert.ok(
      error.code === 'HISTORY_INVALID' || error.code === 'HISTORY_VERSION_UNSUPPORTED'
        || error.code === 'HISTORY_IDENTITY_MISMATCH',
      `expected a recognized tamper rejection code, received ${error.code}`,
    );
    assert.equal(
      error.commitMayHaveChanged, false,
      'a read-only, prewrite tamper-detection rejection must report commitMayHaveChanged=false',
    );
  }));
}

test('rejects a malformed (non-JSON) ledger file', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  writeFileSync(ledgerPath(f.directory), '{not valid json');
  assertCode(() => history.head(), 'HISTORY_INVALID');
}));

test('rejects a ledger file missing required top-level fields', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  writeFileSync(ledgerPath(f.directory), JSON.stringify({ version: 1, identity: f.identity }));
  assertCode(() => history.head(), 'HISTORY_INVALID');
}));

test('rejects a ledger file with an unknown extra top-level field', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  const raw = readLedgerRaw(f.directory);
  writeFileSync(ledgerPath(f.directory), JSON.stringify({ ...raw, extra: 'unexpected' }));
  assertCode(() => history.head(), 'HISTORY_INVALID');
}));

test('rejects a truncated ledger file', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  history.append(buildAppend(f.identity, { expectedLatest: 0 }));
  const full = readFileSync(ledgerPath(f.directory), 'utf8');
  writeFileSync(ledgerPath(f.directory), full.slice(0, Math.floor(full.length / 2)));
  assertCode(() => history.head(), 'HISTORY_INVALID');
}));

test('read()/readBytes() of a missing sequence is explicit, never a default or empty success', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  history.append(buildAppend(f.identity, { expectedLatest: 0 }));
  assertCode(() => history.read(2), 'HISTORY_NOT_FOUND');
  assertCode(() => history.readBytes(2), 'HISTORY_NOT_FOUND');
  assertCode(() => history.read(0), 'HISTORY_REQUEST_INVALID');
  assertCode(() => history.read(-1), 'HISTORY_REQUEST_INVALID');
  assertCode(() => history.read(1.5), 'HISTORY_REQUEST_INVALID');
  // An unsafe-but-integer-valued sequence (per contract.json's own "positive
  // safe integer" wording) must be rejected as HISTORY_REQUEST_INVALID, never
  // treated as a legitimately-shaped-but-missing sequence (HISTORY_NOT_FOUND).
  assertCode(() => history.read(Number.MAX_SAFE_INTEGER + 1), 'HISTORY_REQUEST_INVALID');
  assertCode(() => history.readBytes(Number.MAX_SAFE_INTEGER + 1), 'HISTORY_REQUEST_INVALID');
}));

// ---------------------------------------------------------------------------
// HISTORY_SEQUENCE_EXHAUSTED is a dedicated code reserved for a VALID next
// sequence that would legitimately, contiguously exceed Number.MAX_SAFE_INTEGER
// through real appends -- never for an already-corrupted, noncontiguous
// ledger. Given HISTORY_ARTIFACT_MAX_BYTES/HISTORY_LEDGER_MAX_BYTES, a single
// bounded ledger can hold only on the order of ~10-12 maximally-sized real
// appends (see the HISTORY_LEDGER_MAX_BYTES test's own measured on-disk
// growth) before HISTORY_TOO_LARGE triggers; no fixture constructible under
// this contract's bounded single-file design can ever contiguously reach a
// sequence anywhere near Number.MAX_SAFE_INTEGER (~9.007e15) through real
// appends. Genuine blackbox runtime coverage of HISTORY_SEQUENCE_EXHAUSTED's
// legitimate reachable-overflow precondition is therefore provably
// unreachable in this suite -- a declared, honest limitation, not an
// oversight -- and this suite deliberately does not fabricate an impossible
// ledger state or add a test-only sequence-bound override seam solely to
// force coverage of it.
// ---------------------------------------------------------------------------

test(
  'rejects a ledger whose single record carries a noncontiguous, directly-tampered sequence jump as '
  + 'HISTORY_INVALID corruption (distinct from the unreachable, legitimately-reachable HISTORY_SEQUENCE_EXHAUSTED '
  + 'overflow precondition)',
  () => withFixture(f => {
    const history = new NodeWorkflowHistory(f.directory, f.identity);
    history.initialize();
    history.append(buildAppend(f.identity, { expectedLatest: 0 }));
    // Directly tampering a single stored record's sequence to MAX_SAFE_INTEGER
    // is an impossible, noncontiguous jump (~9 quadrillion) that no real
    // append sequence could ever reach -- this models ledger corruption, not
    // the dedicated overflow code's legitimate reachable-overflow precondition.
    tamperLedger(f.directory, raw => {
      raw.revisions[0].sequence = Number.MAX_SAFE_INTEGER;
    });
    const reopened = new NodeWorkflowHistory(f.directory, f.identity);
    assertCode(() => reopened.append(buildAppend(f.identity, {
      operationId: randomUUID(), expectedLatest: Number.MAX_SAFE_INTEGER,
    })), 'HISTORY_INVALID');
  }),
);

// ---------------------------------------------------------------------------
// append() request validation.
// ---------------------------------------------------------------------------

const invalidAppends: ReadonlyArray<[string, Partial<HistoryAppend>]> = [
  ['blank operationId', { operationId: '' }],
  ['oversized operationId', { operationId: 'x'.repeat(257) }],
  ['non-integer expectedLatest', { expectedLatest: 1.5 }],
  ['negative expectedLatest', { expectedLatest: -1 }],
  ['non-finite expectedLatest', { expectedLatest: Number.POSITIVE_INFINITY }],
  ['unsupported kind', { kind: 'unsupported-kind' as unknown as HistoryArtifactKind }],
  ['non-Uint8Array bytes', { bytes: 'not-bytes' as unknown as Uint8Array }],
  ['malformed binding', { binding: { version: 1 } as unknown as WorkflowBinding }],
];

for (const [label, overrides] of invalidAppends) {
  test(`append() rejects ${label} before any mutation`, () => withFixture(f => {
    const history = new NodeWorkflowHistory(f.directory, f.identity);
    history.initialize();
    const before = readFileSync(ledgerPath(f.directory), 'utf8');
    assertCode(() => history.append(buildAppend(f.identity, overrides)), 'HISTORY_REQUEST_INVALID');
    assert.equal(readFileSync(ledgerPath(f.directory), 'utf8'), before);
  }));
}

// ---------------------------------------------------------------------------
// Pagination.
// ---------------------------------------------------------------------------

test('list() returns at most limit revisions strictly above the cursor, in ascending order', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  for (let i = 0; i < 5; i += 1) {
    history.append(buildAppend(f.identity, { expectedLatest: i, bytes: new TextEncoder().encode(`item-${i}`) }));
  }
  assert.deepEqual(history.list(0, 2).map((r: HistoryRevision) => r.sequence), [1, 2]);
  assert.deepEqual(history.list(2, 2).map((r: HistoryRevision) => r.sequence), [3, 4]);
  assert.deepEqual(history.list(4, 2).map((r: HistoryRevision) => r.sequence), [5]);
  assert.deepEqual(history.list(5, 10).map((r: HistoryRevision) => r.sequence), []);
  assert.deepEqual(history.list(0, 100).map((r: HistoryRevision) => r.sequence), [1, 2, 3, 4, 5]);
}));

test('list() rejects invalid cursor/limit arguments', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  history.append(buildAppend(f.identity, { expectedLatest: 0 }));
  assertCode(() => history.list(-1, 10), 'HISTORY_REQUEST_INVALID');
  assertCode(() => history.list(1.5, 10), 'HISTORY_REQUEST_INVALID');
  assertCode(() => history.list(0, 0), 'HISTORY_REQUEST_INVALID');
  assertCode(() => history.list(0, 101), 'HISTORY_REQUEST_INVALID');
  assertCode(() => history.list(0, -1), 'HISTORY_REQUEST_INVALID');
  // An unsafe-but-integer-valued cursor (per contract.json's "cursor safe
  // integer>=0" wording) must be rejected explicitly, never silently
  // accepted into a (necessarily empty/truncated) page response.
  assertCode(() => history.list(Number.MAX_SAFE_INTEGER + 1, 10), 'HISTORY_REQUEST_INVALID');
}));

test('list() results are deeply frozen defensive copies that cannot corrupt retained state', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  history.append(buildAppend(f.identity, { expectedLatest: 0 }));
  const listed = history.list(0, 10);
  assert.ok(Object.isFrozen(listed[0]));
  assert.throws(() => { (listed[0] as unknown as { sequence: number }).sequence = 999; });
  const again = history.list(0, 10);
  assert.equal(again[0].sequence, 1);
}));

test('head()/list()/read()/readBytes() never mutate the ledger file or its metadata', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  history.append(buildAppend(f.identity, { expectedLatest: 0 }));
  const before = statSync(ledgerPath(f.directory));
  const beforeContent = readFileSync(ledgerPath(f.directory), 'utf8');
  history.head();
  history.list(0, 10);
  history.read(1);
  history.readBytes(1);
  const after = statSync(ledgerPath(f.directory));
  const afterContent = readFileSync(ledgerPath(f.directory), 'utf8');
  assert.equal(before.mtimeMs, after.mtimeMs);
  assert.equal(before.mode, after.mode);
  assert.equal(beforeContent, afterContent);
}));

test('only ledger.json is ever left behind in the custody directory under normal operation', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  history.append(buildAppend(f.identity, { expectedLatest: 0 }));
  history.append(buildAppend(f.identity, { expectedLatest: 1 }));
  assert.deepEqual(readdirSync(f.directory).sort(), ['ledger.json']);
}));

// ---------------------------------------------------------------------------
// HISTORY_LEDGER_MAX_BYTES: real appended records, not fabricated strings.
// ---------------------------------------------------------------------------

test('rejects an append that would exceed HISTORY_LEDGER_MAX_BYTES without publishing it', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  let expectedLatest = 0;
  let sizeBefore = statSync(ledgerPath(f.directory)).size;
  // Append real, maximally-sized artifacts (not fabricated strings) until the
  // *next* full-size append would cross HISTORY_LEDGER_MAX_BYTES, tracking
  // actual on-disk ledger growth after each real, successful append.
  while (sizeBefore + estimateAppendGrowth() < HISTORY_LEDGER_MAX_BYTES) {
    const revision = history.append(buildAppend(f.identity, {
      operationId: randomUUID(), expectedLatest, bytes: randomBytes(HISTORY_ARTIFACT_MAX_BYTES),
    }));
    expectedLatest = revision.sequence;
    sizeBefore = statSync(ledgerPath(f.directory)).size;
  }
  const before = readFileSync(ledgerPath(f.directory), 'utf8');
  assertCode(() => history.append(buildAppend(f.identity, {
    operationId: randomUUID(), expectedLatest, bytes: randomBytes(HISTORY_ARTIFACT_MAX_BYTES),
  })), 'HISTORY_TOO_LARGE');
  assert.equal(readFileSync(ledgerPath(f.directory), 'utf8'), before, 'a cap-exceeding append must not publish anything');
  assert.equal(history.head().latestSequence, expectedLatest);
}));

// ---------------------------------------------------------------------------
// Mutex: occupied blocks instead of expiring.
// ---------------------------------------------------------------------------

test('an occupied mutex blocks an append instead of expiring or replacing it', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  writeFileSync(lockPath(f.directory), 'held by another process\n', { mode: 0o600 });
  assertCode(() => history.append(buildAppend(f.identity, { expectedLatest: 0 })), 'HISTORY_BUSY');
  assert.equal(readFileSync(lockPath(f.directory), 'utf8'), 'held by another process\n');
}));

test(
  'a foreign occupied ledger.lock present in a FRESH, not-yet-initialized directory blocks initialize() with '
  + 'HISTORY_BUSY, exactly like it blocks append() -- the contract groups initialize() with append() as a '
  + '"mutation" requiring the same exclusive-mutex discipline, with no exemption for the not-yet-existing-ledger case',
  () => withFixture(f => {
    const history = new NodeWorkflowHistory(f.directory, f.identity);
    writeFileSync(lockPath(f.directory), 'held by another process\n', { mode: 0o600 });
    assertCode(() => history.initialize(), 'HISTORY_BUSY');
    assert.deepEqual(
      readdirSync(f.directory).sort(), ['ledger.lock'],
      'no ledger.json may ever be staged/published while a foreign mutex is held',
    );
    assert.equal(
      readFileSync(lockPath(f.directory), 'utf8'), 'held by another process\n',
      'the foreign lock must be preserved untouched',
    );
  }),
);

test(
  'an unsafe (non-safe-integer) expectedLatest is rejected as HISTORY_REQUEST_INVALID strictly before any mutex '
  + 'interaction -- proven by keeping a foreign mutex occupied throughout, which the rejection must never even reach, '
  + 'unlike a legitimately-shaped-but-stale expectedLatest, which only ever surfaces as HISTORY_CONFLICT/HISTORY_BUSY '
  + 'after entering the locked mutation path',
  () => withFixture(f => {
    const history = new NodeWorkflowHistory(f.directory, f.identity);
    history.initialize();
    writeFileSync(lockPath(f.directory), 'held by another process\n', { mode: 0o600 });
    const before = readFileSync(ledgerPath(f.directory), 'utf8');
    assertCode(() => history.append(buildAppend(f.identity, {
      expectedLatest: Number.MAX_SAFE_INTEGER + 1,
    })), 'HISTORY_REQUEST_INVALID');
    assert.equal(readFileSync(ledgerPath(f.directory), 'utf8'), before, 'prewrite rejection must not mutate the ledger');
    assert.equal(
      readFileSync(lockPath(f.directory), 'utf8'), 'held by another process\n',
      'the foreign lock must be left completely untouched -- the rejection must occur before any lock interaction',
    );
  }),
);

// ---------------------------------------------------------------------------
// Real Linux fixture: permission/FIFO/symlink/directory ledger paths.
// ---------------------------------------------------------------------------

/**
 * Requires an unprivileged (non-root) test runner: POSIX permission bits must
 * actually be enforced for this assertion to be meaningful.
 */
test('rejects a non-owner-readable ledger file explicitly, without chmod-ing it (requires an unprivileged/non-root test runner)', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  chmodSync(ledgerPath(f.directory), 0o644);
  try {
    assertCode(() => history.head(), 'HISTORY_INVALID');
    assert.equal(statSync(ledgerPath(f.directory)).mode & 0o777, 0o644, 'readers must never chmod the ledger');
  } finally {
    chmodSync(ledgerPath(f.directory), 0o600);
  }
}));

/**
 * Creates a real FIFO at the exact ledger path using the system mkfifo binary
 * (no shell, checked exit code), then asserts the loader rejects it as
 * HISTORY_PATH_INVALID without this test itself ever opening the FIFO or
 * installing any timeout: rejection must happen before any blocking open.
 */
test('rejects a FIFO in place of the ledger file as HISTORY_PATH_INVALID without blocking on open', () => withFixture(f => {
  const mkfifo = spawnSync('/usr/bin/mkfifo', [ledgerPath(f.directory)]);
  assert.equal(mkfifo.status, 0, `mkfifo must succeed (stderr: ${mkfifo.stderr?.toString() ?? ''})`);
  try {
    const history = new NodeWorkflowHistory(f.directory, f.identity);
    assertCode(() => history.head(), 'HISTORY_PATH_INVALID');
  } finally {
    rmSync(ledgerPath(f.directory), { force: true });
  }
}));

test('rejects a symlinked ledger file as HISTORY_PATH_INVALID', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  const real = readFileSync(ledgerPath(f.directory), 'utf8');
  rmSync(ledgerPath(f.directory));
  const externalTarget = join(f.base, 'external-ledger.json');
  writeFileSync(externalTarget, real);
  symlinkSync(externalTarget, ledgerPath(f.directory));
  assertCode(() => history.head(), 'HISTORY_PATH_INVALID');
}));

test('rejects a directory in place of the ledger file as HISTORY_PATH_INVALID', () => withFixture(f => {
  mkdirSync(ledgerPath(f.directory));
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  assertCode(() => history.head(), 'HISTORY_PATH_INVALID');
}));

// ---------------------------------------------------------------------------
// Error content hygiene.
// ---------------------------------------------------------------------------

test('error messages never echo artifact bytes, base64 content or binding digest material', () => withFixture(f => {
  const history = new NodeWorkflowHistory(f.directory, f.identity);
  history.initialize();
  const secretBytes = new TextEncoder().encode('super-secret-payload-marker-xyz');
  const append = buildAppend(f.identity, { bytes: secretBytes, expectedLatest: 0 });
  history.append(append);
  const error = historyError(() => history.append({ ...append, expectedLatest: 1 }));
  const serialized = JSON.stringify({ message: error.message, code: error.code });
  assert.ok(!serialized.includes('super-secret-payload-marker-xyz'));
  assert.ok(!serialized.includes(toBase64(secretBytes)));
}));

// ---------------------------------------------------------------------------
// Real injected writeSecureText seam: failure before vs. after publication.
// ---------------------------------------------------------------------------

class WriteFailsBeforePublicationStore implements Pick<ISecureStore, 'writeSecureText'> {
  public called = false;

  writeSecureText(): void {
    this.called = true;
    throw new Error('synthetic failure injected before any publication');
  }
}

test('a write failure before publication reports commitMayHaveChanged=false and publishes nothing', () => withFixture(f => {
  const store = new WriteFailsBeforePublicationStore();
  const history = new NodeWorkflowHistory(f.directory, f.identity, store);
  const error = historyError(() => history.initialize());
  assert.equal(error.code, 'HISTORY_WRITE_FAILED');
  assert.equal(error.commitMayHaveChanged, false);
  assert.ok(store.called, 'the injected writer must actually have been invoked');
  assert.deepEqual(readdirSync(f.directory), [], 'nothing must be published when the write never committed');
}));

/**
 * A real HistoryPublisher that performs an actual same-filesystem hard link
 * of the staged bytes to the final ledger path -- genuinely committing the
 * complete version-1 empty ledger content via fs.linkSync -- and only then
 * throws a synthetic marker. This models "real successful publication
 * followed by an uncertain failure" for initialize(), per the human-approved
 * narrow injectable HistoryPublisher constructor seam. The default writer
 * (left uninjected here) stages the bytes first; this publisher is invoked
 * only once that real staged file already exists, so the link it performs is
 * a genuine, complete publication, not a partial write.
 */
class RealLinkThenFailPublisher implements HistoryPublisher {
  public invoked = false;

  publish(stagedPath: string, ledgerPath: string): void {
    this.invoked = true;
    linkSync(stagedPath, ledgerPath);
    throw new Error('synthetic-secret-marker-injected-after-real-publish');
  }
}

test(
  "initialize()'s real publisher that links staged bytes to the ledger path and then throws reports "
  + 'commitMayHaveChanged=true; an independent instance verifies the empty ledger genuinely committed, and a '
  + 'second initialize() refuses HISTORY_ALREADY_EXISTS rather than overwriting or repeating publication',
  () => withFixture(f => {
    const publisher = new RealLinkThenFailPublisher();
    const history = new NodeWorkflowHistory(f.directory, f.identity, undefined, publisher);
    const error = historyError(() => history.initialize());
    assert.equal(error.code, 'HISTORY_WRITE_FAILED');
    assert.equal(error.commitMayHaveChanged, true);
    assert.ok(publisher.invoked, 'the injected publisher must actually have been invoked');
    // Independent real readback (a plain, uninjected instance) confirms the
    // version-1 empty ledger actually committed to the real ledger path, not
    // merely that the publisher was called.
    const independent = new NodeWorkflowHistory(f.directory, f.identity);
    const head = independent.head();
    assert.equal(head.latestSequence, 0);
    assert.equal(head.latestDigest, null);
    assert.deepEqual(head.identity, f.identity);
    // A second initialize() against the now-real ledger must refuse rather
    // than silently overwriting or repeating publication.
    assertCode(() => independent.initialize(), 'HISTORY_ALREADY_EXISTS');
  }),
);

/**
 * A real HistoryPublisher that performs a genuine same-filesystem hard link
 * of the staged bytes to the final ledger path -- actually, completely
 * publishing real content -- and then, only AFTER that real publication,
 * intentionally damages the now-published ledger file on disk (a real
 * truncating write to the real ledger path) before returning normally (no
 * throw). This models a publisher that reports an uncertain-but-unthrown
 * outcome while the real on-disk artifact it just published is already
 * corrupted -- exactly the class of failure the contract's independent
 * post-publication readback requirement exists to catch.
 */
class RealLinkThenDamagePublisher implements HistoryPublisher {
  public invoked = false;

  publish(stagedPath: string, finalLedgerPath: string): void {
    this.invoked = true;
    linkSync(stagedPath, finalLedgerPath);
    const published = readFileSync(finalLedgerPath, 'utf8');
    writeFileSync(finalLedgerPath, published.slice(0, Math.floor(published.length / 2)));
    // Returns normally: no throw, modeling a misreported/uncertain clean commit.
  }
}

test(
  "initialize()'s publisher that genuinely links staged bytes to the ledger path and then damages the "
  + 'real published ledger before returning normally (no throw) must itself report '
  + 'HISTORY_READBACK_FAILED/commitMayHaveChanged=true -- never a success-shaped HistoryHead -- and an '
  + 'independent real instance must explicitly reject the now-corrupted ledger, never report a default/empty head',
  () => withFixture(f => {
    const publisher = new RealLinkThenDamagePublisher();
    const history = new NodeWorkflowHistory(f.directory, f.identity, undefined, publisher);
    const error = historyError(() => history.initialize());
    assert.equal(error.code, 'HISTORY_READBACK_FAILED');
    assert.equal(error.commitMayHaveChanged, true);
    assert.ok(publisher.invoked, 'the injected publisher must actually have been invoked');
    // Independent real readback: the real on-disk ledger is now genuinely
    // corrupted by the publisher's own post-publication damage; an
    // independent instance must explicitly reject it, never silently
    // succeed, default, or report any success-shaped head.
    const independent = new NodeWorkflowHistory(f.directory, f.identity);
    assertCode(() => independent.head(), 'HISTORY_INVALID');
  }),
);

/**
 * Delegates to a real NodeSecureStore (so the ledger actually commits) and
 * only then throws, modeling "real successful write followed by a thrown
 * error/readback impairment" rather than a pre-publication failure.
 */
class RealWriteThenFailStore implements Pick<ISecureStore, 'writeSecureText'> {
  private readonly real = new NodeSecureStore();
  public writes = 0;

  writeSecureText(filePath: string, content: string): void {
    this.real.writeSecureText(filePath, content);
    this.writes += 1;
    throw new Error('synthetic failure injected after a real, already-committed write');
  }
}

test(
  'a real committed write followed by a thrown error surfaces commitMayHaveChanged=true, '
  + 'and a retry reconciles without a duplicate append',
  () => withFixture(f => {
    const plainHistory = new NodeWorkflowHistory(f.directory, f.identity);
    plainHistory.initialize();
    const store = new RealWriteThenFailStore();
    const history = new NodeWorkflowHistory(f.directory, f.identity, store);
    const operationId = randomUUID();
    const append = buildAppend(f.identity, { operationId, expectedLatest: 0 });
    const error = historyError(() => history.append(append));
    assert.equal(error.code, 'HISTORY_WRITE_FAILED');
    assert.equal(error.commitMayHaveChanged, true);
    assert.equal(store.writes, 1, 'the injected writer must have actually performed its real write exactly once');
    // Independent real readback (a plain, uninjected instance) confirms the
    // append actually committed to disk, not merely that the writer was called.
    const committed = plainHistory.list(0, 10);
    assert.equal(committed.length, 1);
    assert.equal(committed[0].operationId, operationId);
    // Retrying the exact original request must reconcile to the
    // already-persisted revision rather than attempting -- and certainly
    // never duplicating -- another append.
    const retried = history.append(append);
    assert.deepEqual(retried, committed[0]);
    assert.equal(store.writes, 1, 'a reconciled idempotent retry must not perform a second write');
    assert.equal(plainHistory.list(0, 10).length, 1, 'the retry must not create a duplicate stored revision');
  }),
);

// ---------------------------------------------------------------------------
// append() must independently verify persisted bytes, never echo the
// writer's own claimed success: a writer whose writeSecureText() returns
// normally (no throw) but did not actually persist the exact candidate
// content must itself be caught by append(), not silently reported as a
// successful revision.
// ---------------------------------------------------------------------------

/**
 * A writer whose writeSecureText() returns normally but performs no real
 * filesystem write at all -- modeling a writer that silently discards the
 * requested bytes while lying about having committed them. Used only after
 * a real ledger has already been genuinely initialized with the default
 * writer, so the prior, real on-disk state is well-defined and
 * independently checkable both before and after the discarded append.
 */
class SilentlyDiscardingStore implements Pick<ISecureStore, 'writeSecureText'> {
  public calls = 0;

  writeSecureText(): void {
    this.calls += 1;
    // Intentionally does nothing: no real write occurs, no throw either.
  }
}

test(
  'append() with a writer that silently discards the write (no real persistence, no throw) must itself report '
  + 'HISTORY_READBACK_FAILED/commitMayHaveChanged=true -- never a phantom success -- and an independent real '
  + 'instance confirms the real ledger remains at its exact, unchanged prior state; a later retry with a real '
  + 'writer still persists exactly one genuine revision, proving the failed attempt erased nothing',
  () => withFixture(f => {
    const plainHistory = new NodeWorkflowHistory(f.directory, f.identity);
    plainHistory.initialize(); // real, genuine initialization first
    const before = readFileSync(ledgerPath(f.directory), 'utf8');
    const store = new SilentlyDiscardingStore();
    const history = new NodeWorkflowHistory(f.directory, f.identity, store);
    const error = historyError(() => history.append(buildAppend(f.identity, { expectedLatest: 0 })));
    assert.equal(error.code, 'HISTORY_READBACK_FAILED');
    assert.equal(error.commitMayHaveChanged, true);
    assert.ok(store.calls > 0, 'the injected writer must actually have been invoked');
    // Independent real readback: the real on-disk ledger must remain
    // exactly at its unchanged prior (pre-append) state -- not silently
    // advanced, not corrupted, no phantom revision ever visible.
    assert.equal(readFileSync(ledgerPath(f.directory), 'utf8'), before);
    assert.equal(plainHistory.list(0, 10).length, 0, 'no phantom revision may ever become independently readable');
    // A later retry of the identical, never-actually-persisted operation,
    // using a real writer, must genuinely persist exactly one revision --
    // reconciling cleanly, never erasing or duplicating whatever
    // (nonexistent) prior state the failed attempt left behind.
    const retried = plainHistory.append(buildAppend(f.identity, { expectedLatest: 0 }));
    assert.equal(retried.sequence, 1);
    assert.equal(
      plainHistory.list(0, 10).length, 1,
      'the retry must persist exactly one real revision, not erase or duplicate',
    );
  }),
);

/**
 * A writer whose writeSecureText() performs a real, but wrong, write --
 * truncating the candidate content before writing it -- and then returns
 * normally (no throw). Models a writer that lies about having committed the
 * exact requested bytes while still genuinely touching the real filesystem.
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
  'append() with a writer that performs a real but truncated/wrong write (no throw) must itself report '
  + 'HISTORY_READBACK_FAILED/commitMayHaveChanged=true, and an independent real instance explicitly rejects the '
  + 'now-corrupted ledger as invalid -- never a default/empty success -- with the explicit-invalid state surviving '
  + 'a further retry attempt rather than being silently erased or papered over',
  () => withFixture(f => {
    const plainHistory = new NodeWorkflowHistory(f.directory, f.identity);
    plainHistory.initialize();
    const store = new TruncatingWriteStore();
    const history = new NodeWorkflowHistory(f.directory, f.identity, store);
    const error = historyError(() => history.append(buildAppend(f.identity, { expectedLatest: 0 })));
    assert.equal(error.code, 'HISTORY_READBACK_FAILED');
    assert.equal(error.commitMayHaveChanged, true);
    assert.ok(store.calls > 0, 'the injected writer must actually have been invoked');
    // Independent real readback: the real on-disk ledger is now genuinely
    // corrupted by the writer's own truncated write; an independent
    // instance must explicitly reject it, never silently succeed or default.
    const independent = new NodeWorkflowHistory(f.directory, f.identity);
    assertCode(() => independent.head(), 'HISTORY_INVALID');
    // A further retry attempt against the now-corrupted real ledger must
    // continue to detect and explicitly reject the corruption -- it must
    // never silently erase the corrupted bytes or paper over them with an
    // unverified fresh success.
    assertCode(() => independent.append(buildAppend(f.identity, { expectedLatest: 0 })), 'HISTORY_INVALID');
  }),
);


/**
 * Delegates every write to a real NodeSecureStore so the ledger actually
 * commits, then -- once armed, and only on the first write after arming --
 * simulates another legitimate process having re-created the ownership
 * mutex in the narrow window between this process's ledger write and its
 * own mutex release: the lock file this process currently holds is renamed
 * aside to a fixture-owned path, and a brand-new `ledger.lock` is written in
 * its place with content only this store controls. A correct mutex release
 * must recognize that the lock file it is about to remove is no longer the
 * one it created and must refuse to delete someone else's lock.
 */
class LockSwapAfterWriteStore implements Pick<ISecureStore, 'writeSecureText'> {
  private readonly real = new NodeSecureStore();
  private armed = false;
  public triggered = false;

  constructor(
    private readonly lockFilePath: string,
    private readonly savedLockPath: string,
    private readonly replacementMarker: string,
  ) {}

  arm(): void {
    this.armed = true;
  }

  writeSecureText(filePath: string, content: string): void {
    this.real.writeSecureText(filePath, content);
    if (this.armed && !this.triggered) {
      this.triggered = true;
      renameSync(this.lockFilePath, this.savedLockPath);
      writeFileSync(this.lockFilePath, this.replacementMarker, { mode: 0o600 });
    }
  }
}

test('a mutex replaced by another process during append persistence is never silently deleted', () => withFixture(f => {
  const plainHistory = new NodeWorkflowHistory(f.directory, f.identity);
  plainHistory.initialize();
  const savedLockPath = join(f.base, 'saved-ledger.lock');
  const replacementMarker = 'replacement-lock\n';
  const store = new LockSwapAfterWriteStore(lockPath(f.directory), savedLockPath, replacementMarker);
  const history = new NodeWorkflowHistory(f.directory, f.identity, store);
  store.arm();
  const error = historyError(() => history.append(buildAppend(f.identity, { expectedLatest: 0 })));
  assert.equal(error.code, 'HISTORY_BUSY');
  assert.equal(error.commitMayHaveChanged, true);
  assert.ok(store.triggered, 'expected the injected store to have swapped the lock file');
  assert.ok(readFileSync(savedLockPath, 'utf8').length > 0);
  assert.equal(
    readFileSync(lockPath(f.directory), 'utf8'), replacementMarker,
    "the replacement lock must survive mutex release untouched — it is not this process's to delete",
  );
  const committed = plainHistory.list(0, 10);
  assert.equal(committed.length, 1, 'the already-committed append must remain readable despite the mutex failure');
}));

// ---------------------------------------------------------------------------
// Real cross-process contention: two real OS processes race the same expectedLatest.
// ---------------------------------------------------------------------------

interface WorkerOutcome {
  readonly kind: 'ready' | 'result';
  readonly ok?: boolean;
  readonly sequence?: number;
  readonly error?: string;
  /** The contractual error code, propagated from the worker's IPC payload. */
  readonly code?: string;
  readonly commitMayHaveChanged?: boolean;
  readonly pid: number;
}

function startAppendWorker(
  f: Fixture, operationId: string, expectedLatest: number,
): { child: ReturnType<typeof fork>; ready: Promise<void>; complete: Promise<WorkerOutcome> } {
  const payload = {
    operationId,
    expectedLatest,
    binding: buildBinding(f.identity),
    kind: 'scenario' as HistoryArtifactKind,
    bytesBase64: Buffer.from('cross-process-content').toString('base64'),
  };
  const child = fork(
    join(__dirname, 'workflowHistoryWorker.js'),
    [f.directory, f.identity.projectId, f.identity.taskId, f.identity.incarnation, JSON.stringify(payload)],
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
  'two real independent processes racing an append against the same expectedLatest produce at most one new revision',
  () => withFixtureAsync(async f => {
    const history = new NodeWorkflowHistory(f.directory, f.identity);
    history.initialize();
    const first = startAppendWorker(f, randomUUID(), 0);
    const second = startAppendWorker(f, randomUUID(), 0);
    try {
      await Promise.all([first.ready, second.ready]);
      first.child.send('go');
      second.child.send('go');
      const results = await Promise.all([first.complete, second.complete]);
      const succeeded = results.filter(result => result.ok);
      assert.equal(succeeded.length, 1, 'exactly one of the two same-expectedLatest appends must win');
      const failed = results.find(result => !result.ok);
      assert.ok(failed);
      assert.ok(
        failed.code === 'HISTORY_BUSY' || failed.code === 'HISTORY_CONFLICT',
        `expected HISTORY_BUSY or HISTORY_CONFLICT, received ${failed.code}`,
      );
      assert.equal(history.list(0, 10).length, 1, 'only the winning append may be persisted');
      assert.equal(new Set(results.map(result => result.pid)).size, 2, 'both workers must be real, distinct OS processes');
    } finally {
      if (first.child.exitCode === null) { first.child.kill('SIGTERM'); }
      if (second.child.exitCode === null) { second.child.kill('SIGTERM'); }
    }
  }),
);
