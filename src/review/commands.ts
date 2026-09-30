import * as vscode from 'vscode';
import { getDataService } from '../data/DataService';
import { Enrollment, SignedReceipt } from './protocol';
import { resolveReviewWorkspace } from './workspace';

function service(workspace: string) {
  const folders = vscode.workspace.workspaceFolders?.map(folder => ({
    path: folder.uri.path, fsPath: folder.uri.fsPath,
  })) ?? [];
  return getDataService(resolveReviewWorkspace(workspace, folders));
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
