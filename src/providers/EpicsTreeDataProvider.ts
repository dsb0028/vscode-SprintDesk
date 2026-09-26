import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fileService from '../services/fileService';
import * as epicService from '../services/epicService';
import * as taskService from '../services/taskService';
import { UI_CONSTANTS, PROJECT_CONSTANTS, TASK_CONSTANTS } from '../utils/constant';
import matter from 'gray-matter';
import { getTaskPath, removeEmojiFromTaskLabel } from '../utils/taskUtils';
import { getEpicPath } from '../utils/backlogUtils';
import { getDataService } from '../data/DataService';
import { Task, Epic } from '../data/types';


export class EpicsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: EpicsTreeItem[] = [],
    public readonly filePath?: string,
    public readonly taskPath?: string,
    public readonly sourceEpicPath?: string,
    public readonly epicId?: string,
    public readonly taskId?: string
  ) {
    super(label, collapsibleState);

    if (filePath) {
      // Setup epic item
      console.log('filePath: ', filePath)
      this.contextValue = 'epic';
      this.resourceUri = vscode.Uri.file(filePath);

      // Count tasks in epic
      try {
        const { data } = matter.read(filePath);
        console.log("data file: ", data)
        const taskCount = data.tasks?.length;
        this.iconPath = new vscode.ThemeIcon('milestone');
        this.description = `${UI_CONSTANTS.EMOJI.COMMON.TASK_LIST} ${taskCount ? taskCount : 0} tasks`;
      } catch {
        this.description = `${UI_CONSTANTS.EMOJI.COMMON.TASK_LIST} 0 tasks`;
      }

      // Add epic icon and tooltip
      this.iconPath = new vscode.ThemeIcon('milestone');
      this.tooltip = new vscode.MarkdownString()
        .appendMarkdown(`**${label}**\n\n`)
        .appendMarkdown(`${UI_CONSTANTS.EMOJI.COMMON.FILE} Path: \`${filePath}\`\n\n`)
        .appendMarkdown('*Drop tasks here to add them to this epic*');

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
        this.iconPath = new vscode.ThemeIcon('repo');
        this.tooltip = `Task: ${label}\nPath: ${taskPath}`;
      }
    }
  }
}

export class EpicsTreeDataProvider implements vscode.TreeDataProvider<EpicsTreeItem>, vscode.TreeDragAndDropController<EpicsTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<EpicsTreeItem | undefined | void> = new vscode.EventEmitter<EpicsTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<EpicsTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  private workspaceRoot: string;

  // DragAndDrop interface implementation
  readonly dropMimeTypes = [
    'text/uri-list',
    'application/vnd.code.tree.sprintdesk-backlogs',
    'application/vnd.code.tree.sprintdesk-tasks',
    'application/vnd.code.tree.sprintdesk-epics',
    'application/vnd.code.tree.sprintdesk-sprints'
  ];
  readonly dragMimeTypes = ['application/vnd.code.tree.sprintdesk-epics'];


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

  private async handleTaskDropFromTasks(target: EpicsTreeItem, handleData: any): Promise<void> {
    const taskId = handleData._id;
    if (!taskId) {
      throw new Error('No task ID found in drop data');
    }

    if (!target.epicId) {
      throw new Error('No epic ID found in drop target');
    }

    await epicService.addTaskToEpicById(target.epicId, taskId);
    this.refresh();
  }
  private async handleTaskDropFromBacklogs(target: EpicsTreeItem, handleData: any): Promise<void> {
    const taskId = handleData._id;
    if (!taskId) {
      throw new Error('No task ID found in drop data');
    }

    if (!target.epicId) {
      throw new Error('No epic ID found in drop target');
    }

    await epicService.addTaskToEpicById(target.epicId, taskId);
    this.refresh();
  }
  private async handleTaskDropFromEpics(target: EpicsTreeItem, handleData: any): Promise<void> {
    const taskId = handleData._id;
    if (!taskId) {
      throw new Error('No task ID found in drop data');
    }

    if (!target.epicId) {
      throw new Error('No epic ID found in drop target');
    }

    const sourceEpicId = handleData.epic?.epicId || null;
    
    if (sourceEpicId) {
      await epicService.removeTaskFromEpicById(sourceEpicId, taskId);
    }
    
    await epicService.addTaskToEpicById(target.epicId, taskId);
    this.refresh();
  }
  private async handleTaskDropFromSprints(target: EpicsTreeItem, handleData: any): Promise<void> {
    const taskId = handleData._id;
    if (!taskId) {
      throw new Error('No task ID found in drop data');
    }

    if (!target.epicId) {
      throw new Error('No epic ID found in drop target');
    }

    await epicService.addTaskToEpicById(target.epicId, taskId);
    this.refresh();
  }
private async addTaskToEpic(epicPath: string, taskPath: string): Promise<void> {
    const epicName = fileService.getEpicBaseName(epicPath) || path.basename(epicPath, '.md');
    const taskName = path.basename(taskPath, '.md');
    epicService.addTaskToEpic(epicName, taskName);
    this.refresh();
    void vscode.window.showInformationMessage(`Task added to epic`);

  }
  private async removeTaskFromEpic(epicName: string, taskPath: string): Promise<void> {
    epicService.removeTaskFromEpic(epicName, taskPath);
  }
