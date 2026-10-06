/**
 * Test-first Red-phase coverage for the planned managedWorkflowCommands
 * module (contract.json "command_and_ui_wiring" ->
 * src/commands/workflowCommands/managedWorkflowCommands.ts, not yet
 * implemented, production_phase_approved: false). This file intentionally
 * imports modules that do not exist yet; until separately-approved
 * production increments add them, the whole suite is expected to fail to
 * *compile*, not merely fail at runtime. That compiler Red is the authorized
 * outcome of this increment (contract.json "reporting" -> "baseline").
 *
 * This is the PURE command/host-fixture layer only: it never imports the
 * real `vscode` module (no broad module monkeypatching), and every
 * ManagedWorkflowCommandHost / WorkflowSessionClient / WorkflowExecutionUi
 * implementation below is an explicitly labelled SYNTHETIC test double --
 * never real human consent, a real VS Code modal, or real ACP transport
 * (those are independently covered in CopilotAcpSession.test.ts and
 * WorkflowExecutionBridge.test.ts). Real, isolated synthetic task/registry
 * fixtures mirror the already-tested conventions in
 * src/review/NodeTaskWorkflowHistory.test.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import {
  ManagedWorkflowCommandHost, ManagedWorkflowCommands, registerManagedWorkflowCommands,
} from './managedWorkflowCommands';
import { WorkflowExecutionBridge, WorkflowExecutionUi } from '../../services/WorkflowExecutionBridge';
import { WorkflowSessionClient, WorkflowSessionMode, WorkflowSessionState } from '../../services/CopilotAcpSession';
import { NodeWorkflowIdentities } from '../../review/NodeWorkflowIdentities';
import { Task } from '../../data/types';

// ---------------------------------------------------------------------------
// Static source check: this test file never imports 'vscode', and the pure
// command module under test must not either (contract.json
// "command_and_ui_wiring": "Tests don't import runtime vscode via broad
// module monkeypatching"). This is a plain Node fs/text assertion, never a
// require()/import of the real module.
// ---------------------------------------------------------------------------

test('the pure command module source never imports the real vscode module', () => {
  const sourcePath = join(__dirname, 'managedWorkflowCommands.ts');
  const source = readFileSync(sourcePath, 'utf8');
  assert.ok(!/from\s+['"]vscode['"]/.test(source), 'managedWorkflowCommands.ts must not import vscode directly');
  assert.ok(!/require\(\s*['"]vscode['"]\s*\)/.test(source), 'managedWorkflowCommands.ts must not require vscode directly');
});

// ---------------------------------------------------------------------------
// Real, isolated synthetic task/registry fixture.
// ---------------------------------------------------------------------------

interface Fixture {
  readonly base: string;
  readonly workspaceRoot: string;
  readonly tasksPath: string;
}

function createFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), 'managed-workflow-commands-'));
  const workspaceRoot = join(base, 'workspace');
  mkdirSync(workspaceRoot, { mode: 0o700 });
  const dataDir = join(workspaceRoot, '.SprintDesk', 'data');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return { base, workspaceRoot, tasksPath: join(dataDir, 'tasks.yml') };
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

function registerTask(f: Fixture, overrides: Partial<Task> = {}): Task {
  const task = buildTask(overrides);
  writeFileSync(f.tasksPath, yaml.dump({ tasks: [task] }), 'utf8');
  const identities = new NodeWorkflowIdentities(f.workspaceRoot);
  const snapshot = identities.initialize();
  identities.registerTask(task.id, snapshot.digest);
  return task;
}

// ---------------------------------------------------------------------------
// SYNTHETIC session client / UI doubles, as used in WorkflowExecutionBridge.test.ts.
// ---------------------------------------------------------------------------

class SyntheticSessionClient implements WorkflowSessionClient {
  private connected = true;
  private sessionId: string | null = null;
  private mode: WorkflowSessionMode | null = null;
  private epoch = 0;

  async start(): Promise<WorkflowSessionState> {
    this.sessionId = randomUUID();
    this.mode = 'agent';
    this.epoch = 1;
    return this.state();
  }

  async setMode(mode: WorkflowSessionMode): Promise<WorkflowSessionState> {
    this.mode = mode;
    this.epoch += 1;
    return this.state();
  }

  state(): WorkflowSessionState {
    return {
      connected: this.connected, sessionId: this.sessionId, mode: this.mode, epoch: this.epoch,
    };
  }

  cancel(): void { /* synthetic no-op */ }

  async close(): Promise<void> {
    this.connected = false;
  }

  dispose(): void {
    this.connected = false;
  }

  onStateChanged(): { dispose(): void } {
    return { dispose: () => { /* synthetic no-op */ } };
  }
}

