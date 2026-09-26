import * as vscode from 'vscode';

type Deps = {
  createEpicInteractive?: () => Promise<void>;
  epicsProvider?: any;
};

export function registerAddEpicCommand(context: vscode.ExtensionContext, deps: Deps) {
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.addEpic', async () => {
    await deps.createEpicInteractive?.();
    deps.epicsProvider?.refresh?.();
  }));
}
