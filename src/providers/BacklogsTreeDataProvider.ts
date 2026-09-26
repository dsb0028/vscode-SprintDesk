import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from '../services/fileService';
import * as backlogService from '../services/backlogService';
import { UI_CONSTANTS, PROJECT_CONSTANTS } from '../utils/constant';
import matter from 'gray-matter';
import { getBacklogPath, getTasksPath } from '../utils/backlogUtils';
import { getTaskPath, removeEmojiFromTaskLabel } from '../utils/taskUtils';
import { getDataService } from '../data/DataService';
import { Task, Backlog } from '../data/types';


export class BacklogsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: BacklogsTreeItem[] = [],
    public readonly filePath?: string,
    public readonly taskPath?: string,
    public readonly sourceBacklogPath?: string,
    public readonly backlogId?: string,
    public readonly taskId?: string
  ) {
    super(label, collapsibleState);

    if (filePath) {
      // Setup backlog item
      this.contextValue = 'backlog';
      this.resourceUri = vscode.Uri.file(filePath);
      // Count tasks in backlog
      try {
        const { data } = matter.read(filePath);
        const taskCount = data.tasks?.length;
        this.description = `${UI_CONSTANTS.EMOJI.COMMON.TASK_LIST} ${taskCount ? taskCount : 0} tasks`;
      } catch {
        this.description = `${UI_CONSTANTS.EMOJI.COMMON.TASK_LIST} 0 tasks`;
      }

      // Add backlog icon and tooltip
      this.iconPath = new vscode.ThemeIcon('repo');
      this.tooltip = new vscode.MarkdownString()
        .appendMarkdown(`**${label}**\n\n`)
        .appendMarkdown(`${UI_CONSTANTS.EMOJI.COMMON.FILE} Path: \`${filePath}\`\n\n`)
        .appendMarkdown('*Drop tasks here to add them to this backlog*');

    } else if (taskPath) {
      // Setup task item
      this.contextValue = 'task';

      try {

        const { data: taskMetadata } = matter.read(taskPath);
        const { status, priority, type } = taskMetadata;

        const statusKey = (status || 'NOT_STARTED').toUpperCase() as keyof typeof UI_CONSTANTS.EMOJI.STATUS;
        const statusEmoji = UI_CONSTANTS.EMOJI.STATUS[statusKey] || UI_CONSTANTS.EMOJI.STATUS.WAITING;

        // Determine priority emoji (if any)
        const priorityKey = (priority || '').toUpperCase() as keyof typeof UI_CONSTANTS.EMOJI.PRIORITY;
        const priorityEmoji = priority ? (UI_CONSTANTS.EMOJI.PRIORITY[priorityKey] || '') : '';

        // Use the full filename with extension for the label and include priority emoji
        this.label = `${statusEmoji} ${path.basename(taskPath)}`;

        // Keep priority emoji also as description for compact view
        if (priorityEmoji) this.description = priorityEmoji;

        // Create detailed tooltip
        const tooltipMd = new vscode.MarkdownString();
        tooltipMd.supportHtml = true;
        tooltipMd
          .appendMarkdown(`**${label}**\n\n`)
          .appendMarkdown(`${statusEmoji} Status: ${status}\n`);

        if (priority) {
          const priorityKey = priority.toUpperCase() as keyof typeof UI_CONSTANTS.EMOJI.PRIORITY;
          tooltipMd.appendMarkdown(`${UI_CONSTANTS.EMOJI.PRIORITY[priorityKey] || ''} Priority: ${priority}\n`);
        }

        if (type) {
          tooltipMd.appendMarkdown(`${type.toLowerCase().includes('bug') ? '🐛' : '✨'} Type: ${type}\n`);
        }

        tooltipMd.appendMarkdown(`\n${UI_CONSTANTS.EMOJI.COMMON.FILE} Path: \`${taskPath}\``);
        this.tooltip = tooltipMd;

      } catch {
        // Fallback if can't read task file
        this.iconPath = new vscode.ThemeIcon('tasklist');
        this.tooltip = `Task: ${label}\nPath: ${taskPath}`;
      }
    }
  }
}

