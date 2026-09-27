import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { Sprint, Task } from '../data/types';
import * as calendarState from './sprintCalendarState';

interface Disposable {
  dispose(): void;
}

class CalendarPanelDouble implements Disposable {
  messageListener: ((message: unknown) => void | Promise<void>) | undefined;
  disposeListener: (() => void) | undefined;
  messagesDisposed = false;
  disposalListenerDisposed = false;
  disposed = false;
  webview = {
    html: '',
    onDidReceiveMessage: (listener: (message: unknown) => void | Promise<void>): Disposable => {
      this.messageListener = listener;
      return { dispose: () => {
        this.messagesDisposed = true;
        this.messageListener = undefined;
      } };
    },
  };

  onDidDispose(listener: () => void): Disposable {
    this.disposeListener = listener;
    return { dispose: () => {
      this.disposalListenerDisposed = true;
      this.disposeListener = undefined;
    } };
  }

  dispose(): void {
    this.disposed = true;
    this.disposeListener?.();
  }

  receive(message: unknown): void | Promise<void> {
    return this.messageListener?.(message);
  }
}

/** Execute the actual compiled command with only VS Code, storage and clock boundaries doubled. */
export async function runSprintCalendarCommandTests(): Promise<void> {
  const fixtureTask: Task = {
    id: 'task-1', number: 1, code: 'SPD-1', name: 'calendar-task', title: 'Calendar Task',
    type: 'feature', status: 'waiting', priority: 'medium', epic: null, backlog: 'TECHNICAL',
    sprint: 'sprint-1', startDate: '2026-09-25', endDate: '2026-09-25',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  let fixtureSprint: Sprint = {
    id: 'sprint-1', number: 1, title: 'Calendar Sprint', name: 'calendar-sprint',
    startDate: '2026-09-21', endDate: '2026-09-27', status: 'planned', tasks: ['task-1'],
    createdAt: fixtureTask.createdAt, updatedAt: fixtureTask.updatedAt,
  };
  const tasks = Array.from({ length: 5 }, (_, index) => ({ ...fixtureTask, id: `task-${index}` }));
  tasks[1].sprint = null;
  const originalData = JSON.stringify(tasks);
  let today = '2026-09-25';
  let sprintDeleted = false;
  let taskReads = 0;
  let sprintReads = 0;
  let command: ((item?: { filePath?: string }) => Promise<void>) | undefined;
  let registrationDisposed = false;
  const errors: string[] = [];
  const roots: string[] = [];
  const panels: CalendarPanelDouble[] = [];
  const openedTasks: string[] = [];
  const workspace: { workspaceFolders: { uri: { fsPath: string } }[]; getWorkspaceFolder: (uri: { fsPath: string }) => { uri: { fsPath: string } } } = {
    workspaceFolders: [],
    getWorkspaceFolder: uri => {
      assert.equal(uri.fsPath, '/selected/task.md');
      return { uri: { fsPath: '/selected' } };
    },
  };
  const host = {
    commands: {
      executeCommand: async (name: string, filePath: string): Promise<void> => {
        assert.equal(name, 'sprintdesk.editTaskRaw');
        openedTasks.push(filePath);
      },
      registerCommand: (name: string, callback: NonNullable<typeof command>): Disposable => {
        assert.equal(name, 'sprintdesk.showSprintCalendar');
        command = callback;
        return { dispose: () => { registrationDisposed = true; } };
      },
    },
    workspace,
    ['Uri']: { file: (fsPath: string) => ({ fsPath }) },
    ['ViewColumn']: { ['One']: 1 },
    window: {
      showErrorMessage: (message: string) => { errors.push(message); },
      createWebviewPanel: (type: string, title: string, column: number, options: {
        enableScripts: boolean; retainContextWhenHidden: boolean; localResourceRoots: unknown[];
      }) => {
        assert.equal(type, 'sprintdesk-sprint-calendar');
        assert.equal(title, 'Sprint Calendar');
        assert.equal(column, 1);
        assert.equal(options.enableScripts, true);
        assert.equal(options.retainContextWhenHidden, true);
        assert.equal(options.localResourceRoots.length, 0);
        const panel = new CalendarPanelDouble();
        panels.push(panel);
        return panel;
      },
    },
  };
  const storage = new Proxy({
    loadSprints: () => { sprintReads++; return sprintDeleted ? [] : [fixtureSprint]; },
    loadTasks: () => { taskReads++; return tasks; },
    getSprint: (id: string) => !sprintDeleted && id === fixtureSprint.id ? fixtureSprint : undefined,
    getTask: (id: string) => tasks.find(task => task.id === id),
    updateSprint: (id: string, updates: Partial<Sprint>) => {
      assert.equal(id, fixtureSprint.id);
      fixtureSprint = { ...fixtureSprint, ...updates };
    },
    updateTask: (id: string, updates: Partial<Task>) => {
      const index = tasks.findIndex(task => task.id === id);
      assert.notEqual(index, -1);
      tasks[index] = { ...tasks[index], ...updates };
    },
    deleteSprint: (id: string) => { assert.equal(id, fixtureSprint.id); sprintDeleted = true; },
    getTasksDir: () => '/workspace/.SprintDesk/Tasks',
    getTaskFilename: (task: Task) => `[${task.code}]_${task.name}.md`,
  }, {
    get(target, property) {
      assert.ok(property === 'loadTasks' || property === 'loadSprints' || property === 'getSprint'
        || property === 'getTask' || property === 'updateSprint' || property === 'updateTask'
        || property === 'deleteSprint' || property === 'getTasksDir' || property === 'getTaskFilename',
      `Unexpected storage access: ${String(property)}`);
      return target[property];
    },
  });
  const commandPath = require.resolve('../commands/sprintCommands/showSprintCalendarCommand');
  const actualRequire = createRequire(commandPath);
  const moduleExports: {
    registerShowSprintCalendarCommand?: (context: { subscriptions: Disposable[] }) => void;
  } = {};
  runInNewContext(readFileSync(commandPath, 'utf8'), {
    exports: moduleExports,
    require: (request: string): unknown => {
      if (request === 'vscode') {
        return host;
      }
      if (request === '../../data/DataService') {
        return { getDataService: (root: string) => { roots.push(root); return storage; } };
      }
      if (request === '../../calendar/sprintCalendarState') {
        return { ...calendarState, localCalendarDate: () => today };
      }
      return actualRequire(request);
    },
  }, { filename: commandPath });
  assert.ok(moduleExports.registerShowSprintCalendarCommand);
  const context = { subscriptions: [] as Disposable[] };
  moduleExports.registerShowSprintCalendarCommand(context);
  assert.ok(command);
  try {
    await command();
    assert.deepEqual(errors, ['No workspace folder open.']);
    assert.equal(panels.length, 0);
    assert.equal(taskReads, 0);

    workspace.workspaceFolders = [{ uri: { fsPath: '/workspace' } }];
    await command();
    const panel = panels[0];
    assert.deepEqual(roots, ['/workspace']);
    assert.match(panel.webview.html, /data-month="2026-09"/);
    assert.match(panel.webview.html, /2 more tasks/);
    panel.receive({ action: 'next' });
    assert.match(panel.webview.html, /data-month="2026-10"/);
    assert.match(panel.webview.html, /data-focus="nav-next"/);
    panel.receive({ action: 'previous' });
    assert.match(panel.webview.html, /data-month="2026-09"/);
    panel.receive({ action: 'toggle', week: '2026-09-21' });
    assert.match(panel.webview.html, /aria-expanded="true"/);
    assert.match(panel.webview.html, /data-focus="week-2026-09-21-toggle"/);
    panel.receive({ action: 'toggle', week: '2026-09-21' });
    assert.match(panel.webview.html, /aria-expanded="false"/);
    panel.receive({ action: 'toggle', week: '2026-09-21' });
    panel.receive({ action: 'next' });
    panel.receive({ action: 'previous' });
    assert.match(panel.webview.html, /aria-expanded="false"/);

    const beforeInvalid = panel.webview.html;
    for (const invalid of [null, { action: 'saveTasks' }, { action: 'next', path: '/write' },
      { action: 'toggle', week: '2026-09-22' }, { action: 'toggle', week: '../tasks.yml' }]) {
      panel.receive(invalid);
      assert.equal(panel.webview.html, beforeInvalid);
    }
    today = '2027-01-01';
    panel.receive({ action: 'today' });
    assert.match(panel.webview.html, /data-month="2027-01"/);
    assert.match(panel.webview.html, /data-focus="nav-today"/);
    assert.equal(taskReads, 1);
    assert.equal(sprintReads, 1);
    assert.equal(JSON.stringify(tasks), originalData);

    const beforeOpen = panel.webview.html;
    await panel.receive({ action: 'openTask', taskId: 'task-1' });
    assert.deepEqual(openedTasks, ['/workspace/.SprintDesk/Tasks/[SPD-1]_calendar-task.md']);
    assert.equal(panel.webview.html, beforeOpen);
    for (const invalid of [
      { action: 'openTask' }, { action: 'openTask', taskId: 1 },
      { action: 'openTask', taskId: 'task-1', path: '/untrusted.md' },
    ]) {
      await panel.receive(invalid);
    }
    await panel.receive({ action: 'openTask', taskId: 'missing-task' });
    assert.equal(openedTasks.length, 1);
    assert.equal(errors.at(-1), 'Task not found. Reopen the calendar to refresh it.');
    assert.equal(panel.webview.html, beforeOpen);
    assert.equal(JSON.stringify(tasks), originalData);

    panel.receive({ action: 'selectSprint', sprintId: 'sprint-1' });
    assert.match(panel.webview.html, /class="sprint-sidebar sprint-color-0"/);
    panel.receive({ action: 'setSprintColor', sprintId: 'sprint-1', color: '#ec4899' });
    assert.equal(fixtureSprint.color, '#ec4899');
    assert.match(panel.webview.html, /--sprint-color: #ec4899/);
    panel.receive({ action: 'removeTask', sprintId: 'sprint-1', taskId: 'task-1' });
    assert.equal(tasks.find(task => task.id === 'task-1')?.sprint, null);
    assert.match(panel.webview.html, /No tasks are assigned to this sprint/);
    panel.receive({ action: 'assignTask', sprintId: 'sprint-1', taskId: 'task-1' });
    assert.equal(fixtureSprint.tasks.filter(id => id === 'task-1').length, 1);
    panel.receive({ action: 'assignTask', sprintId: 'sprint-1', taskId: 'task-1', extra: true });
    assert.equal(fixtureSprint.tasks.filter(id => id === 'task-1').length, 1);

    await command({ filePath: '/selected/task.md' });
    assert.deepEqual(roots, ['/workspace', '/selected']);
    assert.equal(panels.length, 2);
    panels[1].receive({ action: 'next' });
    assert.match(panels[1].webview.html, /data-month="2027-02"/);
    assert.match(panel.webview.html, /data-month="2027-01"/);
    panel.receive({ action: 'deleteSprint', sprintId: 'sprint-1' });
    assert.match(panel.webview.html, /No sprints are available/);
    assert.equal(tasks.find(task => task.id === 'task-1')?.sprint, null);
    panel.dispose();
    assert.equal(panel.messagesDisposed, true);
    assert.equal(panel.disposalListenerDisposed, true);
    const disposedHtml = panel.webview.html;
    panel.receive({ action: 'next' });
    assert.equal(panel.webview.html, disposedHtml);
  } finally {
    for (const subscription of context.subscriptions) {
      subscription.dispose();
    }
  }
  assert.equal(registrationDisposed, true);
  assert.ok(panels.every(panel => panel.disposed && panel.messagesDisposed && panel.disposalListenerDisposed));
}
