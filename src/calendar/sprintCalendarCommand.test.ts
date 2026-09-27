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
  tasks[4].sprint = null;
  const originalData = JSON.stringify(tasks);
  let today = '2026-09-25';
  let sprintDeleted = false;
  let taskReads = 0;
  let sprintReads = 0;
  let taskWrites = 0;
  let sprintWrites = 0;
  const failedTaskWrites = new Set<number>();
  const failedSprintWrites = new Set<number>();
  let descriptionFailure = false;
  let refreshes = 0;
  let command: ((item?: { filePath?: string }) => Promise<void>) | undefined;
  let registrationDisposed = false;
  const errors: string[] = [];
  const roots: string[] = [];
  const panels: CalendarPanelDouble[] = [];
  const openedTasks: string[] = [];
  const workspace: { workspaceFolders: { uri: { fsPath: string } }[];
    openTextDocument: (uri: { fsPath: string }) => Promise<{getText(): string}>;
    getWorkspaceFolder: (uri: { fsPath: string }) => { uri: { fsPath: string } } } = {
    workspaceFolders: [],
    openTextDocument: async uri => {
      assert.ok(uri.fsPath.startsWith('/workspace/.SprintDesk/Tasks/'));
      if (descriptionFailure) {throw new Error('Description file unavailable');}
      return {getText: () => '## Description\nReal authored description.\nSecond line.\n## Notes\nNot the description.'};
    },
    getWorkspaceFolder: uri => {
      assert.equal(uri.fsPath, '/selected/task.md');
      return { uri: { fsPath: '/selected' } };
    },
  };
  const host = {
    commands: {
      executeCommand: async (name: string, filePath?: string): Promise<void> => {
        if (name === 'sprintdesk.refresh') {refreshes++; return;}
        assert.equal(name, 'sprintdesk.editTaskRaw');
        assert.ok(filePath);
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
    loadTasks: () => { taskReads++; return tasks.map(task => ({...task})); },
    saveTasks: (updated: Task[]) => {
      tasks.splice(0,tasks.length,...updated);
      if (failedTaskWrites.has(++taskWrites)) {throw new Error('Task save failed');}
    },
    saveSprints: (updated: Sprint[]) => {
      sprintDeleted = updated.length === 0;
      if (updated.length) {fixtureSprint = updated[0];}
      if (failedSprintWrites.has(++sprintWrites)) {throw new Error('Sprint save failed');}
    },
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
        || property === 'deleteSprint' || property === 'getTasksDir' || property === 'getTaskFilename'
        || property === 'saveTasks' || property === 'saveSprints',
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
    assert.match(panel.webview.html, /1 more tasks/);
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
    assert.ok(taskReads > 1);
    assert.ok(sprintReads > 1);
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
    assert.equal(errors.at(-1), 'Calendar: Task not found. Refresh the calendar.');
    assert.equal(JSON.stringify(tasks), originalData);

    today = '2026-09-25';
    await panel.receive({ action: 'today' });
    await panel.receive({ action: 'selectTask', taskId: 'task-1' });
    assert.match(panel.webview.html, /class="details"/);
    assert.match(panel.webview.html, /Real authored description.\nSecond line./);
    assert.doesNotMatch(panel.webview.html, /Not the description/);
    assert.equal(openedTasks.length, 1, 'Selecting a task must not open its file');
    descriptionFailure = true;
    await panel.receive({action:'selectTask',taskId:'task-1'});
    assert.match(panel.webview.html,/Unable to read task description:.*Description file unavailable/);
    assert.match(errors.at(-1)!,/Description file unavailable/);
    descriptionFailure = false;
    await panel.receive({action:'selectTask',taskId:'task-1'});
    const snapshot = JSON.stringify({tasks,sprint:fixtureSprint});
    failedSprintWrites.add(sprintWrites + 1);
    await panel.receive({action:'removeTask',sprintId:'sprint-1',taskId:'task-1'});
    assert.equal(JSON.stringify({tasks,sprint:fixtureSprint}),snapshot,'Both records must be restored after a partial sprint save');
    assert.match(errors.at(-1)!,/Sprint save failed/);
    failedTaskWrites.add(taskWrites + 1);
    await panel.receive({action:'removeTask',sprintId:'sprint-1',taskId:'task-1'});
    assert.equal(JSON.stringify({tasks,sprint:fixtureSprint}),snapshot,'A partial task save must be restored');
    failedSprintWrites.add(sprintWrites + 1);
    failedTaskWrites.add(taskWrites + 2);
    await panel.receive({action:'removeTask',sprintId:'sprint-1',taskId:'task-1'});
    assert.match(errors.at(-1)!,/Sprint save failed.*rollback.*Task save failed/);
    assert.equal(JSON.stringify({tasks,sprint:fixtureSprint}),snapshot);
    panel.receive({ action: 'setSprintColor', sprintId: 'sprint-1', color: '#ec4899' });
    assert.equal(fixtureSprint.color, '#ec4899');
    assert.match(panel.webview.html, /--sprint:#ec4899/);
    panel.receive({ action: 'removeTask', sprintId: 'sprint-1', taskId: 'task-1' });
    assert.equal(tasks.find(task => task.id === 'task-1')?.sprint, null);
    assert.doesNotMatch(panel.webview.html, /data-selected="task-1"/);
    assert.equal(tasks.find(task => task.id === 'task-1')?.backlog, 'TECHNICAL');
    assert.ok(!fixtureSprint.tasks.includes('task-1'));
    panel.receive({ action: 'assignTask', sprintId: 'sprint-1', taskId: 'task-1' });
    assert.equal(fixtureSprint.tasks.filter(id => id === 'task-1').length, 1);
    tasks[1] = {...tasks[1],title:'Edited actual task',status:'under-review'};
    await panel.receive({action:'refresh'});
    assert.match(panel.webview.html,/Edited actual task/);
    assert.match(panel.webview.html,/under-review/);
    panel.receive({ action: 'assignTask', sprintId: 'sprint-1', taskId: 'task-1', extra: true });
    assert.equal(fixtureSprint.tasks.filter(id => id === 'task-1').length, 1);

    await command({ filePath: '/selected/task.md' });
    assert.deepEqual(roots, ['/workspace', '/selected']);
    assert.equal(panels.length, 2);
    panels[1].receive({ action: 'next' });
    assert.match(panels[1].webview.html, /data-month="2026-10"/);
    assert.match(panel.webview.html, /data-month="2026-09"/);
    panel.receive({ action: 'deleteSprint', sprintId: 'sprint-1' });
    assert.match(panel.webview.html, /No sprint tasks in this range/);
    assert.equal(tasks.find(task => task.id === 'task-1')?.sprint, null);
    assert.ok(refreshes >= 4,'Membership and color changes refresh the other SprintDesk views');
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
