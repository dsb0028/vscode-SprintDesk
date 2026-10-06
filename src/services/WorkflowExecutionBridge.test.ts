/**
 * Test-first Red-phase coverage for the planned WorkflowExecutionBridge
 * module (contract.json "authority_api" -> src/services/WorkflowExecutionBridge.ts,
 * not yet implemented, production_phase_approved: false). This file
 * intentionally imports modules that do not exist yet (WorkflowExecutionBridge
 * and the WorkflowSessionClient/WorkflowSessionState/WorkflowHostError types
 * from the sibling CopilotAcpSession increment); until separately-approved
 * production increments add them, the whole suite is expected to fail to
 * *compile*, not merely fail at runtime. That compiler Red is the authorized
 * outcome of this increment (contract.json "reporting" -> "baseline").
 *
 * Scope reminder (contract.json "authority_api"/"trust_boundary"): this
 * bridge is execution-permission ONLY, never a human plan approval, signed
 * acceptance, or completion. Every WorkflowSessionClient and
 * WorkflowExecutionUi implementation below is a narrow, explicitly labelled
 * SYNTHETIC test fixture: it never is, proves, or substitutes for a real
 * human approval, real VS Code modal response, or real ACP transport. The
 * real transport is independently exercised (as a real spawned process) in
 * CopilotAcpSession.test.ts; this file focuses on the authority/UI/grant
 * boundary against a REAL NodeTaskWorkflowHistory + NodeWorkflowIdentities
 * registry/task fixture, mirroring the already-tested conventions in
 * src/review/NodeTaskWorkflowHistory.test.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import yaml from 'js-yaml';
import {
  WorkflowBridgeError, WorkflowExecutionBridge, WorkflowExecutionConfirmation, WorkflowExecutionUi,
} from './WorkflowExecutionBridge';
import { WorkflowHostError, WorkflowSessionClient, WorkflowSessionMode, WorkflowSessionState } from './CopilotAcpSession';
import {
  NodeTaskWorkflowHistory, WorkflowCustodyError, WorkflowCustodyOperation, WorkflowMutationRequest,
} from '../review/NodeTaskWorkflowHistory';
import { HistoryAppend, HistoryArtifactKind, WorkflowHistoryError } from '../review/NodeWorkflowHistory';
import { NodeWorkflowIdentities, WorkflowTaskContext } from '../review/NodeWorkflowIdentities';
import { WorkflowBinding } from '../review/workflowBinding';
import { digest as protocolDigest } from '../review/protocol';
import { Task, TaskStatus } from '../data/types';

// ---------------------------------------------------------------------------
// Real, isolated synthetic task/registry fixture (mirrors
// src/review/NodeTaskWorkflowHistory.test.ts's already-tested conventions).
// ---------------------------------------------------------------------------

interface Fixture {
  readonly base: string;
  readonly workspaceRoot: string;
  readonly dataDir: string;
  readonly tasksPath: string;
}

function createFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), 'workflow-execution-bridge-'));
  const workspaceRoot = join(base, 'workspace');
  mkdirSync(workspaceRoot, { mode: 0o700 });
  const dataDir = join(workspaceRoot, '.SprintDesk', 'data');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return { base, workspaceRoot, dataDir, tasksPath: join(dataDir, 'tasks.yml') };
}

function withFixture(run: (f: Fixture) => Promise<void>): Promise<void> {
  const f = createFixture();
  return (async () => {
    try {
      await run(f);
    } finally {
      rmSync(f.base, { recursive: true, force: true });
    }
  })();
}

function buildTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), number: 1, code: 'SPD-1', name: 'Sample Task', title: 'Sample Task',
    type: 'feature', status: 'in-progress', priority: 'medium', epic: null, backlog: 'features',
    sprint: null, createdAt: now, updatedAt: now, ...overrides,
  };
}

function writeTasksYaml(f: Fixture, tasks: Task[]): void {
  writeFileSync(f.tasksPath, yaml.dump({ tasks }), 'utf8');
}

function registerTask(f: Fixture, overrides: Partial<Task> = {}): { task: Task; context: WorkflowTaskContext } {
  const task = buildTask(overrides);
  writeTasksYaml(f, [task]);
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  const context = identities.registerTask(task.id, snapshot.digest);
  return { task, context };
}

function rewriteTaskTitle(f: Fixture, task: Task, title: string): void {
  writeTasksYaml(f, [{ ...task, title }]);
}

function rewriteTaskStatus(f: Fixture, task: Task, status: TaskStatus): void {
  writeTasksYaml(f, [{ ...task, status }]);
}

/** Rewrites tasks.yml for the exact same task id, drifting only createdAt -- this is a TASK_REPLACED-shaped drift at the identities layer, distinct from an ordinary seven-field context mismatch. */
function rewriteTaskCreatedAt(f: Fixture, task: Task, createdAt: string): void {
  writeTasksYaml(f, [{ ...task, createdAt }]);
}

