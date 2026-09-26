import * as vscode from 'vscode';
import * as path from 'path';

export function registerOpenSettingsCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.openSettings', async () => {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      const choice = await vscode.window.showInformationMessage(
        'Configure SprintDesk settings in VS Code Settings',
        'Open VS Code Settings',
        'Cancel'
      );

      if (choice === 'Open VS Code Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'sprintdesk');
      }
    })
  );
}