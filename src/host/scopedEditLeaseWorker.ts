/**
 * Cross-process fixture helper for NodeScopedEdits.test.ts. Forked as a
 * separate OS process so the "real concurrent processes cannot acquire the
 * same scope" case exercises actual process-level lock contention instead of
 * two acquisitions racing inside the same event loop.
 *
 * Invoked as: node scopedEditLeaseWorker.js <stateDirectory> <codeRoot> <owner> <jsonPaths>
 * Protocol: parent sends the string "go"; this process replies with a
 * { kind: "ready" | "result", ... } message over IPC and then disconnects.
 */
import { NodeScopedEdits, ScopedEditError } from './NodeScopedEdits';

interface WorkerResult {
  readonly kind: 'result';
  readonly ok: boolean;
  readonly id?: string;
  readonly error?: string;
  /**
   * The contractual error code (ScopedEditError#code), carried across the
   * IPC boundary so the parent test can assert on the actual code rather
   * than pattern-matching the free-form message string.
   */
  readonly code?: string;
  readonly pid: number;
}

interface WorkerReady {
  readonly kind: 'ready';
  readonly pid: number;
}

const [stateDirectory, codeRoot, owner, serializedPaths] = process.argv.slice(2);

function send(message: WorkerReady | WorkerResult): void {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

/**
 * Native structural guard for a string-valued `code` property, built only
 * from `typeof`/`in`/`Reflect.get` narrowing (no `as` casts, no suppression
 * comments, no stand-in for the still-absent ScopedEditError type). Because
 * the planned module cannot yet be resolved, the imported ScopedEditError
 * binding carries no real static shape, so `instanceof` alone cannot narrow
 * `error` for a safe `.code` read; this guard supplies that narrowing at the
 * IPC boundary while the `instanceof ScopedEditError` runtime check below is
 * still evaluated and required.
 */
function hasStringCode(value: unknown): value is { code: string } {
  return typeof value === 'object' && value !== null && 'code' in value
    && typeof Reflect.get(value, 'code') === 'string';
}

process.once('message', (message: unknown) => {
  if (message !== 'go') {
    throw new Error('Unexpected worker message');
  }
  try {
    const service = new NodeScopedEdits(stateDirectory, codeRoot);
    const paths = JSON.parse(serializedPaths) as readonly string[];
    const lease = service.acquire(owner, paths);
    send({ kind: 'result', ok: true, id: lease.id, pid: process.pid });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const code = error instanceof ScopedEditError && hasStringCode(error) ? error.code : undefined;
    send({ kind: 'result', ok: false, error: reason, code, pid: process.pid });
  }
  process.disconnect();
});

send({ kind: 'ready', pid: process.pid });