/** Registers a second, wholly unrelated in-progress task against the same registry, changing registryDigest for every existing context without touching the original task's own fields. Mirrors src/review/NodeTaskWorkflowHistory.test.ts's registerSecondUnrelatedTask. */
function registerUnrelatedTask(f: Fixture): void {
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const second = buildTask({ status: 'in-progress' });
  const current = identities.read();
  const existingTasks = (yaml.load(readFileSync(f.tasksPath, 'utf8')) as { tasks: Task[] }).tasks;
  writeTasksYaml(f, [...existingTasks, second]);
  identities.registerTask(second.id, current.digest);
}

/** Builds a real, valid 'append' WorkflowCustodyOperation bound to the given context, exercising the second WorkflowCustodyOperation variant alongside the 'initialize' one used elsewhere in this file. */
function buildAppendOperation(context: WorkflowTaskContext, overrides: Partial<WorkflowBinding> = {}): WorkflowCustodyOperation {
  const binding: WorkflowBinding = {
    version: 1,
    stage: 'planning',
    projectId: context.projectId,
    taskId: context.taskId,
    incarnation: context.incarnation,
    criterionId: 'criterion-1',
    criterionRevision: 'rev-1',
    sourceRevision: 'source-rev-1',
    sourceDigest: protocolDigest({ source: 'fixture-source-content' }),
    policyDigest: protocolDigest({ policy: 'fixture-policy' }),
    attemptId: 'attempt-1',
    ...overrides,
  };
  return {
    kind: 'append',
    operationId: randomUUID(),
    expectedLatest: 0,
    binding,
    artifactKind: 'scenario' as HistoryArtifactKind,
    contentDigest: protocolDigest({ content: 'fixture-append-bytes' }),
  };
}

/** Real sha256 hex digest of real bytes, mirroring NodeTaskWorkflowHistory/NodeWorkflowHistory's own internal convention. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

/** Builds a real, valid WorkflowBinding canonically derived from the given context, reused by every real append test below. */
function buildCanonicalAppendBinding(context: WorkflowTaskContext, overrides: Partial<WorkflowBinding> = {}): WorkflowBinding {
  return {
    version: 1,
    stage: 'planning',
    projectId: context.projectId,
    taskId: context.taskId,
    incarnation: context.incarnation,
    criterionId: 'criterion-1',
    criterionRevision: 'rev-1',
    sourceRevision: 'source-rev-1',
    sourceDigest: protocolDigest({ source: 'fixture-source-content' }),
    policyDigest: protocolDigest({ policy: 'fixture-policy' }),
    attemptId: 'attempt-1',
    ...overrides,
  };
}

/** A minimal, explicitly labelled SYNTHETIC writer whose every write fails, modelling a downstream (post-authority) storage failure. It is never a model of real disk/host behavior. */
class SyntheticFailingWriter {
  writeSecureText(): void {
    throw new Error('synthetic-downstream-write-failure-should-not-leak');
  }
}

/**
 * A SYNTHETIC WorkflowSessionClient wrapper that invokes a caller-supplied
 * side effect exactly when the wrapped client's setMode() transitions INTO
 * Agent mode. This models (only for this increment's test coverage) a drift
 * occurring in the narrow window between UI approval and the bridge's own
 * Plan->Agent transition/final recheck -- never a model of real host
 * capture or legitimate session behavior.
 */
class SyntheticAgentTransitionDriftingClient implements WorkflowSessionClient {
  constructor(private readonly inner: SyntheticSessionClient, private readonly onAgentTransition: () => void) {}

  async start(): Promise<WorkflowSessionState> {
    return this.inner.start();
  }

  async setMode(mode: WorkflowSessionMode): Promise<WorkflowSessionState> {
    const next = await this.inner.setMode(mode);
    if (mode === 'agent') {
      this.onAgentTransition();
    }
    return next;
  }

  state(): WorkflowSessionState {
    return this.inner.state();
  }

  cancel(): void {
    this.inner.cancel();
  }

  async close(): Promise<void> {
    return this.inner.close();
  }

  dispose(): void {
    this.inner.dispose();
  }

  onStateChanged(listener: (state: WorkflowSessionState) => void): { dispose(): void } {
    return this.inner.onStateChanged(listener);
  }
}


// ---------------------------------------------------------------------------
// SYNTHETIC WorkflowSessionClient double. Real transport correctness is
// covered against a real spawned process in CopilotAcpSession.test.ts; this
// in-memory double exists only to deterministically drive session/epoch
// drift scenarios for the bridge/authority boundary under test here.
// ---------------------------------------------------------------------------

class SyntheticSessionClient implements WorkflowSessionClient {
  private connected = true;
  private sessionId: string | null = null;
  private mode: WorkflowSessionMode | null = null;
  private epoch = 0;
  public readonly setModeCalls: WorkflowSessionMode[] = [];
  public readonly listeners: Array<(state: WorkflowSessionState) => void> = [];

  async start(): Promise<WorkflowSessionState> {
    this.sessionId = randomUUID();
    this.mode = 'agent';
    this.epoch = 1;
    return this.state();
  }

