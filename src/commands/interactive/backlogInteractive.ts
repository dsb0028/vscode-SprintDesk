import * as vscode from 'vscode';
import * as path from 'path';
import * as fileService from '../../services/fileService';
import * as taskService from '../../services/taskService';
import { getDataService } from '../../data/DataService';
import { PROJECT_CONSTANTS } from '../../utils/constant';
import { Backlog } from '../../data/types';

export async function createBacklogInteractive(): Promise<void> {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  const backlogTitle = await vscode.window.showInputBox({
    prompt: 'Enter backlog title',
    placeHolder: 'e.g., FEATURES, BUGS, TECHNICAL'
  });

  if (!backlogTitle) return;

  const titleUpper = backlogTitle.toUpperCase().trim();
  const backlogId = titleUpper.toLowerCase().replace(/\s+/g, '-');
  const dataService = getDataService(ws);

  if (dataService.getBacklog(backlogId)) {
    vscode.window.showWarningMessage(`Backlog "${titleUpper}" already exists.`);
    return;
  }

  const backlog: Backlog = {
    id: backlogId,
    title: titleUpper,
    name: `[Backlog]_${titleUpper}`,
    description: '',
    tasks: [],
    color: '#2563eb'
  };

  backlog.path = path.join(dataService.getBacklogsDir(), `${backlog.name}.md`);

  dataService.addBacklog(backlog);
  dataService.saveBacklogMd(backlog);

  vscode.window.showInformationMessage(`Backlog "${titleUpper}" created.`);
}

export async function addExistingTasksToBacklog(item: any) {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) { vscode.window.showErrorMessage('No workspace folder open.'); return; }

  const backlogFile: string | undefined = item?.filePath;
  if (!backlogFile) { vscode.window.showErrorMessage('Backlog file not found.'); return; }

  const tasks = taskService.loadTasks();
  if (!tasks.length) { vscode.window.showInformationMessage('No tasks found.'); return; }

  const itemsQP = tasks.map(t => ({
    label: t.title,
    taskId: t.id,
    task: t
  }));

  const picked = await vscode.window.showQuickPick(itemsQP, { canPickMany: true, title: 'Select tasks to add to Backlog' });
  if (!picked || picked.length === 0) return;

  try {
    const dataService = getDataService(ws);
    const backlogId = path.basename(backlogFile, PROJECT_CONSTANTS.MD_FILE_EXTENSION);
    const backlog = dataService.getBacklog(backlogId);
    if (!backlog) { vscode.window.showErrorMessage('Backlog not found in data store.'); return; }

    for (const p of picked) {
      const taskObj = (p as any).task;
      if (!taskObj) continue;

      if (!backlog.tasks.includes(taskObj.id)) {
        backlog.tasks.push(taskObj.id);
      }

      dataService.updateTask(taskObj.id, { backlog: backlogId });
      dataService.saveTaskMd(taskObj);
    }

    dataService.updateBacklog(backlog.id, { tasks: backlog.tasks });
    dataService.saveBacklogMd(backlog);

    vscode.window.showInformationMessage('Tasks added to backlog.');
  } catch (err) {
    console.error(err);
    vscode.window.showErrorMessage('Failed to update backlog.');
  }
}

export async function addTaskToBacklogInteractive(item: any) {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) { vscode.window.showErrorMessage('No workspace folder open.'); return; }

  const backlogFile: string | undefined = item?.filePath;
  if (!backlogFile) { vscode.window.showErrorMessage('Backlog file not found for this item.'); return; }

  const taskName = await vscode.window.showInputBox({ prompt: 'Task title' });
  if (!taskName) return;

  try {
    const createdTask = await taskService.createTask(ws, {
      title: taskName,
      type: 'feature',
      status: 'waiting',
      priority: 'medium'
    });

    const dataService = getDataService(ws);
    const backlogId = path.basename(backlogFile, PROJECT_CONSTANTS.MD_FILE_EXTENSION);
    const backlog = dataService.getBacklog(backlogId);
    if (!backlog) { vscode.window.showErrorMessage('Backlog not found.'); return; }

    if (!backlog.tasks.includes(createdTask.id)) {
      backlog.tasks.push(createdTask.id);
    }

    dataService.updateBacklog(backlog.id, { tasks: backlog.tasks });
    dataService.saveBacklogMd(backlog);

    dataService.updateTask(createdTask.id, { backlog: backlogId });
    dataService.saveTaskMd(createdTask);

    vscode.window.showInformationMessage('Task added to backlog.');
  } catch (e) {
    console.error(e);
    vscode.window.showErrorMessage('Failed to add task to backlog.');
  }
}