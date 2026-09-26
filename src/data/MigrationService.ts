import * as path from 'path';
import * as fs from 'fs';
import matter from 'gray-matter';
import { getDataService } from './DataService';
import * as taskService from '../services/taskService';
import { Task, Backlog, Epic, Sprint } from './types';

const SPRINTDESK_DIR = '.SprintDesk';
const TASKS_DIR = 'tasks';
const EPICS_DIR = 'epics';
const BACKLOGS_DIR = 'Backlogs';
const SPRINTS_DIR = 'Sprints';

export interface MigrationResult {
  tasks: number;
  epics: number;
  backlogs: number;
  sprints: number;
  errors: string[];
}

export async function migrateFromMdFiles(workspaceRoot: string): Promise<MigrationResult> {
  const dataService = getDataService(workspaceRoot);
  const config = dataService.loadConfig();
  const sdPath = path.join(workspaceRoot, SPRINTDESK_DIR);

  const result: MigrationResult = {
    tasks: 0,
    epics: 0,
    backlogs: 0,
    sprints: 0,
    errors: []
  };

  const existingTasks = dataService.loadTasks();
  const existingBacklogs = dataService.loadBacklogs();
  const existingEpics = dataService.loadEpics();
  const existingSprints = dataService.loadSprints();

  // Migrate Tasks
  const tasksPath = path.join(sdPath, config.directories.tasks);
  if (fs.existsSync(tasksPath)) {
    const taskFiles = fs.readdirSync(tasksPath).filter(f => f.endsWith('.md'));
    for (const file of taskFiles) {
      try {
        const filePath = path.join(tasksPath, file);
        const { data, content } = matter.read(filePath);

        if (existingTasks.find(t => t.id === data._id || t.title === data.title)) {
          continue; // Skip duplicates
        }

        const taskCount = dataService.loadTasks().length;
        const taskNumber = taskCount + 1;
        const task: Task = {
          id: data._id || data.id || crypto.randomUUID(),
          number: taskNumber,
          code: data.code || `task_${taskNumber}`,
          name: '',
          title: data.title || path.basename(file, '.md').replace(/^\[Task\]_/, '').replace(/_/g, ' '),
          type: data.type || 'feature',
          status: data.status || 'waiting',
          priority: data.priority || 'medium',
          epic: data.epic || null,
          backlog: data.backlog || extractBacklogFromContent(content) || config.defaults.backlog || 'features',
          sprint: data.sprint || null,
          createdAt: data.createdAt || new Date().toISOString(),
          updatedAt: data.updatedAt || new Date().toISOString()
        };
        
        // Set name from filename
        task.name = path.basename(file, '.md');

        // Use TaskService migration helper to preserve original ids/codes
        try {
          taskService.createTaskFromData(workspaceRoot, task as any);
        } catch (e) {
          // fallback to dataService if TaskService fails
          dataService.addTask(task);
        }
        result.tasks++;
      } catch (e) {
        result.errors.push(`Failed to migrate task: ${file}`);
      }
    }
  }

  // Migrate Backlogs
  const backlogsPath = path.join(sdPath, BACKLOGS_DIR);
  if (fs.existsSync(backlogsPath)) {
    const backlogFiles = fs.readdirSync(backlogsPath).filter(f => f.endsWith('.md'));
    for (const file of backlogFiles) {
      try {
        const filePath = path.join(backlogsPath, file);
        const { data, content } = matter.read(filePath);

        const id = file
          .replace('.md', '')
          .replace(/^\[Backlog\]_/, '')
          .toLowerCase();

        if (existingBacklogs.find(b => b.id === id)) {
          continue;
        }

        const backlogTasks = extractTasksFromBacklogMd(filePath);
        const backlogTitle = data.title || path.basename(file, '.md').replace(/^\[Backlog\]_/, '').replace(/_/g, ' ').toUpperCase();
        const backlog: Backlog = {
          id,
          title: backlogTitle,
          name: `[Backlog]_${backlogTitle}`,
          description: data.description || '',
          tasks: backlogTasks,
          color: data.color || '#2563eb'
        };

        dataService.addBacklog(backlog);
        result.backlogs++;
      } catch (e) {
        result.errors.push(`Failed to migrate backlog: ${file}`);
      }
    }
  }

  // Migrate Epics
  const epicsPath = path.join(sdPath, config.directories.epics);
  if (fs.existsSync(epicsPath)) {
    const epicFiles = fs.readdirSync(epicsPath).filter(f => f.endsWith('.md'));
    for (const file of epicFiles) {
      try {
        const filePath = path.join(epicsPath, file);
        const { data, content } = matter.read(filePath);

        if (existingEpics.find(e => e.id === data._id || e.name === data.title)) {
          continue;
        }

        const epicTasks = extractTasksFromEpicMd(filePath);
        const epicCount = dataService.loadEpics().length;
        const epicNumber = epicCount + 1;
        const epicCode = `epic_${epicNumber}`;
        const epic: Epic = {
          id: data._id || data.id || crypto.randomUUID(),
          number: epicNumber,
          code: epicCode,
          name: '',
          title: data.title || path.basename(file, '.md').replace(/^\[Epic\]_/, '').replace(/_/g, ' '),
          category: data.category || 'MISC',
          description: data.description || '',
          status: data.status || 'planned',
          priority: data.priority || 'medium',
          tasks: epicTasks,
          createdAt: data.createdAt || new Date().toISOString(),
          updatedAt: data.updatedAt || new Date().toISOString()
        };

        epic.name = `[${epicCode}]_${epic.category}_${dataService.slugifyTitle(epic.title)}`;

        dataService.addEpic(epic);
        result.epics++;
      } catch (e) {
        result.errors.push(`Failed to migrate epic: ${file}`);
      }
    }
  }

  // Migrate Sprints
  const sprintsPath = path.join(sdPath, config.directories.sprints);
  if (fs.existsSync(sprintsPath)) {
    const sprintFiles = fs.readdirSync(sprintsPath).filter(f => f.endsWith('.md'));
    for (const file of sprintFiles) {
      try {
        const filePath = path.join(sprintsPath, file);
        const { data, content } = matter.read(filePath);

        const id = file
          .replace('.md', '')
          .replace(/^\[Sprint\]_/, '')
          .toLowerCase();

        if (existingSprints.find(s => s.id === id)) {
          continue;
        }

        const sprintTasks = extractTasksFromSprintMd(filePath);
        const sprintTitle = data.title || path.basename(file, '.md').replace(/^\[Sprint\]_/, '').replace(/_/g, ' ');
        const sprintNumber = parseInt(id.replace('sprint_', '')) || (existingSprints.length + 1);
        const sprint: Sprint = {
          id,
          number: sprintNumber,
          title: sprintTitle,
          name: data.name || path.basename(file, '.md'),
          startDate: data.startDate || '',
          endDate: data.endDate || '',
          status: data.status || 'planned',
          tasks: sprintTasks,
          createdAt: data.createdAt || new Date().toISOString(),
          updatedAt: data.updatedAt || new Date().toISOString()
        };

        dataService.addSprint(sprint);
        result.sprints++;
      } catch (e) {
        result.errors.push(`Failed to migrate sprint: ${file}`);
      }
    }
  }

  return result;
}

function extractTasksFromBacklogMd(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const tasks: string[] = [];

  const linkRegex = /\[([^\]]+)\]\([^)]+\.md\)/g;
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const taskTitle = match[1].trim();
    tasks.push(taskTitle);
  }

  return tasks;
}

function extractTasksFromEpicMd(filePath: string): string[] {
  return extractTasksFromBacklogMd(filePath);
}

function extractTasksFromSprintMd(filePath: string): string[] {
  return extractTasksFromBacklogMd(filePath);
}

function extractBacklogFromContent(content: string): string | null {
  return null;
}