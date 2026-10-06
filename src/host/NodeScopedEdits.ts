/**
 * NodeScopedEdits: a typed, host-local service that lets a bound caller
 * ("owner") acquire an exclusive lease over a small set of existing regular
 * UTF-8 text files under one constructor-pinned code root, read or
 * text-replace them, and release the lease — with every boundary checked
 * against an on-disk lease registry rather than trusted caller state.
 *
 * Trust boundaries (read this before depending on this module):
 * - The `owner` string is a trusted-caller binding, not a human identity or
 *   an authentication/authorization claim. Any process able to construct a
 *   `NodeScopedEdits` instance and read the lease it was handed can act as
 *   that owner. This service does not verify human intent.
 * - Cooperative guards only. The symlink, drift and inode checks defend
 *   against accidental concurrent writers and this process's own mistakes,
 *   not a hostile co-resident user who can race the filesystem between our
 *   checks and our writes (classic TOCTOU), nor a sandboxed/managed
 *   environment. This is not an OS-level sandbox.
 * - Atomicity is per-file and per-registry-write, not transactional across
 *   the two. A source file replacement and the registry write that records
 *   it are each individually atomic (temp file + rename, with fsync before
 *   rename), but there is a window between them with no distributed
 *   transaction tying them together. See "partial-write uncertainty" below.
 * - Partial-write uncertainty: `sourceMayHaveChanged: true` on a thrown
 *   `ScopedEditError` means this specific call's own atomic source-file
 *   replacement already committed before the failure that caused it to
 *   throw. It does not, by itself, say whether the following registry
 *   write also committed — two distinct failures set it. First, the
 *   registry write can fail right after the source replacement, leaving
 *   the on-disk file changed but the lease's recorded identity/hash and
 *   operation history unchanged; this service does not retry that write
 *   or roll the source file back (a rollback could itself race a second
 *   writer), and the next `edit()` against this lease will fail closed
 *   rather than silently overwrite the unrecorded change. Second, the
 *   registry write can itself succeed — so the source file and the
 *   registry both already reflect the new content — and only the
 *   mutex-release step afterward can fail (see "Lock recovery limits"
 *   below); here there is nothing left to roll back for that file, only
 *   the lock's own bookkeeping is in question. Neither case is "the one
 *   case": `sourceMayHaveChanged: false` means only that this particular
 *   call did not replace a source file, not that every registry-side
 *   effect of a failed call was undone. Inspecting current bytes with
 *   `read()` shows live content but does not refresh the lease's stored
 *   identity or by itself authorize a retry; this increment has no API
 *   that resynchronizes a lease's recorded identity other than a
 *   subsequent successful `edit()` or a fresh `acquire()`.
 * - Lock recovery limits: the ownership mutex (`leases.lock`) is a plain
 *   exclusive-create file with bounded retry, deliberately *without* the
 *   age-based stale-lock reclamation that `NodeSecureStore.withFileLock`
 *   implements for its own callers. An abandoned lock file (e.g. the
 *   process holding it was killed) will cause every subsequent mutating
 *   call to fail with `STATE_BUSY` until an operator removes it by hand.
 *   This is intentional: silently reclaiming an "old" lock is exactly the
 *   unsafe behavior this service's contract forbids, since "old" cannot be
 *   distinguished from "held by a slow but live writer." There is no
 *   automatic recovery path. Releasing the mutex re-checks the lock file's
 *   device/inode identity (captured when this process created it)
 *   immediately before unlinking; if another process has since replaced
 *   `leases.lock` with its own, release refuses to delete it and reports
 *   `STATE_BUSY` instead of silently discarding a lock it does not own.
 *   Checking `sourceMayHaveChanged` on that failure is mandatory, not
 *   optional: it carries whatever value applied to the operation actually
 *   in progress, including `true` when release fails *after* a source
 *   edit already committed and its registry write already persisted.
 *   Reading the file's current bytes back does not refresh a stale lease.
 *   Reconciling after any such failure may require authorized inspection
 *   of both the source file and the lease registry; `sourceMayHaveChanged:
 *   false` on its own does not prove every registry-side effect of the
 *   failed call was rolled back.
 * - POSIX-mode preservation: ordinary file permission bits on a source file
 *   (e.g. 0o644) are read before every edit and re-applied explicitly after
 *   the atomic replace, so a restrictive process umask cannot silently
 *   tighten or loosen a file's mode as a side effect of an edit.
 * - Source drift: content hash, device, inode and mode are all compared
 *   against the lease's last-known-good identity for that file before any
 *   edit is attempted; any mismatch is `SOURCE_DRIFT` (or `ROOT_DRIFT` when
 *   the code root directory itself has been replaced) and leaves the file
 *   untouched.
 * - Validation scope: this module is exercised and supported on the
 *   verified Linux host only. POSIX permission/owner semantics, symlink
 *   behavior and the Node `fs` bigint stat APIs it depends on are not
 *   validated on Windows or other platforms.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { ISecureStore } from './ISecureStore';
import { NodeSecureStore } from './NodeSecureStore';

/** A request to read one file within an active, owner-bound lease's scope. */
export interface ScopedReadRequest {
  readonly leaseId: string;
  readonly fence: number;
  readonly owner: string;
  readonly path: string;
}

