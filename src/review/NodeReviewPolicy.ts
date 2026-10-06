/**
 * Read-only, per-project loader for `.SprintDesk/settings/review-thresholds.yml`. The
 * constructor validates workspace/project identity eagerly; this validation does perform real,
 * read-only filesystem access (`lstat`/`realpath` calls to confirm the workspace root exists,
 * is a canonical directory, and is not reached through any symlinked path component, including
 * ancestor directories), but it never creates, initializes, writes, or `chmod`s anything.
 * `read()` performs a single bounded, nonblocking, descriptor-safe read of a confirmed regular
 * file and returns the exact-byte SHA256 digest of what was parsed. Digest equality is not
 * authenticity or approval, and no immutable task snapshot is created here. This loader never
 * creates, initializes, or chmods any file, and never reads or initializes a live `.SprintDesk`
 * policy outside of tests.
 */

import * as fs from 'fs';
import { isAbsolute, join, normalize, sep } from 'path';
import { createHash } from 'crypto';
import { ReviewPolicy, ReviewPolicyError, REVIEW_POLICY_MAX_BYTES, parseReviewPolicy } from './reviewPolicy';

export interface ReviewPolicyReadResult {
  readonly projectId: string;
  readonly workspaceRoot: string;
  readonly filePath: string;
  readonly digest: string;
  readonly policy: ReviewPolicy;
}

interface IdentitySnapshot {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
}

function snapshotOf(stats: fs.Stats): IdentitySnapshot {
  return { dev: stats.dev, ino: stats.ino, size: stats.size, mtimeMs: stats.mtimeMs };
}

function sameIdentity(a: IdentitySnapshot, b: IdentitySnapshot): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function contextInvalid(projectId: string, workspaceRoot: string, reason: string): never {
  throw new ReviewPolicyError({
    code: 'POLICY_CONTEXT_INVALID',
    message: reason,
    operation: 'context',
    correctiveAction: 'Supply an existing absolute canonical workspace directory and a nonblank project identifier.',
    projectId: typeof projectId === 'string' ? projectId : '',
    filePath: typeof workspaceRoot === 'string' ? workspaceRoot : '',
  });
}

function fileMissing(projectId: string, filePath: string): never {
  throw new ReviewPolicyError({
    code: 'POLICY_FILE_MISSING',
    message: 'The review policy file does not exist.',
    operation: 'read',
    correctiveAction: 'Create the review policy file at the expected location before retrying.',
    projectId,
    filePath,
  });
}

function unreadable(projectId: string, filePath: string): never {
  throw new ReviewPolicyError({
    code: 'POLICY_UNREADABLE',
    message: 'The review policy file could not be read.',
    operation: 'read',
    correctiveAction: 'Verify file permissions and I/O availability for the review policy file, then retry.',
    projectId,
    filePath,
  });
}

function pathInvalid(projectId: string, filePath: string, reason: string): never {
  throw new ReviewPolicyError({
    code: 'POLICY_PATH_INVALID',
    message: reason,
    operation: 'read',
    correctiveAction: 'Replace the symlink, FIFO, directory, or other non-regular path component with plain directories and a regular file.',
    projectId,
    filePath,
  });
}

function encodingInvalid(projectId: string, filePath: string): never {
  throw new ReviewPolicyError({
    code: 'POLICY_ENCODING_INVALID',
    message: 'The review policy file does not contain valid UTF-8 text.',
    operation: 'read',
    correctiveAction: 'Save the review policy file using valid UTF-8 encoding.',
    projectId,
    filePath,
  });
}

function tooLarge(projectId: string, filePath: string): never {
  throw new ReviewPolicyError({
    code: 'POLICY_TOO_LARGE',
    message: `The review policy file exceeds the maximum allowed size of ${REVIEW_POLICY_MAX_BYTES} bytes.`,
    operation: 'read',
    correctiveAction: `Reduce the review policy file to at most ${REVIEW_POLICY_MAX_BYTES} bytes.`,
    projectId,
    filePath,
  });
}

