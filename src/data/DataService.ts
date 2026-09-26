import * as path from 'path';
import yaml from 'js-yaml';
import { getHost, getFileSystem, IFileSystem } from '../host';
import { Config, Task, Epic, Backlog, Sprint, TasksData, EpicsData, BacklogsData, SprintsData, DEFAULT_CONFIG } from './types';

const SPRINTDESK_DIR = '.SprintDesk';
const SETTINGS_DIR = 'settings';
const DATA_DIR = 'data';

export class DataService {
  private workspaceRoot: string;
  private configCache: Config | null = null;

  private get fileSystem(): IFileSystem {
    return getFileSystem();
  }

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot || this.getDefaultWorkspaceRoot();
  }

  private getDefaultWorkspaceRoot(): string {
    return getHost().getWorkspaceRoot() || '';
  }

  setWorkspaceRoot(root: string) {
    this.workspaceRoot = root;
    this.configCache = null;
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  clearConfigCache(): void {
    this.configCache = null;
  }

  private getSprintDeskPath(): string {
    return path.join(this.workspaceRoot, SPRINTDESK_DIR);
  }

  private getDataPath(): string {
    return path.join(this.getSprintDeskPath(), DATA_DIR);
  }

  private getSettingsPath(): string {
    return path.join(this.getSprintDeskPath(), SETTINGS_DIR);
  }

  // === Config ===
  loadConfig(): Config {
    if (this.configCache) {
      return this.configCache;
    }

    const host = getHost();
    const taskPrefix = host.getConfig<string>('taskPrefix') || 'task_';
    const taskStart = host.getConfig<number>('taskStartNumber') || 100;
    const taskPad = host.getConfig<number>('taskPadding') || 3;
    const epicPrefix = host.getConfig<string>('epicPrefix') || 'epic_';
    const epicStart = host.getConfig<number>('epicStartNumber') || 1;
    const epicPad = host.getConfig<number>('epicPadding') || 2;
    const sprintPrefix = host.getConfig<string>('sprintPrefix') || 'sprint_';
    const sprintStart = host.getConfig<number>('sprintStartNumber') || 1;
    const sprintPad = host.getConfig<number>('sprintPadding') || 1;
    const defaultBacklog = host.getConfig<string>('defaultBacklog') || 'features';
    const defaultStatus = host.getConfig<string>('defaultStatus') || 'waiting';
    const defaultPriority = host.getConfig<string>('defaultPriority') || 'medium';
    const showIds = host.getConfig<boolean>('showIds') ?? true;
    const showCompleted = host.getConfig<boolean>('showCompleted') ?? false;
    const projectPrefix = host.getConfig<string>('projectPrefix') || 'SPD';

    this.configCache = {
      projectPrefix,
      ids: {
        task: { prefix: taskPrefix, startNumber: taskStart, padding: taskPad },
        epic: { prefix: epicPrefix, startNumber: epicStart, padding: epicPad },
        sprint: { prefix: sprintPrefix, startNumber: sprintStart, padding: sprintPad },
        backlog: { prefix: '' }
      },
      defaults: {
        backlog: defaultBacklog,
        epic: null,
        sprint: null,
        status: defaultStatus,
        priority: defaultPriority,
        type: 'feature'
      },
      ui: {
        showCompleted,
        defaultView: 'tree',
        showIds,
        dateFormat: 'iso'
      },
      directories: {
        data: 'data',
        tasks: 'Tasks',
        backlogs: 'Backlogs',
        epics: 'Epics',
        sprints: 'Sprints',
        templates: 'templates'
      }
    };

    return this.configCache;
  }

  // === Generate Next Number ===
  generateNextNumber(type: 'task' | 'epic' | 'sprint' | 'backlog'): number {
    const config = this.loadConfig();
    let maxNum = 0;

    if (type === 'task') {
      maxNum = config.ids.task.startNumber - 1;
      const tasks = this.loadTasks();
      tasks.forEach(t => {
        if (t.number && t.number > maxNum) maxNum = t.number;
      });
    } else if (type === 'epic') {
      maxNum = config.ids.epic.startNumber - 1;
      const epics = this.loadEpics();
      epics.forEach(e => {
        if (e.number && e.number > maxNum) maxNum = e.number;
      });
    } else if (type === 'sprint') {
      maxNum = config.ids.sprint.startNumber - 1;
      const sprints = this.loadSprints();
      sprints.forEach(s => {
        if (s.number && s.number > maxNum) maxNum = s.number;
      });
    } else if (type === 'backlog') {
      const backlogs = this.loadBacklogs();
      backlogs.forEach(b => {
        const num = parseInt(b.id.replace(/^\D+/, ''));
        if (!isNaN(num) && num > maxNum) maxNum = num;
      });
    }

    return maxNum + 1;
  }

  // === Generate Code ===
  generateCode(type: 'task' | 'epic', number: number, epicCode?: string): string {
    const config = this.loadConfig();

    if (type === 'epic') {
      return `${config.projectPrefix}-${number}`;
    } else if (type === 'task') {
      if (epicCode) {
        return `${epicCode}.${number}`;
      }
      return `${config.projectPrefix}-${number}`;
    }
    return '';
  }

  // === Generate Next ID (legacy, returns code) ===
  generateId(type: 'task' | 'epic' | 'sprint' | 'backlog'): string {
    const config = this.loadConfig();

    let maxNum = 0;
    let prefix = '';
    let padding = 1;

    if (type === 'task') {
      const idConfig = config.ids.task;
      maxNum = idConfig.startNumber - 1;
      prefix = idConfig.prefix;
      padding = idConfig.padding;
      const tasks = this.loadTasks();
      tasks.forEach(t => {
        const num = parseInt(String(t.code || '').replace(prefix, ''));
        if (!isNaN(num) && num > maxNum) maxNum = num;
      });
    } else if (type === 'epic') {
      const idConfig = config.ids.epic;
      maxNum = idConfig.startNumber - 1;
      prefix = idConfig.prefix;
      padding = idConfig.padding;
      const epics = this.loadEpics();
      epics.forEach(e => {
        const num = parseInt(e.id.replace(prefix, ''));
        if (!isNaN(num) && num > maxNum) maxNum = num;
      });
    } else if (type === 'sprint') {
      const idConfig = config.ids.sprint;
      maxNum = idConfig.startNumber - 1;
      prefix = idConfig.prefix;
      padding = idConfig.padding;
      const sprints = this.loadSprints();
      sprints.forEach(s => {
        const num = parseInt(s.id.replace(prefix, ''));
        if (!isNaN(num) && num > maxNum) maxNum = num;
      });
    } else if (type === 'backlog') {
      prefix = config.ids.backlog.prefix;
      const backlogs = this.loadBacklogs();
      backlogs.forEach(b => {
        const num = parseInt(b.id.replace(/^\D+/, ''));
        if (!isNaN(num) && num > maxNum) maxNum = num;
      });
    }

    const nextNum = maxNum + 1;
    return `${prefix}${nextNum.toString().padStart(padding, '0')}`;
  }

  // === Tasks ===
  loadTasks(): Task[] {
    const tasksPath = path.join(this.getDataPath(), 'tasks.yml');
    try {
      if (!this.fileSystem.exists(tasksPath)) return [];
      const content = this.fileSystem.readFile(tasksPath);
      const data = yaml.load(content) as TasksData;
      return data.tasks || [];
    } catch (e) {
      return [];
    }
  }

  saveTasks(tasks: Task[]): void {
    const tasksPath = path.join(this.getDataPath(), 'tasks.yml');
    this.fileSystem.mkdir(path.dirname(tasksPath), { recursive: true });
    this.fileSystem.writeFile(tasksPath, yaml.dump({ tasks }));
  }

  addTask(task: Task): void {
    const tasks = this.loadTasks();
    tasks.push(task);
    this.saveTasks(tasks);
  }

  updateTask(taskId: string, updates: Partial<Task>): void {
    const tasks = this.loadTasks();
    const index = tasks.findIndex(t => t.id === taskId);
    if (index !== -1) {
      tasks[index] = { ...tasks[index], ...updates, updatedAt: new Date().toISOString() };
      this.saveTasks(tasks);
    }
  }

  deleteTask(taskId: string): void {
    const tasks = this.loadTasks().filter(t => t.id !== taskId);
    this.saveTasks(tasks);
  }

  deleteTaskMd(taskId: string): void {
    const tasksDir = this.getTasksDir();
    const filePath = path.join(tasksDir, `${taskId}.md`);
    if (this.fileSystem.exists(filePath)) {
      this.fileSystem.delete(filePath);
    }
  }

getTask(taskId: string): Task | undefined {
    return this.loadTasks().find(t => t.id === taskId);
  }

  getTaskByCode(code: string): Task | undefined {
    return this.loadTasks().find(t => t.code === code);
  }

  // === Epics ===
  loadEpics(): Epic[] {
    const epicsPath = path.join(this.getDataPath(), 'epics.yml');
    try {
      if (!this.fileSystem.exists(epicsPath)) return [];
      const content = this.fileSystem.readFile(epicsPath);
      const data = yaml.load(content) as EpicsData;
      return data.epics || [];
    } catch (e) {
      return [];
    }
  }

  saveEpics(epics: Epic[]): void {
    const epicsPath = path.join(this.getDataPath(), 'epics.yml');
    this.fileSystem.mkdir(path.dirname(epicsPath), { recursive: true });
    this.fileSystem.writeFile(epicsPath, yaml.dump({ epics }));
  }

  addEpic(epic: Epic): void {
    const epics = this.loadEpics();
    epics.push(epic);
    this.saveEpics(epics);
  }

  updateEpic(epicId: string, updates: Partial<Epic>): void {
    const epics = this.loadEpics();
    const index = epics.findIndex(e => e.id === epicId);
    if (index !== -1) {
      epics[index] = { ...epics[index], ...updates, updatedAt: new Date().toISOString() };
      this.saveEpics(epics);
    }
  }

  deleteEpic(epicId: string): void {
    const epics = this.loadEpics().filter(e => e.id !== epicId);
    this.saveEpics(epics);
  }

  getEpic(epicId: string): Epic | undefined {
    return this.loadEpics().find(e => e.id === epicId);
  }

  // === Backlogs ===
  loadBacklogs(): Backlog[] {
    const backlogsPath = path.join(this.getDataPath(), 'backlogs.yml');
    try {
      if (!this.fileSystem.exists(backlogsPath)) return [];
      const content = this.fileSystem.readFile(backlogsPath);
      const data = yaml.load(content) as BacklogsData;
      return data.backlogs || [];
    } catch (e) {
      return [];
    }
  }

  saveBacklogs(backlogs: Backlog[]): void {
    const backlogsPath = path.join(this.getDataPath(), 'backlogs.yml');
    this.fileSystem.mkdir(path.dirname(backlogsPath), { recursive: true });
    this.fileSystem.writeFile(backlogsPath, yaml.dump({ backlogs }));
  }

  addBacklog(backlog: Backlog): void {
    const backlogs = this.loadBacklogs();
    backlogs.push(backlog);
    this.saveBacklogs(backlogs);
  }

  updateBacklog(backlogId: string, updates: Partial<Backlog>): void {
    const backlogs = this.loadBacklogs();
    const index = backlogs.findIndex(b => b.id === backlogId);
    if (index !== -1) {
      backlogs[index] = { ...backlogs[index], ...updates };
      this.saveBacklogs(backlogs);
    }
  }

  deleteBacklog(backlogId: string): void {
    const backlogs = this.loadBacklogs().filter(b => b.id !== backlogId);
    this.saveBacklogs(backlogs);
  }

  getBacklog(backlogId: string): Backlog | undefined {
    return this.loadBacklogs().find(b => b.id === backlogId);
  }

  addTaskToBacklog(taskId: string, backlogId: string): void {
    const backlog = this.getBacklog(backlogId);
    if (!backlog) return;

    if (!backlog.tasks.includes(taskId)) {
      backlog.tasks.push(taskId);
      this.saveBacklogs(this.loadBacklogs());
      this.saveBacklogMd(backlog);
    }

    const task = this.getTask(taskId);
    if (task) {
      task.backlog = backlogId;
      task.updatedAt = new Date().toISOString();
      this.saveTasks(this.loadTasks());
      this.saveTaskMd(task);
    }
  }

  removeTaskFromBacklog(taskId: string, backlogId: string): void {
    const backlog = this.getBacklog(backlogId);
    if (!backlog) return;

    backlog.tasks = backlog.tasks.filter(t => t !== taskId);
    this.saveBacklogs(this.loadBacklogs());
    this.saveBacklogMd(backlog);

    const task = this.getTask(taskId);
    if (task) {
      task.backlog = '';
      task.updatedAt = new Date().toISOString();
      this.saveTasks(this.loadTasks());
      this.saveTaskMd(task);
    }
  }

  // === Sprints ===
  loadSprints(): Sprint[] {
    const sprintsPath = path.join(this.getDataPath(), 'sprints.yml');
    try {
      if (!this.fileSystem.exists(sprintsPath)) return [];
      const content = this.fileSystem.readFile(sprintsPath);
      const data = yaml.load(content) as SprintsData;
      return data.sprints || [];
    } catch (e) {
      return [];
    }
  }

  saveSprints(sprints: Sprint[]): void {
    const sprintsPath = path.join(this.getDataPath(), 'sprints.yml');
    this.fileSystem.mkdir(path.dirname(sprintsPath), { recursive: true });
    this.fileSystem.writeFile(sprintsPath, yaml.dump({ sprints }));
  }

  addSprint(sprint: Sprint): void {
    const sprints = this.loadSprints();
    sprints.push(sprint);
    this.saveSprints(sprints);
  }

  updateSprint(sprintId: string, updates: Partial<Sprint>): void {
    const sprints = this.loadSprints();
    const index = sprints.findIndex(s => s.id === sprintId);
    if (index !== -1) {
      sprints[index] = { ...sprints[index], ...updates, updatedAt: new Date().toISOString() };
      this.saveSprints(sprints);
    }
  }

  deleteSprint(sprintId: string): void {
    const sprints = this.loadSprints().filter(s => s.id !== sprintId);
    this.saveSprints(sprints);
  }

  getSprint(sprintId: string): Sprint | undefined {
    return this.loadSprints().find(s => s.id === sprintId);
  }

  // === Utility ===
  getTasksByBacklog(backlogId: string): Task[] {
    const backlog = this.getBacklog(backlogId);
    if (!backlog) return [];

    const allTasks = this.loadTasks();
    return allTasks.filter(t => backlog.tasks.includes(t.id));
  }

  getTasksBySprint(sprintId: string): Task[] {
    const sprint = this.getSprint(sprintId);
    if (!sprint) return [];

    const allTasks = this.loadTasks();
    return allTasks.filter(t => sprint.tasks.includes(t.id));
  }

  getTasksByEpic(epicId: string): Task[] {
    const epic = this.getEpic(epicId);
    if (!epic) return [];

    const allTasks = this.loadTasks();
    return allTasks.filter(t => epic.tasks.includes(t.id));
  }

  // === Directory Getters ===
  getTasksDir(): string {
    const config = this.loadConfig();
    return path.join(this.getSprintDeskPath(), config.directories.tasks);
  }

  getBacklogsDir(): string {
    const config = this.loadConfig();
    return path.join(this.getSprintDeskPath(), config.directories.backlogs || 'Backlogs');
  }

  getEpicsDir(): string {
    const config = this.loadConfig();
    return path.join(this.getSprintDeskPath(), config.directories.epics);
  }

  getSprintsDir(): string {
    const config = this.loadConfig();
    return path.join(this.getSprintDeskPath(), config.directories.sprints);
  }

  // === MD Generation ===
  private generateTaskMd(task: Task, additionalContent?: string): string {
    let md = `# 🧩 Task: ${task.title}\n\n`;
    md += `## 📋 Description\n`;
    md += `\n## ✅ Acceptance Criteria\n`;
    md += `\n## 📝 Notes\n`;

    if (additionalContent) {
      md += '\n' + additionalContent;
    }

    return md;
  }

  public slugifyTitle(title: string): string {
    return (title || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  public getTaskFilename(task: Task): string {
    const code = task.code || task.id || 'task_1';
    const titleSlug = this.slugifyTitle(task.title || task.title || 'untitled');
    return `[${code}]_${titleSlug}.md`;
  }

  public getEpicFilename(epic: Epic): string {
    const code = epic.code || epic.id || 'epic_1';
    const category = epic.category || 'MISC';
    const titleSlug = this.slugifyTitle(epic.title || epic.title || 'untitled');
    return `[${code}]_${category}_${titleSlug}.md`;
  }

  public getBacklogFilename(backlog: Backlog): string {
    const title = backlog.title || backlog.id || 'backlog';
    return `[Backlog]_${title.toUpperCase()}.md`;
  }

  public getSprintFilename(sprint: Sprint): string {
    const name = sprint.name || '[sprint_1_unknown]';
    return `${name}.md`;
  }

  private generateBacklogMd(backlog: Backlog, tasks: Task[]): string {
    let md = `# 📒 Backlog: ${backlog.name}\n`;
    md += `- **Last update:** ${new Date().toISOString()}\n`;
    md += `- **Total Tasks:** ${tasks.length}\n\n`;

    md += `## 📋 Tasks\n`;
    for (const task of tasks) {
      const statusEmoji = task.status === 'done' ? '✅' : task.status === 'in-progress' ? '🔄' : '⏳';
      const fname = this.getTaskFilename(task);
      md += `- ${statusEmoji} [${task.title}](../Tasks/${fname}) ${task.status}\n`;
    }

    return md;
  }

  private generateEpicMd(epic: Epic, tasks: Task[]): string {
    const statusEmoji = epic.status === 'completed' ? '✅' : epic.status === 'in-progress' ? '🔄' : '⏳';
    let md = `# 🚩 Epic: ${epic.name}\n`;
    md += `${statusEmoji} **Status:** ${epic.status}\n`;
    md += `- **Priority:** ${epic.priority}\n`;
    md += `- **Tasks:** ${tasks.length}\n\n`;

    md += `## 🧱 Tasks\n`;
    for (const task of tasks) {
      const taskStatusEmoji = task.status === 'done' ? '✅' : task.status === 'in-progress' ? '🔄' : '⏳';
      const fname = this.getTaskFilename(task);
      md += `- ${taskStatusEmoji} [${task.title}](../Tasks/${fname})\n`;
    }

    return md;
  }

  private generateSprintMd(sprint: Sprint, tasks: Task[]): string {
    const statusEmoji = sprint.status === 'completed' ? '✅' : sprint.status === 'in-progress' ? '🔄' : '⏳';
    let md = `# ⏱️ Sprint: ${sprint.name}\n`;
    md += `${statusEmoji} **${sprint.startDate} → ${sprint.endDate}**\n`;
    md += `- **Status:** ${sprint.status}\n`;
    md += `- **Tasks:** ${tasks.length}\n\n`;

    md += `## 📋 Tasks\n`;
    for (const task of tasks) {
      const taskStatusEmoji = task.status === 'done' ? '✅' : task.status === 'in-progress' ? '🔄' : '⏳';
      const fname = this.getTaskFilename(task);
      md += `- ${taskStatusEmoji} [${task.title}](../Tasks/${fname}) ${task.status}\n`;
    }

    return md;
  }

  // === MD File Operations (YAML source + MD read-only) ===
  saveTaskMd(task: Task, preserveUserContent: boolean = true): void {
    const tasksDir = this.getTasksDir();
    this.fileSystem.mkdir(tasksDir, { recursive: true });

    const filename = this.getTaskFilename(task);
    const newFilePath = path.join(tasksDir, filename);
    const oldFilePath = path.join(tasksDir, `${task.id}.md`);

    let additionalContent: string | undefined;
    if (preserveUserContent) {
      if (this.fileSystem.exists(newFilePath)) {
        const existingContent = this.fileSystem.readFile(newFilePath);
        const userContentMatch = existingContent.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/m);
        additionalContent = userContentMatch ? userContentMatch[1] : existingContent;
      } else if (this.fileSystem.exists(oldFilePath)) {
        const existingContent = this.fileSystem.readFile(oldFilePath);
        const userContentMatch = existingContent.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/m);
        additionalContent = userContentMatch ? userContentMatch[1] : existingContent;
      }
    }

    const md = this.generateTaskMd(task, additionalContent);
    this.fileSystem.writeFile(newFilePath, md);

    // remove legacy id-based file if it exists and is different
    try {
      if (this.fileSystem.exists(oldFilePath) && oldFilePath !== newFilePath) {
        this.fileSystem.delete(oldFilePath);
      }
    } catch (e) {
      // ignore deletion errors
    }
  }

  saveBacklogMd(backlog: Backlog, preserveUserContent: boolean = true): void {
    const backlogsDir = this.getBacklogsDir();
    this.fileSystem.mkdir(backlogsDir, { recursive: true });

    const filename = this.getBacklogFilename(backlog);
    const filePath = path.join(backlogsDir, filename);
    let additionalContent: string | undefined;

    if (preserveUserContent && this.fileSystem.exists(filePath)) {
      const existingContent = this.fileSystem.readFile(filePath);
      const userContentMatch = existingContent.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/m);
      if (userContentMatch) {
        additionalContent = userContentMatch[1];
      } else {
        additionalContent = existingContent;
      }
    }

    const tasks = this.getTasksByBacklog(backlog.id);
    let md = this.generateBacklogMd(backlog, tasks);
    if (additionalContent) md += '\n' + additionalContent;
    this.fileSystem.writeFile(filePath, md);
  }

  saveEpicMd(epic: Epic, preserveUserContent: boolean = true): void {
    const epicsDir = this.getEpicsDir();
    this.fileSystem.mkdir(epicsDir, { recursive: true });

    const filename = this.getEpicFilename(epic);
    const filePath = path.join(epicsDir, filename);
    let additionalContent: string | undefined;

    if (preserveUserContent && this.fileSystem.exists(filePath)) {
      const existingContent = this.fileSystem.readFile(filePath);
      const userContentMatch = existingContent.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/m);
      if (userContentMatch) {
        additionalContent = userContentMatch[1];
      } else {
        additionalContent = existingContent;
      }
    }

    const tasks = this.getTasksByEpic(epic.id);
    let md = this.generateEpicMd(epic, tasks);
    if (additionalContent) md += '\n' + additionalContent;
    this.fileSystem.writeFile(filePath, md);
  }

  saveSprintMd(sprint: Sprint, preserveUserContent: boolean = true): void {
    const sprintsDir = this.getSprintsDir();
    this.fileSystem.mkdir(sprintsDir, { recursive: true });

    const filename = this.getSprintFilename(sprint);
    const filePath = path.join(sprintsDir, filename);
    let additionalContent: string | undefined;

    if (preserveUserContent && this.fileSystem.exists(filePath)) {
      const existingContent = this.fileSystem.readFile(filePath);
      const userContentMatch = existingContent.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/m);
      if (userContentMatch) {
        additionalContent = userContentMatch[1];
      } else {
        additionalContent = existingContent;
      }
    }

    const tasks = this.getTasksBySprint(sprint.id);
    let md = this.generateSprintMd(sprint, tasks);
    if (additionalContent) md += '\n' + additionalContent;
    this.fileSystem.writeFile(filePath, md);
  }

  refresh(): void {
    this.configCache = null;
  }
}

// Singleton instance
let dataServiceInstance: DataService | null = null;

export function getDataService(workspaceRoot?: string): DataService {
  if (!dataServiceInstance) {
    dataServiceInstance = new DataService(workspaceRoot);
  } else if (workspaceRoot) {
    dataServiceInstance.setWorkspaceRoot(workspaceRoot);
  }
  return dataServiceInstance;
}