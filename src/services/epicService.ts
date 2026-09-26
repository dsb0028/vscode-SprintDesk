import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as fileService from './fileService';
import { PROJECT_CONSTANTS } from '../utils/constant';
import { getDataService } from '../data/DataService';
import { Epic } from '../data/types';

function getDs() {
  const ws = fileService.getWorkspaceRoot();
  return ws ? getDataService(ws) : undefined;
}

export async function createNewEpic(epicMetadata: SprintDesk.EpicMetadata): Promise<SprintDesk.EpicMetadata> {
  const ws = fileService.getWorkspaceRoot();
  const title = epicMetadata.title;
  if (!title) throw new Error('Epic title is required');

  const category = epicMetadata.category || 'MISC';

  const dataService = getDataService(ws);
  const epicId = crypto.randomUUID();
  const epicNumber = dataService.generateNextNumber('epic');
  const epicCode = dataService.generateCode('epic', epicNumber);

  const epic: Epic = {
    id: epicId,
    number: epicNumber,
    code: epicCode,
    name: '',
    title: title,
    category: category,
    description: epicMetadata.description || '',
    status: 'planned',
    priority: 'medium',
    tasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  epic.name = `[${epicCode}]_${category}_${dataService.slugifyTitle(title)}`;
  epic.path = path.join(dataService.getEpicsDir(), dataService.getEpicFilename(epic));

  dataService.addEpic(epic);
  dataService.saveEpicMd(epic);

  return {
    _id: epic.id as any,
    title: epic.title,
    status: epic.status as SprintDesk.EpicStatus,
    priority: epic.priority as SprintDesk.Priority,
    createdAt: epic.createdAt,
    updatedAt: epic.updatedAt,
    totalTasks: 0,
    completedTasks: 0,
    path: epic.path
  };
}

export function createEpic(name: string, category?: string): string {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) throw new Error('No workspace');

  const dataService = getDataService(ws);
  const epicId = crypto.randomUUID();
  const epicNumber = dataService.generateNextNumber('epic');
  const epicCode = dataService.generateCode('epic', epicNumber);
  const epicCategory = category || 'MISC';

  const epic: Epic = {
    id: epicId,
    number: epicNumber,
    code: epicCode,
    name: '',
    title: name,
    category: epicCategory,
    description: '',
    status: 'planned',
    priority: 'medium',
    tasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  epic.name = `[${epicCode}]_${epicCategory}_${dataService.slugifyTitle(name)}`;
  epic.path = path.join(dataService.getEpicsDir(), dataService.getEpicFilename(epic));

  dataService.addEpic(epic);
  dataService.saveEpicMd(epic);

  return epic.path;
}

export function addTaskToEpic(epicTitleOrPath: string, taskNameOrPath: string) {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) throw new Error('No workspace');

  // Support both title and path
  let epicTitle = epicTitleOrPath;
  let taskName = taskNameOrPath;
  
  if (epicTitleOrPath.includes(path.sep)) {
    epicTitle = path.basename(epicTitleOrPath, '.md');
  }
  if (taskNameOrPath.includes(path.sep)) {
    taskName = path.basename(taskNameOrPath, '.md');
  }

  const dataService = getDataService(ws);
  const epics = dataService.loadEpics();
  const epic = epics.find(e => e.name === epicTitle || e.id === epicTitle);
  if (!epic) return;

  const taskPath = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.TASKS_DIR, taskName);
  const taskContent = fileService.readFileSyncSafe(taskPath);
  if (!taskContent) return;

  const tm = require('gray-matter')(taskContent);
  const taskId = tm.data._id || tm.data.id || path.basename(taskName, PROJECT_CONSTANTS.MD_FILE_EXTENSION);

  if (!epic.tasks.includes(taskId)) {
    epic.tasks.push(taskId);
  }

  dataService.updateEpic(epic.id, { tasks: epic.tasks, updatedAt: new Date().toISOString() });
  dataService.saveEpicMd(epic);

  const allTasks = dataService.loadTasks();
  const taskObj = allTasks.find(t => t.id === taskId);
  if (taskObj) {
    taskObj.epic = epic.name;
    dataService.updateTask(taskObj.id, { epic: epic.name });
    dataService.saveTaskMd(taskObj);
  }
}

