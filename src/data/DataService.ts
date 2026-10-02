import * as path from 'path';
import yaml from 'js-yaml';
import { getHost, getFileSystem, IFileSystem } from '../host';
import { Config, Task, Epic, Backlog, Sprint, TasksData, EpicsData, BacklogsData, SprintsData, DEFAULT_CONFIG } from './types';
import { canonical, digest, Enrollment, keyId, SignedReceipt, SnapshotResponse, reviewedMarkdown, verifyReceipt } from '../review/protocol';
import {
  authorizeChange,
  needsModification,
  protectedChange,
  receiptReview,
  receiptVerification,
  taskMetadata,
} from '../review/authorization';
import { assertCriterionEvidence, CriterionEvidence, renderCriterionEvidence } from '../review/evidence';

const SPRINTDESK_DIR = '.SprintDesk';
const SETTINGS_DIR = 'settings';
const DATA_DIR = 'data';

interface TaskTemplateField {
  heading: string;
  matches: (line: string) => boolean;
}

export class DataService {
  private workspaceRoot: string;
  private configCache: Config | null = null;

  private assertTaskReviewEvidence(task: Task, markdown?: string): void {
    const markdownPath = task.path || path.join(this.getTasksDir(), this.getTaskFilename(task));
    const taskMarkdown = markdown ?? this.readReviewFile(markdownPath);
    assertCriterionEvidence(taskMarkdown, this.getTaskAcceptanceCriteria(task));
  }

  validateTaskReviewEvidence(taskId: string): void {
    const task = this.getTask(taskId) || this.getTaskByCode(taskId);
    if (!task) {
      throw new Error('Review task not found');
    }
    this.assertTaskReviewEvidence(task);
  }

  recordTaskEvidence(taskId: string, evidence: CriterionEvidence[]): string {
    const task = this.getTask(taskId) || this.getTaskByCode(taskId);
    if (!task) {
      throw new Error('Review task not found');
    }
    const markdownPath = task.path || path.join(this.getTasksDir(), this.getTaskFilename(task));
    const markdown = this.readReviewFile(markdownPath);
    const updatedMarkdown = renderCriterionEvidence(
      markdown,
      this.getTaskAcceptanceCriteria(task),
      evidence,
    );
    this.assertTaskReviewEvidence(task, updatedMarkdown);
    this.fileSystem.writeFile(markdownPath, updatedMarkdown);
    return updatedMarkdown;
  }

