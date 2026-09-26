import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from '../services/fileService';
import * as sprintService from '../services/sprintService';
import { UI_CONSTANTS, PROJECT_CONSTANTS, TASK_CONSTANTS } from '../utils/constant';
import matter from 'gray-matter';
import { getTaskPath, removeEmojiFromTaskLabel } from '../utils/taskUtils';
import { getDataService } from '../data/DataService';
import { getSprintPath } from '../services/sprintService';
import { Task, Sprint } from '../data/types';

export class SprintsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: SprintsTreeItem[] = [],
    public readonly filePath?: string,
    public readonly taskPath?: string,
    public readonly sourceSprintPath?: string,
    public readonly sprintId?: string,
    public readonly taskId?: string
  ) {
    super(label, collapsibleState);

    if (filePath) {
      // Setup sprint item
      this.contextValue = 'sprint';
      this.resourceUri = vscode.Uri.file(filePath);

      // Count tasks in sprint
      try {
        const { data } = matter.read(filePath);
        const taskCount = data.tasks?.length;
        this.description = `${UI_CONSTANTS.EMOJI.COMMON.TASK_LIST} ${taskCount ? taskCount : 0} tasks`;
      } catch {
        this.description = `${UI_CONSTANTS.EMOJI.COMMON.TASK_LIST} 0 tasks`;
      }

      // Add sprint icon and tooltip
      this.iconPath = new vscode.ThemeIcon('rocket');
      this.tooltip = new vscode.MarkdownString()
        .appendMarkdown(`**${label}**\n\n`)
        .appendMarkdown(`${UI_CONSTANTS.EMOJI.COMMON.FILE} Path: \`${filePath}\`\n\n`)
        .appendMarkdown('*Drop tasks here to add them to this sprint*');

    } else if (taskPath) {
      // Setup task item
      this.contextValue = 'task';

      try {

        const { data: taskMetadata } = matter.read(taskPath);
        const { status, priority, type } = taskMetadata;

        const statusKey = (status || TASK_CONSTANTS.STATUS.WAITING).toUpperCase() as keyof typeof UI_CONSTANTS.EMOJI.STATUS;
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

export class SprintsTreeDataProvider implements vscode.TreeDataProvider<SprintsTreeItem>, vscode.TreeDragAndDropController<SprintsTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<SprintsTreeItem | undefined | void> = new vscode.EventEmitter<SprintsTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<SprintsTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  private workspaceRoot: string;

  // DragAndDrop interface implementation
  readonly dropMimeTypes = [
    'text/uri-list',
    'application/vnd.code.tree.sprintdesk-backlogs',
    'application/vnd.code.tree.sprintdesk-tasks',
    'application/vnd.code.tree.sprintdesk-epics',
    'application/vnd.code.tree.sprintdesk-sprints'
  ];
  readonly dragMimeTypes = ['application/vnd.code.tree.sprintdesk-sprints'];

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

  private async handleTaskDropFromTasks(target: SprintsTreeItem, handleData: any): Promise<void> {
    const taskId = handleData._id;
    if (!taskId) {
      throw new Error('No task ID found in drop data');
    }

    if (!target.sprintId) {
      throw new Error('No sprint ID found in drop target');
    }

    await sprintService.addTaskToSprintById(target.sprintId, taskId);
    this.refresh();
  }
  private async handleTaskDropFromBacklogs(target: SprintsTreeItem, handleData: any): Promise<void> {
    const taskId = handleData._id;
    if (!taskId) {
      throw new Error('No task ID found in drop data');
    }

    if (!target.sprintId) {
      throw new Error('No sprint ID found in drop target');
    }

    await sprintService.addTaskToSprintById(target.sprintId, taskId);
    this.refresh();
  }
  private async handleTaskDropFromEpics(target: SprintsTreeItem, handleData: any): Promise<void> {
    const taskId = handleData._id;
    if (!taskId) {
      throw new Error('No task ID found in drop data');
    }

    if (!target.sprintId) {
      throw new Error('No sprint ID found in drop target');
    }

    await sprintService.addTaskToSprintById(target.sprintId, taskId);
    this.refresh();
  }
  private async handleTaskDropFromSprints(target: SprintsTreeItem, handleData: any): Promise<void> {
    const taskId = handleData._id;
    if (!taskId) {
      throw new Error('No task ID found in drop data');
    }

    if (!target.sprintId) {
      throw new Error('No sprint ID found in drop target');
    }

    const sourceSprintId = handleData.sprint?.sprintId || null;
    
    if (sourceSprintId) {
      sprintService.removeTaskFromSprintById(sourceSprintId, taskId);
    }
    
    await sprintService.addTaskToSprintById(target.sprintId, taskId);
    this.refresh();
  }
private async addTaskToSprint(sprintPath: string, taskPath: string): Promise<void> {
    sprintService.addTaskToSprint(sprintPath, taskPath);
  }
  private async removeTaskFromSprint(sprintPath: string, taskPath: string): Promise<void> {
    sprintService.removeTaskFromSprint(sprintPath, taskPath);
  }
  private async getTasksFromSprintName(sprintName: string): Promise<SprintsTreeItem[]> {
    const treeItemsRaw = sprintService.getTasksFromSprint(sprintName);
    const sprints = sprintService.getSprints('');
    const sprint = sprints.find(s => s.name === sprintName);
    const sprintId = sprint?.id;
    
    return (treeItemsRaw || []).map((item: any) => {
      const treeItem = new SprintsTreeItem(
        item.label,
        item.collapsibleState || vscode.TreeItemCollapsibleState.None,
        [],
        undefined,
        item.path,
        undefined,
        sprintId,
        item.id
      );
      if (item.command) {
        treeItem.command = item.command;
      }
      treeItem.tooltip = `Task: ${item.title || item.name || item.label}\nPath: ${item.path}`;
      return treeItem;
    });
  }
  private async getTasksFromSprintId(sprintId: string): Promise<SprintsTreeItem[]> {
    const treeItemsRaw = sprintService.getTasksFromSprintById(sprintId);
    return (treeItemsRaw || []).map((item: any) => {
      const treeItem = new SprintsTreeItem(
        item.label,
        item.collapsibleState || vscode.TreeItemCollapsibleState.None,
        [],
        undefined,
        item.path,
        undefined,
        sprintId,
        item.id
      );
      if (item.command) {
        treeItem.command = item.command;
      }
      treeItem.tooltip = `Task: ${item.title || item.name || item.label}\nPath: ${item.path}`;
      return treeItem;
    });
  }
  // handle drag and drop
  handleDrag(source: readonly SprintsTreeItem[], dataTransfer: vscode.DataTransfer): void {
    try {
      if (source.length > 0) {
        const taskItem = source[0];

        const taskData = {
          _id: taskItem.taskId,
          type: 'task',
          label: taskItem.label,
          path: taskItem.taskPath,
          sprint: {
            type: 'sprint',
            sprintId: taskItem.sprintId
          }
        };

        dataTransfer.set('application/vnd.code.tree.sprintdesk-sprints',
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

  async handleDrop(target: SprintsTreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    try {
      if (!target?.filePath || target.contextValue !== 'sprint') {
        throw new Error('Invalid drop target: must be a sprint');
      }

      // Try sprint MIME type first (dragging from another sprint)
      const sprintMimeType = 'application/vnd.code.tree.sprintdesk-sprints';
      const sprintItem = dataTransfer.get(sprintMimeType);
      if (sprintItem && sprintItem.value) {
        const handleData = JSON.parse(sprintItem.value as string);
        if (handleData._id) {
          await this.handleTaskDropFromSprints(target, handleData);
          return;
        }
      }

      // Try text/plain
      const textItem = dataTransfer.get('text/plain');
      if (textItem && textItem.value) {
        try {
          const handleData = JSON.parse(textItem.value as string);
          if (handleData._id && handleData.sprint?.sprintId) {
            await this.handleTaskDropFromSprints(target, handleData);
            return;
          } else if (handleData._id) {
            await this.handleTaskDropFromTasks(target, handleData);
            return;
          }
        } catch (e) {
        }
      }

      // Fallback: try other sources
      const taskSources = {
        tasks: 'application/vnd.code.tree.sprintdesk-tasks',
        backlogs: 'application/vnd.code.tree.sprintdesk-backlogs',
        epics: 'application/vnd.code.tree.sprintdesk-epics'
      };

      for (const [source, mimeType] of Object.entries(taskSources)) {
        const dataItem = dataTransfer.get(mimeType);
        if (dataItem && dataItem.value) {
          const handleData = JSON.parse(dataItem.value as string);
          
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
              case 'backlogs':
                await this.handleTaskDropFromBacklogs(target, { _id: taskId });
                return;
              case 'epics':
                await this.handleTaskDropFromEpics(target, { _id: taskId });
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
  private humanizeSprintName(filename: string): string {
    const base = filename.replace(/\.[^.]+$/, '');

    const cleaned = base
      .replace(/^\[(?:sprint|sp)\]_?/i, '')
      .trim();

    // date range transform
    const dateRange = cleaned.replace(
      /^(\d{2}-\d{2}-\d{4})_(\d{2}-\d{2}-\d{4})$/,
      '$1 -> $2'
    );

    return dateRange;
  }
private async getSprintsTree(workspaceRoot: string): Promise<SprintsTreeItem[]> {
    const dataService = getDataService(workspaceRoot);
    const sprints = dataService.loadSprints();

    const items = sprints.map(sprint => {
      const filePath = sprint.path || '';
      const label = sprint.name || sprint.title || '';

      return new SprintsTreeItem(
        label, 
        vscode.TreeItemCollapsibleState.Collapsed, 
        [], 
        filePath, 
        undefined, 
        undefined,
        sprint.id
      );
    });

    items.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));

    return items;
  }
  getTreeItem(element: SprintsTreeItem): vscode.TreeItem {
    return element;
  }
  async getChildren(element?: SprintsTreeItem): Promise<SprintsTreeItem[]> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return [];

    if (!element) {
      return this.getSprintsTree(workspaceRoot);
    }

    if (element.filePath) {
      if (element.sprintId) {
        return this.getTasksFromSprintId(element.sprintId);
      }
      return this.getTasksFromSprintName(path.basename(element.filePath));
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
