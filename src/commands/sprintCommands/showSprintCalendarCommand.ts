import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { buildSprintCalendar } from '../../calendar/sprintCalendar';
import { renderSprintCalendarHtml } from '../../calendar/sprintCalendarHtml';
import { getDataService } from '../../data/DataService';

export function registerShowSprintCalendarCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.showSprintCalendar', async (item: any) => {
      const filePath = item?.filePath;
      if (!filePath) {
        vscode.window.showErrorMessage('Sprint file not found for this item.');
        return;
      }
      const workspaceRoot = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri.fsPath
        ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      const dataService = getDataService(workspaceRoot);
      const calendar = buildSprintCalendar(dataService.loadSprints(), dataService.loadTasks());
      if (!calendar.sprints.length) {
        vscode.window.showInformationMessage('No sprints with valid date ranges are available.');
        return;
      }

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
