import { exec as nodeExec, execSync as nodeExecSync } from 'child_process';
import { IHost, GitUser, MessageType, ExecOptions, ExecResult } from './IHost';

export class NodeHost implements IHost {
  private root: string;
  private settings: Record<string, unknown>;

  constructor(options?: { workspaceRoot?: string; config?: Record<string, unknown> }) {
    this.root = options?.workspaceRoot || process.env.SPRINTDESK_WORKSPACE || process.cwd();
    this.settings = options?.config || {};
  }

  getWorkspaceRoot(): string | undefined {
    return this.root;
  }

  getConfig<T>(key: string, defaultValue?: T): T {
    const value = this.lookup(key);
    return (value === undefined ? defaultValue : value) as T;
  }

  private lookup(key: string): unknown {
    return key.split('.').reduce<unknown>((acc, part) => {
      if (acc !== null && typeof acc === 'object') {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, this.settings);
  }

  showMessage(message: string, type: MessageType = 'info'): void {
    const label = type === 'error'
      ? '[SprintDesk][error]'
      : type === 'warning'
        ? '[SprintDesk][warning]'
        : '[SprintDesk]';
    console.log(`${label} ${message}`);
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
      cwd: options?.cwd || this.root,
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
          cwd: options?.cwd || this.root,
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