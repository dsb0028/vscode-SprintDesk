import { NodeHost } from './NodeHost';
import { NodeFileSystem } from './NodeFileSystem';
import { NodeSecureStore } from './NodeSecureStore';
import { IHost } from './IHost';
import { IFileSystem } from './IFileSystem';
import { ISecureStore } from './ISecureStore';

let currentHost: IHost | null = null;
let currentFileSystem: IFileSystem | null = null;
let currentSecureStore: ISecureStore | null = null;

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

export function setSecureStore(secureStore: ISecureStore): void {
  currentSecureStore = secureStore;
}

export function getSecureStore(): ISecureStore {
  if (!currentSecureStore) {
    currentSecureStore = new NodeSecureStore();
  }
  return currentSecureStore;
}

export * from './IHost';
export * from './IFileSystem';
export * from './ISecureStore';
export { NodeHost } from './NodeHost';
export { NodeFileSystem } from './NodeFileSystem';
export { NodeSecureStore } from './NodeSecureStore';
