import yaml from 'js-yaml';
import { TextDecoder } from 'node:util';
import { canonical, digest, reviewedMarkdown, SignedReceipt, SnapshotResponse } from '../../src/review/protocol';
import { evidencePath, validateSnapshot } from './state';

export interface SourceFiles {
  read(relativePath: string): Promise<Uint8Array>;
}
export interface SourceReadback {
  response: SnapshotResponse;
  taskSource: Record<string, unknown>;
  rawYaml: string;
  rawMarkdown: string;
  markdownPath: string;
  handoffWarning: string;
}

function text(bytes: Uint8Array, limit: number): string {
  if (bytes.length > limit) { throw new Error('Source file exceeds the independent reader size limit.'); }
  const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!Buffer.from(value).equals(Buffer.from(bytes))) {
    throw new Error('Source must be exact UTF-8 text without encoding/BOM ambiguity.');
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Invalid task source object.');
  }
  return value as Record<string, unknown>;
}

function taskSources(content: string): Record<string, unknown>[] {
  // JSON schema keeps timestamps as strings and rejects executable/custom YAML tags.
  const data = record(yaml.load(content, { schema: yaml.JSON_SCHEMA }));
  if (!Array.isArray(data.tasks)) { throw new Error('Invalid tasks.yml source.'); }
  const tasks = data.tasks.map(record);
  if (tasks.some(task => typeof task.id !== 'string')
    || new Set(tasks.map(task => task.id)).size !== tasks.length) {
    throw new Error('Ambiguous/duplicate task identity in source.');
  }
  return tasks;
}

export function parseTaskSource(content: string, taskId: string): Record<string, unknown> {
  const task = taskSources(content).find(entry => entry.id === taskId);
  if (!task) { throw new Error('Task deleted/missing from actual YAML source.'); }
  canonical(task);
  return task;
}

export async function resolveTaskReference(files: SourceFiles, reference: string): Promise<string> {
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(reference)
    || ['__proto__', 'constructor', 'prototype'].includes(reference)) {
    throw new Error('Enter an exact task code or canonical ID, not a title or path.');
  }
  const relative = '.SprintDesk/data/tasks.yml';
  const bytes = await files.read(relative);
  const tasks = taskSources(text(bytes, 10_000_000));
  const matches = tasks.filter(task => task.id === reference || task.code === reference);
  if (!matches.length) { throw new Error('Task code or ID not found in the pinned workspace source.'); }
  if (matches.length !== 1) { throw new Error('Ambiguous task code/ID. Use an unambiguous canonical ID.'); }
  const taskId = matches[0].id;
  if (typeof taskId !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(taskId)
    || ['__proto__', 'constructor', 'prototype'].includes(taskId)) {
    throw new Error('Invalid canonical task identity in actual source.');
  }
  canonical(matches[0]);
  if (!Buffer.from(await files.read(relative)).equals(Buffer.from(bytes))) {
    throw new Error('Task source changed during lookup. Load the task again before reviewing.');
  }
  return taskId;
}

export function markdownPath(task: Record<string, unknown>, workspacePath: string): string {
  if (task.path !== undefined) {
    if (typeof task.path !== 'string' || task.path.includes('\\')) {
      throw new Error('Ambiguous task Markdown path.');
    }
    const prefix = workspacePath.replace(/\/$/, '') + '/';
    if (task.path.startsWith('/')) {
      if (!task.path.startsWith(prefix)) { throw new Error('Task Markdown outside pinned workspace.'); }
      return evidencePath(task.path.slice(prefix.length));
    }
    return evidencePath(task.path);
  }
  const code = task.code || task.id;
  if (typeof code !== 'string' || code.includes('/') || code.includes('\\')
    || typeof task.title !== 'string') { throw new Error('Invalid task Markdown filename metadata.'); }
  const slug = task.title.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');
  return evidencePath(`.SprintDesk/Tasks/[${code}]_${slug || (task.title ? '' : 'untitled')}.md`);
}

export function sourceCriteria(markdown: string): string[] {
  if ((markdown.match(/(?:^|\n)## ✅ Acceptance Criteria\r?\n/g) ?? []).length !== 1) {
    throw new Error('Missing/ambiguous acceptance-criteria section in actual Markdown.');
  }
  const section = markdown.match(/(?:^|\n)## ✅ Acceptance Criteria\r?\n([\s\S]*?)(?=\r?\n#{2,3} |\n?$)/);
  const criteria: string[] = [];
  for (const line of section![1].split(/\r?\n/)) {
    const bullet = line.match(/^[-*]\s+(?:\[[ xX]\]\s*)?(.+)$/);
    if (bullet) { criteria.push(bullet[1].trim()); }
    else if (/^\s+\S/.test(line) && criteria.length) {
      criteria[criteria.length - 1] += ` ${line.trim()}`;
    }
  }
  return criteria;
}

export async function readSource(files: SourceFiles, workspacePath: string,
  projectId: string, taskId: string, paths: string[], remote: SnapshotResponse): Promise<SourceReadback> {
  validateSnapshot(remote, projectId, taskId, paths);
  const yamlPath = '.SprintDesk/data/tasks.yml';
  const yamlBytes = await files.read(yamlPath);
  const rawYaml = text(yamlBytes, 10_000_000);
  const task = parseTaskSource(rawYaml, taskId);
  const path = markdownPath(task, workspacePath);
  const markdownBytes = await files.read(path);
  const markdown = text(markdownBytes, 1_000_000);
  const metadata = { ...task };
  for (const field of ['review', 'humanVerification', 'reviewReceipt', 'completionReceipt',
    'status', 'workStatus', 'updatedAt']) {
    delete metadata[field];
  }
  const evidence = [];
  const observed: [string, Uint8Array][] = [[yamlPath, yamlBytes], [path, markdownBytes]];
  for (const selected of paths) {
    evidencePath(selected);
    if (selected.split('/').includes('.SprintDesk')) {
      throw new Error('Selected evidence must be non-task repository files.');
    }
    const bytes = await files.read(selected);
    evidence.push({ path: selected, content: text(bytes, 1_000_000) });
    observed.push([selected, bytes]);
  }
  const response: SnapshotResponse = {
    snapshot: {
      version: 1, projectId, taskId, createdAt: task.createdAt as string, metadata,
      criteria: sourceCriteria(markdown), markdown: reviewedMarkdown(markdown), evidence
    },
    status: task.status as string,
    workStatus: task.workStatus as string | undefined,
    reviewReceipt: task.reviewReceipt as SignedReceipt | undefined,
    completionReceipt: task.completionReceipt as SignedReceipt | undefined,
    review: task.review, humanVerification: task.humanVerification
  };
  validateSnapshot(response, projectId, taskId, paths);
  if (digest(response.snapshot) !== digest(remote.snapshot)
    || canonical({ ...response, snapshot: undefined }) !== canonical({ ...remote, snapshot: undefined })) {
    throw new Error('TAMPER WARNING: actual YAML/Markdown/evidence differs from remote snapshot response.');
  }
  for (const [relative, prior] of observed) {
    if (!Buffer.from(await files.read(relative)).equals(Buffer.from(prior))) {
      throw new Error('Actual source changed during independent readback. No signing allowed.');
    }
  }
  return {
    response, taskSource: task, rawYaml, rawMarkdown: markdown, markdownPath: path,
    handoffWarning: 'The generated ### Review Handoff block is an UNAUTHENTICATED Markdown projection. '
      + 'It is excluded from the signed digest; do not use it as approval or evidence. '
      + 'Only the actual YAML projection checked against the independent local receipt ledger is authenticated.'
  };
}
