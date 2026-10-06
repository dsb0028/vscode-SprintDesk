/**
 * Task-bound custody adapter over the already-independently tested
 * `NodeWorkflowIdentities` (canonical task context) and `NodeWorkflowHistory`
 * (bounded artifact/revision ledger) libraries, gated by a trusted
 * constructor-injected `WorkflowMutationAuthority`.
 *
 * `NodeTaskWorkflowHistory` is never a human approval, a signed reviewer
 * receipt, a live task-mutation API, or proof of authentic host capture.
 * `WorkflowMutationAuthority` is a trusted constructor-injected HOST adapter,
 * never a model/tool argument or caller-authored approval flag; this module
 * does not implement a real host adapter or sign consent. A missing
 * authority blocks every write with `CUSTODY_AUTHORITY_UNAVAILABLE`, even for
 * an otherwise valid in-progress registered task; read-only operations never
 * require authority at all.
 */

import * as fs from 'fs';
import { isAbsolute, join, normalize } from 'path';
import { createHash } from 'crypto';
import { NodeWorkflowIdentities, WorkflowIdentityError, WorkflowTaskContext } from './NodeWorkflowIdentities';
import {
  HistoryAppend, HistoryArtifactKind, HistoryHead, HistoryIdentity, HistoryPublisher,
  HistoryRevision, NodeWorkflowHistory, WorkflowHistoryError,
} from './NodeWorkflowHistory';
import { WorkflowBinding, parseWorkflowBinding } from './workflowBinding';
import { digest as protocolDigest } from './protocol';
import { ISecureStore } from '../host/ISecureStore';
import { TaskStatus } from '../data/types';

const DATA_DIR_SEGMENTS = ['.SprintDesk', 'data'] as const;
const WORKFLOW_DIR_SEGMENTS = ['.SprintDesk', 'workflow'] as const;
const TASKS_LOCK_FILE_NAME = 'tasks.yml.lock';

const MAX_FIELD_UNITS = 256;
const HEX_64_LOWER = /^[0-9a-f]{64}$/;
const DIRECTORY_MODE = 0o700;
const DIRECTORY_MODE_MASK = 0o077;
const FILE_MODE = 0o600;

const TASK_STATUSES: ReadonlySet<string> = new Set([
  'waiting', 'in-progress', 'under-review', 'needs-modification', 'done', 'blocked', 'cancelled',
]);

const APPEND_ARTIFACT_KINDS: ReadonlySet<string> = new Set([
  'scenario', 'translation', 'review', 'execution',
  'implementation', 'evidence', 'guidance', 'context',
]);

const EXPECTED_CONTEXT_FIELDS = [
  'projectId', 'taskId', 'createdAt', 'incarnation', 'status', 'taskDigest', 'registryDigest',
] as const;

const APPEND_REQUEST_FIELDS = ['operationId', 'expectedLatest', 'binding', 'kind', 'bytes'] as const;

/**
 * The real current task/binding operation this adapter is about to perform,
 * handed to a trusted `WorkflowMutationAuthority` as an immutable, frozen
 * copy. `initialize` carries only its discriminant; `append` additionally
 * carries the exact caller-submitted operation identity/expectation,
 * binding, artifact kind, and the content digest computed from an ALREADY
 * COPIED snapshot of the caller's bytes (never the live caller array).
 */
export type WorkflowCustodyOperation =
  | { readonly kind: 'initialize' }
  | {
    readonly kind: 'append';
    readonly operationId: string;
    readonly expectedLatest: number;
    readonly binding: WorkflowBinding;
    readonly artifactKind: HistoryArtifactKind;
    readonly contentDigest: string;
  };

/** The immutable, frozen request handed to `WorkflowMutationAuthority#assertAllowed`. */
export interface WorkflowMutationRequest {
  readonly workspaceRoot: string;
  readonly context: WorkflowTaskContext;
  readonly operation: WorkflowCustodyOperation;
}

/**
 * A trusted, constructor-injected HOST adapter. See the module doc comment
 * and contract.json "trust_boundary": this interface is never satisfied by a
 * model/tool argument, a caller-authored approval flag, or a signed review
 * receipt from another operation. A future real host adapter must
 * independently establish actual current scope/execution/phase/plan
 * authority and cancellation; no proposed JSON, chat-stored flag, status, or
 * caller confirmation is accepted here as a substitute.
 */
