import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { buildSprintCalendar } from '../../calendar/sprintCalendar';
import { renderSprintCalendarHtml } from '../../calendar/sprintCalendarHtml';
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
        { enableScripts: false },
      );
      panel.webview.html = renderSprintCalendarHtml(
        calendar,
        randomBytes(16).toString('base64'),
      );
    })
  );
}
