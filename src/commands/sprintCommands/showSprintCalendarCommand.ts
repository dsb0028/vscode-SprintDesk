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
      const calendar = buildSprintCalendar(dataService.loadSprints(), dataService.loadTasks());
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
