import { NodeHost } from './NodeHost';
import { NodeFileSystem } from './NodeFileSystem';
import { IHost } from './IHost';
import { IFileSystem } from './IFileSystem';

let currentHost: IHost | null = null;
let currentFileSystem: IFileSystem | null = null;

export function setHost(host: IHost): void {
  currentHost = host;
}

export function getHost(): IHost {
  if (!currentHost) {
    currentHost = new NodeHost();
  }
  return currentHost;
}

export function setFileSystem(fileSystem: IFileSystem): void {
  currentFileSystem = fileSystem;
}

export function getFileSystem(): IFileSystem {
  if (!currentFileSystem) {
    currentFileSystem = new NodeFileSystem();
  }
  return currentFileSystem;
}

export * from './IHost';
export * from './IFileSystem';
export { NodeHost } from './NodeHost';
export { NodeFileSystem } from './NodeFileSystem';