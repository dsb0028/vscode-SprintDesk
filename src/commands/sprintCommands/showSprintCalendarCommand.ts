import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { buildSprintCalendar } from '../../calendar/sprintCalendar';
import { renderSprintCalendarHtml } from '../../calendar/sprintCalendarHtml';
import { initialCalendarState, localCalendarDate, updateCalendarState } from '../../calendar/sprintCalendarState';
import { getDataService } from '../../data/DataService';

export function registerShowSprintCalendarCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.showSprintCalendar', async (item?: { filePath?: string }) => {
      const filePath = item?.filePath;
      const workspaceRoot = (filePath
        ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri.fsPath
        : undefined)
        ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      const dataService = getDataService(workspaceRoot);
      let calendar = buildSprintCalendar(dataService.loadSprints(), dataService.loadTasks());
      const panel = vscode.window.createWebviewPanel(
        'sprintdesk-sprint-calendar',
        'Sprint Calendar',
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
      );
      let state = initialCalendarState(localCalendarDate());
      const render = () => {
        panel.webview.html = renderSprintCalendarHtml(calendar, randomBytes(16).toString('base64'), {
          state, today: localCalendarDate(),
        });
      };
      const refresh = () => {
        calendar = buildSprintCalendar(dataService.loadSprints(), dataService.loadTasks());
        render();
      };
      const messages = panel.webview.onDidReceiveMessage(async (message: unknown) => {
        if (message && typeof message === 'object' && 'action' in message && message.action === 'openTask') {
          if (Object.keys(message).length !== 2 || !('taskId' in message) || typeof message.taskId !== 'string') {
            return;
          }
          const task = dataService.loadTasks().find(task => task.id === message.taskId);
          if (!task) {
            vscode.window.showErrorMessage('Task not found. Reopen the calendar to refresh it.');
            return;
          }
          await vscode.commands.executeCommand(
            'sprintdesk.editTaskRaw', join(dataService.getTasksDir(), dataService.getTaskFilename(task)),
          );
          return;
        }
        if (message && typeof message === 'object' && !Array.isArray(message)) {
          const data = message as Record<string, unknown>;
          const sprintId = typeof data.sprintId === 'string' ? data.sprintId : undefined;
          const taskId = typeof data.taskId === 'string' ? data.taskId : undefined;
          const sprint = sprintId ? dataService.getSprint(sprintId) : undefined;
          if (data.action === 'selectSprint' && Object.keys(data).length === 2 && sprint) {
            state = { ...state, selectedSprintId: sprint.id };
            render();
            return;
          }
          if (data.action === 'setSprintColor' && Object.keys(data).length === 3 && sprint
            && typeof data.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(data.color)) {
            dataService.updateSprint(sprint.id, { color: data.color });
            refresh();
            return;
          }
          if (data.action === 'deleteSprint' && Object.keys(data).length === 2 && sprint) {
            for (const assignedTaskId of sprint.tasks) {
              dataService.updateTask(assignedTaskId, { sprint: null });
            }
            dataService.deleteSprint(sprint.id);
            state = { ...state, selectedSprintId: null };
            refresh();
            return;
          }
          if (data.action === 'assignTask' && Object.keys(data).length === 3 && sprint && taskId) {
            const task = dataService.getTask(taskId);
            if (task?.sprint === null && !sprint.tasks.includes(task.id)) {
              dataService.updateTask(task.id, { sprint: sprint.id });
              dataService.updateSprint(sprint.id, { tasks: [...sprint.tasks, task.id] });
              state = { ...state, selectedSprintId: sprint.id };
              refresh();
            }
            return;
          }
          if (data.action === 'removeTask' && Object.keys(data).length === 3 && sprint && taskId
            && sprint.tasks.includes(taskId)) {
            dataService.updateTask(taskId, { sprint: null });
            dataService.updateSprint(sprint.id, { tasks: sprint.tasks.filter(id => id !== taskId) });
            state = { ...state, selectedSprintId: sprint.id };
            refresh();
            return;
          }
        }
        const next = updateCalendarState(state, message, localCalendarDate());
        if (!next) {
          return;
        }
        state = next;
        render();
      });
      const disposal = panel.onDidDispose(() => {
        messages.dispose();
        disposal.dispose();
      });
      context.subscriptions.push(panel);
      render();
    })
  );
}