/** A single exact-text replacement request, scoped to an active lease. */
export interface ScopedEditRequest extends ScopedReadRequest {
  readonly expectedHash: string;
  readonly oldText: string;
  readonly newText: string;
}

/**
 * The identity and content hash of one leased file as last observed by this
 * service (either at acquisition time or after the most recent successful
 * edit). `dev`/`ino` are carried as decimal strings so 64-bit device/inode
 * identities survive round-tripping through JSON without precision loss.
 */
export interface ScopedTarget {
  readonly path: string;
  readonly hash: string;
  readonly dev: string;
  readonly ino: string;
  readonly mode: number;
}

/** A single successfully applied edit, retained for the lease's history. */
export interface ScopedOperation {
  readonly id: string;
  readonly path: string;
  readonly beforeHash: string;
  readonly afterHash: string;
}

export type ScopedLeaseStatus = 'active' | 'released';

/** The full, persisted record of one acquire-to-release lease lifecycle. */
export interface ScopedLease {
  readonly id: string;
  readonly fence: number;
  readonly owner: string;
  readonly root: string;
  readonly rootIdentity: string;
  readonly status: ScopedLeaseStatus;
  readonly targets: readonly ScopedTarget[];
  readonly operations: readonly ScopedOperation[];
}

const APPROVED_CODES = [
  'ROOT_INVALID', 'ROOT_SYMLINK', 'STATE_INSIDE_ROOT', 'SOURCE_MISSING',
  'SOURCE_SYMLINK', 'SOURCE_UNSUPPORTED', 'SOURCE_NOT_UTF8', 'SOURCE_DRIFT',
  'STATE_MISSING', 'STATE_INVALID', 'STATE_BUSY', 'LEASE_CONFLICT',
  'LEASE_BINDING', 'LEASE_INACTIVE', 'FENCE_EXHAUSTED', 'SCOPE_INVALID',
  'PATH_OUT_OF_SCOPE', 'EDIT_INVALID', 'EXPECTED_HASH_MISMATCH',
  'MATCH_NOT_FOUND', 'MATCH_NOT_UNIQUE', 'ROOT_DRIFT',
] as const;

export type ScopedEditErrorCode = typeof APPROVED_CODES[number];

/**
 * Thrown for every contract-defined rejection. `code` is the stable,
 * machine-checked contract (see the approved vocabulary above); `message`
 * is a free-form, human-readable explanation that callers must not parse.
 * `sourceMayHaveChanged` is `true` when this call's own atomic source-file
 * replacement already committed before the failure that caused it to
 * throw — whether or not the registry write and mutex release that follow
 * it also committed — and `false` when this call never reached that
 * replacement. Callers must check it on every failure; `false` only says
 * this call did not replace a source file, it is not proof that every
 * registry-side effect of a failed call was rolled back.
 */