  async setMode(mode: WorkflowSessionMode): Promise<WorkflowSessionState> {
    this.setModeCalls.push(mode);
    if (!this.connected) {
      throw new WorkflowHostError('HOST_DISCONNECTED', 'synthetic client is disconnected');
    }
    this.mode = mode;
    this.epoch += 1;
    const next = this.state();
    this.listeners.forEach((listener) => listener(next));
    return next;
  }

  state(): WorkflowSessionState {
    return {
      connected: this.connected, sessionId: this.sessionId, mode: this.mode, epoch: this.epoch,
    };
  }

  cancel(): void { /* no-op double */ }

  async close(): Promise<void> {
    this.connected = false;
  }

  dispose(): void {
    this.connected = false;
  }

  onStateChanged(listener: (state: WorkflowSessionState) => void): { dispose(): void } {
    this.listeners.push(listener);
    return { dispose: () => { /* synthetic double keeps it simple: no removal needed per test lifetime */ } };
  }

  /** Test-only hook: simulates a native epoch/mode drift occurring independently of the bridge. */
  simulateForeignDrift(): void {
    this.epoch += 1;
    const next = this.state();
    this.listeners.forEach((listener) => listener(next));
  }
}

// ---------------------------------------------------------------------------
// SYNTHETIC WorkflowExecutionUi doubles. Per contract.json "authority_api":
// "Tests may use explicitly synthetic UI callbacks, never claiming real
// human consent." None of these are, or stand in for, a real VS Code modal
// or an actual human decision.
// ---------------------------------------------------------------------------

class SyntheticApprovingUi implements WorkflowExecutionUi {
  public readonly seen: WorkflowExecutionConfirmation[] = [];

  async confirmExecution(request: WorkflowExecutionConfirmation): Promise<'approve' | 'cancel'> {
    this.seen.push(request);
    return 'approve';
  }
}

class SyntheticCancellingUi implements WorkflowExecutionUi {
  async confirmExecution(): Promise<'approve' | 'cancel'> {
    return 'cancel';
  }
}

class SyntheticInvalidUi implements WorkflowExecutionUi {
  async confirmExecution(): Promise<'approve' | 'cancel'> {
    // Deliberately returns a value outside the documented union to prove the
    // bridge never treats an invalid UI result as approval.
    return 'approve-ish' as unknown as 'approve';
  }
}

class SyntheticPendingUi implements WorkflowExecutionUi {
  private resolver: ((value: 'approve' | 'cancel') => void) | null = null;
  public readonly seen: WorkflowExecutionConfirmation[] = [];

