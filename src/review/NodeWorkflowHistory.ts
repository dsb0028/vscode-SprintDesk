/**
 * Bounded, single-file immutable artifact/revision custody library.
 *
 * `NodeWorkflowHistory` proves byte-for-byte consistency and append-only custody of artifacts a
 * trusted caller hands it under a pinned `{projectId, taskId, incarnation}` identity. It is a
 * narrow, explicitly initialized ledger over one JSON file (`ledger.json`) plus one cooperating
 * mutex file (`ledger.lock`) inside a caller-owned custody directory. It never proves authentic
 * host capture, semantic review correctness, human approval, signing, or a live, writable
 * task-tracking identity; it never reads or writes any other SprintDesk tracking state.
 */

import * as fs from 'fs';
import { isAbsolute, join, normalize } from 'path';
import { createHash, randomUUID } from 'crypto';
import { ISecureStore } from '../host/ISecureStore';
import { NodeSecureStore } from '../host/NodeSecureStore';
import { WorkflowBinding, WorkflowBindingError, parseWorkflowBinding } from './workflowBinding';
import { digest as protocolDigest } from './protocol';

export const HISTORY_ARTIFACT_MAX_BYTES = 1048576;
export const HISTORY_LEDGER_MAX_BYTES = 16777216;

const LEDGER_FILE_NAME = 'ledger.json';
const LOCK_FILE_NAME = 'ledger.lock';
const MAX_IDENTITY_FIELD_UNITS = 256;
const HEX_64 = /^[0-9a-f]{64}$/;
const READ_CHUNK_SIZE = 65536;
const DIRECTORY_MODE_MASK = 0o077;
const FILE_MODE = 0o600;

export type HistoryArtifactKind =
  | 'scenario' | 'translation' | 'review' | 'execution'
  | 'implementation' | 'evidence' | 'guidance' | 'context';

const HISTORY_ARTIFACT_KINDS: ReadonlySet<string> = new Set([
  'scenario', 'translation', 'review', 'execution',
  'implementation', 'evidence', 'guidance', 'context',
]);

export interface HistoryIdentity {
  readonly projectId: string;
  readonly taskId: string;
  readonly incarnation: string;
}

export interface HistoryAppend {
  readonly operationId: string;
  readonly expectedLatest: number;
  readonly binding: WorkflowBinding;
  readonly kind: HistoryArtifactKind;
  readonly bytes: Uint8Array;
}

export interface HistoryRevision {
  readonly id: string;
  readonly sequence: number;
  readonly operationId: string;
  readonly expectedLatest: number;
  readonly binding: WorkflowBinding;
  readonly kind: HistoryArtifactKind;
  readonly digest: string;
  readonly byteLength: number;
  readonly contentBase64: string;
  readonly previousDigest: string | null;
  readonly revisionDigest: string;
}

export interface HistoryHead {
  readonly identity: HistoryIdentity;
  readonly latestSequence: number;
  readonly latestDigest: string | null;
}

/**
 * The narrow initialization publication seam. The default implementation atomically publishes
 * staged content without ever replacing any existing path (a same-filesystem hard link is
 * sufficient and is what the default uses). Only `initialize()` ever calls this operation;
 * `append()` always replaces the whole ledger atomically through the writer alone, since an
 * existing ledger is expected and required there.
 */
export interface HistoryPublisher {
  publish(stagedPath: string, ledgerPath: string): void;
}

export class WorkflowHistoryError extends Error {
  readonly code: string;
  readonly commitMayHaveChanged: boolean;

  constructor(code: string, message: string, commitMayHaveChanged: boolean) {
    super(message);
    this.name = 'WorkflowHistoryError';
    this.code = code;
    this.commitMayHaveChanged = commitMayHaveChanged;
    Object.setPrototypeOf(this, WorkflowHistoryError.prototype);
  }
}

class DefaultHistoryPublisher implements HistoryPublisher {
  publish(stagedPath: string, ledgerPath: string): void {
    let published = false;
    try {
      fs.linkSync(stagedPath, ledgerPath);
      published = true;
    } finally {
      if (published) {
        // The ledger is now genuinely published. A cleanup failure here must
        // never be silently swallowed: it propagates out of publish() and is
        // surfaced by initialize() as HISTORY_WRITE_FAILED with
        // commitMayHaveChanged=true, since a real publication was attempted.
        // Neither the already-published ledger nor the lingering staged
        // path is ever rolled back or deleted here -- both remain on disk
        // exactly as they are for independent inspection/reconciliation.
        fs.unlinkSync(stagedPath);
      } else {
        // The link itself failed (for example an existing ledger, EEXIST):
        // the staged file was never consumed. Best-effort remove it without
        // masking the original link failure with any secondary cleanup
        // error -- nothing was published in this branch.
        try { fs.unlinkSync(stagedPath); } catch { /* best-effort cleanup of the staged copy */ }
      }
    }
  }
}