export class BacklogsTreeDataProvider implements vscode.TreeDataProvider<BacklogsTreeItem>, vscode.TreeDragAndDropController<BacklogsTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<BacklogsTreeItem | undefined | void> = new vscode.EventEmitter<BacklogsTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<BacklogsTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  private workspaceRoot: string;

  // DragAndDrop interface implementation
  readonly dropMimeTypes = [
    'text/uri-list',
    'application/vnd.code.tree.sprintdesk-backlogs',
    'application/vnd.code.tree.sprintdesk-tasks',
    'application/vnd.code.tree.sprintdesk-epics',
    'application/vnd.code.tree.sprintdesk-sprints'
  ];
  readonly dragMimeTypes = ['application/vnd.code.tree.sprintdesk-backlogs'];

  private resolveTaskPath(handleData: any): string {
    let taskFilePath: string | undefined;

    // Prefer explicit path-like fields first
    if (handleData.path) taskFilePath = handleData.path;
    else if (handleData.filePath) taskFilePath = handleData.filePath;
    else if (handleData.taskPath) taskFilePath = handleData.taskPath;

    // If legacy itemHandles exists, extract basename using split(' ')[1]
    if (!taskFilePath && handleData.itemHandles && Array.isArray(handleData.itemHandles) && handleData.itemHandles.length > 0) {
      const raw = String(handleData.itemHandles[0] || '');
      const parts = raw.split(' ');
      const maybeBasename = parts[1] || parts.pop() || raw;
      let base = path.basename(maybeBasename).trim();
      if (!base.toLowerCase().endsWith('.md')) base = `${base}.md`;

      const ws = this.getWorkspaceRoot();
      if (!ws) throw new Error('No workspace root found');
      taskFilePath = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.TASKS_DIR, base);
    }

    if (!taskFilePath) throw new Error('Could not resolve task path from drop data');
    if (!fs.existsSync(taskFilePath)) throw new Error(`Task file not found: ${taskFilePath}`);

    return taskFilePath;
  }

  constructor() {
    // Initialize workspace root from fileService (may be overridden later)
    this.workspaceRoot = fileService.getWorkspaceRoot();

  }

  /**
   * Set the repository root that this provider should read from.
   * Pass `undefined` to reset to the default workspace folder.
   */
  public setWorkspaceRoot(root?: string) {
    if (root) this.workspaceRoot = root;
    else this.workspaceRoot = fileService.getWorkspaceRoot();
    this.refresh();
  }

  private async handleTaskDropFromTasks(target: BacklogsTreeItem, handleData: any): Promise<void> {
    const taskId = handleData._id;
    if (!taskId) {
      throw new Error('No task ID found in drop data');
    }

    if (!target.backlogId) {
      throw new Error('No backlog ID found in drop target');
    }

    await backlogService.addTaskToBacklogById(target.backlogId, taskId);
    this.refresh();
  }
  private async handleTaskDropFromSprints(target: BacklogsTreeItem, handleData: any): Promise<void> {
    const taskId = handleData._id;
    if (!taskId) {
      throw new Error('No task ID found in drop data');
    }

    if (!target.backlogId) {
      throw new Error('No backlog ID found in drop target');
    }

    await backlogService.addTaskToBacklogById(target.backlogId, taskId);
    this.refresh();
  }
  private async handleTaskDropFromEpics(target: BacklogsTreeItem, handleData: any): Promise<void> {
    const taskId = handleData._id;
    if (!taskId) {
      throw new Error('No task ID found in drop data');
    }

    if (!target.backlogId) {
      throw new Error('No backlog ID found in drop target');
    }

    await backlogService.addTaskToBacklogById(target.backlogId, taskId);
    this.refresh();
  }
  private async handleTaskDropFromBacklogs(target: BacklogsTreeItem, handleData: any): Promise<void> {
    const taskId = handleData._id;
    if (!taskId) {
      throw new Error('No task ID found in drop data');
    }

    if (!target.backlogId) {
      throw new Error('No backlog ID found in drop target');
    }

    const sourceBacklogId = handleData.backlog?.backlogId || null;
    
    if (sourceBacklogId) {
      backlogService.removeTaskFromBacklogById(sourceBacklogId, taskId);
    }
    
    await backlogService.addTaskToBacklogById(target.backlogId, taskId);
    this.refresh();
  }