  confirmExecution(request: WorkflowExecutionConfirmation): Promise<'approve' | 'cancel'> {
    this.seen.push(request);
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  resolvePending(value: 'approve' | 'cancel'): void {
    this.resolver?.(value);
  }
}

function initializeOperation(): WorkflowCustodyOperation {
  return { kind: 'initialize' };
}

test('start() creates its own managed session and verifies Plan mode, independent of any foreground session', async () => {
  await withFixture(async (f) => {
    const { task } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticApprovingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    const state = await bridge.start();
    assert.equal(state.mode, 'plan');
    assert.deepEqual(client.setModeCalls, ['plan']);
  });
});

test('requestApproval presents an immutable copy of the full context/operation/digest and grants a one-shot execution permission on approval', async () => {
  await withFixture(async (f) => {
    const { task, context } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticApprovingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();

    const outcome = await bridge.requestApproval(initializeOperation());
    assert.equal(outcome, 'approved');
    assert.equal(ui.seen.length, 1);

    const confirmation = ui.seen[0];
    assert.equal(confirmation.version, 1);
    assert.equal(confirmation.context.taskId, context.taskId);
    assert.equal(confirmation.operation.kind, 'initialize');
    assert.equal(typeof confirmation.requestDigest, 'string');
    assert.ok(Object.isFrozen(confirmation), 'the confirmation handed to the UI must be an immutable copy');
    assert.ok(Object.isFrozen(confirmation.context), 'the context copy must be immutable');
    assert.ok(Object.isFrozen(confirmation.operation), 'the operation copy must be immutable');

    const recomputedDigest = protocolDigest({
      version: confirmation.version,
      sessionId: confirmation.sessionId,
      nativeMode: confirmation.nativeMode,
      context: confirmation.context,
      operation: confirmation.operation,
    });
    assert.equal(
      recomputedDigest, confirmation.requestDigest,
      'requestDigest must be the real protocol.digest() over exactly the documented confirmation fields excluding requestDigest itself',
    );

    assert.deepEqual(client.setModeCalls, ['plan', 'agent'], 'approval transitions the managed session into verified Agent mode');

    const history = new NodeTaskWorkflowHistory(f.workspaceRoot, task.id, bridge);
    const head = history.initialize(context);
    assert.equal(head.latestSequence, 0, 'the real NodeTaskWorkflowHistory write must actually succeed under the issued grant');
    assert.equal(head.latestDigest, null);
  });
});

test('a cancelled UI decision issues no grant and assertAllowed rejects BRIDGE_NOT_AUTHORIZED', async () => {
  await withFixture(async (f) => {
    const { task, context } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticCancellingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();

    const outcome = await bridge.requestApproval(initializeOperation());
    assert.equal(outcome, 'cancelled');

    const request: WorkflowMutationRequest = {
      workspaceRoot: f.workspaceRoot, context, operation: initializeOperation(),
    };
    assert.throws(() => bridge.assertAllowed(request), (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_NOT_AUTHORIZED');
      return true;
    });
  });
});

test('an invalid UI result is an explicit error, never treated as approval', async () => {
  await withFixture(async (f) => {
    const { task } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticInvalidUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();

    await assert.rejects(() => bridge.requestApproval(initializeOperation()), (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_UI_INVALID');
      return true;
    });
  });
});

test('context drift (title) while the UI decision is pending blocks the grant with BRIDGE_CONTEXT_CHANGED', async () => {
  await withFixture(async (f) => {
    const { task } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticPendingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();

    const pending = bridge.requestApproval(initializeOperation());
    rewriteTaskTitle(f, task, 'drifted-title-while-pending');
    ui.resolvePending('approve');

    await assert.rejects(() => pending, (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_CONTEXT_CHANGED');
      return true;
    });
  });
});

test('status drift while the UI decision is pending blocks the grant with BRIDGE_CONTEXT_CHANGED', async () => {
  await withFixture(async (f) => {
    const { task } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticPendingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();

    const pending = bridge.requestApproval(initializeOperation());
    rewriteTaskStatus(f, task, 'under-review');
    ui.resolvePending('approve');

    await assert.rejects(() => pending, (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_CONTEXT_CHANGED');
      return true;
    });
  });
});

test('a session epoch change while the UI decision is pending blocks the grant, never silently reusing the earlier session snapshot', async () => {
  await withFixture(async (f) => {
    const { task } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticPendingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();

    const pending = bridge.requestApproval(initializeOperation());
    client.simulateForeignDrift();
    ui.resolvePending('approve');

    await assert.rejects(() => pending, (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_CONTEXT_CHANGED');
      return true;
    });
  });
});

test('overlapping approval requests reject the second as BRIDGE_BUSY instead of silently replacing the pending dialog', async () => {
  await withFixture(async (f) => {
    const { task } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticPendingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();

    const first = bridge.requestApproval(initializeOperation());
    await assert.rejects(() => bridge.requestApproval(initializeOperation()), (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_BUSY');
      return true;
    });
    ui.resolvePending('cancel');
    await first;
  });
});

test('disposal revokes an already-issued grant: assertAllowed throws BRIDGE_DISPOSED afterward', async () => {
  await withFixture(async (f) => {
    const { task, context } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticApprovingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();
    await bridge.requestApproval(initializeOperation());

    bridge.dispose();

    const request: WorkflowMutationRequest = {
      workspaceRoot: f.workspaceRoot, context, operation: initializeOperation(),
    };
    assert.throws(() => bridge.assertAllowed(request), (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_DISPOSED');
      return true;
    });
  });
});

test('a task that is not in-progress blocks start() with BRIDGE_TASK_STATE_INVALID, never an implicit status change', async () => {
  await withFixture(async (f) => {
    const { task } = registerTask(f, { status: 'done' });
    const client = new SyntheticSessionClient();
    const ui = new SyntheticApprovingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await assert.rejects(() => bridge.start(), (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_TASK_STATE_INVALID');
      return true;
    });
  });
});

test('an unregistered taskId blocks start() with a context error, never implicit registry initialization', async () => {
  await withFixture(async (f) => {
    const client = new SyntheticSessionClient();
    const ui = new SyntheticApprovingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, 'never-registered-task-id', client, ui);
    await assert.rejects(() => bridge.start(), (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_CONTEXT_INVALID');
      return true;
    });
  });
});

test('a rejecting/sanitizing WorkflowExecutionUi exception never leaks raw provider/UI exception text', async () => {
  await withFixture(async (f) => {
    const { task } = registerTask(f);
    const client = new SyntheticSessionClient();
    class ThrowingUi implements WorkflowExecutionUi {
      async confirmExecution(): Promise<'approve' | 'cancel'> {
        throw new Error('synthetic-ui-secret-detail-should-not-leak');
      }
    }
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, new ThrowingUi());
    await bridge.start();
    await assert.rejects(() => bridge.requestApproval(initializeOperation()), (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.ok(!(error as WorkflowBridgeError).message.includes('synthetic-ui-secret-detail-should-not-leak'));
      return true;
    });
  });
});

// ---------------------------------------------------------------------------
// Test-Code Reviewer corrective Red-phase additions (consolidated-review.json
// findings 1-9). Every fixture/double introduced below is explicitly
// SYNTHETIC per the module doc comment; none proves or substitutes for real
// human approval, real ACP transport, or real host capture.
// ---------------------------------------------------------------------------

test('a successful assertAllowed consumes the grant exactly once; an identical structurally-new replay request is rejected', async () => {
  await withFixture(async (f) => {
    const { task, context } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticApprovingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();
    const outcome = await bridge.requestApproval(initializeOperation());
    assert.equal(outcome, 'approved');

    const request: WorkflowMutationRequest = {
      workspaceRoot: f.workspaceRoot, context, operation: initializeOperation(),
    };
    assert.doesNotThrow(() => bridge.assertAllowed(request), 'the first assertion against the exact approved operation must succeed');

    const replay: WorkflowMutationRequest = {
      workspaceRoot: f.workspaceRoot, context, operation: initializeOperation(),
    };
    assert.throws(() => bridge.assertAllowed(replay), (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_NOT_AUTHORIZED');
      return true;
    });
  });
});

