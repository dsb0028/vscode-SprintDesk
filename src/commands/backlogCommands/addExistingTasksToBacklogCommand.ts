import * as vscode from 'vscode';
import { addExistingTasksToBacklog as defaultAddExisting } from '../interactive/backlogInteractive';

export function registerAddExistingTasksToBacklogCommand(context: vscode.ExtensionContext, deps: { addExistingTasksToBacklog?: (item: any) => Promise<void> }) {
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addExistingTasksToBacklog', async (item: any) => {
    await deps.addExistingTasksToBacklog?.(item) ?? defaultAddExisting(item);
  }));
}
