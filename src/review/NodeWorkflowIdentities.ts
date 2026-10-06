/**
 * Dedicated workflow identity registry and exact canonical task-context read.
 *
 * `NodeWorkflowIdentities` proves field-for-field, byte-for-byte consistency between a caller's
 * exact canonical `tasks.yml` task entry and a narrow, explicitly initialized registry
 * (`workflow-identities.json`) that pins a stable per-project identifier and a stable
 * per-task incarnation identifier the first time a task is observed `in-progress`. It is not a
 * human approval, a signed reviewer receipt, a task mutation API, or a creation-event journal; it
 * never rewrites `tasks.yml` or any approval/Markdown/enrollment/workforce state, and it never
 * initializes anything implicitly.
 */

import * as fs from 'fs';
import { isAbsolute, join, normalize } from 'path';
import { createHash, randomUUID } from 'crypto';
import yaml from 'js-yaml';
import { ISecureStore } from '../host/ISecureStore';
import { NodeSecureStore } from '../host/NodeSecureStore';
import { HistoryPublisher } from './NodeWorkflowHistory';
import { digest as protocolDigest } from './protocol';
import { TaskStatus } from '../data/types';

export const WORKFLOW_IDENTITIES_MAX_BYTES = 1048576;
export const WORKFLOW_TASKS_MAX_BYTES = 8388608;

const DATA_DIR_SEGMENTS = ['.SprintDesk', 'data'] as const;
const REGISTRY_FILE_NAME = 'workflow-identities.json';
const REGISTRY_LOCK_FILE_NAME = 'workflow-identities.json.lock';
const TASKS_FILE_NAME = 'tasks.yml';
const TASKS_LOCK_FILE_NAME = 'tasks.yml.lock';

const MAX_FIELD_UNITS = 256;
const HEX_64_LOWER = /^[0-9a-f]{64}$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const READ_CHUNK_SIZE = 65536;
const DIRECTORY_MODE_MASK = 0o077;
const FILE_MODE = 0o600;

const TASK_STATUSES: ReadonlySet<string> = new Set([
  'waiting', 'in-progress', 'under-review', 'needs-modification', 'done', 'blocked', 'cancelled',
]);

export interface WorkflowTaskIdentity {
  readonly taskId: string;
  readonly createdAt: string;
  readonly incarnation: string;
}

export interface WorkflowIdentitySnapshot {
  readonly version: 1;
  readonly projectId: string;
  readonly tasks: readonly WorkflowTaskIdentity[];
  readonly digest: string;
}

export interface WorkflowTaskContext {
  readonly projectId: string;
  readonly taskId: string;
  readonly createdAt: string;
  readonly incarnation: string;
  readonly status: TaskStatus;
  readonly taskDigest: string;
  readonly registryDigest: string;
}

export class WorkflowIdentityError extends Error {
  readonly code: string;
  readonly commitMayHaveChanged: boolean;

  constructor(code: string, message: string, commitMayHaveChanged: boolean) {
    super(message);
    this.name = 'WorkflowIdentityError';
    this.code = code;
    this.commitMayHaveChanged = commitMayHaveChanged;
    Object.setPrototypeOf(this, WorkflowIdentityError.prototype);
  }
}

class DefaultIdentitiesPublisher implements HistoryPublisher {
  publish(stagedPath: string, finalPath: string): void {
    let published = false;
    try {
      fs.linkSync(stagedPath, finalPath);
      published = true;
    } finally {
      if (published) {
        // Genuinely published: a cleanup failure here must never be silently
        // swallowed. It propagates out of publish() and is surfaced by
        // initialize() as IDENTITIES_WRITE_FAILED with commitMayHaveChanged=true.
        // Neither the published registry nor a lingering staged path is ever
        // rolled back or deleted here.
        fs.unlinkSync(stagedPath);
      } else {
        try { fs.unlinkSync(stagedPath); } catch { /* best-effort cleanup of the staged copy */ }
      }
    }
  }
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

function isValidIsoLike(value: string): boolean {
  return Number.isFinite(Date.parse(value));
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

interface LoadedRegistry {
  readonly projectId: string;
  readonly tasks: readonly WorkflowTaskIdentity[];
  readonly raw: Buffer;
}

interface RawTaskRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly status: TaskStatus;
  readonly plain: Record<string, unknown>;
}

export class NodeWorkflowIdentities {
  private readonly workspaceRoot: string;
  private readonly writer: Pick<ISecureStore, 'writeSecureText'>;
  private readonly publisher: HistoryPublisher;
  private readonly registryPath: string;
  private readonly registryLockPath: string;
  private readonly tasksPath: string;
  private readonly tasksLockPath: string;