private async getTasksFromEpicName(epicName: string): Promise<EpicsTreeItem[]> {
    const treeItemsRaw = epicService.getTasksFromEpic(epicName);
    const epics = epicService.getEpics('');
    const epic = epics.find(e => e.name === epicName);
    const epicId = epic?.id;
    
    return (treeItemsRaw || []).map((item: any) => {
      return new EpicsTreeItem(
        item.label,
        vscode.TreeItemCollapsibleState.None,
        [],
        undefined,
        item.path,
        undefined,
        epicId,
        item.id
      );
    });
  }
  private async getTasksFromEpicId(epicId: string): Promise<EpicsTreeItem[]> {
    const treeItemsRaw = epicService.getTasksFromEpicById(epicId);
    return (treeItemsRaw || []).map((item: any) => {
      return new EpicsTreeItem(
        item.label,
        vscode.TreeItemCollapsibleState.None,
        [],
        undefined,
        item.path,
        undefined,
        epicId,
        item.id
      );
    });
  }
  private updateTaskEpic(taskName: string, epicName: string): void {
    const ws = this.getWorkspaceRoot();
    const taskPath = path.join(ws || '','.SprintDesk', 'Tasks', taskName);
    taskService.updateTaskByPath(taskPath, { epic: epicName });
  }
  // handle drag and drop
  handleDrag(source: readonly EpicsTreeItem[], dataTransfer: vscode.DataTransfer): void {
    try {
      if (source.length > 0) {
        const taskItem = source[0];
        
        const taskData = {
          _id: taskItem.taskId,
          type: 'task',
          label: taskItem.label,
          path: taskItem.taskPath,
          epic: {
            type: 'epic',
            epicId: taskItem.epicId
          }
        };

        dataTransfer.set('application/vnd.code.tree.sprintdesk-epics',
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
  async handleDrop(target: EpicsTreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    try {
      console.log('===== Epics handleDrop =====');
      console.log('target:', target?.label, target?.epicId);
      
      if (!target?.filePath || target.contextValue !== 'epic') {
        throw new Error('Invalid drop target: must be an epic');
      }

      // Try epics mime type first (dragging from another epic)
      const epicsItem = dataTransfer.get('application/vnd.code.tree.sprintdesk-epics');
      if (epicsItem && epicsItem.value) {
        const handleData = JSON.parse(epicsItem.value as string);
        console.log('epics data:', handleData);
        if (handleData._id) {
          await this.handleTaskDropFromEpics(target, handleData);
          return;
        }
        // Try to get task ID from path
        if (handleData.path) {
          const taskId = path.basename(handleData.path, '.md');
          await this.handleTaskDropFromEpics(target, { _id: taskId });
          return;
        }
      }

      // Try text/plain (dragging from tasks)
      const textItem = dataTransfer.get('text/plain');
      console.log('text/plain:', textItem);
      if (textItem && textItem.value) {
        try {
          const handleData = JSON.parse(textItem.value as string);
          console.log('text/plain parsed:', handleData);
          if (handleData._id) {
            await this.handleTaskDropFromEpics(target, handleData);
            return;
          }
          // Try to get task ID from path
          if (handleData.path) {
            const taskId = path.basename(handleData.path, '.md');
            await this.handleTaskDropFromEpics(target, { _id: taskId });
            return;
          }
        } catch (e) {
          console.log('text/plain parse error:', e);
        }
      }

      // Fallback: try other tree mime types
      const taskSources: { [key: string]: string } = {
        tasks: 'application/vnd.code.tree.sprintdesk-tasks',
        backlogs: 'application/vnd.code.tree.sprintdesk-backlogs',
        sprints: 'application/vnd.code.tree.sprintdesk-sprints'
      };

      for (const [source, mimeType] of Object.entries(taskSources)) {
        const dataItem = dataTransfer.get(mimeType);
        console.log(`Checking ${source} (${mimeType}):`, dataItem?.value);
        if (dataItem && dataItem.value) {
          const handleData = JSON.parse(dataItem.value as string);
          
          // Handle VS Code tree internal format (itemHandles)
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
  private humanizeEpicName(filename: string): string {
    const base = filename.replace(/\.[^.]+$/, '');
    const cleaned = base
      .replace(/^\[(?:epic|e)\]_?/i, '')
      .replace(/[_-]+/g, ' ')
      .trim();
    return cleaned || base;
  }
private async getEpicsTree(workspaceRoot: string): Promise<EpicsTreeItem[]> {
    const epics = epicService.getEpics(workspaceRoot);

    const items = epics.map(epic => {
      const filePath = epic.path || '';
      const label = epic.name || epic.title;

      return new EpicsTreeItem(label, vscode.TreeItemCollapsibleState.Collapsed, [], filePath, undefined, undefined, epic.id);
    });

    items.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));

    return items;
  }
  getTreeItem(element: EpicsTreeItem): vscode.TreeItem {
    return element;
  }
  async getChildren(element?: EpicsTreeItem): Promise<EpicsTreeItem[]> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return [];

    if (!element) {
      return this.getEpicsTree(workspaceRoot);
    }

    if (element.filePath) {
      if (element.epicId) {
        return this.getTasksFromEpicId(element.epicId);
      }
      const epicName = path.basename(element.filePath, '.md');
      return this.getTasksFromEpicName(epicName);
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