function policyChanged(projectId: string, filePath: string): never {
  throw new ReviewPolicyError({
    code: 'POLICY_CHANGED',
    message: 'The review policy file changed while it was being read.',
    operation: 'read',
    correctiveAction: 'Reread the review policy file after the concurrent modification has settled.',
    projectId,
    filePath,
  });
}

/**
 * Decodes UTF-8 strictly: Node's default `Buffer#toString('utf8')` silently substitutes invalid
 * byte sequences with U+FFFD rather than throwing, so validity is instead confirmed by
 * re-encoding the decoded text and comparing it byte-for-byte against the original input.
 */
function decodeStrictUtf8(raw: Buffer): string | undefined {
  const text = raw.toString('utf8');
  const roundTrip = Buffer.from(text, 'utf8');
  if (!roundTrip.equals(raw)) {
    return undefined;
  }
  return text;
}

export class NodeReviewPolicy {
  private readonly workspaceRoot: string;
  private readonly projectId: string;
  private readonly filePath: string;

  constructor(workspaceRoot: string, projectId: string) {
    if (typeof projectId !== 'string' || projectId.trim().length === 0) {
      contextInvalid(projectId, workspaceRoot, 'NodeReviewPolicy requires a nonblank projectId.');
    }
    if (typeof workspaceRoot !== 'string' || !isAbsolute(workspaceRoot)) {
      contextInvalid(projectId, workspaceRoot, 'NodeReviewPolicy requires an absolute workspaceRoot path.');
    }

    let canonicalRoot: string;
    try {
      canonicalRoot = normalize(workspaceRoot);
    } catch {
      contextInvalid(projectId, workspaceRoot, 'The workspace root could not be normalized.');
    }
    if (canonicalRoot !== workspaceRoot) {
      contextInvalid(projectId, workspaceRoot,
        'The workspace root must be an already-normalized directory path with no "." or ".." segments.');
    }

    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(workspaceRoot);
    } catch {
      contextInvalid(projectId, workspaceRoot, 'The workspace root could not be inspected.');
    }
    if (stats.isSymbolicLink()) {
      contextInvalid(projectId, workspaceRoot, 'The workspace root must not be a symlink.');
    }
    if (!stats.isDirectory()) {
      contextInvalid(projectId, workspaceRoot, 'The workspace root must be a directory.');
    }

    // `lstat` on the workspace root alone only reports whether the final path component itself
    // is a symlink: every path component *before* the final one is transparently resolved by
    // the operating system, so a workspace root reached through a symlinked ancestor directory
    // (e.g. `/alias/workspace` where `/alias` -> `/real-container`) would otherwise pass the
    // checks above while silently resolving into a different directory than its literal path
    // states. Comparing against `realpath` (itself a read-only resolution, not a mutation)
    // detects any symlink anywhere in the chain, including ancestors, and rejects it eagerly
    // here in the constructor rather than allowing it to resolve into an unintended project.
    let canonicalReal: string;
    try {
      canonicalReal = fs.realpathSync(workspaceRoot);
    } catch {
      contextInvalid(projectId, workspaceRoot, 'The workspace root could not be resolved.');
    }
    if (canonicalReal !== workspaceRoot) {
      contextInvalid(projectId, workspaceRoot,
        'The workspace root must not traverse any symlinked ancestor directory.');
    }