interface ValidatedAppend {
  readonly operationId: string;
  readonly expectedLatest: number;
  readonly binding: WorkflowBinding;
  readonly kind: HistoryArtifactKind;
  readonly bytes: Uint8Array;
}

interface LoadedLedger {
  readonly identity: HistoryIdentity;
  readonly revisions: readonly HistoryRevision[];
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype;
}

function isNonBlankBoundedString(value: unknown, maxUnits: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxUnits;
}

/**
 * Decodes UTF-8 strictly: Node's `Buffer#toString('utf8')` silently substitutes invalid byte
 * sequences with U+FFFD rather than throwing, so validity is confirmed by re-encoding the
 * decoded text and comparing it byte-for-byte against the original input.
 */
function decodeStrictUtf8(raw: Buffer): string | undefined {
  const text = raw.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(raw)) {
    return undefined;
  }
  return text;
}

function isCanonicalBase64(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    return Buffer.from(value, 'base64').toString('base64') === value;
  } catch {
    return false;
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

export class NodeWorkflowHistory {
  private readonly directory: string;
  private readonly identity: HistoryIdentity;
  private readonly writer: Pick<ISecureStore, 'writeSecureText'>;
  private readonly publisher: HistoryPublisher;
  private readonly ledgerPath: string;
  private readonly lockPath: string;

  constructor(
    directory: string,
    identity: HistoryIdentity,
    writer: Pick<ISecureStore, 'writeSecureText'> = new NodeSecureStore(),
    publisher: HistoryPublisher = new DefaultHistoryPublisher(),
  ) {
    this.directory = this.validateDirectory(directory);
    this.identity = this.validateIdentity(identity);
    this.writer = writer;
    this.publisher = publisher;
    this.ledgerPath = join(this.directory, LEDGER_FILE_NAME);
    this.lockPath = join(this.directory, LOCK_FILE_NAME);
  }

  // ---------------------------------------------------------------------
  // Constructor validation: directory + identity only. No writes, no reads
  // of the ledger, no mkdir/chmod recovery, no implicit workspace root.
  // ---------------------------------------------------------------------

  private contextInvalid(reason: string): never {
    throw new WorkflowHistoryError('HISTORY_CONTEXT_INVALID', reason, false);
  }

  private validateDirectory(directory: unknown): string {
    if (typeof directory !== 'string' || !isAbsolute(directory)) {
      this.contextInvalid('NodeWorkflowHistory requires an absolute custody directory path.');
    }
    let normalized: string;
    try {
      normalized = normalize(directory);
    } catch {
      this.contextInvalid('The custody directory path could not be normalized.');
    }
    if (normalized !== directory) {
      this.contextInvalid('The custody directory must already be a normalized path.');
    }
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(directory);
    } catch {
      this.contextInvalid('The custody directory could not be inspected.');
    }
    if (stats.isSymbolicLink()) {
      this.contextInvalid('The custody directory must not be a symlink.');
    }
    if (!stats.isDirectory()) {
      this.contextInvalid('The custody directory must be a directory.');
    }
    let real: string;
    try {
      real = fs.realpathSync(directory);
    } catch {
      this.contextInvalid('The custody directory could not be resolved.');
    }
    if (real !== directory) {
      this.contextInvalid('The custody directory must not traverse any symlinked ancestor.');
    }
    if (process.platform !== 'win32' && (stats.mode & DIRECTORY_MODE_MASK) !== 0) {
      this.contextInvalid('The custody directory must be owner-only (mode 0700).');
    }
    return directory;
  }

  private validateIdentity(identity: unknown): HistoryIdentity {
    if (!isPlainObject(identity)) {
      this.contextInvalid('NodeWorkflowHistory requires a plain-object identity.');
    }
    const known = new Set(['projectId', 'taskId', 'incarnation']);
    for (const key of Object.keys(identity)) {
      if (!known.has(key)) {
        this.contextInvalid('The identity contains an unrecognized field.');
      }
    }
    const fields: Record<string, string> = {};
    for (const field of ['projectId', 'taskId', 'incarnation']) {
      if (!(field in identity)) {
        this.contextInvalid(`The identity is missing required field "${field}".`);
      }
      const value = identity[field];
      if (!isNonBlankBoundedString(value, MAX_IDENTITY_FIELD_UNITS)) {
        this.contextInvalid(`The identity field "${field}" must be a nonblank string of at most ${MAX_IDENTITY_FIELD_UNITS} UTF-16 code units.`);
      }
      fields[field] = value;
    }
    return Object.freeze({ projectId: fields.projectId, taskId: fields.taskId, incarnation: fields.incarnation });
  }

  // ---------------------------------------------------------------------
  // Shared error helpers.
  // ---------------------------------------------------------------------

  private error(code: string, message: string, commitMayHaveChanged: boolean): WorkflowHistoryError {
    return new WorkflowHistoryError(code, message, commitMayHaveChanged);
  }

  private writeFailed(commitMayHaveChanged: boolean): WorkflowHistoryError {
    return this.error('HISTORY_WRITE_FAILED', 'The workflow history ledger could not be written.', commitMayHaveChanged);
  }

  private newStagingPath(tag: string): string {
    return `${this.ledgerPath}.${tag}-${process.pid}-${randomUUID()}.staged`;
  }

  // ---------------------------------------------------------------------
  // initialize(): explicit, no-overwrite, atomic.
  // ---------------------------------------------------------------------

  initialize(): HistoryHead {
    return this.withLock(() => this.performInitialize());
  }

  private performInitialize(): HistoryHead {
    if (this.ledgerPathExists()) {
      throw this.error('HISTORY_ALREADY_EXISTS', 'A ledger already exists at this custody location.', false);
    }

    const emptyLedgerContent = JSON.stringify({ version: 1, identity: this.identity, revisions: [] });
    const stagingPath = this.newStagingPath('init');

    try {
      this.writer.writeSecureText(stagingPath, emptyLedgerContent);
    } catch {
      throw this.writeFailed(false);
    }

    try {
      this.publisher.publish(stagingPath, this.ledgerPath);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'EEXIST') {
        throw this.error('HISTORY_ALREADY_EXISTS', 'A ledger already exists at this custody location.', false);
      }
      throw this.writeFailed(true);
    }

    // Independent post-publication readback: a publisher that returns
    // normally is not proof the real, persisted ledger is the exact empty
    // version-1 content just staged. Re-read and fully re-validate it; any
    // load failure or content mismatch after a genuinely attempted
    // publication is an uncertain outcome, not a plain prewrite corruption.
    let ledger: LoadedLedger;
    try {
      ledger = this.loadLedger();
    } catch {
      throw this.error(
        'HISTORY_READBACK_FAILED',
        'initialize() published but the ledger could not be independently verified afterward.',
        true,
      );
    }
    if (ledger.revisions.length !== 0) {
      throw this.error(
        'HISTORY_READBACK_FAILED',
        'initialize() published but the independently re-read ledger does not match the expected empty content.',
        true,
      );
    }

    return this.toHead(ledger);
  }

  private ledgerPathExists(): boolean {
    try {
      fs.lstatSync(this.ledgerPath);
      return true;
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        return false;
      }
      return true;
    }
  }

  // ---------------------------------------------------------------------
  // Read-only operations.
  // ---------------------------------------------------------------------

  head(): HistoryHead {
    return this.toHead(this.loadLedger());
  }

  read(sequence: number): HistoryRevision {
    this.validateSequenceArgument(sequence);
    const ledger = this.loadLedger();
    const found = ledger.revisions.find(revision => revision.sequence === sequence);
    if (!found) {
      throw this.error('HISTORY_NOT_FOUND', 'No revision exists at the requested sequence.', false);
    }
    return found;
  }

  list(afterSequence: number, limit: number): readonly HistoryRevision[] {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw this.error('HISTORY_REQUEST_INVALID', 'afterSequence must be a nonnegative safe integer.', false);
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw this.error('HISTORY_REQUEST_INVALID', 'limit must be an integer between 1 and 100 inclusive.', false);
    }
    const ledger = this.loadLedger();
    const page = ledger.revisions.filter(revision => revision.sequence > afterSequence).slice(0, limit);
    return Object.freeze(page);
  }

  readBytes(sequence: number): Uint8Array {
    const revision = this.read(sequence);
    return Uint8Array.from(Buffer.from(revision.contentBase64, 'base64'));
  }

  private validateSequenceArgument(sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw this.error('HISTORY_REQUEST_INVALID', 'sequence must be a positive safe integer.', false);
    }
  }

  private toHead(ledger: LoadedLedger): HistoryHead {
    const last = ledger.revisions.length > 0 ? ledger.revisions[ledger.revisions.length - 1] : undefined;
    return Object.freeze({
      identity: ledger.identity,
      latestSequence: ledger.revisions.length,
      // The chain-tip digest is the full-record revisionDigest, never the
      // raw artifact-bytes digest -- per the approved content-chain decision.
      latestDigest: last ? last.revisionDigest : null,
    });
  }

  // ---------------------------------------------------------------------
  // append(): request validation (no lock needed), then mutation under lock.
  // ---------------------------------------------------------------------

  append(request: HistoryAppend): HistoryRevision {
    const validated = this.validateAppendRequest(request);
    return this.withLock(() => this.performAppend(validated));
  }

  private validateAppendRequest(request: HistoryAppend): ValidatedAppend {
    if (!isPlainObject(request as unknown)) {
      throw this.error('HISTORY_REQUEST_INVALID', 'The append request must be a plain object.', false);
    }
    const knownAppendFields = new Set(['operationId', 'expectedLatest', 'binding', 'kind', 'bytes']);
    for (const key of Object.keys(request as unknown as Record<string, unknown>)) {
      if (!knownAppendFields.has(key)) {
        throw this.error('HISTORY_REQUEST_INVALID', 'The append request contains an unrecognized field.', false);
      }
    }
    const operationId = request.operationId;
    if (!isNonBlankBoundedString(operationId, MAX_IDENTITY_FIELD_UNITS)) {
      throw this.error('HISTORY_REQUEST_INVALID', 'operationId must be a nonblank string of at most 256 UTF-16 code units.', false);
    }
    const expectedLatest = request.expectedLatest;
    if (!Number.isSafeInteger(expectedLatest) || expectedLatest < 0) {
      throw this.error('HISTORY_REQUEST_INVALID', 'expectedLatest must be a nonnegative safe integer.', false);
    }
    const kind = request.kind;
    if (typeof kind !== 'string' || !HISTORY_ARTIFACT_KINDS.has(kind)) {
      throw this.error('HISTORY_REQUEST_INVALID', 'kind must be a supported HistoryArtifactKind.', false);
    }
    if (!(request.bytes instanceof Uint8Array)) {
      throw this.error('HISTORY_REQUEST_INVALID', 'bytes must be a Uint8Array.', false);
    }
    const bytes = Uint8Array.from(request.bytes);
    let binding: WorkflowBinding;
    try {
      binding = parseWorkflowBinding(request.binding);
    } catch (error) {
      if (error instanceof WorkflowBindingError) {
        throw this.error('HISTORY_REQUEST_INVALID', 'binding failed structural validation.', false);
      }
      throw error;
    }
    if (binding.projectId !== this.identity.projectId
      || binding.taskId !== this.identity.taskId
      || binding.incarnation !== this.identity.incarnation) {
      throw this.error('HISTORY_IDENTITY_MISMATCH', 'The binding identity does not match the pinned custody identity.', false);
    }
    if (bytes.length > HISTORY_ARTIFACT_MAX_BYTES) {
      throw this.error('HISTORY_TOO_LARGE', `bytes exceeds the maximum artifact size of ${HISTORY_ARTIFACT_MAX_BYTES} bytes.`, false);
    }
    return { operationId, expectedLatest, binding, kind: kind as HistoryArtifactKind, bytes };
  }

  private performAppend(request: ValidatedAppend): HistoryRevision {
    const ledger = this.loadLedger();

    const existing = ledger.revisions.find(revision => revision.operationId === request.operationId);
    if (existing) {
      if (this.sameRequest(existing, request)) {
        return existing;
      }
      throw this.error('HISTORY_OPERATION_CONFLICT', 'A different request was already stored under this operationId.', false);
    }

    const latestSequence = ledger.revisions.length;
    if (request.expectedLatest !== latestSequence) {
      throw this.error('HISTORY_CONFLICT', 'expectedLatest does not match the current ledger head.', false);
    }

    const nextSequence = latestSequence + 1;
    if (!Number.isSafeInteger(nextSequence)) {
      throw this.error('HISTORY_SEQUENCE_EXHAUSTED', 'The next sequence exceeds the safe-integer range.', false);
    }

    const previousDigest = latestSequence === 0 ? null : ledger.revisions[latestSequence - 1].revisionDigest;
    const digest = sha256Hex(request.bytes);
    const contentBase64 = Buffer.from(request.bytes).toString('base64');
    const byteLength = request.bytes.length;
    const id = randomUUID();

    const revisionCore = {
      id,
      sequence: nextSequence,
      operationId: request.operationId,
      expectedLatest: request.expectedLatest,
      binding: request.binding,
      kind: request.kind,
      digest,
      byteLength,
      contentBase64,
      previousDigest,
    };
    const revisionDigest = protocolDigest(revisionCore);
    const revision: HistoryRevision = Object.freeze({ ...revisionCore, revisionDigest });

    const rawRevisions = [...ledger.revisions, revision];
    const candidateContent = JSON.stringify({ version: 1, identity: this.identity, revisions: rawRevisions });
    if (Buffer.byteLength(candidateContent, 'utf8') > HISTORY_LEDGER_MAX_BYTES) {
      throw this.error('HISTORY_TOO_LARGE', `The ledger would exceed the maximum size of ${HISTORY_LEDGER_MAX_BYTES} bytes.`, false);
    }

    try {
      this.writer.writeSecureText(this.ledgerPath, candidateContent);
    } catch {
      throw this.writeFailed(true);
    }

    // Independent post-write readback: never trust the writer's own claimed
    // success (or local echo of the candidate object) as proof of custody.
    // Re-read and fully re-validate the actual persisted ledger, and confirm
    // the new revision is genuinely present with the exact expected chain
    // position and content-chain digest before ever returning it.
    let verifiedLedger: LoadedLedger;
    try {
      verifiedLedger = this.loadLedger();
    } catch {
      throw this.error(
        'HISTORY_READBACK_FAILED',
        'append() wrote the ledger but the persisted content could not be independently verified afterward.',
        true,
      );
    }
    const verifiedRevision = verifiedLedger.revisions.length > 0
      ? verifiedLedger.revisions[verifiedLedger.revisions.length - 1]
      : undefined;
    if (
      !verifiedRevision
      || verifiedLedger.revisions.length !== nextSequence
      || verifiedRevision.revisionDigest !== revision.revisionDigest
    ) {
      throw this.error(
        'HISTORY_READBACK_FAILED',
        'append() wrote the ledger but the independently re-read content does not match the expected revision.',
        true,
      );
    }

    return verifiedRevision;
  }

  private sameRequest(existing: HistoryRevision, request: ValidatedAppend): boolean {
    return existing.expectedLatest === request.expectedLatest
      && existing.kind === request.kind
      && existing.byteLength === request.bytes.length
      && existing.digest === sha256Hex(request.bytes)
      && existing.contentBase64 === Buffer.from(request.bytes).toString('base64')
      && this.sameBinding(existing.binding, request.binding);
  }

  private sameBinding(a: WorkflowBinding, b: WorkflowBinding): boolean {
    return a.version === b.version && a.stage === b.stage && a.projectId === b.projectId
      && a.taskId === b.taskId && a.incarnation === b.incarnation && a.criterionId === b.criterionId
      && a.criterionRevision === b.criterionRevision && a.sourceRevision === b.sourceRevision
      && a.sourceDigest === b.sourceDigest && a.policyDigest === b.policyDigest && a.attemptId === b.attemptId;
  }

  // ---------------------------------------------------------------------
  // Mutex: an exclusive ownership lock per mutation. No age-based
  // reclamation; contention fails explicitly; the held inode is verified
  // before unlink so a replaced owner's lock is never silently deleted.
  // ---------------------------------------------------------------------

  private withLock<T>(operation: () => T): T {
    let descriptor: number;
    try {
      descriptor = fs.openSync(this.lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, FILE_MODE);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'EEXIST') {
        throw this.error('HISTORY_BUSY', 'The workflow history mutex is currently held.', false);
      }
      throw this.error('HISTORY_BUSY', 'The workflow history mutex could not be acquired.', false);
    }

    let ownedStat: { dev: number; ino: number };
    try {
      fs.writeSync(descriptor, `${process.pid}\n`);
      ownedStat = this.snapshotStat(fs.fstatSync(descriptor));
    } catch {
      try { fs.closeSync(descriptor); } catch { /* already closed */ }
      try { fs.unlinkSync(this.lockPath); } catch { /* best-effort cleanup */ }
      throw this.error('HISTORY_BUSY', 'The workflow history mutex could not be initialized.', false);
    }
    try { fs.closeSync(descriptor); } catch { /* already closed */ }

    let outcome: { kind: 'value'; value: T } | { kind: 'error'; error: unknown };
    try {
      outcome = { kind: 'value', value: operation() };
    } catch (operationError) {
      outcome = { kind: 'error', error: operationError };
    }

    const released = this.releaseLockIfOwned(ownedStat);

    if (outcome.kind === 'error') {
      if (!released) {
        // Track the uncertainty truthfully: a cleanup (lock release) failure
        // never by itself proves a ledger mutation occurred. If the
        // operation's own error already determined no write was attempted
        // (a prewrite rejection/contention), that determination is
        // preserved rather than being unconditionally overridden to true;
        // only an operation error that itself reports an attempted/uncertain
        // write keeps that uncertainty through the failed cleanup.
        const original = outcome.error;
        const originalFlag = original instanceof WorkflowHistoryError ? original.commitMayHaveChanged : true;
        throw this.error(
          'HISTORY_BUSY',
          'The workflow history mutex could not be safely released after a failed operation.',
          originalFlag,
        );
      }
      throw outcome.error;
    }

    if (!released) {
      throw this.error(
        'HISTORY_BUSY',
        'The workflow history mutex was replaced by another owner before release and was left untouched.',
        true,
      );
    }
    return outcome.value;
  }

  private snapshotStat(stats: fs.Stats): { dev: number; ino: number } {
    return { dev: stats.dev, ino: stats.ino };
  }

  private releaseLockIfOwned(ownedStat: { dev: number; ino: number }): boolean {
    let currentStat: fs.Stats;
    try {
      currentStat = fs.lstatSync(this.lockPath);
    } catch {
      return false;
    }
    if (currentStat.dev !== ownedStat.dev || currentStat.ino !== ownedStat.ino) {
      return false;
    }
    try {
      fs.unlinkSync(this.lockPath);
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Ledger load: full parse + validation, shared by every read path and by
  // append() before mutation. Nonregular paths are rejected before any
  // blocking open; the actual read is bounded; descriptors are always
  // closed; readers never chmod or otherwise mutate what they inspect.
  // ---------------------------------------------------------------------

  private loadLedger(): LoadedLedger {
    const preStats = this.statLedgerPathOrThrow();
    if (process.platform !== 'win32' && (preStats.mode & DIRECTORY_MODE_MASK) !== 0) {
      throw this.error('HISTORY_INVALID', 'The ledger file must be owner-only (mode 0600).', false);
    }

    let fd: number;
    try {
      fd = fs.openSync(this.ledgerPath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        throw this.error('HISTORY_MISSING', 'The ledger has not been initialized.', false);
      }
      throw this.error('HISTORY_PATH_INVALID', 'The ledger path could not be opened.', false);
    }

    let raw: Buffer;
    try {
      const openStats = fs.fstatSync(fd);
      if (!openStats.isFile()) {
        throw this.error('HISTORY_PATH_INVALID', 'The ledger path is not a plain regular file.', false);
      }
      raw = this.readBounded(fd);
    } finally {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }

    if (raw.length > HISTORY_LEDGER_MAX_BYTES) {
      throw this.error('HISTORY_TOO_LARGE', `The ledger exceeds the maximum size of ${HISTORY_LEDGER_MAX_BYTES} bytes.`, false);
    }

    const text = decodeStrictUtf8(raw);
    if (text === undefined) {
      throw this.error('HISTORY_INVALID', 'The ledger file does not contain valid UTF-8 text.', false);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw this.error('HISTORY_INVALID', 'The ledger file is not valid JSON.', false);
    }

    return this.validateLedgerEnvelope(parsed);
  }

  private statLedgerPathOrThrow(): fs.Stats {
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(this.ledgerPath);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        throw this.error('HISTORY_MISSING', 'The ledger has not been initialized.', false);
      }
      throw this.error('HISTORY_PATH_INVALID', 'The ledger path could not be inspected.', false);
    }
    if (stats.isSymbolicLink()) {
      throw this.error('HISTORY_PATH_INVALID', 'The ledger path must not be a symlink.', false);
    }
    if (!stats.isFile()) {
      throw this.error('HISTORY_PATH_INVALID', 'The ledger path must be a plain regular file.', false);
    }
    return stats;
  }

  private readBounded(fd: number): Buffer {
    const chunks: Buffer[] = [];
    let total = 0;
    const chunkBuffer = Buffer.alloc(READ_CHUNK_SIZE);
    for (;;) {
      let bytesRead: number;
      try {
        bytesRead = fs.readSync(fd, chunkBuffer, 0, READ_CHUNK_SIZE, null);
      } catch (error) {
        if (isErrnoException(error) && (error.code === 'EAGAIN' || error.code === 'EWOULDBLOCK')) {
          break;
        }
        throw this.error('HISTORY_PATH_INVALID', 'The ledger file could not be read.', false);
      }
      if (bytesRead === 0) {
        break;
      }
      chunks.push(Buffer.from(chunkBuffer.subarray(0, bytesRead)));
      total += bytesRead;
      if (total > HISTORY_LEDGER_MAX_BYTES) {
        break;
      }
    }
    return Buffer.concat(chunks, total);
  }

  // ---------------------------------------------------------------------
  // Ledger envelope + revision validation.
  // ---------------------------------------------------------------------

  private validateLedgerEnvelope(parsed: unknown): LoadedLedger {
    if (!isPlainObject(parsed)) {
      throw this.error('HISTORY_INVALID', 'The ledger file must contain a plain JSON object.', false);
    }
    const knownTop = new Set(['version', 'identity', 'revisions']);
    for (const key of Object.keys(parsed)) {
      if (!knownTop.has(key)) {
        throw this.error('HISTORY_INVALID', 'The ledger file contains an unrecognized top-level field.', false);
      }
    }
    for (const field of ['version', 'identity', 'revisions']) {
      if (!(field in parsed)) {
        throw this.error('HISTORY_INVALID', `The ledger file is missing required field "${field}".`, false);
      }
    }

    const version = parsed.version;
    if (typeof version !== 'number') {
      throw this.error('HISTORY_INVALID', 'The ledger "version" field must be a number.', false);
    }
    if (version !== 1) {
      throw this.error('HISTORY_VERSION_UNSUPPORTED', 'The ledger version is not supported.', false);
    }

    const identity = this.validateStoredIdentity(parsed.identity);

    const revisionsRaw = parsed.revisions;
    if (!Array.isArray(revisionsRaw)) {
      throw this.error('HISTORY_INVALID', 'The ledger "revisions" field must be an array.', false);
    }

    const revisions: HistoryRevision[] = [];
    const seenOperationIds = new Set<string>();
    const seenIds = new Set<string>();
    for (let index = 0; index < revisionsRaw.length; index += 1) {
      const revision = this.validateStoredRevision(revisionsRaw[index], index, revisions[index - 1]);
      if (seenOperationIds.has(revision.operationId)) {
        throw this.error('HISTORY_INVALID', 'The ledger contains a duplicate operationId.', false);
      }
      if (seenIds.has(revision.id)) {
        throw this.error('HISTORY_INVALID', 'The ledger contains a duplicate id.', false);
      }
      seenOperationIds.add(revision.operationId);
      seenIds.add(revision.id);
      revisions.push(revision);
    }

    return { identity, revisions: Object.freeze(revisions) };
  }

  private validateStoredIdentity(value: unknown): HistoryIdentity {
    if (!isPlainObject(value)) {
      throw this.error('HISTORY_INVALID', 'The ledger "identity" field must be a plain object.', false);
    }
    const known = new Set(['projectId', 'taskId', 'incarnation']);
    for (const key of Object.keys(value)) {
      if (!known.has(key)) {
        throw this.error('HISTORY_INVALID', 'The ledger identity contains an unrecognized field.', false);
      }
    }
    const fields: Record<string, string> = {};
    for (const field of ['projectId', 'taskId', 'incarnation']) {
      if (!(field in value) || !isNonBlankBoundedString(value[field], MAX_IDENTITY_FIELD_UNITS)) {
        throw this.error('HISTORY_INVALID', `The ledger identity field "${field}" is missing or malformed.`, false);
      }
      fields[field] = value[field] as string;
    }
    if (fields.projectId !== this.identity.projectId
      || fields.taskId !== this.identity.taskId
      || fields.incarnation !== this.identity.incarnation) {
      throw this.error('HISTORY_IDENTITY_MISMATCH', 'The stored ledger identity does not match the pinned custody identity.', false);
    }
    return Object.freeze({ projectId: fields.projectId, taskId: fields.taskId, incarnation: fields.incarnation });
  }

  private validateStoredRevision(value: unknown, index: number, previous: HistoryRevision | undefined): HistoryRevision {
    if (!isPlainObject(value)) {
      throw this.error('HISTORY_INVALID', 'Each stored revision must be a plain object.', false);
    }
    const knownFields = new Set([
      'id', 'sequence', 'operationId', 'expectedLatest', 'binding', 'kind',
      'digest', 'byteLength', 'contentBase64', 'previousDigest', 'revisionDigest',
    ]);
    for (const key of Object.keys(value)) {
      if (!knownFields.has(key)) {
        throw this.error('HISTORY_INVALID', 'A stored revision contains an unrecognized field.', false);
      }
    }
    for (const field of knownFields) {
      if (!(field in value)) {
        throw this.error('HISTORY_INVALID', `A stored revision is missing required field "${field}".`, false);
      }
    }

    const id = value.id;
    if (!isNonBlankBoundedString(id, Number.MAX_SAFE_INTEGER)) {
      throw this.error('HISTORY_INVALID', 'A stored revision has a malformed id.', false);
    }

    const sequence = value.sequence;
    if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence)) {
      throw this.error('HISTORY_INVALID', 'A stored revision has a malformed sequence.', false);
    }
    if (sequence !== index + 1) {
      throw this.error('HISTORY_INVALID', 'A stored revision has an out-of-order or noncontiguous sequence.', false);
    }

    const operationId = value.operationId;
    if (!isNonBlankBoundedString(operationId, MAX_IDENTITY_FIELD_UNITS)) {
      throw this.error('HISTORY_INVALID', 'A stored revision has a malformed operationId.', false);
    }

    const expectedLatest = value.expectedLatest;
    if (typeof expectedLatest !== 'number' || !Number.isSafeInteger(expectedLatest) || expectedLatest < 0) {
      throw this.error('HISTORY_INVALID', 'A stored revision has a malformed expectedLatest.', false);
    }
    if (expectedLatest !== index) {
      throw this.error('HISTORY_INVALID', 'A stored revision expectedLatest is incoherent with its sequence position.', false);
    }

    let binding: WorkflowBinding;
    try {
      binding = parseWorkflowBinding(value.binding);
    } catch {
      throw this.error('HISTORY_INVALID', 'A stored revision has a malformed binding.', false);
    }
    if (binding.projectId !== this.identity.projectId
      || binding.taskId !== this.identity.taskId
      || binding.incarnation !== this.identity.incarnation) {
      throw this.error('HISTORY_IDENTITY_MISMATCH', 'A stored revision binding does not match the pinned custody identity.', false);
    }

    const kind = value.kind;
    if (typeof kind !== 'string' || !HISTORY_ARTIFACT_KINDS.has(kind)) {
      throw this.error('HISTORY_INVALID', 'A stored revision has an unsupported kind.', false);
    }

    const digest = value.digest;
    if (typeof digest !== 'string' || !HEX_64.test(digest)) {
      throw this.error('HISTORY_INVALID', 'A stored revision has a malformed digest.', false);
    }

    const byteLength = value.byteLength;
    if (typeof byteLength !== 'number' || !Number.isInteger(byteLength) || byteLength < 0 || byteLength > HISTORY_ARTIFACT_MAX_BYTES) {
      throw this.error('HISTORY_INVALID', 'A stored revision has a malformed byteLength.', false);
    }

    const contentBase64 = value.contentBase64;
    if (!isCanonicalBase64(contentBase64)) {
      throw this.error('HISTORY_INVALID', 'A stored revision has malformed contentBase64.', false);
    }
    const decoded = Buffer.from(contentBase64, 'base64');
    if (decoded.length !== byteLength) {
      throw this.error('HISTORY_INVALID', 'A stored revision byteLength does not match its contentBase64.', false);
    }
    if (createHash('sha256').update(decoded).digest('hex') !== digest) {
      throw this.error('HISTORY_INVALID', 'A stored revision digest does not match its contentBase64.', false);
    }

    const previousDigest = value.previousDigest;
    if (previousDigest !== null && (typeof previousDigest !== 'string' || !HEX_64.test(previousDigest))) {
      throw this.error('HISTORY_INVALID', 'A stored revision has a malformed previousDigest.', false);
    }
    const expectedPreviousDigest = previous ? previous.revisionDigest : null;
    if (previousDigest !== expectedPreviousDigest) {
      throw this.error('HISTORY_INVALID', 'A stored revision breaks the previousDigest chain.', false);
    }

    const revisionDigest = value.revisionDigest;
    if (typeof revisionDigest !== 'string' || !HEX_64.test(revisionDigest)) {
      throw this.error('HISTORY_INVALID', 'A stored revision has a malformed revisionDigest.', false);
    }
    const expectedRevisionDigest = protocolDigest({
      id, sequence, operationId, expectedLatest, binding, kind, digest, byteLength, contentBase64, previousDigest,
    });
    if (revisionDigest !== expectedRevisionDigest) {
      throw this.error('HISTORY_INVALID', 'A stored revision digest chain has been altered.', false);
    }

    return Object.freeze({
      id, sequence, operationId, expectedLatest, binding, kind: kind as HistoryArtifactKind,
      digest, byteLength, contentBase64, previousDigest, revisionDigest,
    });
  }
}