export class ScopedEditError extends Error {
  readonly code: ScopedEditErrorCode;
  readonly sourceMayHaveChanged: boolean;

  constructor(code: ScopedEditErrorCode, message: string, sourceMayHaveChanged = false) {
    super(message);
    this.name = 'ScopedEditError';
    this.code = code;
    this.sourceMayHaveChanged = sourceMayHaveChanged;
    Object.setPrototypeOf(this, ScopedEditError.prototype);
  }
}

function fail(code: ScopedEditErrorCode, message: string, sourceMayHaveChanged = false): never {
  throw new ScopedEditError(code, message, sourceMayHaveChanged);
}

interface PersistedTarget {
  readonly path: string;
  readonly hash: string;
  readonly dev: string;
  readonly ino: string;
  readonly mode: number;
}

interface PersistedOperation {
  readonly id: string;
  readonly path: string;
  readonly beforeHash: string;
  readonly afterHash: string;
}

interface PersistedLease {
  readonly id: string;
  readonly fence: number;
  readonly owner: string;
  readonly root: string;
  readonly rootIdentity: string;
  readonly status: ScopedLeaseStatus;
  readonly targets: readonly PersistedTarget[];
  readonly operations: readonly PersistedOperation[];
}

interface PersistedRegistry {
  readonly version: number;
  readonly nextFence: number;
  readonly leases: readonly PersistedLease[];
}

const REGISTRY_VERSION = 1;
const REGISTRY_FILE_NAME = 'leases.json';
const LOCK_FILE_NAME = 'leases.lock';
const MUTEX_TIMEOUT_MS = 300;
const MUTEX_RETRY_INTERVAL_MS = 15;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const POSIX_MODE_MASK = 0o777n;

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

// ---------------------------------------------------------------------------
// Registry schema guards: the on-disk leases.json is untrusted input. Every
// field is narrowed from `unknown` with no `as` casts, so a malformed or
// hand-edited registry fails closed as STATE_INVALID instead of silently
// coercing into a lease the service never actually granted.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

function isLeaseStatus(value: unknown): value is ScopedLeaseStatus {
  return value === 'active' || value === 'released';
}

function invalidState(): never {
  return fail('STATE_INVALID', 'The lease registry is malformed or unsupported');
}

function parseTarget(raw: unknown): PersistedTarget {
  if (!isRecord(raw)) { return invalidState(); }
  const { path: targetPath, hash, dev, ino, mode } = raw;
  if (!isNonEmptyString(targetPath) || !isHash(hash) || typeof dev !== 'string'
    || typeof ino !== 'string' || !isSafeInteger(mode)) {
    return invalidState();
  }
  return { path: targetPath, hash, dev, ino, mode };
}

function parseOperation(raw: unknown): PersistedOperation {
  if (!isRecord(raw)) { return invalidState(); }
  const { id, path: opPath, beforeHash, afterHash } = raw;
  if (!isNonEmptyString(id) || !isNonEmptyString(opPath) || !isHash(beforeHash) || !isHash(afterHash)) {
    return invalidState();
  }
  return { id, path: opPath, beforeHash, afterHash };
}

function parseLease(raw: unknown): PersistedLease {
  if (!isRecord(raw)) { return invalidState(); }
  const {
    id, fence, owner, root, rootIdentity, status, targets, operations,
  } = raw;
  if (!isNonEmptyString(id) || !isSafeInteger(fence) || !isNonEmptyString(owner)
    || !isNonEmptyString(root) || !isNonEmptyString(rootIdentity) || !isLeaseStatus(status)
    || !Array.isArray(targets) || !Array.isArray(operations)) {
    return invalidState();
  }
  return {
    id, fence, owner, root, rootIdentity, status,
    targets: targets.map(parseTarget),
    operations: operations.map(parseOperation),
  };
}

