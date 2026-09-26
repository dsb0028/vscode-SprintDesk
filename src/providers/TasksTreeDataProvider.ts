import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PROJECT_CONSTANTS, UI_CONSTANTS } from '../utils/constant';
import matter from 'gray-matter';
import * as taskService from '../services/taskService';
import * as fileService from '../services/fileService';
import { SprintDeskItem } from '../utils/SprintDeskItem';
import { getDataService } from '../data/DataService';
import { Task } from '../data/types';
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

    this.label = `${this.taskData.name || this.taskData.title} ${statusEmoji}`;

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

export class TasksTreeDataProvider implements vscode.TreeDataProvider<TaskTreeItem>, vscode.TreeDragAndDropController<TaskTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TaskTreeItem | undefined | void> = new vscode.EventEmitter<TaskTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TaskTreeItem | undefined | void> = this._onDidChangeTreeData.event;

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
    this.refresh();
  }

  // Any task dropped from epic sprint backlog should be removed from there,
  // and returned to the main tasks list.
  public handleDrop(): void { }

  public handleDrag(source: readonly TaskTreeItem[], dataTransfer: vscode.DataTransfer): void {
    if (!source[0]) return;

    const taskItem = source[0];
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

  getTreeItem(element: TaskTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TaskTreeItem): Promise<TaskTreeItem[]> {
    const ws = this.workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      return [];
    }

    if (!element) {
      // Load tasks directly from YAML (source of truth)
      const tasks = taskService.loadTasks();

      return tasks.map((task: Task) => {
        // Get the MD file path from the task's path field
        const mdPath = task.path || '';

        const taskData: TaskData = {
          _id: task.id,
          name: task.name || '',
          title: task.title,
          type: task.type,
          status: task.status,
          priority: task.priority,
          epic: task.epic ? { _id: task.epic, title: task.epic, path: '' } : null,
          path: mdPath
        };

        // Create TreeItem with task data and MD file path
        const item = new TaskTreeItem(taskData, task, mdPath);

        return item;
      }).filter(item => item !== null) as TaskTreeItem[];
    }

    return [];
  }

}
