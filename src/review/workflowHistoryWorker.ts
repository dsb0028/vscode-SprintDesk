/**
 * Cross-process fixture helper for NodeWorkflowHistory.test.ts. Forked as a
 * separate OS process so the "two real processes race an append against the
 * same expectedLatest" case exercises actual process-level mutex contention
 * instead of two acquisitions racing inside the same event loop.
 *
 * Invoked as:
 *   node workflowHistoryWorker.js <directory> <projectId> <taskId> <incarnation> <appendRequestJson>
 * where <appendRequestJson> is a JSON-encoded WorkerAppendRequest (bytes carried as base64).
 *
 * Protocol: parent sends the string "go"; this process replies with a
 * { kind: "ready" | "result", ... } message over IPC and then disconnects.
 */
import { NodeWorkflowHistory, WorkflowHistoryError, HistoryArtifactKind } from './NodeWorkflowHistory';
import { WorkflowBinding } from './workflowBinding';

interface WorkerAppendRequest {
  readonly operationId: string;
  readonly expectedLatest: number;
  readonly binding: WorkflowBinding;
  readonly kind: HistoryArtifactKind;
  readonly bytesBase64: string;
}

interface WorkerResult {
  readonly kind: 'result';
  readonly ok: boolean;
  readonly sequence?: number;
  readonly digest?: string;
  readonly revisionDigest?: string;
  readonly error?: string;
  /**
   * The contractual error code (WorkflowHistoryError#code), carried across
   * the IPC boundary so the parent test can assert on the actual code
   * rather than pattern-matching the free-form message string.
   */
  readonly code?: string;
  readonly commitMayHaveChanged?: boolean;
  readonly pid: number;
}

interface WorkerReady {
  readonly kind: 'ready';
  readonly pid: number;
}

const [directory, projectId, taskId, incarnation, serializedAppend] = process.argv.slice(2);

function send(message: WorkerReady | WorkerResult): void {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

/**
 * Native structural guards for string/boolean-valued properties, built only
 * from `typeof`/`in`/`Reflect.get` narrowing (no `as` casts, no suppression
 * comments, no stand-in for the still-absent WorkflowHistoryError type).
 * Because the planned module cannot yet be resolved, the imported
 * WorkflowHistoryError binding carries no real static shape, so `instanceof`
 * alone cannot narrow `error` for a safe `.code`/`.commitMayHaveChanged`
 * read; these guards supply that narrowing at the IPC boundary while the
 * `instanceof WorkflowHistoryError` runtime check below is still evaluated
 * and required.
 */
function hasStringCode(value: unknown): value is { code: string } {
  return typeof value === 'object' && value !== null && 'code' in value
    && typeof Reflect.get(value, 'code') === 'string';
}

function hasBooleanCommitFlag(value: unknown): value is { commitMayHaveChanged: boolean } {
  return typeof value === 'object' && value !== null && 'commitMayHaveChanged' in value
    && typeof Reflect.get(value, 'commitMayHaveChanged') === 'boolean';
}

process.once('message', (message: unknown) => {
  if (message !== 'go') {
    throw new Error('Unexpected worker message');
  }
  try {
    const history = new NodeWorkflowHistory(directory, { projectId, taskId, incarnation });
    const parsed = JSON.parse(serializedAppend) as WorkerAppendRequest;
    const revision = history.append({
      operationId: parsed.operationId,
      expectedLatest: parsed.expectedLatest,
      binding: parsed.binding,
      kind: parsed.kind,
      bytes: Uint8Array.from(Buffer.from(parsed.bytesBase64, 'base64')),
    });
    send({
      kind: 'result', ok: true, sequence: revision.sequence,
      digest: revision.digest, revisionDigest: revision.revisionDigest, pid: process.pid,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const code = error instanceof WorkflowHistoryError && hasStringCode(error) ? error.code : undefined;
    const commitMayHaveChanged = error instanceof WorkflowHistoryError && hasBooleanCommitFlag(error)
      ? error.commitMayHaveChanged
      : undefined;
    send({ kind: 'result', ok: false, error: reason, code, commitMayHaveChanged, pid: process.pid });
  }
  process.disconnect();
});

send({ kind: 'ready', pid: process.pid });
