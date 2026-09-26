import * as vscode from 'vscode';
import * as path from 'path';
import * as historyService from '../../services/history/historyService';
import { HistoryEntry } from '../../data/types';

interface HistoryTreeEntry {
  id: string;
  title: string;
  subtitle?: string;
  timestamp: string;
  type: 'internal' | 'git';
  entry?: HistoryEntry;
  commit?: historyService.GitCommit;
}

export class HistoryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly entry: HistoryTreeEntry,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(entry.title, collapsibleState);
    
    this.contextValue = 'historyEntry';
    this.tooltip = entry.subtitle || entry.title;
    
    if (entry.type === 'git') {
      this.iconPath = new vscode.ThemeIcon('git-commit');
      this.description = entry.timestamp;
    } else {
      this.iconPath = new vscode.ThemeIcon('history');
      this.description = entry.subtitle;
    }
  }
}

export class HistoryTreeDataProvider implements vscode.TreeDataProvider<HistoryTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<HistoryTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private workspaceRoot: string | undefined;
  private viewMode: 'combined' | 'internal' | 'git' = 'combined';

  constructor() {
    this.refresh();
  }

  setWorkspaceRoot(root: string) {
    this.workspaceRoot = root;
    this.refresh();
  }

  setViewMode(mode: 'combined' | 'internal' | 'git') {
    this.viewMode = mode;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: HistoryTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: HistoryTreeItem): Thenable<HistoryTreeItem[]> {
    if (!this.workspaceRoot) {
      const wsFolders = vscode.workspace.workspaceFolders;
      this.workspaceRoot = wsFolders?.[0]?.uri.fsPath;
    }

    if (!this.workspaceRoot) {
      return Promise.resolve([]);
    }

    if (element) {
      return Promise.resolve([]);
    }

    const entries = this.getEntries();
    return Promise.resolve(entries);
  }

  private getEntries(): HistoryTreeItem[] {
    const internal = historyService.loadHistoryEntries().slice(-50).reverse();
    const gitCommits = historyService.getGitHistoryForSprintDesk().slice(0, 50);

    const items: HistoryTreeItem[] = [];

    if (this.viewMode === 'internal' || this.viewMode === 'combined') {
      for (const entry of internal) {
        const actionEmoji = this.getActionEmoji(entry.action);
        items.push(new HistoryTreeItem({
          id: entry.id,
          title: `${actionEmoji} ${entry.action} ${entry.itemType}: ${entry.itemId}`,
          subtitle: entry.field ? `${entry.field}: ${entry.oldValue || 'N/A'} → ${entry.newValue || 'N/A'}` : undefined,
          timestamp: this.formatDate(entry.timestamp),
          type: 'internal',
          entry
        }));
      }
    }

    if (this.viewMode === 'git' || this.viewMode === 'combined') {
      for (const commit of gitCommits) {
        items.push(new HistoryTreeItem({
          id: commit.hash,
          title: commit.message.substring(0, 60),
          subtitle: commit.author,
          timestamp: this.formatDate(commit.date),
          type: 'git',
          commit
        }));
      }
    }

    if (this.viewMode === 'combined') {
      items.sort((a, b) => {
        const dateA = new Date(a.entry.timestamp).getTime();
        const dateB = new Date(b.entry.timestamp).getTime();
        return dateB - dateA;
      });
    }

    return items;
  }

  private getActionEmoji(action: HistoryEntry['action']): string {
    switch (action) {
      case 'create': return '✨';
      case 'update': return '📝';
      case 'delete': return '🗑️';
      case 'move': return '➡️';
      case 'assign': return '👤';
      default: return '📌';
    }
  }

  private formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  }
}

export const historyTreeDataProvider = new HistoryTreeDataProvider();