class SyntheticApprovingUi implements WorkflowExecutionUi {
  async confirmExecution(): Promise<'approve' | 'cancel'> {
    return 'approve';
  }
}

// ---------------------------------------------------------------------------
// SYNTHETIC ManagedWorkflowCommandHost: a pure, explicitly labelled test
// double. It never touches a real vscode.window/vscode.commands API.
// ---------------------------------------------------------------------------

interface RegisteredCommand {
  readonly id: string;
  readonly handler: (taskId?: string) => Promise<void>;
  disposed: boolean;
}

class SyntheticCommandHost implements ManagedWorkflowCommandHost {
  public readonly registered: RegisteredCommand[] = [];
  public readonly errors: string[] = [];
  public readonly reports: string[] = [];
  public workspaceRootToReturn: string | undefined;
  public taskIdToReturn: string | undefined;

  registerCommand(id: string, handler: (taskId?: string) => Promise<void>): { dispose(): void } {
    const entry: RegisteredCommand = { id, handler, disposed: false };
    this.registered.push(entry);
    return { dispose: () => { entry.disposed = true; } };
  }

  async selectWorkspace(): Promise<string | undefined> {
    return this.workspaceRootToReturn;
  }

  async requestTaskId(): Promise<string | undefined> {
    return this.taskIdToReturn;
  }

  createClient(): WorkflowSessionClient {
    return new SyntheticSessionClient();
  }

  createUi(): WorkflowExecutionUi {
    return new SyntheticApprovingUi();
  }

  report(message: string): void {
    this.reports.push(message);
  }

  reportError(code: string): void {
    this.errors.push(code);
  }

  findCommand(id: string): RegisteredCommand | undefined {
    return this.registered.find((entry) => entry.id === id);
  }

  async invoke(id: string, taskId?: string): Promise<void> {
    const command = this.findCommand(id);
    assert.ok(command, `command ${id} was never registered`);
    await command.handler(taskId);
  }
}

test('registers exactly the two documented command IDs', () => {
  const host = new SyntheticCommandHost();
  const commands = registerManagedWorkflowCommands(host);
  const ids = host.registered.map((entry) => entry.id).sort();
  assert.deepEqual(ids, ['sprintdesk.closeManagedWorkflow', 'sprintdesk.startManagedWorkflow']);
  commands.dispose();
});

test('start creates a bridge keyed to the exact selected workspace and task, discoverable via find()', async () => {
  await withFixture(async (f) => {
    const task = registerTask(f);
    const host = new SyntheticCommandHost();
    host.workspaceRootToReturn = f.workspaceRoot;
    host.taskIdToReturn = task.id;
    const commands: ManagedWorkflowCommands = registerManagedWorkflowCommands(host);

    await host.invoke('sprintdesk.startManagedWorkflow');

    const bridge = commands.find(f.workspaceRoot, task.id);
    assert.ok(bridge instanceof WorkflowExecutionBridge);
    assert.deepEqual(host.errors, []);

    commands.dispose();
  });
});

test('a second start for the same already-live workspace+task reports busy instead of silently replacing the bridge', async () => {
  await withFixture(async (f) => {
    const task = registerTask(f);
    const host = new SyntheticCommandHost();
    host.workspaceRootToReturn = f.workspaceRoot;
    host.taskIdToReturn = task.id;
    const commands = registerManagedWorkflowCommands(host);

    await host.invoke('sprintdesk.startManagedWorkflow');
    const first = commands.find(f.workspaceRoot, task.id);

    await host.invoke('sprintdesk.startManagedWorkflow');
    const second = commands.find(f.workspaceRoot, task.id);

    assert.equal(host.errors.length, 1, 'the duplicate start must be surfaced as an explicit error, not swallowed');
    assert.equal(first, second, 'the original bridge instance must not be silently replaced');

    commands.dispose();
  });
});

