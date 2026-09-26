import * as fs from 'fs';
import { IFileSystem } from './IFileSystem';

export class NodeFileSystem implements IFileSystem {
  readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf8');
  }

  writeFile(filePath: string, content: string): void {
    fs.writeFileSync(filePath, content, 'utf8');
  }

  exists(filePath: string): boolean {
    try { return fs.existsSync(filePath); } catch { return false; }
  }

  mkdir(dirPath: string, options?: { recursive?: boolean }): void {
    fs.mkdirSync(dirPath, options);
  }

  delete(filePath: string): void {
    fs.unlinkSync(filePath);
  }

  list(dirPath: string): string[] {
    return fs.readdirSync(dirPath);
  }
}