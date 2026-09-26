import * as path from 'path';
import * as fs from 'fs';
import * as fileService from './fileService';
import { PROJECT_CONSTANTS } from '../utils/constant';
import { getDataService } from '../data/DataService';
import { Backlog } from '../data/types';

export function getBacklogs(ws: string): Backlog[] {
  const dataService = getDataService(ws);
  return dataService.loadBacklogs();
}

export function getBacklog(backlogId: string): Backlog | undefined {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  return dataService.getBacklog(backlogId);
}

export function updateBacklog(backlogId: string, updates: Partial<Backlog>): void {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  dataService.updateBacklog(backlogId, updates);
  const updated = dataService.getBacklog(backlogId);
  if (updated) dataService.saveBacklogMd(updated);
}

export function deleteBacklog(backlogId: string): void {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  dataService.deleteBacklog(backlogId);
}

export function addTaskToBacklog(backlogPath: string, taskPath: string): void {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const backlogName = path.basename(backlogPath, '.md');
  const taskName = path.basename(taskPath, '.md');
  
  const backlogs = dataService.loadBacklogs();
  const backlog = backlogs.find(b => b.id === backlogName);
  if (!backlog) return;
  
  const tasks = dataService.loadTasks();
  const task = tasks.find(t => t.id === taskName);
  if (!task) return;
  
  if (!backlog.tasks.includes(task.id)) {
    backlog.tasks.push(task.id);
    dataService.updateBacklog(backlog.id, { tasks: backlog.tasks });
    dataService.saveBacklogMd(backlog);
  }
  
  dataService.updateTask(task.id, { backlog: backlog.id });
  dataService.saveTaskMd(task);
}

export function removeTaskFromBacklog(backlogPath: string, taskPath: string): void {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const backlogName = path.basename(backlogPath, '.md');
  const taskName = path.basename(taskPath, '.md');
  
  const backlogs = dataService.loadBacklogs();
  const backlog = backlogs.find(b => b.id === backlogName);
  if (!backlog) return;
  
  const tasks = dataService.loadTasks();
  const task = tasks.find(t => t.id === taskName);
  if (!task) return;
  
  backlog.tasks = backlog.tasks.filter(t => t !== task.id);
  dataService.updateBacklog(backlog.id, { tasks: backlog.tasks });
  dataService.saveBacklogMd(backlog);
  
  dataService.updateTask(task.id, { backlog: '' });
  dataService.saveTaskMd(task);
}

export function addTaskToBacklogById(backlogId: string, taskId: string): void {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const backlog = dataService.getBacklog(backlogId);
  if (!backlog) return;
  
  const task = dataService.getTask(taskId);
  if (!task) return;
  
  if (!backlog.tasks.includes(task.id)) {
    backlog.tasks.push(task.id);
    dataService.updateBacklog(backlog.id, { tasks: backlog.tasks });
    dataService.saveBacklogMd(backlog);
  }
  
  dataService.updateTask(task.id, { backlog: backlog.id });
  dataService.saveTaskMd(task);
}

export function removeTaskFromBacklogById(backlogId: string, taskId: string): void {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const backlog = dataService.getBacklog(backlogId);
  if (!backlog) return;
  
  const task = dataService.getTask(taskId);
  if (!task) return;
  
  backlog.tasks = backlog.tasks.filter(t => t !== task.id);
  dataService.updateBacklog(backlog.id, { tasks: backlog.tasks });
  dataService.saveBacklogMd(backlog);
  
  dataService.updateTask(task.id, { backlog: '' });
  dataService.saveTaskMd(task);
}

export function getTasksFromBacklog(backlogId: string): { label: string; path: string; id: string }[] {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  const backlog = dataService.getBacklog(backlogId);
  if (!backlog || !backlog.tasks) return [];

  const tasks = dataService.loadTasks();
  const tasksDir = dataService.getTasksDir();

  return tasks.filter(t => backlog.tasks.includes(t.id)).map(t => ({
    label: t.title,
    path: path.join(tasksDir, dataService.getTaskFilename(t)),
    id: t.id
  }));
}

export function getTasksFromBacklogById(backlogId: string): { label: string; path: string; id: string }[] {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  const backlog = dataService.getBacklog(backlogId);
  if (!backlog || !backlog.tasks) return [];

  const tasks = dataService.loadTasks();
  const tasksDir = dataService.getTasksDir();

  return tasks.filter(t => backlog.tasks.includes(t.id)).map(t => ({
    label: t.title,
    path: path.join(tasksDir, dataService.getTaskFilename(t)),
    id: t.id
  }));
}

export function listBacklogs(ws: string): { id: string; filePath: string; title: string; tasks: { label: string; abs?: string }[] }[] {
  const dataService = getDataService(ws);
  const backlogs = dataService.loadBacklogs();
  const tasks = dataService.loadTasks();
  
  return backlogs.map(backlog => ({
    id: backlog.id,
    filePath: path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.BACKLOGS_DIR, `${backlog.id}.md`),
    title: backlog.name,
    tasks: tasks.filter(t => backlog.tasks.includes(t.id)).map(t => ({
      label: t.title,
      abs: path.join(dataService.getTasksDir(), dataService.getTaskFilename(t))
    }))
  }));
}

export function listBacklogsSummary(ws: string): { filePath: string; title: string; tasks: { label: string; abs?: string }[] }[] {
  return listBacklogs(ws);
}

export function readBacklog(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

export function updateBacklogContent(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, 'utf8');
}

export function deleteBacklogFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}