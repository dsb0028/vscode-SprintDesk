import * as vscode from 'vscode';
import * as taskService from '../../services/taskService';
import * as epicService from '../../services/epicService';
import * as backlogService from '../../services/backlogService';
import insertTaskLinkUnderSection from '../../utils/mdUtils';

export function registerAddQuicklyCommand(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('sprintdesk.addQuickly', async () => {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }

    const input = await vscode.window.showInputBox({
      prompt: "Enter: '@task task name @epic epic name @backlog backlog name'",
      placeHolder: "@task My Task @epic My Epic @backlog My Backlog"
    });
    if (!input) {
      return;
    }

    const taskMatch = input.match(/@task ([^@]+)/);
    const epicMatch = input.match(/@epic ([^@]+)/);
    const backlogMatch = input.match(/@backlog ([^@]+)/);
    const taskTitle = taskMatch ? taskMatch[1].trim() : undefined;
    const epicTitle = epicMatch ? epicMatch[1].trim() : undefined;
    const backlogName = backlogMatch ? backlogMatch[1].trim() : undefined;

    if (!taskTitle) {
      vscode.window.showErrorMessage('Task name (@task) is required.');
      return;
    }

    let taskPath: string | undefined;
    try {
      const res = await taskService.createTask(ws, {
        title: taskTitle,
        type: 'feature',
        priority: 'medium',
        status: 'waiting'
      });
      taskPath = res?.path;
    } catch (e) {
      vscode.window.showErrorMessage('Failed to create task.');
      return;
    }

    if (epicTitle) {
      try {
        epicService.addTaskToEpic(epicTitle, taskTitle);
      } catch (e) {
        const category = await vscode.window.showInputBox({
          prompt: 'Epic category (e.g., SEO, FE, BE)',
          placeHolder: 'MISC'
        }) || 'MISC';
        epicService.createEpic(epicTitle, category);
      }
    }

    if (backlogName && taskPath) {
      const backlogs = backlogService.listBacklogs(ws);
      const match = backlogs.find(b => b.title.toLowerCase().includes(backlogName.toLowerCase()));
      if (!match) {
        vscode.window.showWarningMessage(`No backlog found matching '${backlogName}'. Task was created but not linked.`);
      } else {
        const tasks = taskService.loadTasks();
        const task = tasks.find(t => t.title === taskTitle);
        if (task) {
          backlogService.addTaskToBacklog(match.id, task.id);
        }
      }
    }

    vscode.window.showInformationMessage('Task created and linked successfully!');
  });

  context.subscriptions.push(disposable);
}