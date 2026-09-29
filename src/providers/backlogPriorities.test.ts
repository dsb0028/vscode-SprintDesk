import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import yaml from 'js-yaml';
import type { DataTransfer, DataTransferItem } from 'vscode';
import { DataService } from '../data/DataService';
import { Backlog, Task } from '../data/types';
import { NodeHost, setHost } from '../host';
import type { BacklogsTreeDataProvider, BacklogsTreeItem } from './BacklogsTreeDataProvider';

class TreeItemDouble {
  constructor(public label: string, public collapsibleState: number) {}
}

class MarkdownDouble {
  appendMarkdown(): this { return this; }
}

class EventDouble {
  static readonly changes: unknown[] = [];
  readonly event = (): void => {};
  fire(value: unknown): void { EventDouble.changes.push(value); }
}

class TransferItemDouble {
  constructor(public value: string) {}
  async asString(): Promise<string> { return this.value; }
  asFile(): undefined { return undefined; }
}

class TransferDouble {
  readonly entries = new Map<string, DataTransferItem>();
  get(mime: string): DataTransferItem | undefined { return this.entries.get(mime); }
  set(mime: string, item: DataTransferItem): void { this.entries.set(mime, item); }
  [Symbol.iterator](): IterableIterator<[string, DataTransferItem]> {
    return this.entries[Symbol.iterator]();
  }
  forEach(callback: (item: DataTransferItem, mime: string, transfer: DataTransfer) => void): void {
    this.entries.forEach((item, mime) => callback(item, mime, this));
  }
}

function task(number: number, priority: Task['priority'], status: Task['status']): Task {
  return {
    id: `task-${number}`, number, code: `SPD-${number}`, name: `task-${number}`,
    title: `Task ${number}`, type: 'feature', status, priority,
    backlog: 'features', epic: null, sprint: number === 1 ? 'sprint-1' : null,
    createdAt: '', updatedAt: '',
  };
}

function backlog(root: string, id: string, tasks: string[]): Backlog {
  return {
    id, name: id, title: id, tasks, description: '', color: '#2563eb',
    path: join(root, '.SprintDesk', 'Backlogs', `${id}.md`),
  };
}

function persist(root: string, tasks: Task[], backlogs: Backlog[]): void {
  const directory = join(root, '.SprintDesk', 'data');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'tasks.yml'), yaml.dump({ tasks }));
  writeFileSync(join(directory, 'backlogs.yml'), yaml.dump({ backlogs }));
}

function snapshot(root: string): string[] {
  return ['tasks.yml', 'backlogs.yml'].map(name =>
    readFileSync(join(root, '.SprintDesk', 'data', name), 'utf8'));
}

function ids(items: BacklogsTreeItem[]): string[] {
  return Array.from(items, item => {
    assert.ok(item.taskId);
    return item.taskId;
  });
}

async function assertCounts(
  provider: BacklogsTreeDataProvider, backlogId: string, counts: number[]
): Promise<void> {
  const roots = await provider.getChildren();
  const parent = roots.find(item => item.backlogId === backlogId);
  assert.ok(parent);
  const groups = await provider.getChildren(parent);
  assert.deepEqual(Array.from(groups, group => group.label), ['High', 'Medium', 'Low']);
  assert.deepEqual(Array.from(groups, group => group.description),
    counts.map(count => `📋 ${count} tasks`));
  for (const [index, group] of groups.entries()) {
    assert.equal(group.collapsibleState, 1);
    assert.equal(provider.getTreeItem(group).description, `📋 ${counts[index]} tasks`);
    assert.equal((await provider.getChildren(group)).length, counts[index]);
    assert.equal(group.description, `📋 ${counts[index]} tasks`);
  }
}

