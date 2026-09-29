export interface IFileSystem {
  readFile(filePath: string): string;
  writeFile(filePath: string, content: string): void;
  writeAtomic?(filePath: string, content: string): void;
  realPath?(filePath: string): string;
  withLock?(filePath: string, operation: () => void): void;
  exists(filePath: string): boolean;
  mkdir(dirPath: string, options?: { recursive?: boolean }): void;
  delete(filePath: string): void;
  list(dirPath: string): string[];
}