test('an unregistered taskId blocks connecting and never auto-initializes the registry', async () => {
  await withFixture(async (f) => {
    mkdirSync(join(f.workspaceRoot, '.SprintDesk', 'data'), { recursive: true });
    const host = new SyntheticCommandHost();
    host.workspaceRootToReturn = f.workspaceRoot;
    host.taskIdToReturn = 'never-registered-task-id';
    const commands = registerManagedWorkflowCommands(host);

    await host.invoke('sprintdesk.startManagedWorkflow');

    assert.ok(host.errors.length > 0, 'missing/unregistered task must be surfaced as an explicit error');
    assert.equal(commands.find(f.workspaceRoot, 'never-registered-task-id'), undefined);

    commands.dispose();
  });
});

test('cancelling workspace selection is a legitimate no-op, never an error or a bridge', async () => {
  await withFixture(async (f) => {
    const task = registerTask(f);
    const host = new SyntheticCommandHost();
    host.workspaceRootToReturn = undefined;
    host.taskIdToReturn = task.id;
    const commands = registerManagedWorkflowCommands(host);

    await host.invoke('sprintdesk.startManagedWorkflow');

    assert.deepEqual(host.errors, []);
    assert.equal(commands.find(f.workspaceRoot, task.id), undefined);

    commands.dispose();
  });
});

test('cancelling the task id prompt is a legitimate no-op, never a task-code fallback', async () => {
  await withFixture(async (f) => {
    const host = new SyntheticCommandHost();
    host.workspaceRootToReturn = f.workspaceRoot;
    host.taskIdToReturn = undefined;
    const commands = registerManagedWorkflowCommands(host);

    await host.invoke('sprintdesk.startManagedWorkflow');

    assert.deepEqual(host.errors, []);

    commands.dispose();
  });
});

test('close revokes and disposes the exact bridge for the selected workspace/task, removing it from find()', async () => {
  await withFixture(async (f) => {
    const task = registerTask(f);
    const host = new SyntheticCommandHost();
    host.workspaceRootToReturn = f.workspaceRoot;
    host.taskIdToReturn = task.id;
    const commands = registerManagedWorkflowCommands(host);

    await host.invoke('sprintdesk.startManagedWorkflow');
    assert.ok(commands.find(f.workspaceRoot, task.id));

    await host.invoke('sprintdesk.closeManagedWorkflow');
    assert.equal(commands.find(f.workspaceRoot, task.id), undefined);
    assert.deepEqual(host.errors, []);

    commands.dispose();
  });
});

test('closing when there is no active session for the selected workspace/task is an explicit error, never silently ignored', async () => {
  await withFixture(async (f) => {
    const task = registerTask(f);
    const host = new SyntheticCommandHost();
    host.workspaceRootToReturn = f.workspaceRoot;
    host.taskIdToReturn = task.id;
    const commands = registerManagedWorkflowCommands(host);

    await host.invoke('sprintdesk.closeManagedWorkflow');

    assert.ok(host.errors.length > 0, 'closing with no active session must report an explicit error code');

    commands.dispose();
  });
});

test('dispose() revokes every owned bridge and every registered command handle', async () => {
  await withFixture(async (f) => {
    const task = registerTask(f);
    const host = new SyntheticCommandHost();
    host.workspaceRootToReturn = f.workspaceRoot;
    host.taskIdToReturn = task.id;
    const commands = registerManagedWorkflowCommands(host);

    await host.invoke('sprintdesk.startManagedWorkflow');
    assert.ok(commands.find(f.workspaceRoot, task.id));

    commands.dispose();

    assert.equal(commands.find(f.workspaceRoot, task.id), undefined, 'dispose must revoke every owned bridge');
    assert.ok(host.registered.every((entry) => entry.disposed), 'dispose must dispose every registered command handle');
  });
});
