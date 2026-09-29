import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataService } from '../data/DataService';
import { Task } from '../data/types';
import { setFileSystem, setHost } from '../host';
import { NodeFileSystem } from '../host/NodeFileSystem';
import { digest, keyId, ReceiptPayload, signReceipt, SignedReceipt, reviewedMarkdown } from './protocol';
import { receiptReview } from './authorization';
import { getTaskService, updateTaskByPath } from '../services/taskService';

const workspace = mkdtempSync(join(tmpdir(), 'sprintdesk-approval-'));
setFileSystem(new NodeFileSystem());
setHost({
  getWorkspaceRoot: () => workspace,
  getConfig: <T>(_key: string, defaultValue?: T) => defaultValue as T,
  showMessage: () => undefined,
  getGitUser: async () => undefined,
  execSync: () => ({ stdout: '', stderr: '' }),
  exec: async () => ({ stdout: '', stderr: '' }),
});
const ds = new DataService(workspace);
const task: Task = {
  id: 'authorization-fixture', number: 1, code: 'SPD-1', name: 'fixture',
  title: 'Authorization fixture', type: 'test', status: 'waiting', priority: 'low',
  epic: null, sprint: null, backlog: 'features', createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
try {
  mkdirSync(join(workspace, '.SprintDesk', 'data'), { recursive: true });
  ds.addTask(task);
  assert.throws(() => ds.updateTask(task.id, {
    status: 'done', workStatus: 'done',
    humanVerification: { reviewerId: 'human', reviewerName: 'Human', approvedAt: task.createdAt },
  }), /signed|approval|authorization/i);
  assert.equal(ds.getTask(task.id)?.status, 'waiting');
  assert.throws(() => ds.saveTasks([{ ...task, status: 'done' }]), /signed|approval|authorization/i);
  assert.throws(() => ds.addTask({ ...task, id: 'imported', status: 'done' }), /signed|approval|authorization/i);
  assert.throws(() => getTaskService(workspace).createTask({
    title: 'Forged completion', status: 'done',
  }), /signed|approval|authorization/i);
  assert.throws(() => getTaskService(workspace).createTaskFromData({
    ...task, id: 'forged-import', status: 'done',
  }), /signed|approval|authorization/i);
  ds.saveTaskMd(task);
  const markdownPath = join(ds.getTasksDir(), ds.getTaskFilename(task));
  assert.throws(() => updateTaskByPath(markdownPath, { status: 'done' }), /signed|approval|authorization/i);
  writeFileSync(markdownPath, '# Task\n\n## ✅ Acceptance Criteria\n- First\n- Second\n\n## 📝 Notes\nEvidence v1\n');
  ds.updateTask(task.id, { status: 'under-review', review: {
    summary: 'pending', criteria: ds.getTaskAcceptanceCriteria(task).map(criterion => ({ criterion })),
  } });
  ds.saveTaskMd(ds.getTask(task.id)!);
  writeFileSync(markdownPath, reviewedMarkdown(readFileSync(markdownPath, 'utf8')));
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const enrollment = {
    version: 1 as const, projectId: randomUUID(), reviewerId: 'human', reviewerName: 'Human',
    keyId: keyId(publicKey), publicKey,
  };
  ds.enrollReview(enrollment);
  const snapshot = ds.reviewSnapshot(task.id).snapshot;
  assert.throws(() => ds.reviewSnapshot(task.id, ['../outside.txt']), /repository-relative/);
  assert.throws(() => ds.reviewSnapshot(task.id, ['/etc/passwd']), /repository-relative/);
  assert.throws(() => ds.reviewSnapshot(task.id, ['.SprintDesk/data/tasks.yml']), /repository-relative/);
  symlinkSync(tmpdir(), join(workspace, 'outside-link'), 'dir');
  assert.throws(() => ds.reviewSnapshot(task.id, ['outside-link']), /inside its workspace/);
  const base: ReceiptPayload = {
    version: 1, projectId: enrollment.projectId, taskId: task.id, createdAt: task.createdAt,
    incarnation: randomUUID(), reviewerId: 'human', keyId: enrollment.keyId,
    intent: 'review', snapshotDigest: digest(snapshot), expectedStatus: 'under-review',
    operationId: randomUUID(), sequence: 1, timestamp: new Date().toISOString(),
    criteria: snapshot.criteria.map(criterion => ({ criterion, result: 'met' })),
    evidencePaths: [],
  };
  const signed = (updates: Partial<ReceiptPayload> = {}): SignedReceipt =>
    signReceipt({ ...base, ...updates }, privateKey);
  for (const updates of [
    { projectId: 'wrong' }, { taskId: 'wrong' }, { createdAt: 'wrong' },
    { snapshotDigest: '0'.repeat(64) }, { intent: 'complete' as const },
    { criteria: [...base.criteria].reverse() }, { sequence: 0 }, { keyId: 'wrong' },
    { reviewerId: 'impostor' },
  ]) {
    assert.throws(() => ds.commitReview(signed(updates)));
    assert.equal(ds.getTask(task.id)?.review?.summary, 'pending');
  }
  assert.throws(() => ds.commitReview({ ...signed(), signature: Buffer.alloc(64).toString('base64') }),
    /signature/);
  const rejected = ds.commitReview(signed({
    criteria: base.criteria.map((entry, index) => ({ ...entry, result: index ? 'needs work' : 'met' })),
  }));
  assert.equal(rejected.review?.summary, 'further work required');
  assert.deepEqual(ds.reviewSnapshot(task.id).snapshot, snapshot);
  assert.throws(() => ds.commitReview(signed({
    intent: 'complete', sequence: 2, operationId: randomUUID(),
    reviewOperationId: rejected.reviewReceipt?.payload.operationId,
  })), /all-met/);
  assert.throws(() => ds.updateTask(task.id, { review: receiptReview(signed()) }), /signed|replayed/);
  const acceptedReceipt = signed({ sequence: 2, operationId: randomUUID() });
  const accepted = ds.commitReview(acceptedReceipt);
  assert.equal(accepted.status, 'under-review');
  assert.equal(accepted.review?.summary, 'accepted');
  assert.equal(ds.reviewSnapshot(task.id).snapshot.markdown, snapshot.markdown);
  assert.deepEqual(ds.commitReview(acceptedReceipt), accepted);
  assert.throws(() => ds.commitReview(signed()), /replayed/);
  assert.throws(() => ds.commitReview(signed({
    sequence: 3, operationId: randomUUID(), incarnation: randomUUID(),
  })), /mismatched/);
  const original = readFileSync(markdownPath, 'utf8');
  writeFileSync(markdownPath, `${original}\nChanged evidence\n`);
  const completion = signed({
    intent: 'complete', sequence: 3, operationId: randomUUID(),
    reviewOperationId: acceptedReceipt.payload.operationId,
  });
  assert.throws(() => ds.commitReview(completion), /mismatched/);
  writeFileSync(markdownPath, original);
  const beforeFailure = readFileSync(join(workspace, '.SprintDesk', 'data', 'tasks.yml'), 'utf8');
  const fs = new NodeFileSystem();
  fs.withLock(join(workspace, '.SprintDesk', 'data', 'tasks.yml'), () => {
    assert.throws(() => ds.commitReview(completion), /locked/);
    assert.equal(readFileSync(join(workspace, '.SprintDesk', 'data', 'tasks.yml'), 'utf8'), beforeFailure);
  });
  assert.equal(existsSync(join(workspace, '.SprintDesk', 'data', 'tasks.yml.lock')), false);
  class FailingFileSystem extends NodeFileSystem {
    writeAtomic(): void {
      throw new Error('Injected disk failure');
    }
  }
  setFileSystem(new FailingFileSystem());
  assert.throws(() => ds.commitReview(completion), /disk failure/);
  assert.equal(existsSync(join(workspace, '.SprintDesk', 'data', 'tasks.yml.lock')), false);
  assert.equal(readFileSync(join(workspace, '.SprintDesk', 'data', 'tasks.yml'), 'utf8'), beforeFailure);
  setFileSystem(new NodeFileSystem());
  const done = ds.commitReview(completion);
  assert.equal(done.status, 'done');
  assert.equal(done.workStatus, 'done');
  assert.equal(done.humanVerification?.approvedAt, completion.payload.timestamp);
  assert.deepEqual(ds.commitReview(completion), done);
  assert.deepEqual(ds.getReviewAudit().map(receipt => receipt.payload.sequence), [1, 2, 3]);
  assert.throws(() => ds.commitReview(signed({
    intent: 'complete', sequence: 3, operationId: randomUUID(),
    reviewOperationId: acceptedReceipt.payload.operationId,
  })), /replayed|mismatched/);
  assert.throws(() => ds.enrollReview({ ...enrollment, reviewerId: 'replacement' }), /replacement/);
  ds.deleteTask(task.id);
  ds.addTask({ ...task, status: 'under-review' });
  assert.throws(() => ds.commitReview(signed({
    sequence: 4, operationId: randomUUID(),
  })), /identity reuse/);
  writeFileSync(join(workspace, '.SprintDesk', 'data', 'tasks.yml'), 'tasks: not-an-array');
  assert.throws(() => ds.saveTasks([task]), /Invalid task store/);
  console.log('Shared authorization boundary tests passed');
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
