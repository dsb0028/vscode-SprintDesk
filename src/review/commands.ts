import * as vscode from 'vscode';
import { getDataService } from '../data/DataService';
import { Enrollment, SignedReceipt } from './protocol';

function service(workspace: string) {
  if (!vscode.workspace.workspaceFolders?.some(folder => folder.uri.fsPath === workspace)) {
    throw new Error('Review workspace is not an open workspace folder');
  }
  return getDataService(workspace);
}

export function registerReviewCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.reviewSnapshot',
      (workspace: string, taskId: string, evidencePaths?: string[]) =>
        service(workspace).reviewSnapshot(taskId, evidencePaths)),
    vscode.commands.registerCommand('sprintdesk.reviewEnroll',
      (workspace: string, enrollment: Enrollment) => service(workspace).enrollReview(enrollment)),
    vscode.commands.registerCommand('sprintdesk.reviewCommit',
      async (workspace: string, receipt: SignedReceipt) => {
        const result = service(workspace).commitReview(receipt);
        await vscode.commands.executeCommand('sprintdesk.refresh');
        return result;
      }),
  );
}
