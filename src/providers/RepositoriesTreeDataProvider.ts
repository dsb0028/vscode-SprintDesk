import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PROJECT_CONSTANTS, UI_CONSTANTS } from '../utils/constant';

export class RepositoriesTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    // fullPath points to repository root for repo nodes, or to a file for file nodes
    public readonly fullPath: string,
    // type: 'repo' | 'category' | 'file'
    public readonly nodeType: 'repo' | 'category' | 'file' = 'repo',
    // categoryName used when nodeType === 'category'
    public readonly categoryName?: string
  ) {
    super(label, collapsibleState);

    if (fullPath) this.resourceUri = vscode.Uri.file(fullPath);

    this.tooltip = `${fullPath}`;

    if (nodeType === 'repo') {
      // Add context menu for repository nodes
      this.contextValue = 'repository';
      this.iconPath = new vscode.ThemeIcon('folder');
      this.tooltip = `Right-click for options: ${fullPath}`;
    } else if (nodeType === 'category') {
      this.contextValue = `repoCategory`;
      this.iconPath = new vscode.ThemeIcon('root-folder');
    } else {
      // file node: allow opening
      this.contextValue = 'file';
      this.iconPath = new vscode.ThemeIcon('file');
      this.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [vscode.Uri.file(fullPath)]
      };
    }
  }
}

function humanizeFileLabel(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  const cleaned = base
    .replace(/^[\[]?(?:task|backlog|epic|sprint)[\]]?_?/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return cleaned || base;
}

export class RepositoriesTreeDataProvider implements vscode.TreeDataProvider<RepositoriesTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<RepositoriesTreeItem | undefined | void> = new vscode.EventEmitter<RepositoriesTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<RepositoriesTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  private workspaceRoots: string[] = [];
  private excludeDirs = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.vscode', 'vendor', 'bower_components']);

  constructor() {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      this.workspaceRoots = folders.map(f => f.uri.fsPath);
    }
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: RepositoriesTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: RepositoriesTreeItem): Promise<RepositoriesTreeItem[]> {
    if (!this.workspaceRoots || this.workspaceRoots.length === 0) return [];

    // Root level: list repositories that contain .SprintDesk
    if (!element) {
      const parents = new Set<string>();

      for (const root of this.workspaceRoots) {
        try {
          await this.scanForSprintDesk(root, parents);
        } catch (err) {
          // ignore errors for individual roots
          console.error('Error scanning root', root, err);
        }
      }

      const items = Array.from(parents).map(p => {
        return new RepositoriesTreeItem(path.basename(p) || p, vscode.TreeItemCollapsibleState.Collapsed, p, 'repo');
      });

      items.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));

      return items;
    }

    // If a repository node was expanded, show category nodes
    if (element.nodeType === 'repo') {
      const categories = [
        { label: 'Backlogs', key: PROJECT_CONSTANTS.BACKLOGS_DIR },
        { label: 'Epics', key: PROJECT_CONSTANTS.EPICS_DIR },
        { label: 'Sprints', key: PROJECT_CONSTANTS.SPRINTS_DIR },
        { label: 'Tasks', key: PROJECT_CONSTANTS.TASKS_DIR }
      ];

      return categories.map(c => new RepositoriesTreeItem(c.label, vscode.TreeItemCollapsibleState.Collapsed, element.fullPath, 'category', c.label));
    }

    // If a category node was expanded, list files inside <repo>/.SprintDesk/<Category>
    if (element.nodeType === 'category') {
      const mapping: Record<string, string> = {
        Backlogs: PROJECT_CONSTANTS.BACKLOGS_DIR,
        Epics: PROJECT_CONSTANTS.EPICS_DIR,
        Sprints: PROJECT_CONSTANTS.SPRINTS_DIR,
        Tasks: PROJECT_CONSTANTS.TASKS_DIR
      };

      const prefixMap: Record<string, string> = {
        Backlogs: PROJECT_CONSTANTS.FILE_PREFIX.BACKLOG,
        Epics: PROJECT_CONSTANTS.FILE_PREFIX.EPIC,
        Sprints: PROJECT_CONSTANTS.FILE_PREFIX.SPRINT,
        Tasks: PROJECT_CONSTANTS.FILE_PREFIX.TASK
      };

      const catDirName = mapping[element.categoryName || ''];
      if (!catDirName) return [];

      const dirPath = path.join(element.fullPath, PROJECT_CONSTANTS.SPRINTDESK_DIR, catDirName);
      try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        const files = entries.filter(e => e.isFile()).map(e => e.name);

        const filtered = files.filter(f => f.endsWith(PROJECT_CONSTANTS.MD_FILE_EXTENSION) && f.startsWith(prefixMap[element.categoryName || ''] || ''));

        const items = filtered.map(fname => {
          const filePath = path.join(dirPath, fname);
          const label = humanizeFileLabel(fname);
          return new RepositoriesTreeItem(label, vscode.TreeItemCollapsibleState.None, filePath, 'file', element.categoryName);
        });

        items.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
        return items;
      } catch (err) {
        return [];
      }
    }

    return [];
  }

  private async scanForSprintDesk(startDir: string, outSet: Set<string>) {
    const stack: string[] = [startDir];

    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (err) {
        // unreadable directory, skip
        continue;
      }

      for (const e of entries) {
        try {
          if (e.isDirectory()) {
            if (e.name === '.SprintDesk') {
              // parent directory is the repository/project root we want
              outSet.add(dir);
              // do not descend into the .SprintDesk folder
              continue;
            }

            if (this.excludeDirs.has(e.name)) continue;

            // push subdirectory to stack to scan
            stack.push(path.join(dir, e.name));
          }
        } catch (err) {
          // skip problematic entry
          continue;
        }
      }
    }
  }
}
