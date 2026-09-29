export interface FileLockOptions {
  /** Maximum time to wait for the lock before failing, in milliseconds. */
  timeoutMs?: number;
  /** Age after which an existing lock file is treated as abandoned, in milliseconds. */
  staleMs?: number;
}

/**
 * File primitives for data that must survive partial writes, stay owner-only on
 * POSIX hosts, and be serialized across cooperating processes.
 */
export interface ISecureStore {
  /** Returns the file content, or undefined when the file does not exist. */
  readSecureText(filePath: string): string | undefined;
  /** Replaces the file atomically, creating parents with owner-only permissions. */
  writeSecureText(filePath: string, content: string): void;
  /** Runs the operation while holding an exclusive cross-process lock. */
  withFileLock<T>(lockPath: string, operation: () => T, options?: FileLockOptions): T;
}

export const DEFAULT_LOCK_TIMEOUT_MS = 5000;
export const DEFAULT_STALE_LOCK_MS = 30000;
