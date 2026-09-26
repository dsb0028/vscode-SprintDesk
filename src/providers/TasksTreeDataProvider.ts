import * as vscode from 'vscode';
import * as path from 'path';
import * as taskService from '../services/taskService';
import * as fileService from '../services/fileService';
import { getDataService } from '../data/DataService';
import { Task, TaskStatus } from '../data/types';
import { TaskStatusGroup, groupTasksByStatus } from './taskStatusGroups';

const TASK_PAGE_SIZE = 100;
interface TaskData {
  _id: string;
  name: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  epic?: {
    _id: string;
    title: string;
    path: string;
  } | null;
  path: string;
}

export class TaskTreeItem extends vscode.TreeItem {
  public readonly taskData: TaskData;
  private taskObj?: Task;

  constructor(
    taskData: TaskData,
    taskObj?: Task,
    // absolute path to the markdown file on disk (preferred)
    absoluteFilePath?: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    // Create base TreeItem with initial label
    super(taskData.title, collapsibleState);
    this.taskData = taskData;

    // Set task context and make draggable
    this.contextValue = 'task';
    // Prefer the provided absolute path. If not available, try to resolve
    // using workspace folder and file service helpers.
    let resourceFsPath: string | undefined = undefined;
    if (absoluteFilePath) {
      resourceFsPath = absoluteFilePath;
    } else if (taskData.path) {
      resourceFsPath = taskData.path;
    } else {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      try {
        const rel = fileService.createTaskRelativePath(taskData.title);
        resourceFsPath = fileService.taskRelativePathToAbsolute(rel, ws);
      } catch (e) {
        resourceFsPath = undefined;
      }
    }

    if (resourceFsPath) {
      this.resourceUri = vscode.Uri.file(resourceFsPath);
    }

    // Set up visual elements
    this.setupVisuals();

    // Make primary click open the markdown preview
    if (resourceFsPath) {
      this.command = {
        command: 'sprintdesk.viewTaskPreview',
        title: 'Preview Task',
        arguments: [vscode.Uri.file(resourceFsPath)]
      };
    }
  }

  private getStatusEmoji(status: string): string {
    switch (status.toLowerCase()) {
      case 'not-started': return '⏳';
      case 'waiting': return '⏳';
      case 'in-progress': return '🔄';
      case 'under-review': return '🔎';
      case 'done': return '✅';
      case 'blocked': return '⛔';
      case 'cancelled': return '❌';
      default: return '⏳';
    }
  }

  private getPriorityEmoji(priority: string): string {
    switch (priority.toLowerCase()) {
      case 'high': return '🔴';
      case 'medium': return '🟡';
      case 'low': return '🟢';
      default: return '⚪';
    }
  }

  private getTypeIcon(type: string): string {
    switch (type?.toLowerCase()) {
      case 'bug': return '🐛';
      case 'feature': return '✨';
      case 'chore': return '🔧';
      case 'doc': return '📝';
      case 'test': return '🧪';
      default: return '✨';
    }
  }

  private setupVisuals(): void {
    const statusEmoji = this.getStatusEmoji(this.taskData.status);

    let filename = path.basename(this.taskData.path);
    if (this.taskObj) {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (ws) {
        const dataService = getDataService(ws);
        filename = dataService.getTaskFilename(this.taskObj);
      }
    }

    this.label = `${this.taskData.name || this.taskData.title} [${this.taskData.status}] ${statusEmoji}`;

    // Set description with priority and epic
    const description = [this.getPriorityEmoji(this.taskData.priority)];
    if (this.taskData.epic?.title) {
      description.push(`📘 ${this.taskData?.epic?.title || 'No Epic'}`);
    }
    this.description = description.join(' ');

    // Set detailed tooltip
    this.tooltip = new vscode.MarkdownString()
      .appendMarkdown(`**${this.taskData.title}**\n\n`)
      .appendMarkdown(`${this.getStatusEmoji(this.taskData.status)} Status: ${this.taskData.status}\n`)
      .appendMarkdown(`${this.getPriorityEmoji(this.taskData.priority)} Priority: ${this.taskData.priority}\n`)
      .appendMarkdown(`${this.getTypeIcon(this.taskData.type)} Type: ${this.taskData.type || 'feature'}\n`)
      .appendMarkdown(this.taskData.epic ? `\n📘 Epic: ${this.taskData.epic.title}\n` : '')
      .appendMarkdown(`\n📁 Path: \`${this.taskData.path}\``);
  }
}