    this.workspaceRoot = workspaceRoot;
    this.projectId = projectId;
    this.filePath = join(workspaceRoot, '.SprintDesk', 'settings', 'review-thresholds.yml');
  }

  /**
   * Walks the workspace root and then each path component down to the policy file using
   * `lstat` only (never `open`), rejecting a symlinked workspace root, symlinked intermediate
   * directories, non-directory intermediates, and any final target that is not a plain regular
   * file (symlink, directory, FIFO, device, etc.). `lstat` never blocks regardless of file
   * type, so a FIFO at the final path is rejected here before any blocking `open` is ever
   * attempted.
   */
  private walkRegularFileChain(): fs.Stats {
    let rootStats: fs.Stats;
    try {
      rootStats = fs.lstatSync(this.workspaceRoot);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        fileMissing(this.projectId, this.filePath);
      }
      unreadable(this.projectId, this.filePath);
    }
    if (rootStats.isSymbolicLink()) {
      pathInvalid(this.projectId, this.filePath, 'The workspace root must not be a symlink.');
    }
    if (!rootStats.isDirectory()) {
      pathInvalid(this.projectId, this.filePath, 'The workspace root must be a directory.');
    }

    const relative = this.filePath.slice(this.workspaceRoot.length).split(sep).filter(part => part.length > 0);
    let current = this.workspaceRoot;
    let lastStats: fs.Stats = rootStats;
    for (let index = 0; index < relative.length; index += 1) {
      current = join(current, relative[index]);
      const isLast = index === relative.length - 1;
      let stats: fs.Stats;
      try {
        stats = fs.lstatSync(current);
      } catch (error) {
        if (isErrnoException(error) && error.code === 'ENOENT') {
          fileMissing(this.projectId, this.filePath);
        }
        unreadable(this.projectId, this.filePath);
      }
      if (stats.isSymbolicLink()) {
        pathInvalid(this.projectId, this.filePath, 'A symlinked path component was found where a plain directory or file was expected.');
      }
      if (!isLast && !stats.isDirectory()) {
        pathInvalid(this.projectId, this.filePath, 'A non-directory path component was found where a directory was expected.');
      }
      if (isLast && !stats.isFile()) {
        pathInvalid(this.projectId, this.filePath, 'The review policy path is not a plain regular file.');
      }
      lastStats = stats;
    }
    return lastStats;
  }

  read(): ReviewPolicyReadResult {
    const preStats = snapshotOf(this.walkRegularFileChain());

    let fd: number;
    try {
      fd = fs.openSync(this.filePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        fileMissing(this.projectId, this.filePath);
      }
      unreadable(this.projectId, this.filePath);
    }

    try {
      const openStats = fs.fstatSync(fd);
      if (!openStats.isFile()) {
        pathInvalid(this.projectId, this.filePath, 'The review policy path is not a plain regular file.');
      }

      const buffer = Buffer.alloc(REVIEW_POLICY_MAX_BYTES + 1);
      let totalRead = 0;
      while (totalRead < buffer.length) {
        let bytesRead: number;
        try {
          bytesRead = fs.readSync(fd, buffer, totalRead, buffer.length - totalRead, totalRead);
        } catch (error) {
          if (isErrnoException(error) && (error.code === 'EAGAIN' || error.code === 'EWOULDBLOCK')) {
            break;
          }
          unreadable(this.projectId, this.filePath);
        }
        if (bytesRead === 0) {
          break;
        }
        totalRead += bytesRead;
      }

      const readbackStats = fs.fstatSync(fd);
      const openSnapshot = snapshotOf(openStats);
      const readbackSnapshot = snapshotOf(readbackStats);
      if (!sameIdentity(preStats, openSnapshot) || !sameIdentity(openSnapshot, readbackSnapshot)) {
        policyChanged(this.projectId, this.filePath);
      }

      if (totalRead > REVIEW_POLICY_MAX_BYTES) {
        tooLarge(this.projectId, this.filePath);
      }

      const raw = buffer.subarray(0, totalRead);
      const text = decodeStrictUtf8(raw);
      if (text === undefined) {
        encodingInvalid(this.projectId, this.filePath);
      }

      const digest = createHash('sha256').update(raw).digest('hex');
      const policy = parseReviewPolicy(text, { projectId: this.projectId, filePath: this.filePath });

      return Object.freeze({
        projectId: this.projectId,
        workspaceRoot: this.workspaceRoot,
        filePath: this.filePath,
        digest,
        policy,
      });
    } finally {
      fs.closeSync(fd);
    }
  }
}
