import { randomUUID } from 'node:crypto';
import {
  canonical, digest, Enrollment, ReceiptPayload, ReviewSnapshot, SignedReceipt,
  SnapshotResponse, verifyReceipt
} from '../../src/review/protocol';

export type Decision = 'met' | 'needs work' | 'needs-evidence';
export interface Draft {
  digest: string;
  evidencePaths: string[];
  decisions: Decision[];
  invalidated?: boolean;
}
export interface Operation {
  receipt: SignedReceipt;
  state: 'pending' | 'accepted';
  expectedWorkStatus?: string;
}
export interface TaskLedger {
  createdAt: string;
  incarnation: string;
  blocked: boolean;
  draft?: Draft;
  operations: Operation[];
}
export interface LocalRoot {
  version: 1;
  workspace: string;
  enrollment: Enrollment;
  keys: Enrollment[];
  revoked: boolean;
  tasks: Record<string, TaskLedger>;
  archives: TaskLedger[];
}

export function assertPlacement(scheme: string, kind: number | undefined, appHost: string): void {
  if (scheme !== 'file' || kind !== 1 || appHost !== 'desktop') {
    throw new Error('Local desktop UI extension placement required. Never enroll a workspace-host extension.');
  }
}

export function evidencePath(path: string): string {
  if (!path || path.includes('\\') || path.includes('\0') || path.startsWith('/')
    || path.split('/').some(part => !part || part === '.' || part === '..')
    || /^[a-zA-Z]:/.test(path)) {
    throw new Error('Evidence must have an unambiguous repository-relative path.');
  }
  return path;
}

export function validateSnapshot(response: SnapshotResponse, projectId: string, taskId: string,
  paths: string[]): ReviewSnapshot {
  const s = response?.snapshot;
  if (!s || ['__proto__', 'constructor', 'prototype'].includes(taskId)
    || s.version !== 1 || s.projectId !== projectId || s.taskId !== taskId
    || typeof s.createdAt !== 'string' || !s.createdAt || !Number.isFinite(Date.parse(s.createdAt))
    || !Array.isArray(s.criteria) || !s.criteria.length
    || s.criteria.some(c => typeof c !== 'string' || !c.trim())
    || new Set(s.criteria).size !== s.criteria.length
    || typeof s.markdown !== 'string' || !s.metadata || typeof s.metadata !== 'object'
    || !Array.isArray(s.evidence) || s.evidence.length !== paths.length
    || s.evidence.some((e, i) => !e || e.path !== paths[i] || typeof e.content !== 'string')
    || new Set(paths).size !== paths.length) {
    throw new Error('Invalid/ambiguous snapshot, criteria, evidence or project identity.');
  }
  paths.forEach(evidencePath);
  digest(s);
  return s;
}

export function observeTask(root: LocalRoot, snapshot: ReviewSnapshot): TaskLedger {
  const remembered = Object.prototype.hasOwnProperty.call(root.tasks, snapshot.taskId)
    ? root.tasks[snapshot.taskId] : undefined;
  if (remembered && (remembered.createdAt !== snapshot.createdAt || remembered.blocked)) {
    remembered.blocked = true;
    throw new Error('Deleted/reused or inaccessible task identity: explicit local reset required.');
  }
  if (remembered) { return remembered; }
  const task: TaskLedger = {
    createdAt: snapshot.createdAt, incarnation: randomUUID(), blocked: false, operations: []
  };
  root.tasks[snapshot.taskId] = task;
  return task;
}

export function pending(root: LocalRoot): boolean {
  return [...Object.values(root.tasks), ...root.archives]
    .some(task => task.operations.some(op => op.state === 'pending'));
}

export function resumeDraft(task: TaskLedger, snapshot: ReviewSnapshot, paths: string[]): Draft {
  const hash = digest(snapshot);
  if (task.draft && (task.draft.invalidated || task.draft.digest !== hash
    || canonical(task.draft.evidencePaths) !== canonical(paths))) {
    task.draft.invalidated = true;
    throw new Error('Snapshot changed. Explicitly discard the old draft before starting again.');
  }
  if (!task.draft) {
    task.draft = { digest: hash, evidencePaths: [...paths], decisions: [] };
  }
  return task.draft;
}

export function decide(draft: Draft, snapshot: ReviewSnapshot, index: number, decision: Decision): void {
  const waiting = draft.decisions.indexOf('needs-evidence');
  if (index !== (waiting < 0 ? draft.decisions.length : waiting) || index >= snapshot.criteria.length
    || !['met', 'needs work', 'needs-evidence'].includes(decision)) {
    throw new Error('Only the single currently displayed criterion can be decided.');
  }
  draft.decisions[index] = decision;
}