  recordExecutionEvidence(
    taskId: string, evidence: CriterionEvidence[],
  ): { task: Task; markdown: string } {
    const task = this.getTask(taskId) || this.getTaskByCode(taskId);
    if (!task) {
      throw new Error('Evidence task not found');
    }
    if (task.status !== 'in-progress') {
      throw new Error('Execution evidence may only be recorded for in-progress tasks.');
    }
    const expected = this.recordTaskEvidence(task.id, evidence);
    const markdownPath = task.path || path.join(this.getTasksDir(), this.getTaskFilename(task));
    const markdown = this.readReviewFile(markdownPath);
    const current = this.getTask(task.id);
    if (markdown !== expected || !current || canonical(current) !== canonical(task)) {
      throw new Error('Evidence readback does not match the saved content or task. Reconcile before retry.');
    }
    this.assertTaskReviewEvidence(current, markdown);
    return { task: current, markdown };
  }

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
    return this.loadTaskDocument().tasks;
  }

  private loadTaskDocument(): TasksData & { approvals?: SignedReceipt[] } {
    const tasksPath = path.join(this.getDataPath(), 'tasks.yml');
    if (!this.fileSystem.exists(tasksPath)) {
      return { tasks: [] };
    }
    const data = yaml.load(this.fileSystem.readFile(tasksPath)) as TasksData & { approvals?: SignedReceipt[] };
    if (!data || !Array.isArray(data.tasks) || (data.approvals !== undefined && !Array.isArray(data.approvals))) {
      throw new Error('Invalid task store; refusing mutation');
    }
    return data;
  }

  saveTasks(tasks: Task[]): void {
    const tasksPath = path.join(this.getDataPath(), 'tasks.yml');
    this.fileSystem.mkdir(path.dirname(tasksPath), { recursive: true });
    if (this.fileSystem.withLock) {
      this.fileSystem.withLock(tasksPath, () => this.persistTasks(tasks));
    } else {
      this.persistTasks(tasks);
    }
  }

  private commitTasks(tasks: Task[], receipt: SignedReceipt): Task {
    const tasksPath = path.join(this.getDataPath(), 'tasks.yml');
    let committed: Task | undefined;
    const persistAndRead = () => {
      const previousContent = this.fileSystem.readFile(tasksPath);
      let persisted = false;
      try {
        this.persistTasks(tasks);
        persisted = true;
        committed = this.getTask(receipt.payload.taskId);
        if (!committed) {
          throw new Error('Approval commit readback failed');
        }
        this.assertCommittedApproval(committed, receipt);
      } catch (error) {
        if (persisted) {
          try {
            if (this.fileSystem.writeAtomic) {
              this.fileSystem.writeAtomic(tasksPath, previousContent);
            } else {
              this.fileSystem.writeFile(tasksPath, previousContent);
            }
          } catch (rollbackError) {
            throw new Error(`Approval commit failed and rollback failed: ${String(rollbackError)}`);
          }
        }
        throw error;
      }
    };
    if (this.fileSystem.withLock) {
      this.fileSystem.withLock(tasksPath, persistAndRead);
    } else {
      persistAndRead();
    }
    if (!committed) {
      throw new Error('Approval commit readback failed');
    }
    return committed;
  }

  private persistTasks(tasks: Task[]): void {
    const document = this.loadTaskDocument();
    const previous = document.tasks;
    const approvals = [...(document.approvals ?? [])];
    if (new Set(tasks.map(task => task.id)).size !== tasks.length) {
      throw new Error('Duplicate task identity');
    }
    for (const task of tasks) {
      const before = previous.find(entry => entry.id === task.id);
      if (!protectedChange(before, task)) {
        continue;
      }
      if (!before) {
        throw new Error('Cannot create/import protected task state without signed approval');
      }
      const receipt = task.completionReceipt !== before.completionReceipt
        && canonical(task.completionReceipt ?? null) !== canonical(before.completionReceipt ?? null)
        ? task.completionReceipt : task.reviewReceipt;
      if (!receipt) {
        throw new Error('Protected task writes require signed local UI approval');
      }
      const enrollment = this.getReviewEnrollment();
      const snapshot = this.reviewSnapshot(before.id, receipt.payload.evidencePaths).snapshot;
      authorizeChange(before, task, snapshot, enrollment);
      if (approvals.some(entry => entry.payload.operationId === receipt.payload.operationId)) {
        throw new Error('Signed approval operation already consumed');
      }
      const last = [...approvals].reverse().find(entry => entry.payload.taskId === before.id);
      if (last && (receipt.payload.createdAt !== last.payload.createdAt
        || receipt.payload.incarnation !== last.payload.incarnation
        || receipt.payload.sequence <= last.payload.sequence
        || (last.payload.intent === 'complete' && !before.completionReceipt))) {
        throw new Error('Task identity reuse or stale approval history');
      }
      approvals.push(receipt);
    }
    const tasksPath = path.join(this.getDataPath(), 'tasks.yml');
    this.fileSystem.mkdir(path.dirname(tasksPath), { recursive: true });
    const content = yaml.dump(approvals.length ? { tasks, approvals } : { tasks });
    if (this.fileSystem.writeAtomic) {
      this.fileSystem.writeAtomic(tasksPath, content);
    } else {
      this.fileSystem.writeFile(tasksPath, content);
    }
  }

  getReviewAudit(): SignedReceipt[] {
    const approvals = this.loadTaskDocument().approvals ?? [];
    if (approvals.length) {
      const enrollment = this.getReviewEnrollment();
      for (const receipt of approvals) {
        verifyReceipt(receipt, enrollment);
      }
    }
    return approvals;
  }

  getReviewEnrollment(): Enrollment {
    const file = path.join(this.getDataPath(), 'review-authority.json');
    if (!this.fileSystem.exists(file)) {
      throw new Error('Local reviewer companion is not enrolled');
    }
    const enrollment = JSON.parse(this.fileSystem.readFile(file)) as Enrollment;
    if (enrollment.version !== 1 || !enrollment.projectId || !enrollment.reviewerId
      || !enrollment.reviewerName || keyId(enrollment.publicKey) !== enrollment.keyId) {
      throw new Error('Invalid reviewer enrollment mirror');
    }
    return enrollment;
  }

  enrollReview(enrollment: Enrollment): void {
    if (enrollment.version !== 1 || !enrollment.projectId || !enrollment.reviewerId
      || !enrollment.reviewerName || keyId(enrollment.publicKey) !== enrollment.keyId) {
      throw new Error('Invalid reviewer enrollment');
    }
    const file = path.join(this.getDataPath(), 'review-authority.json');
    if (this.fileSystem.exists(file)
      && canonical(this.getReviewEnrollment()) !== canonical(enrollment)) {
      throw new Error('Reviewer key replacement requires explicit local recovery');
    }
    this.fileSystem.mkdir(this.getDataPath(), { recursive: true });
    this.fileSystem.writeFile(file, JSON.stringify(enrollment));
  }

  reviewSnapshot(taskId: string, evidencePaths: string[] = []): SnapshotResponse {
    const task = this.getTask(taskId) || this.getTaskByCode(taskId);
    if (!task) {
      throw new Error('Review task not found');
    }
    if (!Array.isArray(evidencePaths) || evidencePaths.length > 32) {
      throw new Error('Invalid evidence paths');
    }
    const evidence = evidencePaths.map(relative => {
      if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)
        || relative.split(/[\\/]/).some(part => part === '..' || part === '.SprintDesk')
        || relative.includes('\0')) {
        throw new Error('Evidence must be repository-relative non-task files');
      }
      const content = this.readReviewFile(path.join(this.workspaceRoot, relative));
      if (Buffer.byteLength(content) > 1_000_000) {
        throw new Error('Evidence file exceeds 1 MB; select bounded text evidence');
      }
      return { path: relative, content };
    });
    const markdownPath = task.path || path.join(this.getTasksDir(), this.getTaskFilename(task));
    const markdown = this.readReviewFile(markdownPath);
    if (Buffer.byteLength(markdown) > 1_000_000) {
      throw new Error('Task Markdown exceeds 1 MB');
    }
    if (!task.reviewReceipt && !task.completionReceipt) {
      this.assertTaskReviewEvidence(task, markdown);
    }

    return {
      snapshot: {
        version: 1, projectId: this.getReviewEnrollment().projectId,
        taskId: task.id, createdAt: task.createdAt, metadata: taskMetadata(task),
        criteria: this.getTaskAcceptanceCriteria(task), markdown: reviewedMarkdown(markdown), evidence,
      },
      status: task.status, workStatus: task.workStatus,
      reviewReceipt: task.reviewReceipt, completionReceipt: task.completionReceipt,
      review: task.review, humanVerification: task.humanVerification,
    };
  }

  private readReviewFile(file: string): string {
    const resolved = this.fileSystem.realPath?.(file) ?? path.resolve(file);
    const root = this.fileSystem.realPath?.(this.workspaceRoot) ?? path.resolve(this.workspaceRoot);
    const relative = path.relative(root, resolved);
    if (!relative || path.isAbsolute(relative) || relative === '..'
      || relative.startsWith(`..${path.sep}`)) {
      throw new Error('Review evidence must remain inside its workspace');
    }
    return this.fileSystem.readFile(file);
  }

  private assertCommittedApproval(task: Task, receipt: SignedReceipt): void {
    const enrollment = this.getReviewEnrollment();
    verifyReceipt(receipt, enrollment);
    if (!task.reviewReceipt) {
      throw new Error('Committed approval is missing its signed review');
    }
    verifyReceipt(task.reviewReceipt, enrollment);
    const response = this.reviewSnapshot(task.id, receipt.payload.evidencePaths);
    if (receipt.payload.snapshotDigest !== digest(response.snapshot)
      || (receipt.payload.intent === 'review'
        && task.status !== (needsModification(receipt) ? 'needs-modification' : 'under-review'))
      || canonical(task.review ?? null) !== canonical(receiptReview(task.reviewReceipt))
      || (receipt.payload.intent === 'complete' && (task.status !== 'done' || task.workStatus !== 'done'
        || receipt.payload.reviewOperationId !== task.reviewReceipt.payload.operationId
        || task.reviewReceipt.payload.snapshotDigest !== receipt.payload.snapshotDigest
        || task.reviewReceipt.payload.incarnation !== receipt.payload.incarnation
        || task.reviewReceipt.payload.sequence >= receipt.payload.sequence
        || !task.reviewReceipt.payload.criteria.every(entry => entry.result === 'met')
        || canonical(task.humanVerification ?? null) !== canonical(receiptVerification(receipt, enrollment))))) {
      throw new Error('Committed approval content has drifted');
    }
  }

  commitReview(receipt: SignedReceipt): Task {
    const task = this.getTask(receipt.payload.taskId);
    if (!task) {
      throw new Error('Review task not found');
    }
    const stored = receipt.payload.intent === 'complete' ? task.completionReceipt : task.reviewReceipt;
    if (stored && canonical(stored) === canonical(receipt)) {
      this.assertCommittedApproval(task, receipt);
      this.saveTaskMd(task);
      return task;
    }
    const next: Task = receipt.payload.intent === 'review'
      ? {
        ...task,
        status: needsModification(receipt) ? 'needs-modification' : 'under-review',
        review: receiptReview(receipt),
        reviewReceipt: receipt,
      }
      : { ...task, status: 'done', workStatus: 'done', completionReceipt: receipt,
        humanVerification: receiptVerification(receipt, this.getReviewEnrollment()) };
    const tasks = this.loadTasks().map(entry => entry.id === task.id
      ? { ...next, updatedAt: new Date().toISOString() } : entry);
    const committed = this.commitTasks(tasks, receipt);
    this.saveTaskMd(committed);
    return committed;
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
      const updatedTask = { ...tasks[index], ...updates, updatedAt: new Date().toISOString() };
      if (updatedTask.status === 'under-review' && tasks[index].status !== 'under-review') {
        this.assertTaskReviewEvidence(updatedTask);
      }
      tasks[index] = updatedTask;
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
    const reviewBlock = this.generateReviewTemplate(task);
    if (reviewBlock) {
      md += `${reviewBlock}\n`;
    }
    md += `\n## 📝 Notes\n`;

    if (additionalContent) {
      md += '\n' + additionalContent;
    }

    return md;
  }

  private generateReviewTemplate(task: Task): string {
    if (!['under-review', 'needs-modification'].includes(task.status) || !task.review?.criteria.length) {
      return '';
    }

    const lines: string[] = [
      '### Review Handoff',
      '',
      `Summary: ${task.review.summary}`,
      ''
    ];

    for (const entry of task.review.criteria) {
      lines.push(`- ${entry.criterion}`);
      lines.push(`  - Result: ${entry.result || 'not recorded'}`);
      lines.push(`  - Reviewer: ${entry.reviewerId || 'not recorded'}`);
      lines.push(`  - Verified at: ${entry.verifiedAt || 'not recorded'}`);
    }

    return lines.join('\n');
  }

  getTaskAcceptanceCriteria(task: Task): string[] {
    const filePath = task.path || path.join(this.getTasksDir(), this.getTaskFilename(task));
    if (!this.fileSystem.exists(filePath)) {
      return [];
    }

    const content = this.fileSystem.readFile(filePath);
    const section = content.match(/(?:^|\n)## ✅ Acceptance Criteria\r?\n([\s\S]*?)(?=\r?\n#{2,3} |\n?$)/);
    if (!section) {
      return [];
    }

    const criteria: string[] = [];
    for (const line of section[1].split(/\r?\n/)) {
      const bullet = line.match(/^[-*]\s+(?:\[[ xX]\]\s*)?(.+)$/);
      if (bullet) {
        criteria.push(bullet[1].trim());
      } else if (/^\s+\S/.test(line) && criteria.length > 0) {
        criteria[criteria.length - 1] += ` ${line.trim()}`;
      }
    }
    return criteria;
  }

  private completeTaskTemplate(task: Task, content: string): string {
    const fields: TaskTemplateField[] = [
      {
        heading: `# 🧩 Task: ${task.title}`,
        matches: line => /^# 🧩 Task:.*$/.test(line),
      },
      {
        heading: '## 📋 Description',
        matches: line => line === '## 📋 Description',
      },
      {
        heading: '## ✅ Acceptance Criteria',
        matches: line => line === '## ✅ Acceptance Criteria',
      },
      {
        heading: '## 📝 Notes',
        matches: line => line === '## 📝 Notes',
      },
    ];
    const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(lineEnding);
    const fieldIndexes = this.findTaskTemplateFieldIndexes(lines, fields);
    const hasTemplateField = fieldIndexes.some(index => index !== -1);

    if (!hasTemplateField) {
      return this.generateTaskMd(task, content);
    }

    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
      const currentFieldIndexes = this.findTaskTemplateFieldIndexes(lines, fields);
      if (currentFieldIndexes[fieldIndex] !== -1) {
        continue;
      }

      const nextFieldIndex = currentFieldIndexes
        .slice(fieldIndex + 1)
        .find(index => index !== -1);
      const insertionIndex = nextFieldIndex === undefined ? lines.length : nextFieldIndex;
      lines.splice(insertionIndex, 0, fields[fieldIndex].heading, '');
    }

    const reviewBlock = this.generateReviewTemplate(task);
    if (reviewBlock) {
      const existingReview = lines.findIndex(line => line === '### Review Handoff');
      if (existingReview !== -1) {
        let reviewEnd = existingReview + 1;
        while (reviewEnd < lines.length && !/^## /.test(lines[reviewEnd])) {
          reviewEnd += 1;
        }
        lines.splice(existingReview, reviewEnd - existingReview);
      }
      const notesIndex = lines.indexOf('## 📝 Notes');
      lines.splice(notesIndex, 0, ...reviewBlock.split('\n'), '');
    }
    return lines.join(lineEnding);
  }

  private findTaskTemplateFieldIndexes(lines: string[], fields: TaskTemplateField[]): number[] {
    const indexes = fields.map(() => -1);
    let fencedCodeDelimiter: string | undefined;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
      if (fenceMatch) {
        const delimiter = fenceMatch[1][0];
        if (!fencedCodeDelimiter) {
          fencedCodeDelimiter = delimiter;
        } else if (fencedCodeDelimiter === delimiter) {
          fencedCodeDelimiter = undefined;
        }
        continue;
      }
      if (fencedCodeDelimiter) {
        continue;
      }

      for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
        if (indexes[fieldIndex] === -1 && fields[fieldIndex].matches(line)) {
          indexes[fieldIndex] = lineIndex;
        }
      }
    }

    return indexes;
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
      const statusEmoji = task.status === 'done' ? '✅'
        : task.status === 'in-progress' ? '🔄'
          : task.status === 'needs-modification' ? '🛠️' : '⏳';
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
      const taskStatusEmoji = task.status === 'done' ? '✅'
        : task.status === 'in-progress' ? '🔄'
          : task.status === 'needs-modification' ? '🛠️' : '⏳';
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
      const taskStatusEmoji = task.status === 'done' ? '✅'
        : task.status === 'in-progress' ? '🔄'
          : task.status === 'needs-modification' ? '🛠️' : '⏳';
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

    const md = additionalContent === undefined
      ? this.generateTaskMd(task)
      : this.completeTaskTemplate(task, additionalContent);
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