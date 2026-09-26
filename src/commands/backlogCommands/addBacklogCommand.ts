import * as vscode from 'vscode';
import { createBacklogInteractive } from '../interactive/backlogInteractive';

export function registerAddBacklogCommand(context: vscode.ExtensionContext, deps?: { createBacklogInteractive?: () => Promise<void> }) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.addBacklog', async () => {
      if (deps?.createBacklogInteractive) {
        await deps.createBacklogInteractive();
      } else {
        await createBacklogInteractive();
      }
    })
  );
}