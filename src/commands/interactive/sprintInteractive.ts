import * as vscode from 'vscode';
import * as path from 'path';
import * as fileService from '../../services/fileService';
import * as taskService from '../../services/taskService';
import { getDataService } from '../../data/DataService';
import { PROJECT_CONSTANTS } from '../../utils/constant';
import { createSprint } from '../../services/sprintService';

export async function createSprintInteractive() {
  const input = await vscode.window.showInputBox({
    prompt: 'Enter: @from DD-MM @to DD-MM @year YYYY @title Title',
    placeHolder: '@from 23-04 @to 30-04 @year 2026 @title Starting'
  });
  if (!input) return;

  const fromMatch = input.match(/@from\s+(\d{2})-(\d{2})/i);
  const toMatch = input.match(/@to\s+(\d{2})-(\d{2})/i);
  const yearMatch = input.match(/@year\s+(\d{4})/i);
  const titleMatch = input.match(/@title\s+(.+)/i);

  if (!fromMatch || !toMatch) {
    vscode.window.showErrorMessage('Format: @from DD-MM @to DD-MM @year YYYY @title Title');
    return;
  }

  const d1 = fromMatch[1], mo1 = fromMatch[2];
  const d2 = toMatch[1], mo2 = toMatch[2];
  const yy = new Date().getFullYear().toString().slice(-2);
  const yyyy = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();

  const title = titleMatch ? titleMatch[1].trim() : undefined;
  createSprint({ d1, mo1, d2, mo2, yy, yyyy, title });
  vscode.window.showInformationMessage('Sprint created.');
}

export async function addExistingTasksToSprint(item: any) {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) { vscode.window.showErrorMessage('No workspace folder open.'); return; }

  const sprintFile: string | undefined = item?.filePath;
  if (!sprintFile) { vscode.window.showErrorMessage('Sprint file not found.'); return; }

  const tasks = taskService.loadTasks();
  if (!tasks.length) { vscode.window.showInformationMessage('No tasks found.'); return; }

  const itemsQP = tasks.map(t => ({
    label: t.title,
    taskId: t.id,
    task: t
  }));

  const picked = await vscode.window.showQuickPick(itemsQP, { canPickMany: true, title: 'Select tasks to add to Sprint' });
  if (!picked || picked.length === 0) return;

  try {
    const dataService = getDataService(ws);
    const sprintId = path.basename(sprintFile, PROJECT_CONSTANTS.MD_FILE_EXTENSION);
    const sprint = dataService.getSprint(sprintId);
    if (!sprint) { vscode.window.showErrorMessage('Sprint not found in data store.'); return; }

    for (const p of picked) {
      const taskObj = (p as any).task;
      if (!taskObj) continue;

      if (!sprint.tasks.includes(taskObj.id)) {
        sprint.tasks.push(taskObj.id);
      }

      dataService.updateTask(taskObj.id, { sprint: sprint.id });
      dataService.saveTaskMd(taskObj);
    }

    dataService.updateSprint(sprint.id, { tasks: sprint.tasks });
    dataService.saveSprintMd(sprint);

    vscode.window.showInformationMessage('Tasks added to sprint.');
  } catch (err) {
    console.error(err);
    vscode.window.showErrorMessage('Failed to update sprint.');
  }
}

export async function startFeatureFromTask(item: any) {
  try {
    const workspaceRoot = fileService.getWorkspaceRoot();
    if (!workspaceRoot) { vscode.window.showErrorMessage('No workspace folder open.'); return; }

    const taskSlug: string | undefined = item?.taskSlug || item?.label?.toString()?.replace(/\s+/g, '-');
    const taskFilePath: string | undefined = item?.taskFilePath;
    if (!taskSlug) { vscode.window.showErrorMessage('Unable to infer task name.'); return; }

    const terminal = vscode.window.createTerminal({ name: 'SprintDesk: git flow' });
    terminal.show(true);
    terminal.sendText(`cd "${workspaceRoot}"`);
    terminal.sendText(`git flow feature start ${taskSlug}`);

    const dateStr = new Date().toISOString();

    if (taskFilePath) {
      const uri = vscode.Uri.file(taskFilePath);
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString('utf8');
      let updated = text;
      const statusRegex = /(\n- \*\*📍 Status:\*\*.*\n)([\s\S]*)/;
      if (statusRegex.test(text)) {
        updated = text.replace(statusRegex, (_m: any, head: string, tail: string) => `${head}\n- **🟢 Started:** ${dateStr}\n${tail}`);
      } else {
        updated = `${text}\n\n- **🟢 Started:** ${dateStr}\n`;
      }
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));

      try {
        const dataService = getDataService(workspaceRoot);
        const tm = require('gray-matter')(updated);
        const taskId = tm.data._id || tm.data.id || undefined;
        if (taskId) {
          dataService.updateTask(taskId, { status: 'in-progress' });
          const taskObj = dataService.getTask(taskId);
          if (taskObj) dataService.saveTaskMd(taskObj);
        }
      } catch (e) { console.error('Failed to sync task status to YAML', e); }
    }

    if (taskFilePath && item?.taskSlug) {
      try {
        const dataService = getDataService(workspaceRoot);
        const sprintId = path.basename(taskFilePath, PROJECT_CONSTANTS.MD_FILE_EXTENSION);
        const sprint = dataService.getSprint(sprintId);
        if (sprint && item?.taskFileName) {
          const taskId = item.taskSlug || path.basename(item.taskFileName, PROJECT_CONSTANTS.MD_FILE_EXTENSION);
          if (!sprint.tasks.includes(taskId)) sprint.tasks.push(taskId);
          dataService.updateSprint(sprint.id, { tasks: sprint.tasks });
          dataService.saveSprintMd(sprint);
        }
      } catch (e) { console.error('Failed to sync sprint from task start', e); }
    }
  } catch (e) {
    vscode.window.showErrorMessage('Failed to start feature from task.');
  }
}