export function payload(root: LocalRoot, task: TaskLedger, snapshot: ReviewSnapshot,
  intent: 'review' | 'complete', paths: string[]): ReceiptPayload {
  if (root.revoked || pending(root)) {
    throw new Error('Revoked authority or unresolved prior operation. Reconcile before signing.');
  }
  if (task.blocked || task.createdAt !== snapshot.createdAt) { throw new Error('Task identity blocked.'); }
  const draft = task.draft;
  const latest = task.operations[task.operations.length - 1]?.receipt;
  if (intent === 'review' && (!draft || draft.invalidated || draft.digest !== digest(snapshot)
    || draft.decisions.length !== snapshot.criteria.length
    || draft.decisions.some(d => d === 'needs-evidence')
    || canonical(draft.evidencePaths) !== canonical(paths))) {
    throw new Error('Every exact criterion needs a decision against the current evidence.');
  }
  if (intent === 'complete' && (!latest || latest.payload.intent !== 'review'
    || latest.payload.keyId !== root.enrollment.keyId
    || latest.payload.reviewerId !== root.enrollment.reviewerId
    || latest.payload.snapshotDigest !== digest(snapshot)
    || latest.payload.criteria.some(c => c.result !== 'met')
    || canonical(latest.payload.evidencePaths) !== canonical(paths))) {
    throw new Error('Completion requires the accepted current all-met review.');
  }
  return {
    version: 1, intent, projectId: root.enrollment.projectId, taskId: snapshot.taskId,
    createdAt: snapshot.createdAt, incarnation: task.incarnation,
    reviewerId: root.enrollment.reviewerId, keyId: root.enrollment.keyId,
    snapshotDigest: digest(snapshot), expectedStatus: 'under-review',
    operationId: randomUUID(), sequence: (latest?.payload.sequence ?? 0) + 1,
    timestamp: new Date().toISOString(),
    criteria: intent === 'review'
      ? snapshot.criteria.map((criterion, i) => ({ criterion, result: draft!.decisions[i] as 'met' | 'needs work' }))
      : latest!.payload.criteria,
    evidencePaths: [...paths],
    ...(intent === 'complete' ? { reviewOperationId: latest!.payload.operationId } : {})
  };
}

export function recordIntent(root: LocalRoot, task: TaskLedger, receipt: SignedReceipt,
  expectedWorkStatus?: string): void {
  if (pending(root)) { throw new Error('Unresolved operation exists.'); }
  verifyReceipt(receipt, root.enrollment);
  const p = receipt.payload;
  const last = task.operations[task.operations.length - 1]?.receipt.payload;
  if (root.tasks[p.taskId] !== task || p.incarnation !== task.incarnation || p.createdAt !== task.createdAt
    || p.sequence !== (last?.sequence ?? 0) + 1) {
    throw new Error('Invalid local task sequence/identity.');
  }
  task.operations.push({ receipt, state: 'pending', expectedWorkStatus });
}

export function verifyProjection(response: SnapshotResponse, receipt: SignedReceipt, root: LocalRoot): void {
  const enrollment = root.keys.find(key => key.keyId === receipt.payload.keyId);
  if (!enrollment) { throw new Error('Unknown local public key.'); }
  verifyReceipt(receipt, enrollment);
  const p = receipt.payload;
  const localOperation = root.tasks[p.taskId]?.operations.find(op =>
    op.receipt.payload.operationId === p.operationId);
  if (!localOperation) { throw new Error('Receipt has no independent local intent.'); }
  if (digest(response.snapshot) !== p.snapshotDigest
    || response.snapshot.taskId !== p.taskId || response.snapshot.createdAt !== p.createdAt
    || response.status !== (p.intent === 'review' ? 'under-review' : 'done')
    || response.workStatus !== (p.intent === 'review' ? localOperation.expectedWorkStatus : 'done')
    || canonical(p.intent === 'review' ? response.reviewReceipt ?? null : response.completionReceipt ?? null)
      !== canonical(receipt)) {
    throw new Error('TAMPER WARNING: remote status, evidence or receipt differs from the local ledger.');
  }
  verifyFields(response, receipt, enrollment);
}

function verifyFields(response: SnapshotResponse, receipt: SignedReceipt, enrollment: Enrollment): void {
  const p = receipt.payload;
  const reviewReceipt = p.intent === 'review' ? receipt : response.reviewReceipt;
  if (!reviewReceipt || reviewReceipt.payload.operationId !== p.reviewOperationId && p.intent === 'complete') {
    throw new Error('TAMPER WARNING: missing completion review reference.');
  }
  const r = reviewReceipt.payload;
  const expectedReview = {
    summary: r.criteria.every(c => c.result === 'met') ? 'accepted' : 'further work required',
    reviewerId: r.reviewerId,
    reviewedAt: r.timestamp,
    criteria: r.criteria.map(c => ({ ...c, reviewerId: r.reviewerId, verifiedAt: r.timestamp }))
  };
  if (canonical(response.review ?? null) !== canonical(expectedReview)) {
    throw new Error('TAMPER WARNING: projected review differs from signed decisions.');
  }
  if (p.intent === 'review' && (response.humanVerification || response.completionReceipt)) {
    throw new Error('TAMPER WARNING: review unexpectedly projects completion.');
  }
  if (p.intent === 'complete' && canonical(response.humanVerification ?? null) !== canonical({
    reviewerId: p.reviewerId, reviewerName: enrollment.reviewerName, approvedAt: p.timestamp
  })) {
    throw new Error('TAMPER WARNING: human verification differs from signed completion.');
  }
}

export function reconcile(root: LocalRoot, task: TaskLedger, response: SnapshotResponse): void {
  const latest = task.operations[task.operations.length - 1];
  if (!latest) {
    const review = response.review as Record<string, unknown> | undefined;
    if (response.reviewReceipt || response.completionReceipt || response.humanVerification
      || response.status === 'done' || review && review.summary !== 'pending') {
      throw new Error('UNATTESTED: remote approval has no independent local ledger entry.');
    }
    return;
  }
  verifyProjection(response, latest.receipt, root);
  if (latest.receipt.payload.intent === 'complete') {
    const review = task.operations[task.operations.length - 2]?.receipt;
    if (!review || canonical(response.reviewReceipt ?? null) !== canonical(review)
      || latest.receipt.payload.reviewOperationId !== review.payload.operationId
      || (response.review as Record<string, unknown>)?.reviewedAt !== review.payload.timestamp) {
      throw new Error('TAMPER WARNING: completion review reference differs from local ledger.');
    }
  }
  latest.state = 'accepted';
}
