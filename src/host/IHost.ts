export type MessageType = 'info' | 'warning' | 'error';

export interface GitUser {
  name: string;
  email: string;
}

export interface ExecOptions {
  cwd?: string;
  encoding?: BufferEncoding;
  maxBuffer?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface IHost {
  getWorkspaceRoot(): string | undefined;
  getConfig<T>(key: string, defaultValue?: T): T;
  showMessage(message: string, type?: MessageType): void;
  getGitUser(): Promise<GitUser | undefined>;
  execSync(command: string, options?: ExecOptions): ExecResult;
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  getWorkspaceFolderForUri?(uriPath: string): string | undefined;
}