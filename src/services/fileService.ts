import * as path from 'path';
import { PROJECT_CONSTANTS } from '../utils/constant';
import { getHost, getFileSystem } from '../host';

export function readFileSyncSafe(filePath: string): string {
  try {
    const fileSystem = getFileSystem();
    if (!fileSystem.exists(filePath)) return '';
    return fileSystem.readFile(filePath);
  } catch (e) {
    return '';
  }
}

export function listMdFiles(dir: string): string[] {
  try {
    const fileSystem = getFileSystem();
    if (!fileSystem.exists(dir)) return [];
    return fileSystem.list(dir).filter(f => f.toLowerCase().endsWith('.md'));
  } catch (e) {
    return [];
  }
}

export function getExistingTasksDirs(ws: string): string[] {
  const base = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR);
  const candidates = [path.join(base, PROJECT_CONSTANTS.TASKS_DIR)];
  const found = candidates.filter(d => getFileSystem().exists(d));
  return found.length ? found : [path.join(base, PROJECT_CONSTANTS.TASKS_DIR)];
}

export function fileExists(filePath: string): boolean {
  try { return getFileSystem().exists(filePath); } catch { return false; }
}

/* [vNext_Feature]: Implement a functions to manipulate files */

// get directories functions
export function getWorkspaceRoot(uri?: { fsPath: string }): string {
  const host = getHost();

  // If a file or folder path is provided (like from a sidebar click)
  if (uri) {
    const folder = host.getWorkspaceFolderForUri?.(uri.fsPath);
    if (folder) {
      return folder;
    }
  }

  // If an override was set programmatically, prefer that
  if ((getWorkspaceRoot as any)._overrideRoot) {
    return (getWorkspaceRoot as any)._overrideRoot as string;
  }

  // Fallback to host workspace root
  return host.getWorkspaceRoot() || '';
}
// Allow other parts of the extension to override the detected workspace root
export function setWorkspaceRootOverride(root?: string) {
  (getWorkspaceRoot as any)._overrideRoot = root;
}
export function getSprintDeskDir(ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR);
}
export function getTasksDir(ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.TASKS_DIR);
}
export function getEpicsDir(ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.EPICS_DIR);
}
export function getSprintsDir(ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.SPRINTS_DIR);
}
export function getBacklogsDir(ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.BACKLOGS_DIR);
}
// [COMMIT]: get files paths functions
export function getTasksFilesPath(tasksDir: string): string[] {
  if (!getFileSystem().exists(tasksDir)) return [];
  const files = getFileSystem().list(tasksDir);
  return files.filter(f => f.toLowerCase().endsWith('.md')).map(f => path.join(tasksDir, f));
}

export function getEpicsFilesPath(epicsDir: string): string[] {
  if (!getFileSystem().exists(epicsDir)) return [];
  const files = getFileSystem().list(epicsDir);
  return files.filter(f => f.toLowerCase().endsWith('.md')).map(f => path.join(epicsDir, f));
}

export function getBacklogsFilesPath(backlogsDir: string): string[] {
  if (!getFileSystem().exists(backlogsDir)) return [];
  const files = getFileSystem().list(backlogsDir);
  return files.filter(f => f.toLowerCase().endsWith('.md')).map(f => path.join(backlogsDir, f));
}
export function getSprintsFilesPath(sprintsDir: string): string[] {
  if (!getFileSystem().exists(sprintsDir)) return [];
  const files = getFileSystem().list(sprintsDir);
  return files.filter(f => f.toLowerCase().endsWith('.md')).map(f => path.join(sprintsDir, f));
}

// [COMMIT]: get files names functions without extensions
export function getTasksBaseNames(tasksDir: string): string[] {
  if (!getFileSystem().exists(tasksDir)) return [];
  const files = getFileSystem().list(tasksDir);
  return files.filter(f => f.toLowerCase().endsWith('.md')).map(f => path.basename(f, '.md'));
}
export function getEpicsBaseNames(epicsDir: string): string[] {
  if (!getFileSystem().exists(epicsDir)) return [];
  const files = getFileSystem().list(epicsDir);
  return files.filter(f => f.toLowerCase().endsWith('.md')).map(f => path.basename(f, '.md'));
}