function parseRegistry(raw: string): PersistedRegistry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalidState();
  }
  if (!isRecord(parsed)) { return invalidState(); }
  const { version, nextFence, leases } = parsed;
  if (version !== REGISTRY_VERSION || !isSafeInteger(nextFence) || !Array.isArray(leases)) {
    return invalidState();
  }
  return { version, nextFence, leases: leases.map(parseLease) };
}

// ---------------------------------------------------------------------------
// Path scope validation: exact relative paths only. Every rejected shape is
// rejected outright rather than normalized into something permitted, so a
// caller cannot smuggle traversal or reserved-directory access past this
// check by relying on implicit normalization.
// ---------------------------------------------------------------------------

function isValidScopePath(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string' || candidate.length === 0) { return false; }
  if (candidate.includes('\\')) { return false; }
  if (candidate.startsWith('/')) { return false; }
  const segments = candidate.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) { return false; }
  if (segments[0] === '.git' || segments[0] === '.SprintDesk') { return false; }
  return true;
}

function assertValidScopePath(candidate: unknown): string {
  if (!isValidScopePath(candidate)) {
    return fail('PATH_OUT_OF_SCOPE', `${JSON.stringify(candidate)} is not a valid in-scope relative path`);
  }
  return candidate;
}

/** A fully resolved, freshly read, current-on-disk view of one scoped file. */
interface LiveSource {
  readonly absolutePath: string;
  readonly stat: fs.BigIntStats;
  readonly content: string;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) { return 0; }
  let count = 0;
  let index = 0;
  for (;;) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) { break; }
    count += 1;
    index = found + needle.length;
  }
  return count;
}

export class NodeScopedEdits {
  private readonly codeRoot: string;
  private readonly stateDirectory: string;
  private readonly secureStore: Pick<ISecureStore, 'readSecureText' | 'writeSecureText'>;
  private readonly rootIdentity: string;
  private temporaryFileCounter = 0;

  constructor(
    stateDirectory: string,
    codeRoot: string,
    secureStore: Pick<ISecureStore, 'readSecureText' | 'writeSecureText'> = new NodeSecureStore(),
  ) {
    const rootStat = this.assertAbsoluteExistingDirectory(codeRoot);
    if (!path.isAbsolute(stateDirectory)) {
      fail('ROOT_INVALID', `${stateDirectory} must be an absolute path`);
    }
    const resolvedRoot = path.resolve(codeRoot);
    const resolvedState = path.resolve(stateDirectory);
    if (resolvedState === resolvedRoot || resolvedState.startsWith(resolvedRoot + path.sep)) {
      fail('STATE_INSIDE_ROOT', `${stateDirectory} must not be inside the code root ${codeRoot}`);
    }
    this.assertAbsoluteExistingDirectory(stateDirectory);

    this.codeRoot = resolvedRoot;
    this.stateDirectory = resolvedState;
    this.secureStore = secureStore;
    this.rootIdentity = `${rootStat.dev}:${rootStat.ino}`;
  }