  constructor(
    workspaceRoot: string,
    writer: Pick<ISecureStore, 'writeSecureText'> = new NodeSecureStore(),
    publisher: HistoryPublisher = new DefaultIdentitiesPublisher(),
  ) {
    this.workspaceRoot = this.validateWorkspaceRoot(workspaceRoot);
    this.writer = writer;
    this.publisher = publisher;
    const dataDir = join(this.workspaceRoot, ...DATA_DIR_SEGMENTS);
    this.registryPath = join(dataDir, REGISTRY_FILE_NAME);
    this.registryLockPath = join(dataDir, REGISTRY_LOCK_FILE_NAME);
    this.tasksPath = join(dataDir, TASKS_FILE_NAME);
    this.tasksLockPath = join(dataDir, TASKS_LOCK_FILE_NAME);
  }

  // ---------------------------------------------------------------------
  // Constructor validation: workspaceRoot only. No mkdir/chmod, no task/
  // policy reads, no registry writes, no getHost/cwd fallback.
  // ---------------------------------------------------------------------

  private contextInvalid(reason: string): never {
    throw new WorkflowIdentityError('IDENTITIES_CONTEXT_INVALID', reason, false);
  }

  private validateWorkspaceRoot(workspaceRoot: unknown): string {
    if (typeof workspaceRoot !== 'string' || !isAbsolute(workspaceRoot)) {
      this.contextInvalid('NodeWorkflowIdentities requires an absolute workspace root path.');
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
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(workspaceRoot);
    } catch {
      this.contextInvalid('The workspace root could not be inspected.');
    }
    if (stats.isSymbolicLink()) {
      this.contextInvalid('The workspace root must not be a symlink.');
    }
    if (!stats.isDirectory()) {
      this.contextInvalid('The workspace root must be a directory.');
    }
    let real: string;
    try {
      real = fs.realpathSync(workspaceRoot);
    } catch {
      this.contextInvalid('The workspace root could not be resolved.');
    }
    if (real !== workspaceRoot) {
      this.contextInvalid('The workspace root must not traverse any symlinked ancestor.');
    }
    return workspaceRoot;
  }

  // ---------------------------------------------------------------------
  // Shared error helpers.
  // ---------------------------------------------------------------------

  private error(code: string, message: string, commitMayHaveChanged: boolean): WorkflowIdentityError {
    return new WorkflowIdentityError(code, message, commitMayHaveChanged);
  }

  private requestInvalid(reason: string): never {
    throw this.error('IDENTITIES_REQUEST_INVALID', reason, false);
  }

  private validateTaskIdArgument(taskId: unknown): string {
    if (!isNonBlankBoundedString(taskId, MAX_FIELD_UNITS)) {
      this.requestInvalid(`taskId must be a nonblank string of at most ${MAX_FIELD_UNITS} UTF-16 code units.`);
    }
    return taskId;
  }

  private validateExpectedDigestArgument(expectedRegistryDigest: unknown): string {
    if (typeof expectedRegistryDigest !== 'string' || !HEX_64_LOWER.test(expectedRegistryDigest)) {
      this.requestInvalid('expectedRegistryDigest must be a 64-character lowercase hexadecimal string.');
    }
    return expectedRegistryDigest;
  }

  private newStagingPath(tag: string): string {
    return `${this.registryPath}.${tag}-${process.pid}-${randomUUID()}.staged`;
  }

  // ---------------------------------------------------------------------
  // initialize(): explicit trusted-caller setup; requires a real task store;
  // no-overwrite, atomic, owner-only.
  // ---------------------------------------------------------------------

