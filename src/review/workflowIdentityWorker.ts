/**
 * Cross-process fixture helper for NodeWorkflowIdentities.test.ts. Forked as a
 * separate OS process so the "two real processes race registerTask against
 * the same expectedRegistryDigest" case exercises actual process-level mutex
 * contention over the real tasks.yml.lock and workflow-identities.json.lock
 * files, instead of two acquisitions racing inside the same event loop.
 *
 * Invoked as:
 *   node workflowIdentityWorker.js <workspaceRoot> <taskId> <expectedRegistryDigest>
 *
 * Protocol: parent sends the string "go"; this process replies with a
 * { kind: "ready" | "result", ... } message over IPC and then disconnects.
 */
import { NodeWorkflowIdentities, WorkflowIdentityError } from './NodeWorkflowIdentities';

interface WorkerResult {
  readonly kind: 'result';
  readonly ok: boolean;
  readonly taskId?: string;
  readonly createdAt?: string;
  readonly incarnation?: string;
  readonly registryDigest?: string;
  readonly taskDigest?: string;
  readonly error?: string;
  /**
   * The contractual error code (WorkflowIdentityError#code), carried across
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

const [workspaceRoot, taskId, expectedRegistryDigest] = process.argv.slice(2);

function send(message: WorkerReady | WorkerResult): void {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

/**
 * Native structural guards for string/boolean-valued properties, built only
 * from `typeof`/`in`/`Reflect.get` narrowing (no `as` casts, no suppression
 * comments, no stand-in for the still-absent WorkflowIdentityError type).
 * Because the planned module cannot yet be resolved, the imported
 * WorkflowIdentityError binding carries no real static shape, so `instanceof`
 * alone cannot narrow `error` for a safe `.code`/`.commitMayHaveChanged`
 * read; these guards supply that narrowing at the IPC boundary while the
 * `instanceof WorkflowIdentityError` runtime check below is still evaluated
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
    const identities = new NodeWorkflowIdentities(workspaceRoot);
    const context = identities.registerTask(taskId, expectedRegistryDigest);
    send({
      kind: 'result',
      ok: true,
      taskId: context.taskId,
      createdAt: context.createdAt,
      incarnation: context.incarnation,
      registryDigest: context.registryDigest,
      taskDigest: context.taskDigest,
      pid: process.pid,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const code = error instanceof WorkflowIdentityError && hasStringCode(error) ? error.code : undefined;
    const commitMayHaveChanged = error instanceof WorkflowIdentityError && hasBooleanCommitFlag(error)
      ? error.commitMayHaveChanged
      : undefined;
    send({ kind: 'result', ok: false, error: reason, code, commitMayHaveChanged, pid: process.pid });
  }
  process.disconnect();
});

send({ kind: 'ready', pid: process.pid });