export interface WorkflowMutationAuthority {
  assertAllowed(request: WorkflowMutationRequest): void;
}

export class WorkflowCustodyError extends Error {
  readonly code: string;
  readonly commitMayHaveChanged: boolean;

  constructor(code: string, message: string, commitMayHaveChanged: boolean) {
    super(message);
    this.name = 'WorkflowCustodyError';
    this.code = code;
    this.commitMayHaveChanged = commitMayHaveChanged;
    Object.setPrototypeOf(this, WorkflowCustodyError.prototype);
  }
}

interface ValidatedAppendRequest {
  readonly operationId: string;
  readonly expectedLatest: number;
  readonly binding: WorkflowBinding;
  readonly kind: HistoryArtifactKind;
  readonly bytes: Uint8Array;
  readonly contentDigest: string;
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

function isHex64(value: unknown): value is string {
  return typeof value === 'string' && HEX_64_LOWER.test(value);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

export class NodeTaskWorkflowHistory {
  private readonly workspaceRoot: string;
  private readonly taskId: string;
  private readonly authority: WorkflowMutationAuthority | undefined;
  private readonly writer: Pick<ISecureStore, 'writeSecureText'> | undefined;
  private readonly publisher: HistoryPublisher | undefined;
  private readonly tasksLockPath: string;

  constructor(
    workspaceRoot: string,
    taskId: string,
    authority?: WorkflowMutationAuthority,
    writer?: Pick<ISecureStore, 'writeSecureText'>,
    publisher?: HistoryPublisher,
  ) {
    this.workspaceRoot = this.validateWorkspaceRootArgument(workspaceRoot);
    this.taskId = this.validateTaskIdArgument(taskId);
    this.authority = this.validateAuthorityArgument(authority);
    this.writer = writer;
    this.publisher = publisher;
    this.tasksLockPath = join(this.workspaceRoot, ...DATA_DIR_SEGMENTS, TASKS_LOCK_FILE_NAME);
  }

  // ---------------------------------------------------------------------
  // Constructor validation: explicit absolute canonical workspace and exact
  // nonblank <=256-unit taskId only. No cwd/getHost/global fallback, no
  // project/history initialization, and no filesystem mutation.
  // ---------------------------------------------------------------------

  private contextInvalid(reason: string): never {
    throw new WorkflowCustodyError('CUSTODY_CONTEXT_INVALID', reason, false);
  }

  private validateWorkspaceRootArgument(workspaceRoot: unknown): string {
    if (typeof workspaceRoot !== 'string' || !isAbsolute(workspaceRoot)) {
      this.contextInvalid('NodeTaskWorkflowHistory requires an absolute workspace root path.');
    }
    let normalized: string;
    try {
      normalized = normalize(workspaceRoot);
    } catch {
      this.contextInvalid('The workspace root path could not be normalized.');
    }
    if (normalized !== workspaceRoot) {
      this.contextInvalid('The workspace root must already be a normalized path.');
    }
    // Reuse NodeWorkflowIdentities' existing canonical-root validation
    // (lstat/realpath existence and symlink-at-root/symlinked-ancestor
    // checks only; no task/registry reads or mutation) rather than
    // duplicating a fresh filesystem parser here.
    try {
      new NodeWorkflowIdentities(workspaceRoot);
    } catch (error) {
      if (error instanceof WorkflowIdentityError && error.code === 'IDENTITIES_CONTEXT_INVALID') {
        this.contextInvalid(error.message);
      }
      throw error;
    }
    return workspaceRoot;
  }

  private validateTaskIdArgument(taskId: unknown): string {
    if (!isNonBlankBoundedString(taskId, MAX_FIELD_UNITS)) {
      this.contextInvalid(`taskId must be a nonblank string of at most ${MAX_FIELD_UNITS} UTF-16 code units.`);
    }
    return taskId;
  }

  private validateAuthorityArgument(authority: unknown): WorkflowMutationAuthority | undefined {
    if (authority === undefined) {
      return undefined;
    }
    if (typeof authority !== 'object' || authority === null
      || typeof Reflect.get(authority, 'assertAllowed') !== 'function') {
      this.contextInvalid('The supplied authority adapter does not implement WorkflowMutationAuthority.');
    }
    return authority as WorkflowMutationAuthority;
  }

  // ---------------------------------------------------------------------
  // context(): independent, immutable, verified current context. No caching
  // across calls; accurate underlying identity errors are preserved as-is.
  // ---------------------------------------------------------------------

  context(): WorkflowTaskContext {
    return this.resolveCurrentContext();
  }

  private resolveCurrentContext(): WorkflowTaskContext {
    return new NodeWorkflowIdentities(this.workspaceRoot).resolveTask(this.taskId);
  }

  // ---------------------------------------------------------------------
  // initialize() / append(): request validation (no lock/authority needed),
  // then the shared guarded task-lock-held mutation flow.
  // ---------------------------------------------------------------------

  initialize(expected: WorkflowTaskContext): HistoryHead {
    const validatedExpected = this.parseExpectedContext(expected);
    return this.runGuardedMutation(
      validatedExpected,
      false,
      () => { /* no additional guard for initialize */ },
      () => ({ kind: 'initialize' as const }),
      current => {
        const directory = this.custodyDirectory(current);
        this.ensureCustodyDirectoriesForInitialize(directory);
        const history = new NodeWorkflowHistory(directory, this.identityTuple(current), this.writer, this.publisher);
        return history.initialize();
      },
    );
  }

  append(expected: WorkflowTaskContext, request: HistoryAppend): HistoryRevision {
    const validatedExpected = this.parseExpectedContext(expected);
    const validatedAppend = this.parseAppendRequest(request);
    return this.runGuardedMutation(
      validatedExpected,
      true,
      current => {
        if (validatedAppend.binding.projectId !== current.projectId
          || validatedAppend.binding.taskId !== current.taskId
          || validatedAppend.binding.incarnation !== current.incarnation) {
          throw new WorkflowCustodyError(
            'CUSTODY_BINDING_MISMATCH',
            'The submitted binding does not match the current task context identity.',
            false,
          );
        }
      },
      () => ({
        kind: 'append' as const,
        operationId: validatedAppend.operationId,
        expectedLatest: validatedAppend.expectedLatest,
        binding: validatedAppend.binding,
        artifactKind: validatedAppend.kind,
        contentDigest: validatedAppend.contentDigest,
      }),
      current => {
        const directory = this.custodyDirectory(current);
        const history = this.openExistingHistory(directory, this.identityTuple(current));
        return history.append({
          operationId: validatedAppend.operationId,
          expectedLatest: validatedAppend.expectedLatest,
          binding: validatedAppend.binding,
          kind: validatedAppend.kind,
          bytes: validatedAppend.bytes,
        });
      },
    );
  }

  // ---------------------------------------------------------------------
  // Read-only operations: never require authority, never acquire the task
  // mutex, and never create/chmod/delete any directory. Known registered
  // statuses (including under-review/done) permit reads; replacement/
  // source/identity mismatch still blocks via the propagated identity error.
  // ---------------------------------------------------------------------

  head(): HistoryHead {
    return this.withReader(reader => reader.head());
  }

  read(sequence: number): HistoryRevision {
    return this.withReader(reader => reader.read(sequence));
  }

  readBytes(sequence: number): Uint8Array {
    return this.withReader(reader => reader.readBytes(sequence));
  }

  list(afterSequence: number, limit: number): readonly HistoryRevision[] {
    return this.withReader(reader => reader.list(afterSequence, limit));
  }

  private withReader<T>(operation: (reader: NodeWorkflowHistory) => T): T {
    const current = this.resolveCurrentContext();
    const directory = this.custodyDirectory(current);
    const history = this.openExistingHistory(directory, this.identityTuple(current));
    return operation(history);
  }

  // ---------------------------------------------------------------------
  // Shared guarded mutation flow: pre-lock accurate source existence check,
  // then exclusive task-lock-held context/status/[extra] guard, authority
  // consultation with an immutable copy, a post-authority pre-mutation
  // re-check, the actual delegated ledger operation, and a post-mutation
  // re-check whose drift is reported as a conservative uncertain outcome.
  // ---------------------------------------------------------------------

  private runGuardedMutation<T>(
    validatedExpected: WorkflowTaskContext,
    statusCheckBeforeContextMatch: boolean,
    extraGuard: (current: WorkflowTaskContext) => void,
    buildOperation: (current: WorkflowTaskContext) => WorkflowCustodyOperation,
    perform: (current: WorkflowTaskContext) => T,
  ): T {
    // Before ever attempting the mutation lock: resolve source to reject a
    // missing/unregistered/replaced context accurately, rather than ever
    // reporting a confusing lock-open failure for a reason unrelated to
    // actual contention (e.g. a wholly absent .SprintDesk/data directory).
    this.resolveCurrentContext();

    return this.withExclusiveTaskLock(() => {
      const current = this.resolveCurrentContext();
      // initialize() reports a status-driven task drift as the generic
      // CUSTODY_CONTEXT_CHANGED(false) (the full seven-field comparison,
      // including the status-sensitive taskDigest, is checked first).
      // append() must still apply the "in-progress" guard to an
      // old-operation replay rather than ever short-circuiting straight to
      // the cached ledger result once the task has left in-progress, so for
      // append() the status check runs first.
      if (statusCheckBeforeContextMatch) {
        this.assertInProgress(current);
        this.assertContextsMatch(validatedExpected, current, false);
      } else {
        this.assertContextsMatch(validatedExpected, current, false);
        this.assertInProgress(current);
      }
      extraGuard(current);

      const operation = buildOperation(current);
      const mutationRequest = this.buildFrozenRequest(current, operation);
      this.invokeAuthority(mutationRequest);

      // After authority returns, re-resolve the actual context again before
      // any mutation. A known callback invocation is not proof of human
      // consent; an adapter that caused actual task/source/registry drift
      // during its own callback cannot authorize a now-stale operation.
      const reResolved = this.resolveCurrentContext();
      this.assertContextsMatch(validatedExpected, reResolved, false);

      const result = perform(reResolved);

      // After any attempted mutation, while the task lock remains held,
      // re-resolve and compare the full context again (including
      // taskDigest/registryDigest). From here on, any drift or source
      // failure is a genuinely uncertain outcome: a real custody write or
      // setup mutation may already have been attempted/committed.
      let postContext: WorkflowTaskContext;
      try {
        postContext = this.resolveCurrentContext();
      } catch {
        throw new WorkflowCustodyError(
          'CUSTODY_CONTEXT_CHANGED',
          'The canonical task context could not be independently re-verified after the custody operation.',
          true,
        );
      }
      if (!this.contextsEqual(validatedExpected, postContext)) {
        throw new WorkflowCustodyError(
          'CUSTODY_CONTEXT_CHANGED',
          'The canonical task context changed during the custody operation.',
          true,
        );
      }

      return result;
    });
  }

  private invokeAuthority(request: WorkflowMutationRequest): void {
    if (!this.authority) {
      throw new WorkflowCustodyError(
        'CUSTODY_AUTHORITY_UNAVAILABLE',
        'No workflow mutation authority is configured; this operation cannot be authorized.',
        false,
      );
    }
    try {
      this.authority.assertAllowed(request);
    } catch {
      // The provider's own thrown detail is never echoed -- see
      // contract.json "trust_boundary" and the "no secret leak" rule.
      throw new WorkflowCustodyError(
        'CUSTODY_AUTHORITY_REJECTED',
        'The workflow mutation authority rejected this operation.',
        false,
      );
    }
  }

  private buildFrozenRequest(current: WorkflowTaskContext, operation: WorkflowCustodyOperation): WorkflowMutationRequest {
    return Object.freeze({
      workspaceRoot: this.workspaceRoot,
      context: current,
      operation: Object.freeze({ ...operation }),
    });
  }

  private assertContextsMatch(expected: WorkflowTaskContext, current: WorkflowTaskContext, commitMayHaveChanged: boolean): void {
    if (!this.contextsEqual(expected, current)) {
      throw new WorkflowCustodyError(
        'CUSTODY_CONTEXT_CHANGED',
        'The canonical task context changed before the custody operation could proceed.',
        commitMayHaveChanged,
      );
    }
  }

  private assertInProgress(current: WorkflowTaskContext): void {
    if (current.status !== 'in-progress') {
      throw new WorkflowCustodyError(
        'CUSTODY_TASK_STATE_INVALID',
        'The canonical task is not in status "in-progress".',
        false,
      );
    }
  }

  private contextsEqual(a: WorkflowTaskContext, b: WorkflowTaskContext): boolean {
    return a.projectId === b.projectId && a.taskId === b.taskId && a.createdAt === b.createdAt
      && a.incarnation === b.incarnation && a.status === b.status
      && a.taskDigest === b.taskDigest && a.registryDigest === b.registryDigest;
  }

  // ---------------------------------------------------------------------
  // Canonical fixed-location derivation: the identity tuple is copied from
  // the actual registry-resolved context, never from a storage-root
  // request, folder title, or supplied binding.
  // ---------------------------------------------------------------------

  private custodyDirectory(context: WorkflowTaskContext): string {
    const tupleDigest = protocolDigest({
      projectId: context.projectId, taskId: context.taskId, incarnation: context.incarnation,
    });
    return join(this.workspaceRoot, ...WORKFLOW_DIR_SEGMENTS, 'history', tupleDigest);
  }

  private identityTuple(context: WorkflowTaskContext): HistoryIdentity {
    return { projectId: context.projectId, taskId: context.taskId, incarnation: context.incarnation };
  }

  // ---------------------------------------------------------------------
  // initialize()-only directory allocation: owner-only, no-overwrite,
  // symlink/non-directory/permissive-namespace rejection at every boundary.
  // A pre-existing strict owner-only directory is reused, never rejected; a
  // pre-existing invalid node is never chmod-recovered or followed.
  // ---------------------------------------------------------------------

  private ensureCustodyDirectoriesForInitialize(directory: string): void {
    const workflowDir = join(this.workspaceRoot, ...WORKFLOW_DIR_SEGMENTS);
    const historyDir = join(workflowDir, 'history');
    this.ensureOwnerOnlyDirectory(workflowDir);
    this.ensureOwnerOnlyDirectory(historyDir);
    this.ensureOwnerOnlyDirectory(directory);
  }

  private ensureOwnerOnlyDirectory(directoryPath: string): void {
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(directoryPath);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        this.createOwnerOnlyDirectory(directoryPath);
        return;
      }
      throw new WorkflowCustodyError('CUSTODY_PATH_INVALID', 'The custody path could not be inspected.', false);
    }
    if (stats.isSymbolicLink()) {
      throw new WorkflowCustodyError('CUSTODY_PATH_INVALID', 'The custody path must not be a symlink.', false);
    }
    if (!stats.isDirectory()) {
      throw new WorkflowCustodyError('CUSTODY_PATH_INVALID', 'The custody path must be a directory.', false);
    }
    if (process.platform !== 'win32' && (stats.mode & DIRECTORY_MODE_MASK) !== 0) {
      throw new WorkflowCustodyError(
        'CUSTODY_PATH_INVALID',
        'An existing custody directory must already be owner-only (mode 0700).',
        false,
      );
    }
  }