  initialize(): WorkflowIdentitySnapshot {
    // Validate the canonical task store before ever attempting to open the
    // registry lock. When .SprintDesk/data itself does not exist, the lock
    // file's parent directory is also missing, and openSync() would fail
    // with a raw ENOENT that is indistinguishable from lock contention.
    // Checking here first produces the correct TASK_STORE_MISSING/
    // TASK_STORE_INVALID semantic error instead of a misleading
    // IDENTITIES_BUSY. This is a precondition check only, never a
    // substitute for authority: performInitialize() still independently
    // reloads and revalidates the task store again under the held lock
    // before anything is published.
    this.loadTaskStore();
    return this.withExclusiveLock(this.registryLockPath, () => this.performInitialize());
  }

  private performInitialize(): WorkflowIdentitySnapshot {
    if (this.registryPathExists()) {
      throw this.error('IDENTITIES_ALREADY_EXISTS', 'A workflow identity registry already exists at this workspace.', false);
    }

    // Requires a real, well-formed task store before anything is published.
    // Never creates missing project directories or copies canonical state.
    this.loadTaskStore();

    const projectId = randomUUID();
    const content = JSON.stringify({ version: 1, projectId, tasks: [] });
    const stagingPath = this.newStagingPath('init');

    try {
      this.writer.writeSecureText(stagingPath, content);
    } catch {
      throw this.error('IDENTITIES_WRITE_FAILED', 'The workflow identity registry could not be staged.', false);
    }

    try {
      this.publisher.publish(stagingPath, this.registryPath);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'EEXIST') {
        throw this.error('IDENTITIES_ALREADY_EXISTS', 'A workflow identity registry already exists at this workspace.', false);
      }
      throw this.error('IDENTITIES_WRITE_FAILED', 'The workflow identity registry publication failed after staging.', true);
    }

    let loaded: LoadedRegistry;
    try {
      loaded = this.loadRegistry();
    } catch {
      throw this.error(
        'IDENTITIES_READBACK_FAILED',
        'initialize() published but the registry could not be independently verified afterward.',
        true,
      );
    }
    if (loaded.projectId !== projectId || loaded.tasks.length !== 0) {
      throw this.error(
        'IDENTITIES_READBACK_FAILED',
        'initialize() published but the independently re-read registry does not match the expected empty content.',
        true,
      );
    }

    return this.toSnapshot(loaded);
  }