  /**
   * Grants `owner` an exclusive, all-or-none lease over `paths` (relative to
   * the constructor-pinned code root). Initializes the on-disk registry on
   * first use; never silently reinitializes a malformed one.
   */
  acquire(owner: string, paths: readonly string[]): ScopedLease {
    if (!isNonEmptyString(owner) || paths.length === 0 || new Set(paths).size !== paths.length) {
      fail('SCOPE_INVALID', 'The owner must be non-empty and paths must be a non-empty, duplicate-free list');
    }
    const relativePaths = paths.map(assertValidScopePath);
    const sources = relativePaths.map(relativePath => this.resolveSource(relativePath));

    const release = this.acquireMutex();
    try {
      const registry = this.loadRegistry(true);
      for (const lease of registry.leases) {
        if (lease.status !== 'active') { continue; }
        if (lease.targets.some(target => relativePaths.includes(target.path))) {
          fail('LEASE_CONFLICT', 'One or more requested paths are already leased by an active owner');
        }
      }
      if (registry.nextFence >= Number.MAX_SAFE_INTEGER) {
        fail('FENCE_EXHAUSTED', 'The lease registry has exhausted its safe-integer fence sequence');
      }

      const targets: PersistedTarget[] = relativePaths.map((relativePath, index) => {
        const source = sources[index];
        return {
          path: relativePath,
          hash: sha256(source.content),
          dev: source.stat.dev.toString(),
          ino: source.stat.ino.toString(),
          mode: Number(source.stat.mode & POSIX_MODE_MASK),
        };
      });

      const fence = registry.nextFence;
      const lease: PersistedLease = {
        id: randomUUID(),
        fence,
        owner,
        root: this.codeRoot,
        rootIdentity: this.rootIdentity,
        status: 'active',
        targets,
        operations: [],
      };
      const updatedRegistry: PersistedRegistry = {
        version: registry.version,
        nextFence: fence + 1,
        leases: [...registry.leases, lease],
      };
      this.saveRegistry(updatedRegistry);
      return lease;
    } finally {
      release(false);
    }
  }

  /** Returns the current on-disk content of one file within an active lease's scope. */
  read(request: ScopedReadRequest): { path: string; hash: string; text: string } {
    const registry = this.loadRegistry(false);
    const lease = this.findBoundLease(registry, request);
    const target = lease.targets.find(candidate => candidate.path === request.path);
    if (!target) {
      fail('PATH_OUT_OF_SCOPE', `${request.path} is not within this lease's scope`);
    }
    const source = this.resolveSource(request.path);
    return { path: request.path, hash: sha256(source.content), text: source.content };
  }

  /**
   * Replaces exactly one non-empty, unique occurrence of `oldText` with
   * `newText` in the leased file at `path`, after verifying the caller's
   * optimistic-concurrency hash, the file's live identity against the
   * lease's last-known-good identity, and the code root's identity.
   */
  edit(request: ScopedEditRequest): ScopedTarget {
    if (typeof request.oldText !== 'string' || request.oldText.length === 0
      || typeof request.newText !== 'string') {
      fail('EDIT_INVALID', 'oldText must be a non-empty string and newText must be a string');
    }

    const release = this.acquireMutex();
    let sourceReplaced = false;
    try {
      const registry = this.loadRegistry(false);
      const lease = this.findBoundLease(registry, request);
      const target = lease.targets.find(candidate => candidate.path === request.path);
      if (!target) {
        fail('PATH_OUT_OF_SCOPE', `${request.path} is not within this lease's scope`);
      }
      this.assertRootIdentity(lease);

      const source = this.resolveSource(request.path);
      const liveHash = sha256(source.content);
      const liveMode = Number(source.stat.mode & POSIX_MODE_MASK);
      if (target.hash !== liveHash || target.dev !== source.stat.dev.toString()
        || target.ino !== source.stat.ino.toString() || target.mode !== liveMode) {
        fail('SOURCE_DRIFT', `${request.path} has changed outside this lease and cannot be edited safely`);
      }
      if (request.expectedHash !== liveHash) {
        fail('EXPECTED_HASH_MISMATCH', `${request.path}'s current hash does not match the expected hash`);
      }

      const occurrences = countOccurrences(source.content, request.oldText);
      if (occurrences === 0) {
        fail('MATCH_NOT_FOUND', `No occurrence of the requested text was found in ${request.path}`);
      }
      if (occurrences > 1) {
        fail('MATCH_NOT_UNIQUE', `Multiple occurrences of the requested text were found in ${request.path}`);
      }

      const matchIndex = source.content.indexOf(request.oldText);
      const newContent = source.content.slice(0, matchIndex)
        + request.newText
        + source.content.slice(matchIndex + request.oldText.length);

      this.replaceSourceAtomic(source.absolutePath, newContent, liveMode);
      sourceReplaced = true;

      const newStat = fs.statSync(source.absolutePath, { bigint: true });
      const newHash = sha256(newContent);
      const updatedTarget: PersistedTarget = {
        path: request.path,
        hash: newHash,
        dev: newStat.dev.toString(),
        ino: newStat.ino.toString(),
        mode: liveMode,
      };
      const operation: PersistedOperation = {
        id: randomUUID(), path: request.path, beforeHash: liveHash, afterHash: newHash,
      };
      const updatedLease: PersistedLease = {
        ...lease,
        targets: lease.targets.map(candidate => (candidate.path === request.path ? updatedTarget : candidate)),
        operations: [...lease.operations, operation],
      };
      const updatedRegistry: PersistedRegistry = {
        version: registry.version,
        nextFence: registry.nextFence,
        leases: registry.leases.map(candidate => (candidate.id === lease.id ? updatedLease : candidate)),
      };

      try {
        this.saveRegistry(updatedRegistry);
      } catch {
        // The source file was already replaced on disk above; this failure
        // means that change cannot be recorded. Surface the uncertainty
        // explicitly rather than guessing at a rollback that could itself
        // race a concurrent writer.
        fail(
          'STATE_BUSY',
          `${request.path} was changed on disk but the lease registry could not be updated`,
          true,
        );
      }

      return updatedTarget;
    } finally {
      release(sourceReplaced);
    }
  }