private async addTaskToBacklog(backlogPath: string, taskPath: string): Promise<void> {

    backlogService.addTaskToBacklog(backlogPath, taskPath);
    this.refresh();
    void vscode.window.showInformationMessage(`Task added to backlog`);

  }
  private async removeTaskFromBacklog(backlogPath: string, taskPath: string): Promise<void> {
    backlogService.removeTaskFromBacklog(backlogPath, taskPath);
  }
  private async getTasksFromBacklogName(backlogName: string): Promise<BacklogsTreeItem[]> {
    const treeItems = backlogService.getTasksFromBacklog(backlogName);
    const backlogs = backlogService.getBacklogs('');
    const backlog = backlogs.find(b => b.name === backlogName);
    const backlogId = backlog?.id;
    
    return treeItems.map(item => {
      const treeItem = new BacklogsTreeItem(
        item.label,
        vscode.TreeItemCollapsibleState.None,
        [],
        undefined,
        item.path,
        undefined,
        backlogId,
        item.id
      );
      treeItem.command = {
        command: 'vscode.open',
        title: 'Open Task',
        arguments: [vscode.Uri.file(item.path)]
      };
      treeItem.tooltip = `Task: ${item.label}\nPath: ${item.path}`;
      return treeItem;
    });
  }
  private async getTasksFromBacklogId(backlogId: string): Promise<BacklogsTreeItem[]> {
    const treeItems = backlogService.getTasksFromBacklogById(backlogId);
    return treeItems.map(item => {
      const treeItem = new BacklogsTreeItem(
        item.label,
        vscode.TreeItemCollapsibleState.None,
        [],
        undefined,
        item.path,
        undefined,
        backlogId,
        item.id
      );
      treeItem.command = {
        command: 'vscode.open',
        title: 'Open Task',
        arguments: [vscode.Uri.file(item.path)]
      };
      treeItem.tooltip = `Task: ${item.label}\nPath: ${item.path}`;
      return treeItem;
    });
  }
  // handle drag and drop
  handleDrag(source: readonly BacklogsTreeItem[], dataTransfer: vscode.DataTransfer): void {
    try {
      if (source.length > 0) {
        const taskItem = source[0];

        const taskData = {
          _id: taskItem.taskId,
          type: 'task',
          label: taskItem.label,
          path: taskItem.taskPath,
          backlog: {
            type: 'backlog',
            backlogId: taskItem.backlogId
          }
        };

        dataTransfer.set('application/vnd.code.tree.sprintdesk-backlogs',
          new vscode.DataTransferItem(JSON.stringify(taskData))
        );

        dataTransfer.set('text/plain',
          new vscode.DataTransferItem(JSON.stringify(taskData))
        );
      }
    } catch (error) {
      void vscode.window.showErrorMessage('Failed to start drag: ' + (error as Error).message);
    }
  }

  async handleDrop(target: BacklogsTreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    try {
      if (!target?.filePath || target.contextValue !== 'backlog') {
        throw new Error('Invalid drop target: must be a backlog');
      }

      const backlogMimeType = 'application/vnd.code.tree.sprintdesk-backlogs';
      const dataItem = dataTransfer.get(backlogMimeType);
      
      if (dataItem && dataItem.value) {
        const handleData = JSON.parse(dataItem.value as string);
        if (handleData._id) {
          await this.handleTaskDropFromBacklogs(target, handleData);
          return;
        }
      }

      const textItem = dataTransfer.get('text/plain');
      if (textItem && textItem.value) {
        try {
          const handleData = JSON.parse(textItem.value as string);
          if (handleData._id && handleData.backlog?.backlogId) {
            await this.handleTaskDropFromBacklogs(target, handleData);
            return;
          } else if (handleData._id) {
            await this.handleTaskDropFromTasks(target, handleData);
            return;
          }
        } catch (e) {
        }
      }

      const taskSources = {
        tasks: 'application/vnd.code.tree.sprintdesk-tasks',
        epics: 'application/vnd.code.tree.sprintdesk-epics',
        sprints: 'application/vnd.code.tree.sprintdesk-sprints'
      };

      for (const [source, mimeType] of Object.entries(taskSources)) {
        const item = dataTransfer.get(mimeType);
        if (item && item.value) {
          const handleData = JSON.parse(item.value as string);
          let taskId = handleData._id;
          if (!taskId && handleData.itemHandles && Array.isArray(handleData.itemHandles) && handleData.itemHandles.length > 0) {
            const raw = String(handleData.itemHandles[0] || '');
            const parts = raw.split(':');
            const taskName = parts[parts.length - 1]?.trim();
            if (taskName) {
              taskId = taskName.replace('.md', '').replace(' ⏳', '');
            }
          }
          
          if (taskId) {
            switch (source) {
              case 'tasks':
                await this.handleTaskDropFromTasks(target, { _id: taskId });
                return;
              case 'epics':
                await this.handleTaskDropFromEpics(target, { _id: taskId });
                return;
              case 'sprints':
                await this.handleTaskDropFromSprints(target, { _id: taskId });
                return;
            }
          }
        }
      }

      throw new Error('No valid task data found in drop');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Failed to move task: ${errorMessage}`);
    }
  }
  private humanizeBacklogName(filename: string): string {
    const base = filename.replace(/\.[^.]+$/, '');
    const cleaned = base
      .replace(/^\[(?:backlog|b)\]_?/i, '')
      .replace(/[_-]+/g, ' ')
      .trim();
    return cleaned || base;
  }

// tree visualization methods
  private async getBacklogsTree(workspaceRoot: string): Promise<BacklogsTreeItem[]> {
    const dataService = getDataService(workspaceRoot);
    const backlogs = dataService.loadBacklogs();

    const items = backlogs.map(backlog => {
      const filePath = backlog.path || '';
      const label = backlog.name || backlog.title || '';

      return new BacklogsTreeItem(
        label,
        vscode.TreeItemCollapsibleState.Collapsed,
        [],
        filePath,
        undefined,
        undefined,
        backlog.id
      );
    });

    items.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));

    return items;
  }
  getTreeItem(element: BacklogsTreeItem): vscode.TreeItem {
    return element;
  }
  async getChildren(element?: BacklogsTreeItem): Promise<BacklogsTreeItem[]> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return [];

    if (!element) {
      return this.getBacklogsTree(workspaceRoot);
    }

    if (element.filePath) {
      if (element.backlogId) {
        return this.getTasksFromBacklogId(element.backlogId);
      }
      return this.getTasksFromBacklogName(path.basename(element.filePath));
    }

    return [];
  }
  private getWorkspaceRoot(): string {
    return this.workspaceRoot || fileService.getWorkspaceRoot();
  }
  public refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}