export class TaskStatusTreeItem extends vscode.TreeItem {
  constructor(public readonly group: TaskStatusGroup) {
    super(
      group.label,
      group.defaultExpanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.id = `task-status-${group.status}`;
    this.contextValue = 'taskStatusGroup';
    this.description = `${group.tasks.length} tasks`;
    this.iconPath = new vscode.ThemeIcon('folder');
    this.tooltip = `${group.label}: ${group.tasks.length} tasks`;
  }
}

export class LoadMoreTasksTreeItem extends vscode.TreeItem {
  constructor(
    public readonly status: TaskStatus,
    remainingCount: number,
  ) {
    super(`Load ${Math.min(TASK_PAGE_SIZE, remainingCount)} more tasks`, vscode.TreeItemCollapsibleState.None);
    this.id = `task-status-${status}-load-more`;
    this.contextValue = 'taskLoadMore';
    this.description = `${remainingCount} remaining`;
    this.iconPath = new vscode.ThemeIcon('add');
    this.command = {
      command: 'sprintdesk.loadMoreTasks',
      title: 'Load More Tasks',
      arguments: [status],
    };
  }
}

type TaskTreeElement = TaskTreeItem | TaskStatusTreeItem | LoadMoreTasksTreeItem;

export class TasksTreeDataProvider implements vscode.TreeDataProvider<TaskTreeElement>, vscode.TreeDragAndDropController<TaskTreeElement> {
  private _onDidChangeTreeData: vscode.EventEmitter<TaskTreeElement | undefined | void> = new vscode.EventEmitter<TaskTreeElement | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TaskTreeElement | undefined | void> = this._onDidChangeTreeData.event;
  private visibleTaskCounts = new Map<TaskStatus, number>();

  // Drag and Drop implementation
  public readonly dropMimeTypes: string[] = [];
  public readonly dragMimeTypes: string[] = ['application/vnd.code.tree.sprintdesk-tasks'];

  constructor(private workspaceRoot?: string) { }

  /**
   * Update the workspace root (repository root) where tasks are read from.
   * Pass `undefined` to reset to the default workspace folder.
   */
  public setWorkspaceRoot(root?: string) {
    this.workspaceRoot = root;
    this.visibleTaskCounts.clear();
    this.refresh();
  }

  // Any task dropped from epic sprint backlog should be removed from there,
  // and returned to the main tasks list.
  public handleDrop(): void { }

  public handleDrag(source: readonly TaskTreeElement[], dataTransfer: vscode.DataTransfer): void {
    const taskItem = source.find((item): item is TaskTreeItem => item instanceof TaskTreeItem);
    if (!taskItem) return;

    const taskData = taskItem.taskData;

    const transferData = {
      _id: taskData._id,
      title: taskData.title,
      type: taskData.type,
      status: taskData.status,
      priority: taskData.priority,
      epic: taskData.epic,
      path: taskData.path
    };

    const jsonString = JSON.stringify(transferData);

    dataTransfer.set('application/vnd.code.tree.sprintdesk-tasks',
      new vscode.DataTransferItem(jsonString)
    );

    dataTransfer.set('text/plain',
      new vscode.DataTransferItem(jsonString)
    );
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  public loadMoreTasks(status: TaskStatus): void {
    const currentCount = this.visibleTaskCounts.get(status) ?? TASK_PAGE_SIZE;
    this.visibleTaskCounts.set(status, currentCount + TASK_PAGE_SIZE);
    this.refresh();
  }

  getTreeItem(element: TaskTreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TaskTreeElement): Promise<TaskTreeElement[]> {
    const ws = this.workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      return [];
    }

    if (!element) {
      const tasks = taskService.getTaskService(ws).loadTasks();
      return groupTasksByStatus(tasks).map(group => new TaskStatusTreeItem(group));
    }

    if (element instanceof TaskStatusTreeItem) {
      const visibleCount = this.visibleTaskCounts.get(element.group.status) ?? TASK_PAGE_SIZE;
      const visibleTasks = element.group.tasks.slice(0, visibleCount);
      const taskItems: TaskTreeElement[] = visibleTasks.map(task => this.createTaskTreeItem(task));
      const remainingCount = element.group.tasks.length - visibleTasks.length;

      if (remainingCount > 0) {
        taskItems.push(new LoadMoreTasksTreeItem(element.group.status, remainingCount));
      }

      return taskItems;
    }

    return [];
  }

  private createTaskTreeItem(task: Task): TaskTreeItem {
    const taskData: TaskData = {
      _id: task.id,
      name: task.name || '',
      title: task.title,
      type: task.type,
      status: task.status,
      priority: task.priority,
      epic: task.epic ? { _id: task.epic, title: task.epic, path: '' } : null,
      path: task.path || '',
    };

    const item = new TaskTreeItem(taskData, task, task.path);
    item.id = `task-${task.id}`;
    return item;
  }
}