  private registryPathExists(): boolean {
    try {
      fs.lstatSync(this.registryPath);
      return true;
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        return false;
      }
      return true;
    }
  }

  // ---------------------------------------------------------------------
  // read(): never initializes or chmods; bounded bytes; rejects symlink/
  // FIFO/nonregular/permissive-mode/corrupt content.
  // ---------------------------------------------------------------------

  read(): WorkflowIdentitySnapshot {
    return this.toSnapshot(this.loadRegistry());
  }

  private toSnapshot(loaded: LoadedRegistry): WorkflowIdentitySnapshot {
    const tasks = loaded.tasks.map(task => Object.freeze({ ...task }));
    return Object.freeze({
      version: 1,
      projectId: loaded.projectId,
      tasks: Object.freeze(tasks),
      digest: createHash('sha256').update(loaded.raw).digest('hex'),
    });
  }

  // ---------------------------------------------------------------------
  // registerTask(): request validation (no lock), then both locks, then
  // mutation gated on a current in-progress canonical task.
  // ---------------------------------------------------------------------

  registerTask(taskId: string, expectedRegistryDigest: string): WorkflowTaskContext {
    const validTaskId = this.validateTaskIdArgument(taskId);
    const validDigest = this.validateExpectedDigestArgument(expectedRegistryDigest);
    // Validate the registry is initialized before ever attempting to open
    // either lock. When .SprintDesk/data itself does not exist, the task
    // lock file's own parent directory is also absent, and openSync() would
    // fail with a raw ENOENT that is indistinguishable from lock contention.
    // Checking here first produces the correct IDENTITIES_MISSING semantic
    // error instead of a misleading IDENTITIES_BUSY. This is a precondition
    // check only, never a substitute for authority: performRegisterTask()
    // still independently reloads and revalidates the registry again under
    // both held locks before any write.
    this.loadRegistry();
    return this.withExclusiveLock(this.tasksLockPath, () =>
      this.withExclusiveLock(this.registryLockPath, () => this.performRegisterTask(validTaskId, validDigest)));
  }

  private performRegisterTask(taskId: string, expectedRegistryDigest: string): WorkflowTaskContext {
    const before = this.loadRegistry();
    const currentDigest = createHash('sha256').update(before.raw).digest('hex');
    if (currentDigest !== expectedRegistryDigest) {
      throw this.error('IDENTITIES_CONFLICT', 'expectedRegistryDigest does not match the current registry.', false);
    }

    const task = this.selectTask(this.loadTaskStore(), taskId);
    if (task.status !== 'in-progress') {
      throw this.error('TASK_STATE_INVALID', 'The canonical task is not in status "in-progress".', false);
    }

    const existing = before.tasks.find(entry => entry.taskId === taskId);
    if (existing) {
      if (existing.createdAt === task.createdAt) {
        return Object.freeze({
          projectId: before.projectId,
          taskId,
          createdAt: task.createdAt,
          incarnation: existing.incarnation,
          status: task.status,
          taskDigest: protocolDigest(task.plain),
          registryDigest: currentDigest,
        });
      }
      throw this.error('TASK_REPLACED', 'The canonical task createdAt no longer matches the registered value.', false);
    }

    const incarnation = randomUUID();
    const newEntry: WorkflowTaskIdentity = { taskId, createdAt: task.createdAt, incarnation };
    const nextTasks = [...before.tasks, newEntry];
    const candidateContent = JSON.stringify({ version: 1, projectId: before.projectId, tasks: nextTasks });
    const candidateBytes = Buffer.from(candidateContent, 'utf8');
    if (candidateBytes.byteLength > WORKFLOW_IDENTITIES_MAX_BYTES) {
      throw this.error('IDENTITIES_TOO_LARGE', `The registry would exceed the maximum size of ${WORKFLOW_IDENTITIES_MAX_BYTES} bytes.`, false);
    }

    let threw = false;
    try {
      this.writer.writeSecureText(this.registryPath, candidateContent);
    } catch {
      threw = true;
    }

    const afterBytes = this.readRawBytesBestEffort();

    if (afterBytes !== undefined && afterBytes.equals(candidateBytes)) {
      if (threw) {
        throw this.error('IDENTITIES_WRITE_FAILED', 'The registry write reported failure after it had already committed.', true);
      }
      // Genuine commit: independently reload and validate the persisted registry.
      const verified = this.loadRegistry();
      if (
        verified.projectId !== before.projectId
        || verified.tasks.length !== nextTasks.length
        || !verified.tasks.some(entry => entry.taskId === taskId && entry.incarnation === incarnation)
      ) {
        throw this.error(
          'IDENTITIES_READBACK_FAILED',
          'registerTask() wrote the registry but the independently re-read content does not match the expected registration.',
          true,
        );
      }

      // Re-read the canonical task under the still-held task lock to detect drift
      // introduced during publication. No global atomicity claim with
      // external/noncooperating writers; any detected drift is TASK_CHANGED.
      const recheck = this.selectTask(this.loadTaskStore(), taskId);
      if (recheck.createdAt !== task.createdAt || recheck.status !== task.status) {
        throw this.error('TASK_CHANGED', 'The canonical task changed during registry publication.', true);
      }

      return Object.freeze({
        projectId: before.projectId,
        taskId,
        createdAt: task.createdAt,
        incarnation,
        status: task.status,
        taskDigest: protocolDigest(task.plain),
        registryDigest: createHash('sha256').update(candidateBytes).digest('hex'),
      });
    }

    if (afterBytes !== undefined && afterBytes.equals(before.raw)) {
      if (threw) {
        throw this.error('IDENTITIES_WRITE_FAILED', 'The registry could not be written.', false);
      }
      throw this.error(
        'IDENTITIES_READBACK_FAILED',
        'The registry writer reported success but the persisted bytes remain unchanged.',
        true,
      );
    }

    // Neither the prior state nor the intended new state: the real on-disk
    // bytes are now in an unknown/corrupted condition.
    throw this.error(
      'IDENTITIES_READBACK_FAILED',
      'The registry could not be independently verified after a write attempt.',
      true,
    );
  }

  private readRawBytesBestEffort(): Buffer | undefined {
    try {
      return fs.readFileSync(this.registryPath);
    } catch {
      return undefined;
    }
  }

  // ---------------------------------------------------------------------
  // resolveTask(): read-only; any known current status; missing
  // registration and replacement are explicit.
  // ---------------------------------------------------------------------

  resolveTask(taskId: string): WorkflowTaskContext {
    const validTaskId = this.validateTaskIdArgument(taskId);
    // Argument shape, then initialized-registry existence, then canonical
    // task-source health and exact lookup -- all before ever deciding a task
    // is merely unregistered. Source errors (missing/invalid/ambiguous/not
    // found) take precedence over TASK_UNREGISTERED, per the human
    // clarification settling this precedence explicitly.
    const registry = this.loadRegistry();
    const task = this.selectTask(this.loadTaskStore(), validTaskId);
    const registered = registry.tasks.find(entry => entry.taskId === validTaskId);
    if (!registered) {
      throw this.error('TASK_UNREGISTERED', 'This task has never been registered.', false);
    }
    if (registered.createdAt !== task.createdAt) {
      throw this.error('TASK_REPLACED', 'The canonical task createdAt no longer matches the registered value.', false);
    }
    const currentDigest = createHash('sha256').update(registry.raw).digest('hex');
    return Object.freeze({
      projectId: registry.projectId,
      taskId: validTaskId,
      createdAt: task.createdAt,
      incarnation: registered.incarnation,
      status: task.status,
      taskDigest: protocolDigest(task.plain),
      registryDigest: currentDigest,
    });
  }

  // ---------------------------------------------------------------------
  // Mutex: an exclusive ownership lock per mutation. No age-based
  // reclamation; contention fails explicitly; the held inode is verified
  // before unlink so a replaced owner's lock is never silently deleted.
  // ---------------------------------------------------------------------

  private withExclusiveLock<T>(lockPath: string, operation: () => T): T {
    let descriptor: number;
    try {
      descriptor = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, FILE_MODE);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'EEXIST') {
        throw this.error('IDENTITIES_BUSY', 'The workflow identity mutex is currently held.', false);
      }
      throw this.error('IDENTITIES_BUSY', 'The workflow identity mutex could not be acquired.', false);
    }

    let ownedStat: { dev: number; ino: number };
    try {
      fs.writeSync(descriptor, `${process.pid}\n`);
      ownedStat = this.snapshotStat(fs.fstatSync(descriptor));
    } catch {
      try { fs.closeSync(descriptor); } catch { /* already closed */ }
      try { fs.unlinkSync(lockPath); } catch { /* best-effort cleanup */ }
      throw this.error('IDENTITIES_BUSY', 'The workflow identity mutex could not be initialized.', false);
    }
    try { fs.closeSync(descriptor); } catch { /* already closed */ }

    let outcome: { kind: 'value'; value: T } | { kind: 'error'; error: unknown };
    try {
      outcome = { kind: 'value', value: operation() };
    } catch (operationError) {
      outcome = { kind: 'error', error: operationError };
    }

    const released = this.releaseLockIfOwned(lockPath, ownedStat);

    if (outcome.kind === 'error') {
      if (!released) {
        const original = outcome.error;
        const originalFlag = original instanceof WorkflowIdentityError ? original.commitMayHaveChanged : true;
        throw this.error(
          'IDENTITIES_BUSY',
          'The workflow identity mutex could not be safely released after a failed operation.',
          originalFlag,
        );
      }
      throw outcome.error;
    }

    if (!released) {
      throw this.error(
        'IDENTITIES_BUSY',
        'The workflow identity mutex was replaced by another owner before release and was left untouched.',
        true,
      );
    }
    return outcome.value;
  }

  private snapshotStat(stats: fs.Stats): { dev: number; ino: number } {
    return { dev: stats.dev, ino: stats.ino };
  }

  private releaseLockIfOwned(lockPath: string, ownedStat: { dev: number; ino: number }): boolean {
    let currentStat: fs.Stats;
    try {
      currentStat = fs.lstatSync(lockPath);
    } catch {
      return false;
    }
    if (currentStat.dev !== ownedStat.dev || currentStat.ino !== ownedStat.ino) {
      return false;
    }
    try {
      fs.unlinkSync(lockPath);
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Registry load: full parse + validation. Nonregular paths are rejected
  // before any blocking open; the actual read is bounded; descriptors are
  // always closed; readers never chmod or otherwise mutate what they
  // inspect.
  // ---------------------------------------------------------------------

  private loadRegistry(): LoadedRegistry {
    const preStats = this.statPathOrThrow(this.registryPath, 'IDENTITIES_MISSING', 'IDENTITIES_PATH_INVALID', 'The workflow identity registry has not been initialized.');
    if (process.platform !== 'win32' && (preStats.mode & DIRECTORY_MODE_MASK) !== 0) {
      throw this.error('IDENTITIES_INVALID', 'The workflow identity registry file must be owner-only (mode 0600).', false);
    }

    let fd: number;
    try {
      fd = fs.openSync(this.registryPath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        throw this.error('IDENTITIES_MISSING', 'The workflow identity registry has not been initialized.', false);
      }
      throw this.error('IDENTITIES_PATH_INVALID', 'The workflow identity registry path could not be opened.', false);
    }

    let raw: Buffer;
    try {
      const openStats = fs.fstatSync(fd);
      if (!openStats.isFile()) {
        throw this.error('IDENTITIES_PATH_INVALID', 'The workflow identity registry path is not a plain regular file.', false);
      }
      raw = this.readBounded(fd, WORKFLOW_IDENTITIES_MAX_BYTES, 'IDENTITIES_PATH_INVALID');
    } finally {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }

    if (raw.length > WORKFLOW_IDENTITIES_MAX_BYTES) {
      throw this.error('IDENTITIES_TOO_LARGE', `The workflow identity registry exceeds the maximum size of ${WORKFLOW_IDENTITIES_MAX_BYTES} bytes.`, false);
    }

    const text = decodeStrictUtf8(raw);
    if (text === undefined) {
      throw this.error('IDENTITIES_INVALID', 'The workflow identity registry does not contain valid UTF-8 text.', false);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw this.error('IDENTITIES_INVALID', 'The workflow identity registry is not valid JSON.', false);
    }

    return this.validateRegistryEnvelope(parsed, raw);
  }

  private statPathOrThrow(path: string, missingCode: string, invalidCode: string, missingMessage: string): fs.Stats {
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(path);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        throw this.error(missingCode, missingMessage, false);
      }
      throw this.error(invalidCode, 'The path could not be inspected.', false);
    }
    if (stats.isSymbolicLink()) {
      throw this.error(invalidCode, 'The path must not be a symlink.', false);
    }
    if (!stats.isFile()) {
      throw this.error(invalidCode, 'The path must be a plain regular file.', false);
    }
    return stats;
  }

  private readBounded(fd: number, maxBytes: number, invalidCode: string): Buffer {
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
        throw this.error(invalidCode, 'The file could not be read.', false);
      }
      if (bytesRead === 0) {
        break;
      }
      chunks.push(Buffer.from(chunkBuffer.subarray(0, bytesRead)));
      total += bytesRead;
      if (total > maxBytes) {
        break;
      }
    }
    return Buffer.concat(chunks, total);
  }

  private validateRegistryEnvelope(parsed: unknown, raw: Buffer): LoadedRegistry {
    if (!isPlainObject(parsed)) {
      throw this.error('IDENTITIES_INVALID', 'The workflow identity registry must contain a plain JSON object.', false);
    }
    const knownTop = new Set(['version', 'projectId', 'tasks']);
    for (const key of Object.keys(parsed)) {
      if (!knownTop.has(key)) {
        throw this.error('IDENTITIES_INVALID', 'The workflow identity registry contains an unrecognized top-level field.', false);
      }
    }
    for (const field of ['version', 'projectId', 'tasks']) {
      if (!(field in parsed)) {
        throw this.error('IDENTITIES_INVALID', 'The workflow identity registry is missing a required field.', false);
      }
    }

    const version = parsed.version;
    if (typeof version !== 'number') {
      throw this.error('IDENTITIES_INVALID', 'The workflow identity registry "version" field must be a number.', false);
    }
    if (version !== 1) {
      throw this.error('IDENTITIES_VERSION_UNSUPPORTED', 'The workflow identity registry version is not supported.', false);
    }

    const projectId = parsed.projectId;
    if (typeof projectId !== 'string' || !UUID_SHAPE.test(projectId)) {
      throw this.error('IDENTITIES_INVALID', 'The workflow identity registry "projectId" field is malformed.', false);
    }

    const tasksRaw = parsed.tasks;
    if (!Array.isArray(tasksRaw)) {
      throw this.error('IDENTITIES_INVALID', 'The workflow identity registry "tasks" field must be an array.', false);
    }

    const tasks: WorkflowTaskIdentity[] = [];
    const seenTaskIds = new Set<string>();
    const seenIncarnations = new Set<string>();
    for (const entry of tasksRaw) {
      const task = this.validateStoredTaskIdentity(entry);
      if (seenTaskIds.has(task.taskId)) {
        throw this.error('IDENTITIES_INVALID', 'The workflow identity registry contains a duplicate taskId.', false);
      }
      if (seenIncarnations.has(task.incarnation)) {
        throw this.error('IDENTITIES_INVALID', 'The workflow identity registry contains a duplicate incarnation.', false);
      }
      seenTaskIds.add(task.taskId);
      seenIncarnations.add(task.incarnation);
      tasks.push(task);
    }

    return { projectId, tasks: Object.freeze(tasks), raw };
  }

  private validateStoredTaskIdentity(value: unknown): WorkflowTaskIdentity {
    if (!isPlainObject(value)) {
      throw this.error('IDENTITIES_INVALID', 'Each registered task entry must be a plain object.', false);
    }
    const known = new Set(['taskId', 'createdAt', 'incarnation']);
    for (const key of Object.keys(value)) {
      if (!known.has(key)) {
        throw this.error('IDENTITIES_INVALID', 'A registered task entry contains an unrecognized field.', false);
      }
    }
    const taskId = value.taskId;
    if (!isNonBlankBoundedString(taskId, MAX_FIELD_UNITS)) {
      throw this.error('IDENTITIES_INVALID', 'A registered task entry has a malformed taskId.', false);
    }
    const createdAt = value.createdAt;
    if (!isNonBlankBoundedString(createdAt, MAX_FIELD_UNITS) || !isValidIsoLike(createdAt)) {
      throw this.error('IDENTITIES_INVALID', 'A registered task entry has a malformed createdAt.', false);
    }
    const incarnation = value.incarnation;
    if (typeof incarnation !== 'string' || !UUID_SHAPE.test(incarnation)) {
      throw this.error('IDENTITIES_INVALID', 'A registered task entry has a malformed incarnation.', false);
    }
    return Object.freeze({ taskId, createdAt, incarnation });
  }

  // ---------------------------------------------------------------------
  // Task store load: bounded, strict data-only YAML. Rejects duplicate
  // keys, custom tags and merge-key expansion; tasks array required;
  // unrelated top-level/task fields are never interpreted or rewritten.
  // ---------------------------------------------------------------------

  private loadTaskStore(): readonly Record<string, unknown>[] {
    this.statPathOrThrowForTasks();
    let fd: number;
    try {
      fd = fs.openSync(this.tasksPath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        throw this.error('TASK_STORE_MISSING', 'The canonical task store has not been created.', false);
      }
      if (isErrnoException(error) && (error.code === 'EACCES' || error.code === 'EPERM')) {
        throw this.error('TASK_STORE_UNREADABLE', 'The canonical task store could not be read.', false);
      }
      throw this.error('TASK_STORE_INVALID', 'The canonical task store path could not be opened.', false);
    }

    let raw: Buffer;
    try {
      const openStats = fs.fstatSync(fd);
      if (!openStats.isFile()) {
        throw this.error('TASK_STORE_INVALID', 'The canonical task store path is not a plain regular file.', false);
      }
      raw = this.readBounded(fd, WORKFLOW_TASKS_MAX_BYTES, 'TASK_STORE_INVALID');
    } finally {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }

    if (raw.length > WORKFLOW_TASKS_MAX_BYTES) {
      throw this.error('TASK_STORE_TOO_LARGE', `The canonical task store exceeds the maximum size of ${WORKFLOW_TASKS_MAX_BYTES} bytes.`, false);
    }

    const text = decodeStrictUtf8(raw);
    if (text === undefined) {
      throw this.error('TASK_STORE_INVALID', 'The canonical task store does not contain valid UTF-8 text.', false);
    }

    let parsed: unknown;
    try {
      parsed = yaml.load(text, { schema: yaml.CORE_SCHEMA, json: false });
    } catch {
      throw this.error('TASK_STORE_INVALID', 'The canonical task store is not valid, strict, data-only YAML.', false);
    }

    if (!isPlainObject(parsed)) {
      throw this.error('TASK_STORE_INVALID', 'The canonical task store must contain a plain mapping document.', false);
    }
    const knownTop = new Set(['tasks', 'approvals']);
    for (const key of Object.keys(parsed)) {
      if (!knownTop.has(key)) {
        throw this.error('TASK_STORE_INVALID', 'The canonical task store contains an unrecognized top-level field.', false);
      }
    }
    const tasksRaw = parsed.tasks;
    if (!Array.isArray(tasksRaw)) {
      throw this.error('TASK_STORE_INVALID', 'The canonical task store "tasks" field must be an array.', false);
    }

    const tasks: Record<string, unknown>[] = [];
    for (const entry of tasksRaw) {
      if (!isPlainObject(entry)) {
        throw this.error('TASK_STORE_INVALID', 'Each task in the canonical task store must be a plain object.', false);
      }
      if ('<<' in entry) {
        throw this.error('TASK_STORE_INVALID', 'The canonical task store must not use YAML merge-key expansion.', false);
      }
      tasks.push(entry);
    }
    return Object.freeze(tasks);
  }

  private statPathOrThrowForTasks(): fs.Stats {
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(this.tasksPath);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        throw this.error('TASK_STORE_MISSING', 'The canonical task store has not been created.', false);
      }
      throw this.error('TASK_STORE_INVALID', 'The canonical task store path could not be inspected.', false);
    }
    if (stats.isSymbolicLink()) {
      throw this.error('TASK_STORE_INVALID', 'The canonical task store path must not be a symlink.', false);
    }
    if (!stats.isFile()) {
      throw this.error('TASK_STORE_INVALID', 'The canonical task store path must be a plain regular file.', false);
    }
    return stats;
  }

  // ---------------------------------------------------------------------
  // Canonical task selection: exact taskId match only; duplicates are
  // ambiguous; identity/status fields are validated for the exact match.
  // ---------------------------------------------------------------------

  private selectTask(tasks: readonly Record<string, unknown>[], taskId: string): RawTaskRecord {
    const matches = tasks.filter(entry => typeof entry.id === 'string' && entry.id === taskId);
    if (matches.length === 0) {
      throw this.error('TASK_NOT_FOUND', 'No canonical task matches the requested id.', false);
    }
    if (matches.length > 1) {
      throw this.error('TASK_AMBIGUOUS', 'Multiple canonical tasks share the requested id.', false);
    }
    const plain = matches[0];

    const id = plain.id;
    if (!isNonBlankBoundedString(id, MAX_FIELD_UNITS)) {
      throw this.error('TASK_STATE_INVALID', 'The canonical task has a malformed id.', false);
    }
    const createdAt = plain.createdAt;
    if (!isNonBlankBoundedString(createdAt, MAX_FIELD_UNITS) || !isValidIsoLike(createdAt)) {
      throw this.error('TASK_STATE_INVALID', 'The canonical task has a malformed createdAt.', false);
    }
    const status = plain.status;
    if (typeof status !== 'string' || !TASK_STATUSES.has(status)) {
      throw this.error('TASK_STATE_INVALID', 'The canonical task has an unsupported status.', false);
    }

    return { id, createdAt, status: status as TaskStatus, plain };
  }
}