export function getBacklogsBaseNames(backlogsDir: string): string[] {
  if (!getFileSystem().exists(backlogsDir)) return [];
  const files = getFileSystem().list(backlogsDir);
  return files.filter(f => f.toLowerCase().endsWith('.md')).map(f => path.basename(f, '.md'));
}
export function getSprintsBaseNames(sprintsDir: string): string[] {
  if (!getFileSystem().exists(sprintsDir)) return [];
  const files = getFileSystem().list(sprintsDir);
  return files.filter(f => f.toLowerCase().endsWith('.md')).map(f => path.basename(f, '.md'));
}

// [COMMIT]: get files names functions extensions
export function getTasksNames(tasksDir: string): string[] {
  if (!getFileSystem().exists(tasksDir)) return [];
  const files = getFileSystem().list(tasksDir);
  return files.filter(f => f.toLowerCase().endsWith('.md'));
}
export function getEpicsNames(epicsDir: string): string[] {
  if (!getFileSystem().exists(epicsDir)) return [];
  const files = getFileSystem().list(epicsDir);
  console.log('[getEpicsNames]: Epics files found:', files);
  return files.filter(f => f.toLowerCase().endsWith('.md'));
}
export function getBacklogsNames(backlogsDir: string): string[] {
  if (!getFileSystem().exists(backlogsDir)) return [];
  const files = getFileSystem().list(backlogsDir);
  return files.filter(f => f.toLowerCase().endsWith('.md'));
}
export function getSprintsNames(sprintsDir: string): string[] {
  if (!getFileSystem().exists(sprintsDir)) return [];
  const files = getFileSystem().list(sprintsDir);
  return files.filter(f => f.toLowerCase().endsWith('.md'));
}

// [COMMIT]: get file path functions
export function getTaskFilePath(tasksDir: string, fileName: string): string {
  return path.join(tasksDir, fileName);
}
export function getEpicFilePath(epicsDir: string, fileName: string): string {
  return path.join(epicsDir, fileName);
}
export function getBacklogFilePath(backlogsDir: string, fileName: string): string {
  return path.join(backlogsDir, fileName);
}
export function getSprintFilePath(sprintsDir: string, fileName: string): string {
  return path.join(sprintsDir, fileName);
}
// [COMMIT]: get file base name functions
export function getTaskBaseName(filePath: string): string {
  return path.basename(filePath, '.md');
}
export function getEpicBaseName(filePath: string): string {
  return path.basename(filePath, '.md');
}
export function getBacklogBaseName(filePath: string): string {
  return path.basename(filePath, '.md');
}
export function getSprintBaseName(filePath: string): string {
  return path.basename(filePath, '.md');
}
// [COMMIT]: get file name functions
export function getTaskName(filePath: string): string {
  return path.basename(filePath);
}
export function getEpicName(filePath: string): string {
  return path.basename(filePath);
}
export function getBacklogName(filePath: string): string {
  return path.basename(filePath);
}
export function getSprintName(filePath: string): string {
  return path.basename(filePath);
}

// [COMMIT]: create files functions
export function createTaskBaseName(title: string, _id : number): string {
  const safeTitle = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${PROJECT_CONSTANTS.FILE_PREFIX.TASKPATTERN(_id)}${safeTitle || 'untitled-task'}`;
}
export function createEpicBaseName(title: string, _id : number): string {
  const safeTitle = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${PROJECT_CONSTANTS.FILE_PREFIX.EPICPATTERN(_id)}${safeTitle || 'untitled-epic'}`;
}

// [COMMIT]: create relative paths functions
export function createTaskRelativePath(basename: string): string {
  return `../${PROJECT_CONSTANTS.TASKS_DIR}/${basename}.md`;
}
export function createEpicRelativePath(basename: string): string {
  return `../${PROJECT_CONSTANTS.EPICS_DIR}/${basename}.md`;
}
export function createBacklogRelativePath(basename: string): string {
  return `../${PROJECT_CONSTANTS.BACKLOGS_DIR}/${basename}.md`;
}
export function createSprintRelativePath(basename: string): string {
  return `../${PROJECT_CONSTANTS.SPRINTS_DIR}/${basename}.md`;
}

// [COMMIT]: relative paths to absolute paths functions
export function taskRelativePathToAbsolute(relativePath: string, ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.TASKS_DIR, path.basename(relativePath));
}
export function epicRelativePathToAbsolute(relativePath: string, ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.EPICS_DIR, path.basename(relativePath));
}
export function backlogRelativePathToAbsolute(relativePath: string, ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.BACKLOGS_DIR, path.basename(relativePath));
}
export function sprintRelativePathToAbsolute(relativePath: string, ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.SPRINTS_DIR, path.basename(relativePath));
}