  private createOwnerOnlyDirectory(directoryPath: string): void {
    try {
      fs.mkdirSync(directoryPath, { mode: DIRECTORY_MODE });
    } catch {
      throw new WorkflowCustodyError('CUSTODY_SETUP_FAILED', 'The custody directory could not be created.', true);
    }
    try {
      if (process.platform !== 'win32') {
        const created = fs.lstatSync(directoryPath);
        if ((created.mode & DIRECTORY_MODE_MASK) !== 0) {
          fs.chmodSync(directoryPath, DIRECTORY_MODE);
        }
      }
    } catch {
      throw new WorkflowCustodyError('CUSTODY_SETUP_FAILED', 'The custody directory mode could not be verified.', true);
    }
  }

  /** append()/read paths: missing history is HISTORY_MISSING, never implicit initialization. */
  private openExistingHistory(directory: string, identity: HistoryIdentity): NodeWorkflowHistory {
    try {
      fs.lstatSync(directory);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        throw new WorkflowHistoryError('HISTORY_MISSING', 'The ledger has not been initialized.', false);
      }
    }
    return new NodeWorkflowHistory(directory, identity, this.writer, this.publisher);
  }

  // ---------------------------------------------------------------------
  // Task mutex: the exact .SprintDesk/data/tasks.yml.lock used by existing
  // task writers. No age-based reclamation; contention fails explicitly;
  // the held inode is verified before unlink so a replaced owner's lock is
  // never silently deleted.
  // ---------------------------------------------------------------------

  private withExclusiveTaskLock<T>(operation: () => T): T {
    let descriptor: number;
    try {
      descriptor = fs.openSync(this.tasksLockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, FILE_MODE);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'EEXIST') {
        throw new WorkflowCustodyError('CUSTODY_BUSY', 'The task mutation lock is currently held.', false);
      }
      throw new WorkflowCustodyError('CUSTODY_BUSY', 'The task mutation lock could not be acquired.', false);
    }

    let ownedStat: { dev: number; ino: number };
    try {
      fs.writeSync(descriptor, `${process.pid}\n`);
      const stats = fs.fstatSync(descriptor);
      ownedStat = { dev: stats.dev, ino: stats.ino };
    } catch {
      try { fs.closeSync(descriptor); } catch { /* already closed */ }
      try { fs.unlinkSync(this.tasksLockPath); } catch { /* best-effort cleanup */ }
      throw new WorkflowCustodyError('CUSTODY_BUSY', 'The task mutation lock could not be initialized.', false);
    }
    try { fs.closeSync(descriptor); } catch { /* already closed */ }

    let outcome: { kind: 'value'; value: T } | { kind: 'error'; error: unknown };
    try {
      outcome = { kind: 'value', value: operation() };
    } catch (operationError) {
      outcome = { kind: 'error', error: operationError };
    }

    const released = this.releaseTaskLockIfOwned(ownedStat);

    if (outcome.kind === 'error') {
      if (!released) {
        const original = outcome.error;
        const originalFlag = original instanceof WorkflowCustodyError ? original.commitMayHaveChanged : true;
        throw new WorkflowCustodyError(
          'CUSTODY_BUSY',
          'The task mutation lock could not be safely released after a failed operation.',
          originalFlag,
        );
      }
      throw outcome.error;
    }

    if (!released) {
      throw new WorkflowCustodyError(
        'CUSTODY_BUSY',
        'The task mutation lock was replaced by another owner before release and was left untouched.',
        true,
      );
    }
    return outcome.value;
  }

  private releaseTaskLockIfOwned(ownedStat: { dev: number; ino: number }): boolean {
    let currentStat: fs.Stats;
    try {
      currentStat = fs.lstatSync(this.tasksLockPath);
    } catch {
      return false;
    }
    if (currentStat.dev !== ownedStat.dev || currentStat.ino !== ownedStat.ino) {
      return false;
    }
    try {
      fs.unlinkSync(this.tasksLockPath);
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Expected seven-field WorkflowTaskContext validation: plain shape,
  // required/unknown own fields, string/status/64hex digests; no coercion,
  // trimming, or extra approved/confirmed flags. Always builds an
  // independent clone; never freezes or mutates the caller's object.
  // ---------------------------------------------------------------------

  private parseExpectedContext(value: unknown): WorkflowTaskContext {
    if (!isPlainObject(value)) {
      this.contextInvalid('The expected context must be a plain object.');
    }
    const known = new Set<string>(EXPECTED_CONTEXT_FIELDS);
    for (const key of Object.keys(value)) {
      if (!known.has(key)) {
        this.contextInvalid('The expected context contains an unrecognized field.');
      }
    }
    for (const field of EXPECTED_CONTEXT_FIELDS) {
      if (!(field in value)) {
        this.contextInvalid(`The expected context is missing required field "${field}".`);
      }
    }

    const projectId = value.projectId;
    const taskId = value.taskId;
    const createdAt = value.createdAt;
    const incarnation = value.incarnation;
    const status = value.status;
    const taskDigest = value.taskDigest;
    const registryDigest = value.registryDigest;

    if (!isNonBlankBoundedString(projectId, MAX_FIELD_UNITS)) {
      this.contextInvalid('The expected context field "projectId" must be a nonblank bounded string.');
    }
    if (!isNonBlankBoundedString(taskId, MAX_FIELD_UNITS)) {
      this.contextInvalid('The expected context field "taskId" must be a nonblank bounded string.');
    }
    if (!isNonBlankBoundedString(createdAt, MAX_FIELD_UNITS)) {
      this.contextInvalid('The expected context field "createdAt" must be a nonblank bounded string.');
    }
    if (!isNonBlankBoundedString(incarnation, MAX_FIELD_UNITS)) {
      this.contextInvalid('The expected context field "incarnation" must be a nonblank bounded string.');
    }
    if (typeof status !== 'string' || !TASK_STATUSES.has(status)) {
      this.contextInvalid('The expected context field "status" must be a known task status.');
    }
    if (!isHex64(taskDigest)) {
      this.contextInvalid('The expected context field "taskDigest" must be exactly 64 lowercase hexadecimal characters.');
    }
    if (!isHex64(registryDigest)) {
      this.contextInvalid('The expected context field "registryDigest" must be exactly 64 lowercase hexadecimal characters.');
    }

    return {
      projectId, taskId, createdAt, incarnation,
      status: status as TaskStatus, taskDigest, registryDigest,
    };
  }

  // ---------------------------------------------------------------------
  // Exact five-field HistoryAppend validation: safe integers, supported
  // kind, copied Uint8Array (BEFORE authority/mutation, so a later or
  // in-callback mutation of the caller's original bytes can never affect
  // the computed digest or persisted content), and the existing binding
  // parser (propagated as-is, never reimplemented). No coercion, no extra
  // approved/confirmed flags.
  // ---------------------------------------------------------------------

  private parseAppendRequest(value: unknown): ValidatedAppendRequest {
    if (!isPlainObject(value)) {
      throw new WorkflowCustodyError('CUSTODY_REQUEST_INVALID', 'The append request must be a plain object.', false);
    }
    const known = new Set<string>(APPEND_REQUEST_FIELDS);
    for (const key of Object.keys(value)) {
      if (!known.has(key)) {
        throw new WorkflowCustodyError('CUSTODY_REQUEST_INVALID', 'The append request contains an unrecognized field.', false);
      }
    }
    for (const field of APPEND_REQUEST_FIELDS) {
      if (!(field in value)) {
        throw new WorkflowCustodyError(
          'CUSTODY_REQUEST_INVALID', `The append request is missing required field "${field}".`, false,
        );
      }
    }

    const operationId = value.operationId;
    if (!isNonBlankBoundedString(operationId, MAX_FIELD_UNITS)) {
      throw new WorkflowCustodyError(
        'CUSTODY_REQUEST_INVALID',
        `operationId must be a nonblank string of at most ${MAX_FIELD_UNITS} UTF-16 code units.`,
        false,
      );
    }
    const expectedLatestValue = value.expectedLatest;
    if (typeof expectedLatestValue !== 'number' || !Number.isSafeInteger(expectedLatestValue) || expectedLatestValue < 0) {
      throw new WorkflowCustodyError('CUSTODY_REQUEST_INVALID', 'expectedLatest must be a nonnegative safe integer.', false);
    }
    const expectedLatest = expectedLatestValue;
    const kind = value.kind;
    if (typeof kind !== 'string' || !APPEND_ARTIFACT_KINDS.has(kind)) {
      throw new WorkflowCustodyError('CUSTODY_REQUEST_INVALID', 'kind must be a supported HistoryArtifactKind.', false);
    }
    const suppliedBytes = value.bytes;
    if (!(suppliedBytes instanceof Uint8Array)) {
      throw new WorkflowCustodyError('CUSTODY_REQUEST_INVALID', 'bytes must be a Uint8Array.', false);
    }
    // Defensive copy taken immediately, before binding parsing, authority,
    // or any lock/mutation -- the digest below is computed from this
    // independent snapshot, never from the caller's live array.
    const bytes = Uint8Array.from(suppliedBytes);
    const binding = parseWorkflowBinding(value.binding);
    const contentDigest = sha256Hex(bytes);

    return { operationId, expectedLatest, binding, kind: kind as HistoryArtifactKind, bytes, contentDigest };
  }
}
