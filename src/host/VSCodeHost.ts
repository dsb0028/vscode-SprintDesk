import * as vscode from 'vscode';
import { exec as nodeExec, execSync as nodeExecSync } from 'child_process';
import { IHost, GitUser, MessageType, ExecOptions, ExecResult } from './IHost';

export class VSCodeHost implements IHost {
  getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  getWorkspaceFolderForUri(uriPath: string): string | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(uriPath));
    return folder?.uri.fsPath;
  }

  getConfig<T>(key: string, defaultValue?: T): T {
    const cfg = vscode.workspace.getConfiguration('sprintdesk');
    const value = defaultValue === undefined ? cfg.get<T>(key) : cfg.get<T>(key, defaultValue);
    return (value === undefined ? defaultValue : value) as T;
  }

  showMessage(message: string, type: MessageType = 'info'): void {
    if (type === 'error') {
      vscode.window.showErrorMessage(message);
    } else if (type === 'warning') {
      vscode.window.showWarningMessage(message);
    } else {
      vscode.window.showInformationMessage(message);
    }
  }

  async getGitUser(): Promise<GitUser | undefined> {
    try {
      const name = this.execSync('git config user.name').stdout.trim();
      const email = this.execSync('git config user.email').stdout.trim();
      if (!name && !email) return undefined;
      return { name, email };
    } catch {
      return undefined;
    }
  }

  execSync(command: string, options?: ExecOptions): ExecResult {
    const stdout = nodeExecSync(command, {
      cwd: options?.cwd || this.getWorkspaceRoot(),
      encoding: options?.encoding || 'utf8',
      maxBuffer: options?.maxBuffer
    }) as string;
    return { stdout, stderr: '' };
  }

  exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      nodeExec(
        command,
        {
          cwd: options?.cwd || this.getWorkspaceRoot(),
          encoding: options?.encoding || 'utf8',
          maxBuffer: options?.maxBuffer
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ stdout, stderr });
        }
      );
    });
  }
}