test('a downstream real write failure after a successful assertAllowed never refunds the already-consumed grant', async () => {
  await withFixture(async (f) => {
    const { task, context } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticApprovingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();
    const outcome = await bridge.requestApproval(initializeOperation());
    assert.equal(outcome, 'approved');

    const history = new NodeTaskWorkflowHistory(f.workspaceRoot, task.id, bridge, new SyntheticFailingWriter());
    assert.throws(() => history.initialize(context), (error: unknown) => {
      assert.ok(error instanceof WorkflowHistoryError, 'the accurate underlying host write error must propagate, not a fabricated bridge code');
      assert.equal((error as WorkflowHistoryError).code, 'HISTORY_WRITE_FAILED');
      assert.equal((error as WorkflowHistoryError).commitMayHaveChanged, false);
      return true;
    });

    const retry: WorkflowMutationRequest = {
      workspaceRoot: f.workspaceRoot, context, operation: initializeOperation(),
    };
    assert.throws(() => bridge.assertAllowed(retry), (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_NOT_AUTHORIZED');
      return true;
    });
  });
});

test('assertAllowed accepts a structurally identical new operation object but rejects a structurally different operation against a fresh grant', async () => {
  await withFixture(async (f) => {
    const { task, context } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticApprovingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();

    const firstOutcome = await bridge.requestApproval(initializeOperation());
    assert.equal(firstOutcome, 'approved');
    const identicalNewObject: WorkflowMutationRequest = {
      workspaceRoot: f.workspaceRoot, context, operation: { kind: 'initialize' },
    };
    assert.doesNotThrow(
      () => bridge.assertAllowed(identicalNewObject),
      'a structurally identical new operation object (same values, different reference) must not be treated as a mismatch',
    );

    const appendOperation = buildAppendOperation(context);
    const secondOutcome = await bridge.requestApproval(appendOperation);
    assert.equal(secondOutcome, 'approved');
    const mismatched: WorkflowMutationRequest = {
      workspaceRoot: f.workspaceRoot, context, operation: initializeOperation(),
    };
    assert.throws(() => bridge.assertAllowed(mismatched), (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_NOT_AUTHORIZED');
      return true;
    }, 'a structurally different operation than the one actually approved (append vs initialize) must be rejected');
  });
});

test('bridge.dispose() while a UI decision is still pending rejects the pending approval and issues no grant', async () => {
  await withFixture(async (f) => {
    const { task, context } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticPendingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();

    const pending = bridge.requestApproval(initializeOperation());
    bridge.dispose();
    ui.resolvePending('approve');

    await assert.rejects(() => pending, (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_DISPOSED');
      return true;
    });

    const request: WorkflowMutationRequest = {
      workspaceRoot: f.workspaceRoot, context, operation: initializeOperation(),
    };
    assert.throws(() => bridge.assertAllowed(request), (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_DISPOSED');
      return true;
    });
  });
});

test('a session drift occurring AFTER a grant has already been issued invalidates it immediately, even without dispose/close', async () => {
  await withFixture(async (f) => {
    const { task, context } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticApprovingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();
    const outcome = await bridge.requestApproval(initializeOperation());
    assert.equal(outcome, 'approved');

    client.simulateForeignDrift();

    const request: WorkflowMutationRequest = {
      workspaceRoot: f.workspaceRoot, context, operation: initializeOperation(),
    };
    assert.throws(() => bridge.assertAllowed(request), (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_NOT_AUTHORIZED');
      return true;
    });
  });
});

test('registryDigest drift from an unrelated concurrently-registered task while the UI decision is pending blocks the grant with BRIDGE_CONTEXT_CHANGED', async () => {
  await withFixture(async (f) => {
    const { task } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticPendingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();

    const pending = bridge.requestApproval(initializeOperation());
    registerUnrelatedTask(f);
    ui.resolvePending('approve');

    await assert.rejects(() => pending, (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_CONTEXT_CHANGED');
      return true;
    });
  });
});

test('a replaced task (createdAt drift) while the UI decision is pending blocks the grant; the accurate underlying source error propagates and no grant is issued', async () => {
  await withFixture(async (f) => {
    const { task, context } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticPendingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();

    const pending = bridge.requestApproval(initializeOperation());
    rewriteTaskCreatedAt(f, task, new Date(Date.parse(task.createdAt) + 1000).toISOString());
    ui.resolvePending('approve');

    // Preserve the contract's accurate source/host error semantics here
    // rather than demanding an arbitrary bridge-level code for a replaced
    // task: only that the pending approval rejects is asserted.
    await assert.rejects(() => pending);

    const request: WorkflowMutationRequest = {
      workspaceRoot: f.workspaceRoot, context, operation: initializeOperation(),
    };
    assert.throws(() => bridge.assertAllowed(request), (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_NOT_AUTHORIZED');
      return true;
    });
  });
});