  /** Marks a lease as released, retaining its full history for audit. */
  release(leaseId: string, fence: number, owner: string): ScopedLease {
    const releaseMutex = this.acquireMutex();
    try {
      const registry = this.loadRegistry(false);
      const lease = this.findBoundLease(registry, { leaseId, fence, owner });
      const updatedLease: PersistedLease = { ...lease, status: 'released' };
      const updatedRegistry: PersistedRegistry = {
        version: registry.version,
        nextFence: registry.nextFence,
        leases: registry.leases.map(candidate => (candidate.id === lease.id ? updatedLease : candidate)),
      };
      this.saveRegistry(updatedRegistry);
      return updatedLease;
    } finally {
      releaseMutex(false);
    }
  }

  /** Returns every lease ever recorded in this registry, active or released. */
  list(): readonly ScopedLease[] {
    return this.loadRegistry(false).leases;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private assertAbsoluteExistingDirectory(candidatePath: string): fs.BigIntStats {
    if (!path.isAbsolute(candidatePath)) {
      fail('ROOT_INVALID', `${candidatePath} must be an absolute path`);
    }
    let lstat: fs.Stats;
    try {
      lstat = fs.lstatSync(candidatePath);
    } catch {
      return fail('ROOT_INVALID', `${candidatePath} does not exist`);
    }
    if (lstat.isSymbolicLink()) {
      fail('ROOT_SYMLINK', `${candidatePath} must not be a symbolic link`);
    }
    if (!lstat.isDirectory()) {
      fail('ROOT_INVALID', `${candidatePath} must be a directory`);
    }
    return fs.statSync(candidatePath, { bigint: true });
  }

  /**
   * Resolves one scope-relative path against the code root, rejecting a
   * symlink anywhere along the path (not just at the final component), and
   * returns its freshly read content and identity. This is the single
   * source of truth for SOURCE_MISSING / SOURCE_SYMLINK / SOURCE_UNSUPPORTED
   * / SOURCE_NOT_UTF8, used identically at acquisition and at every
   * subsequent read/edit so a symlink introduced after acquisition is
   * caught just as reliably as one present at acquisition time.
   */
  private resolveSource(relativePath: string): LiveSource {
    const segments = relativePath.split('/');
    let current = this.codeRoot;
    for (let index = 0; index < segments.length; index += 1) {
      current = path.join(current, segments[index]);
      let lstat: fs.Stats;
      try {
        lstat = fs.lstatSync(current);
      } catch (error) {
        if (errorCode(error) === 'ENOENT') {
          fail('SOURCE_MISSING', `${relativePath} does not exist`);
        }
        fail('SOURCE_UNSUPPORTED', `${relativePath} could not be inspected`);
      }
      if (lstat.isSymbolicLink()) {
        fail('SOURCE_SYMLINK', `${relativePath} passes through a symbolic link`);
      }
      const isLastSegment = index === segments.length - 1;
      if (!isLastSegment && !lstat.isDirectory()) {
        fail('SOURCE_UNSUPPORTED', `${relativePath} passes through a non-directory`);
      }
    }
    const stat = fs.statSync(current, { bigint: true });
    if (!stat.isFile()) {
      fail('SOURCE_UNSUPPORTED', `${relativePath} is not a regular file`);
    }
    const buffer = fs.readFileSync(current);
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      return fail('SOURCE_NOT_UTF8', `${relativePath} is not valid UTF-8 text`);
    }
    return { absolutePath: current, stat, content };
  }

