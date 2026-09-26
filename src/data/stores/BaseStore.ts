import * as path from 'path';
import yaml from 'js-yaml';
import { getFileSystem, getHost, IFileSystem } from '../../host';

export interface StoreRecord {
  id: string;
}

export class YAMLStore<T extends StoreRecord> {
  protected filePath: string;
  private readonly listKey: string;
  private readonly fileSystem: IFileSystem;

  constructor(relativeDir: string, fileName: string, listKey: string, workspaceRoot?: string) {
    const root = workspaceRoot || getHost().getWorkspaceRoot() || '';
    this.filePath = path.join(root, '.SprintDesk', relativeDir, fileName);
    this.listKey = listKey;
    this.fileSystem = getFileSystem();
  }

  loadAll(): T[] {
    try {
      if (!this.fileSystem.exists(this.filePath)) return [];
      const content = this.fileSystem.readFile(this.filePath);
      const data = yaml.load(content) as Record<string, T[]>;
      return data[this.listKey] || [];
    } catch {
      return [];
    }
  }

  saveAll(items: T[]): void {
    this.fileSystem.mkdir(path.dirname(this.filePath), { recursive: true });
    this.fileSystem.writeFile(this.filePath, yaml.dump({ [this.listKey]: items }));
  }

  getById(id: string): T | undefined {
    return this.loadAll().find(r => r.id === id);
  }

  add(item: T): void {
    const all = this.loadAll();
    all.push(item);
    this.saveAll(all);
  }

  update(id: string, updates: Partial<T>): void {
    const all = this.loadAll();
    const index = all.findIndex(r => r.id === id);
    if (index !== -1) {
      all[index] = { ...all[index], ...updates } as T;
      this.saveAll(all);
    }
  }

  delete(id: string): void {
    const all = this.loadAll().filter(r => r.id !== id);
    this.saveAll(all);
  }

  count(): number {
    return this.loadAll().length;
  }
}