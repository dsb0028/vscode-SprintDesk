/**
 * Cross-process fixture helper for NodeTaskWorkflowHistory.test.ts. Forked as a
 * separate OS process so the "two real processes race an append against the
 * same task-bound custody ledger" case exercises actual process-level mutex
 * contention over the real `.SprintDesk/data/tasks.yml.lock` file, instead of
 * two acquisitions racing inside the same event loop.
 *
 * Invoked as:
 *   node taskWorkflowHistoryWorker.js <workspaceRoot> <taskId> <appendRequestJson>
 * where <appendRequestJson> is a JSON-encoded WorkerAppendRequest (bytes
 * carried as base64).
 *
 * Protocol: parent sends the string "go"; this process replies with a
 * { kind: "ready" | "result", ... } message over IPC and then disconnects.
 *
 * The authority used here is a trivial always-allow stand-in, explicitly
 * SYNTHETIC: it is never evidence of real human approval, host capture, or
 * operational workflow authority -- see contract.json "trust_boundary". It
 * exists solely so this worker can reach the mutation path under test.
 */
import { NodeTaskWorkflowHistory, WorkflowCustodyError, WorkflowMutationAuthority } from './NodeTaskWorkflowHistory';
import { WorkflowBinding } from './workflowBinding';
import { HistoryArtifactKind } from './NodeWorkflowHistory';

interface WorkerAppendRequest {
  readonly operationId: string;
  readonly expectedLatest: number;
  readonly binding: WorkflowBinding;
  readonly artifactKind: HistoryArtifactKind;
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
   * The contractual error code (WorkflowCustodyError#code), carried across
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

const [workspaceRoot, taskId, serializedAppend] = process.argv.slice(2);

function send(message: WorkerReady | WorkerResult): void {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

/**
 * SYNTHETIC always-allow authority. Explicitly not a human approval, a
 * signed reviewer receipt, or any real host-execution/plan/phase authority
 * -- see contract.json "trust_boundary". It exists only so this worker's
 * concurrency fixture can reach the task-lock-guarded mutation path at all.
 */
class SyntheticAlwaysAllowAuthority implements WorkflowMutationAuthority {
  assertAllowed(): void {
    // SYNTHETIC: unconditionally allows. Never a stand-in for real consent.
  }
}

/**
 * Native structural guards for string/boolean-valued properties, built only
 * from `typeof`/`in`/`Reflect.get` narrowing (no `as` casts, no suppression
 * comments, no stand-in for the still-absent WorkflowCustodyError type).
 * Because the planned module cannot yet be resolved, the imported
 * WorkflowCustodyError binding carries no real static shape, so `instanceof`
 * alone cannot narrow `error` for a safe `.code`/`.commitMayHaveChanged`
 * read; these guards supply that narrowing at the IPC boundary while the
 * `instanceof WorkflowCustodyError` runtime check below is still evaluated
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
    const authority = new SyntheticAlwaysAllowAuthority();
    const history = new NodeTaskWorkflowHistory(workspaceRoot, taskId, authority);
    const expected = history.context();
    const parsed = JSON.parse(serializedAppend) as WorkerAppendRequest;
    const revision = history.append(expected, {
      operationId: parsed.operationId,
      expectedLatest: parsed.expectedLatest,
      binding: parsed.binding,
      kind: parsed.artifactKind,
      bytes: Uint8Array.from(Buffer.from(parsed.bytesBase64, 'base64')),
    });
    send({
      kind: 'result', ok: true, sequence: revision.sequence,
      digest: revision.digest, revisionDigest: revision.revisionDigest, pid: process.pid,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const code = error instanceof WorkflowCustodyError && hasStringCode(error) ? error.code : undefined;
    const commitMayHaveChanged = error instanceof WorkflowCustodyError && hasBooleanCommitFlag(error)
      ? error.commitMayHaveChanged
      : undefined;
    send({ kind: 'result', ok: false, error: reason, code, commitMayHaveChanged, pid: process.pid });
  }
  process.disconnect();
});

send({ kind: 'ready', pid: process.pid });