test('a drift occurring during the post-approval Plan->Agent transition blocks the grant, proving the post-transition recheck actually runs', async () => {
  await withFixture(async (f) => {
    const { task, context } = registerTask(f);
    const inner = new SyntheticSessionClient();
    const client = new SyntheticAgentTransitionDriftingClient(inner, () => {
      rewriteTaskTitle(f, task, 'drifted-during-agent-transition');
    });
    const ui = new SyntheticApprovingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();

    await assert.rejects(() => bridge.requestApproval(initializeOperation()), (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_CONTEXT_CHANGED');
      return true;
    });

    const request: WorkflowMutationRequest = {
      workspaceRoot: f.workspaceRoot, context, operation: initializeOperation(),
    };
    assert.throws(() => bridge.assertAllowed(request), (error: unknown) => {
      assert.ok(error instanceof WorkflowBridgeError);
      assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_NOT_AUTHORIZED');
      return true;
    });
  });
});

test('a rejected/never-granted bridge authority blocks a real NodeTaskWorkflowHistory write with CUSTODY_AUTHORITY_REJECTED and writes nothing', async () => {
  await withFixture(async (f) => {
    const { task, context } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticApprovingUi();
    // Deliberately never approved: this bridge instance has issued no grant at all.
    const neverApprovedBridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await neverApprovedBridge.start();

    const history = new NodeTaskWorkflowHistory(f.workspaceRoot, task.id, neverApprovedBridge);
    assert.throws(() => history.initialize(context), (error: unknown) => {
      assert.ok(error instanceof WorkflowCustodyError);
      assert.equal((error as WorkflowCustodyError).code, 'CUSTODY_AUTHORITY_REJECTED');
      assert.equal((error as WorkflowCustodyError).commitMayHaveChanged, false);
      return true;
    });

    const reader = new NodeTaskWorkflowHistory(f.workspaceRoot, task.id);
    assert.throws(() => reader.head(), 'nothing was ever written: no ledger exists for an independent reader to find');
  });
});

test('requestApproval also supports the append operation shape with the exact binding/artifactKind/contentDigest fields displayed, granted identically to initialize', async () => {
  await withFixture(async (f) => {
    const { task, context } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticApprovingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();

    const appendOperation = buildAppendOperation(context);
    const outcome = await bridge.requestApproval(appendOperation);
    assert.equal(outcome, 'approved');
    assert.equal(ui.seen.length, 1);

    const confirmation = ui.seen[0];
    assert.equal(confirmation.operation.kind, 'append');
    assert.deepEqual(confirmation.operation, appendOperation);
    assert.ok(Object.isFrozen(confirmation.operation));

    const request: WorkflowMutationRequest = {
      workspaceRoot: f.workspaceRoot, context, operation: appendOperation,
    };
    assert.doesNotThrow(() => bridge.assertAllowed(request));
  });
});

// ---------------------------------------------------------------------------
// Test-Code Reviewer second corrective Red-phase additions
// (test-review/exact-byte-review.json F7/F8). Every fixture/double below is
// explicitly SYNTHETIC per the module doc comment; none proves or
// substitutes for real human approval, real ACP transport, or real host
// capture.
// ---------------------------------------------------------------------------

test(
  'append() under a real approved grant persists the EXACT original artifact bytes, independently verified via a fresh reader readBytes()/read()',
  async () => {
    await withFixture(async (f) => {
      const { task, context } = registerTask(f);
      const client = new SyntheticSessionClient();
      const ui = new SyntheticApprovingUi();
      const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
      await bridge.start();

      const initOutcome = await bridge.requestApproval(initializeOperation());
      assert.equal(initOutcome, 'approved');
      const history = new NodeTaskWorkflowHistory(f.workspaceRoot, task.id, bridge);
      history.initialize(context);

      // A real, nontrivial byte buffer: mixed printable text plus raw
      // non-UTF8-safe byte values (0x00/0xff/etc.), never a trivial/empty
      // placeholder.
      const originalBytes = Buffer.concat([
        Buffer.from('exact-real-artifact-bytes-', 'utf8'),
        Buffer.from([0x00, 0x01, 0x02, 0xfd, 0xfe, 0xff, 0x10, 0x20]),
      ]);
      const originalSnapshot = Uint8Array.from(originalBytes);
      const contentDigest = sha256Hex(originalBytes);
      const binding = buildCanonicalAppendBinding(context);
      const appendOperation: WorkflowCustodyOperation = {
        kind: 'append',
        operationId: randomUUID(),
        expectedLatest: 0,
        binding,
        artifactKind: 'scenario',
        contentDigest,
      };

      const appendOutcome = await bridge.requestApproval(appendOperation);
      assert.equal(appendOutcome, 'approved');

      const appendRequest: HistoryAppend = {
        operationId: appendOperation.operationId as string,
        expectedLatest: 0,
        binding,
        kind: 'scenario',
        bytes: originalBytes,
      };
      const revision = history.append(context, appendRequest);
      assert.equal(revision.digest, contentDigest, 'the real persisted artifact digest must equal the actual sha256 of the original bytes');

      // Independent verification: a brand-new reader instance, no authority,
      // never sharing any in-memory state with the writer above.
      const independentReader = new NodeTaskWorkflowHistory(f.workspaceRoot, task.id);
      const readBack = independentReader.readBytes(revision.sequence);
      assert.deepEqual(readBack, originalSnapshot, 'readBytes() must return exactly the original caller bytes, not merely a matching digest');

      const readRevision = independentReader.read(revision.sequence);
      const decoded = Uint8Array.from(Buffer.from(readRevision.contentBase64, 'base64'));
      assert.deepEqual(decoded, originalSnapshot, 'the independently re-read ledger content must decode to exactly the original caller bytes');
    });
  },
);