  /**
   * Atomically replaces a source file's content while explicitly re-applying
   * its original POSIX mode bits, so a restrictive process umask cannot
   * silently tighten or loosen permissions as a side effect of an edit. Uses
   * a plain temp-file-plus-rename on the same directory (not the secure
   * store, which always forces files to 0600) because leased source files
   * are ordinary project files, not secrets.
   */
  private replaceSourceAtomic(absolutePath: string, content: string, mode: number): void {
    const directory = path.dirname(absolutePath);
    this.temporaryFileCounter += 1;
    const temporaryPath = path.join(
      directory, `.${path.basename(absolutePath)}.${process.pid}.${this.temporaryFileCounter}.tmp`,
    );
    const descriptor = fs.openSync(temporaryPath, 'wx', mode);
    try {
      fs.writeFileSync(descriptor, content, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      fs.chmodSync(temporaryPath, mode);
      fs.renameSync(temporaryPath, absolutePath);
    } catch (error) {
      try { fs.closeSync(descriptor); } catch { /* already closed */ }
      try { fs.unlinkSync(temporaryPath); } catch { /* nothing staged */ }
      fail('SOURCE_UNSUPPORTED', `Unable to write ${absolutePath}: ${errorCode(error) ?? 'write failure'}`);
    }
  }

  private assertRootIdentity(lease: PersistedLease): void {
    const currentRootStat = fs.statSync(this.codeRoot, { bigint: true });
    const currentRootIdentity = `${currentRootStat.dev}:${currentRootStat.ino}`;
    if (lease.rootIdentity !== currentRootIdentity) {
      fail('ROOT_DRIFT', 'The code root directory has been replaced since this lease was acquired');
    }
  }

  /**
   * Validates that `request` binds to a real, active lease owned by the
   * caller under this service's constructor-pinned root. A caller-supplied
   * lease object from a different `NodeScopedEdits` instance bound to a
   * different root — even one sharing this same registry — is rejected
   * here as LEASE_BINDING before any file is touched.
   */
  private findBoundLease(
    registry: PersistedRegistry,
    request: { leaseId: string; fence: number; owner: string },
  ): PersistedLease {
    const lease = registry.leases.find(candidate => candidate.id === request.leaseId);
    if (!lease || lease.owner !== request.owner || lease.fence !== request.fence
      || lease.root !== this.codeRoot) {
      fail('LEASE_BINDING', 'The lease does not match this owner, fence or code root');
    }
    if (lease.status !== 'active') {
      fail('LEASE_INACTIVE', 'This lease has already been released');
    }
    return lease;
  }

  private registryPath(): string {
    return path.join(this.stateDirectory, REGISTRY_FILE_NAME);
  }

  private loadRegistry(initializeIfMissing: boolean): PersistedRegistry {
    const raw = this.secureStore.readSecureText(this.registryPath());
    if (raw === undefined) {
      if (initializeIfMissing) {
        return { version: REGISTRY_VERSION, nextFence: 1, leases: [] };
      }
      fail('STATE_MISSING', 'No lease registry has been created yet');
    }
    return parseRegistry(raw);
  }

  private saveRegistry(registry: PersistedRegistry): void {
    this.secureStore.writeSecureText(this.registryPath(), JSON.stringify(registry));
  }

  /**
   * Acquires the ownership mutex that serializes all registry mutations,
   * via a plain exclusive-create lock file with bounded retry. Deliberately
   * does not reuse `NodeSecureStore.withFileLock`'s age-based stale-lock
   * reclamation: an occupied mutex must block (and eventually fail with
   * STATE_BUSY) rather than ever being silently reclaimed because it looks
   * old, since "old" cannot be distinguished from "held by a slow but live
   * writer." The returned release callback is bound to this lock file's
   * device/inode identity (captured via `fstat` right after creation, while
   * the descriptor this process just opened is still open) so it can later
   * prove — not merely assume — that whatever currently sits at
   * `leases.lock` is still the exact file it created, before ever
   * unlinking it. The caller passes the `sourceMayHaveChanged` value that
   * applies to the operation actually in progress, so a cleanup failure
   * reports the correct uncertainty rather than defaulting to `false`.
   */
  private acquireMutex(): (sourceMayHaveChanged: boolean) => void {
    const lockPath = path.join(this.stateDirectory, LOCK_FILE_NAME);
    const deadline = Date.now() + MUTEX_TIMEOUT_MS;
    for (;;) {
      try {
        const descriptor = fs.openSync(lockPath, 'wx', 0o600);
        let identity: fs.BigIntStats;
        try {
          fs.writeFileSync(descriptor, `${process.pid}\n`, 'utf8');
          identity = fs.fstatSync(descriptor, { bigint: true });
        } finally {
          fs.closeSync(descriptor);
        }
        return (sourceMayHaveChanged: boolean) => {
          this.completeMutexRelease(lockPath, identity, sourceMayHaveChanged);
        };
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') {
          return fail('STATE_BUSY', `Unable to acquire the lease registry lock: ${errorCode(error) ?? 'lock failure'}`);
        }
        if (Date.now() >= deadline) {
          return fail('STATE_BUSY', 'Timed out waiting for the lease registry lock');
        }
        sleepSync(MUTEX_RETRY_INTERVAL_MS);
      }
    }
  }

