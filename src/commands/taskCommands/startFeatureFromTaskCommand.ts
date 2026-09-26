import * as vscode from 'vscode';
import { startFeatureFromTask as defaultStart } from '../interactive/sprintInteractive';

export function registerStartFeatureFromTaskCommand(context: vscode.ExtensionContext, deps?: { startFeatureFromTask?: (item: any) => Promise<void> }) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.startFeatureFromTask', async (item: any) => {
      await deps?.startFeatureFromTask?.(item) ?? defaultStart(item);
    })
  );
}