export function addTaskToEpicById(epicId: string, taskId: string) {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const epics = dataService.loadEpics();
  const epic = epics.find(e => e.id === epicId || e.name === epicId);
  if (!epic) return;

  if (!epic.tasks) {
    epic.tasks = [];
  }
  
  if (!epic.tasks.includes(taskId)) {
    epic.tasks.push(taskId);
  }

  dataService.updateEpic(epic.id, { tasks: epic.tasks, updatedAt: new Date().toISOString() });
  dataService.saveEpicMd(epic);

  const taskObj = dataService.loadTasks().find(t => t.id === taskId);
  if (taskObj) {
    const oldEpicId = taskObj.epic;
    const oldEpic = oldEpicId ? epics.find(e => e.name === oldEpicId || e.id === oldEpicId) : undefined;
    
    const newCode = updateTaskCodeForNewEpic(oldEpic, epic, taskObj, dataService, taskId);
    if (newCode !== taskObj.code) {
      renameTaskFile(taskObj, newCode, dataService);
      taskObj.code = newCode;
      taskObj.number = parseInt(newCode.split('.')[1]) || taskObj.number;
    }
    
    taskObj.epic = epic.name;
    dataService.updateTask(taskId, { 
      epic: epic.name,
      code: taskObj.code,
      number: taskObj.number,
      name: taskObj.name,
      path: taskObj.path
    });
    dataService.saveTaskMd(taskObj);
  }
}

export function addTaskToEpicByName(epicName: string, taskId: string) {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const epics = dataService.loadEpics();
  const epic = epics.find(e => e.name === epicName);
  if (!epic) return;

  if (!epic.tasks.includes(taskId)) {
    epic.tasks.push(taskId);
  }

  dataService.updateEpic(epic.id, { tasks: epic.tasks, updatedAt: new Date().toISOString() });
  dataService.saveEpicMd(epic);

  const taskObj = dataService.loadTasks().find(t => t.id === taskId);
  if (taskObj) {
    taskObj.epic = epic.name;
    dataService.updateTask(taskId, { epic: epic.name });
    dataService.saveTaskMd(taskObj);
  }
}

export function removeTaskFromEpic(epicTitleOrPath: string, taskPath: string) {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  let epicTitle = epicTitleOrPath;
  if (epicTitleOrPath.includes(path.sep)) {
    epicTitle = path.basename(epicTitleOrPath, '.md');
  }
  const taskName = path.basename(taskPath, '.md');

  const dataService = getDataService(ws);
  const epics = dataService.loadEpics();
  const epic = epics.find(e => e.name === epicTitle || e.id === epicTitle);
  if (!epic) return;

  epic.tasks = epic.tasks.filter(t => t !== taskName);
  dataService.updateEpic(epic.id, { tasks: epic.tasks, updatedAt: new Date().toISOString() });
  dataService.saveEpicMd(epic);

  const task = dataService.getTask(taskName);
  if (task) {
    task.epic = '';
    dataService.updateTask(task.id, { epic: '' });
    dataService.saveTaskMd(task);
  }
}

export function removeTaskFromEpicById(epicId: string, taskId: string) {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const epics = dataService.loadEpics();
  const epic = epics.find(e => e.id === epicId || e.name === epicId);
  if (!epic || !epic.tasks) return;

  epic.tasks = epic.tasks.filter(t => t !== taskId);
  dataService.updateEpic(epic.id, { tasks: epic.tasks, updatedAt: new Date().toISOString() });
  dataService.saveEpicMd(epic);

  const task = dataService.getTask(taskId);
  if (task) {
    task.epic = '';
    dataService.updateTask(task.id, { epic: '' });
    dataService.saveTaskMd(task);
  }
}

