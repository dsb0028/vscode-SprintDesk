import * as path from 'path';
import { getFileSystem, getHost, IFileSystem } from '../../host';

export interface ProjectMcpManifest {
  schemaVersion: number;
  extension: string;
  workspace: string;
  generatedAt: string;
  servers: string[];
}

export interface ProjectMcpFile {
  load(): ProjectMcpManifest | null;
  save(manifest: ProjectMcpManifest): void;
}

export function getProjectMcpPath(workspaceRoot?: string): string {
  const root = workspaceRoot || getHost().getWorkspaceRoot() || '';
  return path.join(root, '.SprintDesk', 'project.mcp.json');
}

export function loadProjectMcp(workspaceRoot?: string): ProjectMcpManifest | null {
  const fileSystem: IFileSystem = getFileSystem();
  const filePath = getProjectMcpPath(workspaceRoot);
  try {
    if (!fileSystem.exists(filePath)) return null;
    const content = fileSystem.readFile(filePath);
    return JSON.parse(content) as ProjectMcpManifest;
  } catch {
    return null;
  }
}

export function saveProjectMcp(manifest: ProjectMcpManifest, workspaceRoot?: string): void {
  const fileSystem: IFileSystem = getFileSystem();
  const filePath = getProjectMcpPath(workspaceRoot);
  fileSystem.mkdir(path.dirname(filePath), { recursive: true });
  fileSystem.writeFile(filePath, JSON.stringify(manifest, null, 2) + '\n');
}

export function defaultProjectMcpManifest(workspaceRoot?: string): ProjectMcpManifest {
  const root = workspaceRoot || getHost().getWorkspaceRoot() || '';
  return {
    schemaVersion: 1,
    extension: 'vscode-sprintdesk',
    workspace: root,
    generatedAt: new Date().toISOString(),
    servers: []
  };
}