test('missing grant: an append operation that was never approved cannot write; the ledger is left unchanged', async () => {
  await withFixture(async (f) => {
    const { task, context } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticApprovingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();
    const initOutcome = await bridge.requestApproval(initializeOperation());
    assert.equal(initOutcome, 'approved');
    const history = new NodeTaskWorkflowHistory(f.workspaceRoot, task.id, bridge);
    history.initialize(context);

    const reader = new NodeTaskWorkflowHistory(f.workspaceRoot, task.id);
    const before = reader.head();

    const unapprovedAppend: HistoryAppend = {
      operationId: randomUUID(),
      expectedLatest: before.latestSequence,
      binding: buildCanonicalAppendBinding(context),
      kind: 'scenario',
      bytes: Buffer.from('never-approved-bytes', 'utf8'),
    };
    assert.throws(() => history.append(context, unapprovedAppend), (error: unknown) => {
      assert.ok(error instanceof WorkflowCustodyError);
      assert.equal((error as WorkflowCustodyError).code, 'CUSTODY_AUTHORITY_REJECTED');
      assert.equal((error as WorkflowCustodyError).commitMayHaveChanged, false);
      return true;
    });

    const after = reader.head();
    assert.equal(after.latestSequence, before.latestSequence, 'a rejected append must never advance the ledger');
    assert.equal(after.latestDigest, before.latestDigest);
  });
});

test('consumed grant: a second append using a fresh, actually-correct expectedLatest cannot reuse an already-consumed grant', async () => {
  await withFixture(async (f) => {
    const { task, context } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticApprovingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();
    const initOutcome = await bridge.requestApproval(initializeOperation());
    assert.equal(initOutcome, 'approved');
    const history = new NodeTaskWorkflowHistory(f.workspaceRoot, task.id, bridge);
    history.initialize(context);

    const firstBytes = Buffer.from('first-consuming-append-bytes', 'utf8');
    const firstOperation: WorkflowCustodyOperation = {
      kind: 'append', operationId: randomUUID(), expectedLatest: 0, binding: buildCanonicalAppendBinding(context), artifactKind: 'scenario',
      contentDigest: sha256Hex(firstBytes),
    };
    assert.equal(await bridge.requestApproval(firstOperation), 'approved');
    const firstRevision = history.append(context, {
      operationId: firstOperation.operationId as string, expectedLatest: 0, binding: firstOperation.binding as WorkflowBinding, kind: 'scenario', bytes: firstBytes,
    });
    assert.equal(firstRevision.sequence, 1);

    const reader = new NodeTaskWorkflowHistory(f.workspaceRoot, task.id);
    const before = reader.head();
    assert.equal(before.latestSequence, 1);

    // A NEW operation, never approved, using a fresh/actually-correct
    // expectedLatest (the real current head) so a bypassed-authority write
    // would otherwise have been structurally accepted -- isolating that the
    // rejection below is genuinely the consumed one-shot grant, not a stale
    // CAS/replay mismatch at the NodeWorkflowHistory layer.
    const secondAppend: HistoryAppend = {
      operationId: randomUUID(),
      expectedLatest: before.latestSequence,
      binding: buildCanonicalAppendBinding(context),
      kind: 'scenario',
      bytes: Buffer.from('second-unapproved-append-bytes', 'utf8'),
    };
    assert.throws(() => history.append(context, secondAppend), (error: unknown) => {
      assert.ok(error instanceof WorkflowCustodyError);
      assert.equal((error as WorkflowCustodyError).code, 'CUSTODY_AUTHORITY_REJECTED');
      assert.equal((error as WorkflowCustodyError).commitMayHaveChanged, false);
      return true;
    });

    const after = reader.head();
    assert.equal(after.latestSequence, before.latestSequence, 'the rejected second append must never advance the ledger');
    assert.equal(after.latestDigest, before.latestDigest);
  });
});