export function removeTaskFromEpicByName(epicName: string, taskId: string) {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return;
  
  const dataService = getDataService(ws);
  const epics = dataService.loadEpics();
  const epic = epics.find(e => e.name === epicName);
  if (!epic) return;

  epic.tasks = epic.tasks.filter(t => t !== taskId);
  dataService.updateEpic(epic.id, { tasks: epic.tasks, updatedAt: new Date().toISOString() });
  dataService.saveEpicMd(epic);

  const task = dataService.getTask(taskId);
  if (task) {
    task.epic = '';
    dataService.updateTask(task.id, { epic: '' });
    dataService.saveTaskMd(task);
  }
}

function updateTaskCodeForNewEpic(oldEpic: Epic | undefined, newEpic: Epic, task: any, dataService: any, currentTaskId: string): string {
  const config = dataService.loadConfig();
  
  let newNumber: number;
  if (oldEpic && oldEpic.id === newEpic.id) {
    newNumber = task.number;
  } else {
    const existingTasks = (newEpic.tasks || []).filter((tid: string) => tid !== currentTaskId);
    let maxNum = 0;
    for (const tid of existingTasks) {
      const t = dataService.getTask(tid);
      if (t && t.number && t.number > maxNum) maxNum = t.number;
    }
    newNumber = maxNum > 0 ? maxNum + 1 : config.ids.task.startNumber;
  }
  
  const newCode = `${newEpic.code}.${newNumber}`;
  return newCode;
}

function renameTaskFile(task: any, newCode: string, dataService: any): void {
  const ws = fileService.getWorkspaceRoot();
  const tasksDir = fileService.getTasksDir(ws);
  const oldPath = task.path;
  
  const titleSlug = dataService.slugifyTitle(task.title || 'untitled');
  const newFilename = `[${newCode}]_${titleSlug}.md`;
  const newPath = path.join(tasksDir, newFilename);
  
  if (oldPath && fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
    task.path = newPath;
    task.name = newFilename;
  }
}

export function getEpics(ws: string): Epic[] {
  const dataService = getDataService(ws);
  return dataService.loadEpics();
}

export function getEpic(epicId: string): Epic | undefined {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  return dataService.getEpic(epicId);
}

export function updateEpic(epicId: string, updates: Partial<Epic>): void {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  dataService.updateEpic(epicId, updates);
  const updated = dataService.getEpic(epicId);
  if (updated) dataService.saveEpicMd(updated);
}

export function deleteEpic(epicId: string): void {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  dataService.deleteEpic(epicId);
}

export function listEpics(ws: string): string[] {
  const dataService = getDataService(ws);
  const epics = dataService.loadEpics();
  const epicsDir = fileService.getEpicsDir(ws);
  
  return epics.map(epic => {
    const filename = dataService.getEpicFilename(epic);
    return require('path').join(epicsDir, filename);
  });
}

export function readEpic(filePath: string): string {
  const dataService = getDataService(fileService.getWorkspaceRoot());
  return fs.readFileSync(filePath, 'utf8');
}

export function getTasksFromEpic(epicName: string): { label: string; path: string; id: string }[] {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  const epic = dataService.loadEpics().find(e => e.name === epicName || e.id === epicName);
  if (!epic) return [];
  
  const tasks = dataService.loadTasks();
  const config = dataService.loadConfig();
  const tasksDir = dataService.getTasksDir();
  
  return tasks.filter(t => epic.tasks.includes(t.id)).map(t => {
    const filename = dataService.getTaskFilename(t);
    return {
      label: t.title,
      path: require('path').join(tasksDir, filename),
      id: t.id
    };
  });
}

export function getTasksFromEpicById(epicId: string): { label: string; path: string; id: string }[] {
  const ws = fileService.getWorkspaceRoot();
  const dataService = getDataService(ws);
  const epic = dataService.loadEpics().find(e => e.id === epicId);
  if (!epic) return [];
  
  const tasks = dataService.loadTasks();
  const tasksDir = dataService.getTasksDir();
  
  return tasks.filter(t => epic.tasks.includes(t.id)).map(t => {
    const filename = dataService.getTaskFilename(t);
    return {
      label: t.title,
      path: require('path').join(tasksDir, filename),
      id: t.id
    };
  });
}