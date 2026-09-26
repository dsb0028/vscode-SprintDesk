import * as path from 'path';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';
import * as fileService from '../fileService';
import { getDataService } from '../../data/DataService';
import { HistoryEntry, HistoryData } from '../../data/types';
import { PROJECT_CONSTANTS } from '../../utils/constant';
import { getHost, getFileSystem } from '../../host';

const HISTORY_FILE = 'history.yml';

function getHistoryPath(ws: string): string {
  return path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR, PROJECT_CONSTANTS.DATA_DIR, HISTORY_FILE);
}

function loadHistoryFromFile(ws: string): HistoryEntry[] {
  const historyPath = getHistoryPath(ws);
  try {
    const fileSystem = getFileSystem();
    if (!fileSystem.exists(historyPath)) return [];
    const content = fileSystem.readFile(historyPath);
    const data = yaml.load(content) as HistoryData;
    return data?.entries || [];
  } catch {
    return [];
  }
}

function saveHistoryToFile(ws: string, entries: HistoryEntry[]): void {
  const historyPath = getHistoryPath(ws);
  const fileSystem = getFileSystem();
  fileSystem.mkdir(path.dirname(historyPath), { recursive: true });
  fileSystem.writeFile(historyPath, yaml.dump({ entries }));
}

export interface GitCommit {
  hash: string;
  author: string;
  authorEmail: string;
  date: string;
  message: string;
  files: string[];
}

export function getGitHistoryForItem(itemPath: string, itemType: HistoryEntry['itemType']): GitCommit[] {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return [];

  const ext = path.extname(itemPath);
  const baseName = path.basename(itemPath, ext);

  try {
    const host = getHost();
    const { stdout } = host.execSync(`git log --all --format="%H|%an|%ae|%aI|%s" -- "**/${baseName}*" "**/*${itemType}*"`, {
      cwd: ws
    });

    const commits: GitCommit[] = [];
    const lines = stdout.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length >= 5) {
        commits.push({
          hash: parts[0],
          author: parts[1],
          authorEmail: parts[2],
          date: parts[3],
          message: parts[4],
          files: []
        });
      }
    }

    return commits;
  } catch {
    return [];
  }
}

export function getGitHistoryForSprintDesk(): GitCommit[] {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return [];

  const sdPath = path.join(ws, PROJECT_CONSTANTS.SPRINTDESK_DIR);

  try {
    const host = getHost();
    const { stdout } = host.execSync(`git log --all --format="%H|%an|%ae|%aI|%s" -- "${PROJECT_CONSTANTS.SPRINTDESK_DIR}/"`, {
      cwd: ws,
      maxBuffer: 10 * 1024 * 1024
    });

    const commits: GitCommit[] = [];
    const lines = stdout.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length >= 5) {
        commits.push({
          hash: parts[0],
          author: parts[1],
          authorEmail: parts[2],
          date: parts[3],
          message: parts[4],
          files: []
        });
      }
    }

    return commits;
  } catch {
    return [];
  }
}

export function trackChange(
  itemId: string,
  itemType: HistoryEntry['itemType'],
  action: HistoryEntry['action'],
  field?: string,
  oldValue?: string,
  newValue?: string
): HistoryEntry {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) throw new Error('No workspace found');

  const gitUser = getCurrentGitUser();
  const author = gitUser?.name || 'Unknown';
  const authorEmail = gitUser?.email;

  const entries = loadHistoryFromFile(ws);

  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    itemId,
    itemType,
    action,
    field,
    oldValue,
    newValue,
    author,
    authorEmail,
    timestamp: new Date().toISOString()
  };

  entries.push(entry);
  saveHistoryToFile(ws, entries);

  return entry;
}

export function loadHistoryEntries(): HistoryEntry[] {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return [];
  return loadHistoryFromFile(ws);
}

export function getHistoryForItem(itemId: string, itemType: HistoryEntry['itemType'], limit = 50): {
  internal: HistoryEntry[];
  git: GitCommit[];
} {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return { internal: [], git: [] };

  const internal = loadHistoryFromFile(ws)
    .filter(e => e.itemId === itemId && e.itemType === itemType)
    .slice(-limit)
    .reverse();

  let git: GitCommit[] = [];
  const dataService = getDataService(ws);

  if (itemType === 'task') {
    const task = dataService.getTask(itemId);
    if (task?.path) {
      git = getGitHistoryForItem(task.path, itemType);
    }
  } else if (itemType === 'epic') {
    const epic = dataService.getEpic(itemId);
    if (epic?.path) {
      git = getGitHistoryForItem(epic.path, itemType);
    }
  } else if (itemType === 'sprint') {
    const sprint = dataService.getSprint(itemId);
    if (sprint?.path) {
      git = getGitHistoryForItem(sprint.path, itemType);
    }
  }

  if (git.length === 0) {
    git = getGitHistoryForSprintDesk().slice(0, limit);
  }

  return { internal, git };
}

export function getAllHistory(limit = 100): HistoryEntry[] {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return [];

  return loadHistoryFromFile(ws)
    .slice(-limit)
    .reverse();
}

function getCurrentGitUser(): { name: string; email: string } | null {
  try {
    const host = getHost();
    const name = host.execSync('git config user.name').stdout.trim();
    const email = host.execSync('git config user.email').stdout.trim();
    return { name, email };
  } catch {
    return null;
  }
}

export function getRecentActivity(days = 7): {
  internal: HistoryEntry[];
  commits: GitCommit[];
} {
  const ws = fileService.getWorkspaceRoot();
  if (!ws) return { internal: [], commits: [] };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();

  const internal = loadHistoryFromFile(ws)
    .filter(e => e.timestamp >= cutoffStr)
    .reverse();

  const commits = getGitHistoryForSprintDesk()
    .filter(c => c.date >= cutoffStr);

  return { internal, commits };
}