  /**
   * Releases the ownership mutex this process created, but only after
   * re-proving (via a fresh `lstat`, not the cached write-time identity
   * alone) that the file currently at `leases.lock` still has the exact
   * device/inode identity observed right after this process created it. A
   * mismatch means some other process has already replaced the lock — this
   * is no longer this process's lock to delete, so it is left completely
   * untouched. A missing lock file (removed out from under this process)
   * and any `unlink` failure are likewise never swallowed: every one of
   * these paths reports `STATE_BUSY`, carrying the caller-supplied
   * `sourceMayHaveChanged` for the operation actually in progress, instead
   * of silently discarding the error.
   */
  private completeMutexRelease(lockPath: string, identity: fs.BigIntStats, sourceMayHaveChanged: boolean): void {
    let currentStat: fs.BigIntStats;
    try {
      currentStat = fs.lstatSync(lockPath, { bigint: true });
    } catch (error) {
      fail(
        'STATE_BUSY',
        `The lease registry lock was removed by another process before it could be released: ${errorCode(error) ?? 'stat failure'}`,
        sourceMayHaveChanged,
      );
    }
    if (currentStat.dev !== identity.dev || currentStat.ino !== identity.ino) {
      fail(
        'STATE_BUSY',
        'The lease registry lock was replaced by another process; refusing to delete a lock this process does not own',
        sourceMayHaveChanged,
      );
    }
    try {
      fs.unlinkSync(lockPath);
    } catch (error) {
      fail(
        'STATE_BUSY',
        `Unable to remove the lease registry lock: ${errorCode(error) ?? 'unlink failure'}`,
        sourceMayHaveChanged,
      );
    }
  }
}
