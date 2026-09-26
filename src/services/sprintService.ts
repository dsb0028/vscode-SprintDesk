import * as path from 'path';
import * as crypto from 'crypto';
import * as fileService from './fileService';
import { getDataService } from '../data/DataService';
import { Sprint } from '../data/types';

export function createSprint(nameParts: { d1: string; mo1: string; d2: string; mo2: string; yy: string; yyyy: string; title?: string }): string {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) throw new Error('No workspace');

  const { d1, mo1, d2, mo2, yy, yyyy, title } = nameParts;

  const dataService = getDataService(ws);
  const sprintNumber = dataService.generateNextNumber('sprint');
  const config = dataService.loadConfig();
  const sprintPrefix = config.ids.sprint.prefix;

  const sprintTitle = title || `${d1}-${mo1}-${yy} ➜ ${d2}-${mo2}-${yy}`;
  const sprintName = `[${sprintPrefix}-${sprintNumber}]_${sprintTitle}`;

  const sprint: Sprint = {
    id: crypto.randomUUID(),
    number: sprintNumber,
    title: sprintTitle,
    name: sprintName,
    startDate: `${d1}-${mo1}-${yyyy}`,
    endDate: `${d2}-${mo2}-${yyyy}`,
    status: 'planned',
    tasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  sprint.path = path.join(dataService.getSprintsDir(), dataService.getSprintFilename(sprint));

  dataService.addSprint(sprint);
  dataService.saveSprintMd(sprint);

  return sprint.path;
}

export function getSprints(ws: string): Sprint[] {
  const dataService = getDataService(ws);
  return dataService.loadSprints();
}

export function getSprint(sprintId: string): Sprint | undefined {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  return dataService.getSprint(sprintId);
}

export function updateSprint(sprintId: string, updates: Partial<Sprint>): void {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  dataService.updateSprint(sprintId, updates);
  const updated = dataService.getSprint(sprintId);
  if (updated) dataService.saveSprintMd(updated);
}

export function deleteSprint(sprintId: string): void {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  dataService.deleteSprint(sprintId);
}

export function getTasksFromSprint(sprintId: string): { label: string; path: string; id: string }[] {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  const sprint = dataService.getSprint(sprintId);
  if (!sprint || !sprint.tasks) return [];

  const tasks = dataService.loadTasks();
  const tasksDir = dataService.getTasksDir();

  return tasks.filter(t => sprint.tasks.includes(t.id)).map(t => ({
    label: t.title,
    path: path.join(tasksDir, dataService.getTaskFilename(t)),
    id: t.id
  }));
}

export function getTasksFromSprintById(sprintId: string): { label: string; path: string; id: string }[] {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  const sprint = dataService.getSprint(sprintId);
  if (!sprint || !sprint.tasks) return [];

  const tasks = dataService.loadTasks();
  const tasksDir = dataService.getTasksDir();

  return tasks.filter(t => sprint.tasks.includes(t.id)).map(t => ({
    label: t.title,
    path: path.join(tasksDir, dataService.getTaskFilename(t)),
    id: t.id
  }));
}

export function getSprintPath(sprintName: string): string {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  const sprints = dataService.loadSprints();
  const sprint = sprints.find(s => s.name.includes(sprintName) || s.id === sprintName);
  if (!sprint) return '';

  return path.join(fileService.getSprintsDir(ws), `${sprint.id}.md`);
}

export function addTaskToSprint(sprintPath: string, taskPath: string): void {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;

  const dataService = getDataService(ws);
  const sprintName = path.basename(sprintPath, '.md');
  const taskName = path.basename(taskPath, '.md');

  const sprints = dataService.loadSprints();
  const sprint = sprints.find(s => s.id === sprintName || s.name.includes(sprintName));
  if (!sprint) return;

  const tasks = dataService.loadTasks();
  const task = tasks.find(t => t.id === taskName);
  if (!task) return;

  if (!sprint.tasks.includes(task.id)) {
    sprint.tasks.push(task.id);
    dataService.updateSprint(sprint.id, { tasks: sprint.tasks });
    dataService.saveSprintMd(sprint);
  }

  dataService.updateTask(task.id, { sprint: sprint.id });
  dataService.saveTaskMd(task);
}

export function removeTaskFromSprint(sprintPath: string, taskPath: string): void {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;

  const dataService = getDataService(ws);
  const sprintName = path.basename(sprintPath, '.md');
  const taskName = path.basename(taskPath, '.md');

  const sprints = dataService.loadSprints();
  const sprint = sprints.find(s => s.id === sprintName || s.name.includes(sprintName));
  if (!sprint) return;

  const tasks = dataService.loadTasks();
  const task = tasks.find(t => t.id === taskName);
  if (!task) return;

  sprint.tasks = sprint.tasks.filter(t => t !== task.id);
  dataService.updateSprint(sprint.id, { tasks: sprint.tasks });
  dataService.saveSprintMd(sprint);

  dataService.updateTask(task.id, { sprint: null });
  dataService.saveTaskMd(task);
}

export function addTaskToSprintById(sprintId: string, taskId: string): void {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;

  const dataService = getDataService(ws);
  const sprint = dataService.getSprint(sprintId);
  if (!sprint) return;

  const task = dataService.getTask(taskId);
  if (!task) return;

  if (!sprint.tasks) {
    sprint.tasks = [];
  }

  if (!sprint.tasks.includes(task.id)) {
    sprint.tasks.push(task.id);
    dataService.updateSprint(sprint.id, { tasks: sprint.tasks });
    dataService.saveSprintMd(sprint);
  }

  dataService.updateTask(task.id, { sprint: sprint.name });
  dataService.saveTaskMd(task);
}

export function removeTaskFromSprintById(sprintId: string, taskId: string): void {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;

  const dataService = getDataService(ws);
  const sprint = dataService.getSprint(sprintId);
  if (!sprint) return;

  const task = dataService.getTask(taskId);
  if (!task) return;

  sprint.tasks = sprint.tasks.filter(t => t !== task.id);
  dataService.updateSprint(sprint.id, { tasks: sprint.tasks });
  dataService.saveSprintMd(sprint);

  dataService.updateTask(task.id, { sprint: null });
  dataService.saveTaskMd(task);
}