async function run(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'sprintdesk-backlog-priorities-'));
  const selectedRoot = join(root, 'selected');
  const tasks = [
    task(1, 'high', 'waiting'), task(2, 'low', 'done'),
    task(3, 'medium', 'under-review'), task(4, 'high', 'blocked'),
    task(5, 'medium', 'in-progress'), task(6, 'low', 'cancelled'),
  ];
  const backlogs = [
    backlog(root, 'features', ['task-1', 'task-2', 'task-3', 'task-4']),
    backlog(root, 'bugs', ['task-5', 'task-6']), backlog(root, 'empty', []),
  ];
  const errors: string[] = [];
  const drops: string[] = [];
  const storage = new DataService(root);
  setHost(new NodeHost({ workspaceRoot: root }));

  try {
    persist(root, tasks, backlogs);
    persist(selectedRoot, [task(7, 'low', 'done')], [
      backlog(selectedRoot, 'features', ['task-7']),
    ]);
    mkdirSync(storage.getTasksDir(), { recursive: true });
    for (const item of tasks) {
      // Grouping must use persisted priority even when Markdown disagrees.
      writeFileSync(join(storage.getTasksDir(), storage.getTaskFilename(item)),
        '---\npriority: low\nstatus: waiting\n---\nTask content\n');
    }
    const before = snapshot(root);
    const selectedBefore = snapshot(selectedRoot);
    const providerPath = require.resolve('./BacklogsTreeDataProvider');
    const actualRequire = createRequire(providerPath);
    const exports: Partial<typeof import('./BacklogsTreeDataProvider')> = {};
    const service = {
      getTasksFromBacklogById: (id: string) => storage.getTasksByBacklog(id).map(item => ({
        label: item.title, id: item.id,
        path: join(storage.getTasksDir(), storage.getTaskFilename(item)),
      })),
      addTaskToBacklogById: async (backlogId: string, taskId: string) => {
        drops.push(`${backlogId}:${taskId}`);
      },
    };
    runInNewContext(readFileSync(providerPath, 'utf8'), {
      exports,
      require: (request: string): unknown => {
        if (request === 'vscode') {
          return {
            ['TreeItem']: TreeItemDouble, ['MarkdownString']: MarkdownDouble,
            ['EventEmitter']: EventDouble, ['DataTransferItem']: TransferItemDouble,
            ['ThemeIcon']: class { constructor(public id: string) {} },
            ['Uri']: { file: (fsPath: string) => ({ fsPath }) },
            ['TreeItemCollapsibleState']: { ['None']: 0, ['Collapsed']: 1, ['Expanded']: 2 },
            window: { showErrorMessage: (message: string) => { errors.push(message); } },
          };
        }
        if (request === '../services/fileService') {
          return { getWorkspaceRoot: () => root };
        }
        if (request === '../services/backlogService') { return service; }
        if (request === '../data/DataService') {
          return { getDataService: (workspace: string) => new DataService(workspace) };
        }
        return actualRequire(request);
      },
    }, { filename: providerPath });
    assert.ok(exports.BacklogsTreeDataProvider);
    const provider = new exports.BacklogsTreeDataProvider();
    await assertCounts(provider, 'features', [2, 1, 1]);
    await assertCounts(provider, 'bugs', [0, 1, 1]);
    await assertCounts(provider, 'empty', [0, 0, 0]);
    const roots = await provider.getChildren();
    assert.deepEqual(Array.from(roots, item => item.label), ['bugs', 'empty', 'features']);
    const features = roots[2];
    const groups = await provider.getChildren(features);
    assert.deepEqual(Array.from(groups, item => item.label), ['High', 'Medium', 'Low']);
    assert.equal(features.contextValue, 'backlog');
    assert.match(String(features.description), /4 tasks/);
    assert.equal(new Set(Array.from(groups, group => group.id)).size, 3);
    for (const group of groups) {
      assert.equal(group.contextValue, 'backlogPriorityGroup');
      assert.equal(group.collapsibleState, 1);
      assert.equal(group.command, undefined);
    }
    const high = await provider.getChildren(groups[0]);
    assert.deepEqual(ids(high), ['task-1', 'task-4']);
    assert.deepEqual(ids(await provider.getChildren(groups[1])), ['task-3']);
    assert.deepEqual(ids(await provider.getChildren(groups[2])), ['task-2']);
    const bugs = await provider.getChildren(roots[0]);
    assert.deepEqual(ids(await provider.getChildren(bugs[1])), ['task-5']);
    assert.deepEqual(ids(await provider.getChildren(bugs[2])), ['task-6']);
    assert.notEqual(bugs[0].id, groups[0].id);
    const empty = await provider.getChildren(roots[1]);
    assert.deepEqual(Array.from(empty, group => group.label), ['High', 'Medium', 'Low']);
    for (const group of empty) {
      assert.equal((await provider.getChildren(group)).length, 0);
    }
    const leaf = high[0];
    assert.equal(leaf.contextValue, 'task');
    assert.equal(leaf.backlogId, 'features');
    assert.equal(leaf.command?.command, 'vscode.open');
    assert.ok(leaf.taskPath);
    assert.equal(leaf.resourceUri?.fsPath, leaf.taskPath);
    assert.equal(leaf.command?.arguments?.[0].fsPath, leaf.taskPath);
    assert.equal((await provider.getChildren(leaf)).length, 0);
    const transfer = new TransferDouble();
    provider.handleDrag([leaf], transfer);
    const payload = transfer.get('application/vnd.code.tree.sprintdesk-backlogs');
    assert.ok(payload);
    assert.deepEqual(JSON.parse(payload.value), {
      _id: 'task-1', type: 'task', label: leaf.label, path: leaf.taskPath,
      backlog: { type: 'backlog', backlogId: 'features' },
    });
    const groupTransfer = new TransferDouble();
    provider.handleDrag([groups[0]], groupTransfer);
    provider.handleDrag([features], groupTransfer);
    assert.equal(groupTransfer.entries.size, 0);
    const incoming = new TransferDouble();
    incoming.set('application/vnd.code.tree.sprintdesk-tasks',
      new TransferItemDouble('{"_id":"task-5"}'));
    await provider.handleDrop(features, incoming);
    assert.deepEqual(drops, ['features:task-5']);
    await provider.handleDrop(groups[0], incoming);
    assert.equal(drops.length, 1);
    assert.match(errors.pop() ?? '', /Invalid drop target/);
    assert.deepEqual(errors, []);
    assert.deepEqual(snapshot(root), before);

    tasks[0].priority = 'low';
    backlogs[0].tasks = ['task-1', 'task-3', 'task-4'];
    backlogs[1].tasks.push('task-2');
    tasks[1].backlog = 'bugs';
    persist(root, tasks, backlogs);
    const changed = snapshot(root);
    const eventsBefore = EventDouble.changes.length;
    provider.refresh();
    assert.equal(EventDouble.changes.length, eventsBefore + 1);
    assert.equal(EventDouble.changes[EventDouble.changes.length - 1], undefined);
    await assertCounts(provider, 'features', [1, 1, 1]);
    await assertCounts(provider, 'bugs', [0, 1, 2]);
    assert.deepEqual(ids(await provider.getChildren(groups[0])), ['task-4']);
    assert.deepEqual(ids(await provider.getChildren(groups[2])), ['task-1']);
    assert.deepEqual(ids(await provider.getChildren(bugs[2])), ['task-2', 'task-6']);
    assert.deepEqual(snapshot(root), changed);

    const created = task(8, 'medium', 'waiting');
    tasks.push(created);
    backlogs[0].tasks.push(created.id);
    persist(root, tasks, backlogs);
    const afterCreate = snapshot(root);
    provider.refresh();
    await assertCounts(provider, 'features', [1, 2, 1]);
    await assertCounts(provider, 'bugs', [0, 1, 2]);
    assert.deepEqual(snapshot(root), afterCreate);

    tasks.splice(tasks.findIndex(item => item.id === 'task-3'), 1);
    backlogs[0].tasks = backlogs[0].tasks.filter(id => id !== 'task-3');
    persist(root, tasks, backlogs);
    const afterDelete = snapshot(root);
    provider.refresh();
    await assertCounts(provider, 'features', [1, 1, 1]);
    await assertCounts(provider, 'bugs', [0, 1, 2]);
    const reopened = new exports.BacklogsTreeDataProvider();
    await assertCounts(reopened, 'features', [1, 1, 1]);
    await assertCounts(reopened, 'bugs', [0, 1, 2]);
    assert.deepEqual(snapshot(root), afterDelete);

    provider.setWorkspaceRoot(selectedRoot);
    await assertCounts(provider, 'features', [0, 0, 1]);
    const selectedBacklogs = await provider.getChildren();
    const selectedGroups = await provider.getChildren(selectedBacklogs[0]);
    assert.deepEqual(ids(await provider.getChildren(selectedGroups[2])), ['task-7']);
    assert.equal((await provider.getChildren(selectedGroups[0])).length, 0);
    assert.deepEqual(snapshot(selectedRoot), selectedBefore);
    provider.setWorkspaceRoot();
    assert.equal((await provider.getChildren()).length, 3);
    console.log('Backlog priority provider tests passed.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

void run().catch(error => { console.error(error); process.exitCode = 1; });