test('stale grant: a native session/epoch drift after approval invalidates the grant before the append call executes', async () => {
  await withFixture(async (f) => {
    const { task, context } = registerTask(f);
    const client = new SyntheticSessionClient();
    const ui = new SyntheticApprovingUi();
    const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
    await bridge.start();
    const initOutcome = await bridge.requestApproval(initializeOperation());
    assert.equal(initOutcome, 'approved');
    const history = new NodeTaskWorkflowHistory(f.workspaceRoot, task.id, bridge);
    history.initialize(context);

    const reader = new NodeTaskWorkflowHistory(f.workspaceRoot, task.id);
    const before = reader.head();

    const operation: WorkflowCustodyOperation = {
      kind: 'append', operationId: randomUUID(), expectedLatest: before.latestSequence, binding: buildCanonicalAppendBinding(context), artifactKind: 'scenario',
      contentDigest: sha256Hex(Buffer.from('stale-grant-bytes', 'utf8')),
    };
    assert.equal(await bridge.requestApproval(operation), 'approved');
    client.simulateForeignDrift();

    const staleAppend: HistoryAppend = {
      operationId: operation.operationId as string,
      expectedLatest: before.latestSequence,
      binding: operation.binding as WorkflowBinding,
      kind: 'scenario',
      bytes: Buffer.from('stale-grant-bytes', 'utf8'),
    };
    assert.throws(() => history.append(context, staleAppend), (error: unknown) => {
      assert.ok(error instanceof WorkflowCustodyError);
      assert.equal((error as WorkflowCustodyError).code, 'CUSTODY_AUTHORITY_REJECTED');
      assert.equal((error as WorkflowCustodyError).commitMayHaveChanged, false);
      return true;
    });

    const after = reader.head();
    assert.equal(after.latestSequence, before.latestSequence, 'a rejected stale-grant append must never advance the ledger');
    assert.equal(after.latestDigest, before.latestDigest);
  });
});

interface MutableAppendOperation {
  kind: 'append';
  operationId: string;
  expectedLatest: number;
  binding: WorkflowBinding;
  artifactKind: HistoryArtifactKind;
  contentDigest: string;
}

test(
  'mutating the caller\'s own operation/binding objects AFTER requestApproval is called never alters the already-captured confirmation; the caller objects are never frozen by the bridge',
  async () => {
    await withFixture(async (f) => {
      const { task, context } = registerTask(f);
      const client = new SyntheticSessionClient();
      const ui = new SyntheticPendingUi();
      const bridge = new WorkflowExecutionBridge(f.workspaceRoot, task.id, client, ui);
      await bridge.start();

      const originalOperationId = randomUUID();
      const originalSourceRevision = 'source-rev-original';
      const binding: WorkflowBinding = buildCanonicalAppendBinding(context, { sourceRevision: originalSourceRevision });
      const op: MutableAppendOperation = {
        kind: 'append',
        operationId: originalOperationId,
        expectedLatest: 0,
        binding,
        artifactKind: 'scenario',
        contentDigest: sha256Hex(Buffer.from('fixture-mutation-isolation-bytes', 'utf8')),
      };

      assert.equal(Object.isFrozen(op), false, 'the caller-supplied operation object must never be frozen by the bridge');
      assert.equal(Object.isFrozen(binding), false, 'the caller-supplied nested binding object must never be frozen by the bridge');

      const pending = bridge.requestApproval(op);

      // Synchronously mutate the caller's own mutable objects before the
      // pending UI decision is ever resolved, mirroring this file's
      // already-established "...while pending" drift-injection timing.
      op.operationId = randomUUID();
      op.binding = { ...op.binding, sourceRevision: 'source-rev-mutated-after-capture' };

      ui.resolvePending('approve');
      const outcome = await pending;
      assert.equal(outcome, 'approved');

      assert.equal(ui.seen.length, 1);
      const capturedOperation = ui.seen[0].operation;
      assert.equal(capturedOperation.kind, 'append');
      if (capturedOperation.kind === 'append') {
        assert.equal(capturedOperation.operationId, originalOperationId, 'the captured confirmation must retain the ORIGINAL operationId, never the later caller-side mutation');
        assert.equal(capturedOperation.binding.sourceRevision, originalSourceRevision, 'the captured confirmation must retain the ORIGINAL nested binding field');
      }
      assert.ok(Object.isFrozen(capturedOperation), 'the displayed nested operation copy must remain frozen');
      assert.ok(Object.isFrozen(capturedOperation.binding), 'the displayed nested binding copy must remain frozen');

      const mutatedRequest: WorkflowMutationRequest = {
        workspaceRoot: f.workspaceRoot, context, operation: op,
      };
      assert.throws(() => bridge.assertAllowed(mutatedRequest), (error: unknown) => {
        assert.ok(error instanceof WorkflowBridgeError);
        assert.equal((error as WorkflowBridgeError).code, 'BRIDGE_NOT_AUTHORIZED');
        return true;
      }, 'the caller-mutated request must never be authorized by the grant issued for the original values');

      const originalRequest: WorkflowMutationRequest = {
        workspaceRoot: f.workspaceRoot,
        context,
        operation: {
          kind: 'append',
          operationId: originalOperationId,
          expectedLatest: 0,
          binding: buildCanonicalAppendBinding(context, { sourceRevision: originalSourceRevision }),
          artifactKind: 'scenario',
          contentDigest: op.contentDigest,
        },
      };
      assert.doesNotThrow(
        () => bridge.assertAllowed(originalRequest),
        'the original exact pre-mutation request must still be exactly what was granted and approved',
      );
    });
  },
);
