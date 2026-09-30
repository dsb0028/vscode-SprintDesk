import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { canonical, digest, keyId, ReviewSnapshot, SignedReceipt, signReceipt, SnapshotResponse } from '../../src/review/protocol';
import {
  assertPlacement, decide, evidencePath, LocalRoot, observeTask, payload, pending,
  reconcile, recordIntent, resumeDraft, validateSnapshot
} from '../src/state';

let passed = 0;
function test(name: string, run: () => void): void {
  run(); passed++; console.log(`PASS ${name}`);
}
function fixture() {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const enrollment = { version: 1 as const, projectId: 'local-project', reviewerId: 'human',
    reviewerName: 'Human', keyId: keyId(publicKey), publicKey };
  const root: LocalRoot = { version: 1, workspace: 'vscode-remote://ssh-remote+test/project',
    enrollment, keys: [enrollment], revoked: false, tasks: {}, archives: [] };
  const snapshot: ReviewSnapshot = { version: 1, projectId: enrollment.projectId, taskId: 'SPD-1',
    createdAt: '2026-09-29T12:00:00.000Z', metadata: { title: '<script>untrusted</script>' },
    criteria: ['Tests pass', 'Docs accurate'], markdown: '# Task\nEvidence',
    evidence: [{ path: 'results.txt', content: 'actual evidence\n' }] };
  const task = observeTask(root, snapshot);
  const draft = resumeDraft(task, snapshot, ['results.txt']);
  const signReview = () => {
    decide(draft, snapshot, 0, 'met'); decide(draft, snapshot, 1, 'met');
    return signReceipt(payload(root, task, snapshot, 'review', ['results.txt']), privateKey);
  };
  return { root, snapshot, task, draft, privateKey, signReview };
}
function projected(snapshot: ReviewSnapshot, receipt: SignedReceipt,
  reviewReceipt = receipt): SnapshotResponse {
  const p = receipt.payload, r = reviewReceipt.payload;
  return {
    snapshot,
    status: p.intent === 'complete' ? 'done'
      : p.criteria.some(entry => entry.result === 'needs work') ? 'needs-modification' : 'under-review',
    workStatus: p.intent === 'review' ? 'review' : 'done',
    reviewReceipt,
    ...(p.intent === 'complete' ? { completionReceipt: receipt,
      humanVerification: { reviewerId: p.reviewerId, reviewerName: 'Human', approvedAt: p.timestamp } } : {}),
    review: { summary: r.criteria.every(c => c.result === 'met') ? 'accepted' : 'further work required',
      reviewerId: r.reviewerId, reviewedAt: r.timestamp,
      criteria: r.criteria.map(c => ({ ...c, reviewerId: r.reviewerId, verifiedAt: r.timestamp })) }
  };
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test('placement rejects remote extension URI, workspace host (even file), browser and unknown host', () => {
  assertPlacement('file', 1, 'desktop');
  for (const [scheme, kind, host] of [
    ['vscode-remote', 1, 'desktop'], ['file', 2, 'desktop'], ['file', 1, 'web'],
    ['file', undefined, 'desktop']
  ] as const) assert.throws(() => assertPlacement(scheme, kind, host), /placement/);
});
test('evidence paths reject traversal, URI/drive ambiguity, duplicates and wrong content shapes', () => {
  for (const path of ['/secret', '../secret', 'a/../secret', 'a//b', 'C:/secret', 'a\\b', 'a/\0']) {
    assert.throws(() => evidencePath(path));
  }
  const { snapshot } = fixture();
  assert.equal(validateSnapshot({ snapshot, status: 'under-review' }, 'local-project', 'SPD-1', ['results.txt']), snapshot);
  assert.throws(() => validateSnapshot({ snapshot, status: 'under-review' }, 'remote-forged', 'SPD-1', ['results.txt']));
  assert.throws(() => validateSnapshot({ snapshot, status: 'under-review' }, 'local-project', 'SPD-1', []));
  assert.throws(() => validateSnapshot({ snapshot: { ...snapshot, criteria: ['x', 'x'] }, status: 'under-review' },
    'local-project', 'SPD-1', ['results.txt']));
});
test('one criterion at a time; needs-evidence persists locally and cannot sign', () => {
  const { root, snapshot, task, draft } = fixture();
  assert.throws(() => decide(draft, snapshot, 1, 'met'), /single/);
  decide(draft, snapshot, 0, 'needs-evidence');
  assert.deepEqual(clone(draft).decisions, ['needs-evidence']);
  assert.throws(() => decide(draft, snapshot, 1, 'met'), /single/);
  assert.throws(() => payload(root, task, snapshot, 'review', ['results.txt']), /Every/);
  decide(draft, snapshot, 0, 'met');
  decide(draft, snapshot, 1, 'needs work');
  assert.equal(payload(root, task, snapshot, 'review', ['results.txt']).criteria[1].result, 'needs work');
  assert.throws(() => decide(draft, snapshot, 1, 'met'), /single/);
});
test('restart resumes unchanged draft only; changed snapshot/evidence never inherits consent', () => {
  const { root, snapshot, task, draft } = fixture();
  decide(draft, snapshot, 0, 'met');
  const restored = clone(root);
  assert.deepEqual(resumeDraft(restored.tasks['SPD-1'], snapshot, ['results.txt']).decisions, ['met']);
  assert.throws(() => resumeDraft(task, { ...snapshot, markdown: 'changed' }, ['results.txt']), /changed/);
  assert.equal(task.draft!.invalidated, true);
  assert.throws(() => resumeDraft(clone(task), snapshot, ['results.txt']), /changed/);
  assert.throws(() => payload(root, task, snapshot, 'review', ['results.txt']), /Every/);
  assert.throws(() => resumeDraft(task, snapshot, []), /changed/);
});
test('task creation time and random incarnation persist; failed/deleted identities block automatically', () => {
  const { root, snapshot, task } = fixture();
  assert.equal(observeTask(clone(root), snapshot).incarnation, task.incarnation);
  assert.throws(() => observeTask(root, { ...snapshot, createdAt: '2026-09-30T12:00:00Z' }), /reused/);
  task.blocked = true;
  assert.throws(() => observeTask(root, snapshot), /Deleted/);
  const other = observeTask(root, { ...snapshot, taskId: 'SPD-2' });
  assert.notEqual(other.incarnation, task.incarnation);
});
test('durable pending intent blocks all new signatures including other tasks; readback is authority', () => {
  const { root, snapshot, task, privateKey, signReview } = fixture();
  const receipt = signReview();
  recordIntent(root, task, receipt, 'review');
  const restored = clone(root);
  assert.equal(pending(restored), true);
  assert.throws(() => payload(restored, restored.tasks['SPD-1'], snapshot, 'complete', ['results.txt']), /unresolved/);
  const second = observeTask(root, { ...snapshot, taskId: 'SPD-2' });
  assert.throws(() => payload(root, second, { ...snapshot, taskId: 'SPD-2' }, 'review', []), /unresolved/);
  assert.throws(() => recordIntent(root, task, signReceipt({ ...receipt.payload, sequence: 2 }, privateKey)), /Unresolved/);
  reconcile(restored, restored.tasks['SPD-1'], projected(snapshot, receipt));
  assert.equal(pending(restored), false);
});
test('readback rejects status, work status, snapshot, receipt, full projection and human-verification tampering', () => {
  const { root, snapshot, task, signReview } = fixture();
  const receipt = signReview(); recordIntent(root, task, receipt, 'review');
  const good = projected(snapshot, receipt);
  const bad: SnapshotResponse[] = [
    { ...good, status: 'done' }, { ...good, workStatus: 'done' },
    { ...good, snapshot: { ...snapshot, markdown: 'tampered' } },
    { ...good, reviewReceipt: { ...receipt, signature: 'forged' } },
    { ...good, review: { ...(good.review as object), reviewedAt: 'wrong' } },
    { ...good, review: { ...(good.review as object), summary: 'pending' } },
    { ...good, review: { ...(good.review as object), criteria: receipt.payload.criteria } },
    { ...good, humanVerification: { reviewerId: 'human' } },
    { ...good, completionReceipt: receipt }
  ];
  for (const response of bad) {
    assert.throws(() => reconcile(root, task, response), /TAMPER/);
    assert.equal(task.operations[0].state, 'pending');
  }
  reconcile(root, task, good);
});
test('remote approval/public key cannot replace the local authority', () => {
  const { root, snapshot, task, signReview } = fixture();
  const remote = signReview();
  assert.throws(() => reconcile(root, task, projected(snapshot, remote)), /UNATTESTED/);
  const forged = fixture();
  const receipt = signReceipt({ ...remote.payload, keyId: forged.root.enrollment.keyId }, forged.privateKey);
  assert.throws(() => recordIntent(root, task, receipt), /Invalid/);
  assert.equal(root.keys.length, 1);
});
test('completion is a distinct monotonic operation bound to accepted current all-met review', () => {
  const { root, snapshot, task, privateKey, signReview } = fixture();
  const review = signReview(); recordIntent(root, task, review, 'review');
  reconcile(root, task, projected(snapshot, review));
  const p = payload(root, task, snapshot, 'complete', ['results.txt']);
  assert.equal(p.sequence, 2); assert.equal(p.reviewOperationId, review.payload.operationId);
  assert.notEqual(p.operationId, review.payload.operationId);
  const completion = signReceipt(p, privateKey); recordIntent(root, task, completion);
  const good = projected(snapshot, completion, review);
  for (const bad of [
    { ...good, humanVerification: { ...(good.humanVerification as object), approvedAt: 'wrong' } },
    { ...good, humanVerification: { ...(good.humanVerification as object), reviewerName: 'Imposter' } },
    { ...good, reviewReceipt: undefined },
    { ...good, review: { ...(good.review as object), reviewedAt: completion.payload.timestamp + 'bad' } }
  ]) assert.throws(() => reconcile(root, task, bad), /TAMPER/);
  reconcile(root, task, good);
  assert.equal(task.operations[1].state, 'accepted');
  assert.throws(() => payload(root, task, snapshot, 'complete', ['results.txt']), /accepted/);
});
test('needs-work review cannot complete; drift, revocation and wrong sequence cannot authorize', () => {
  const { root, snapshot, task, draft, privateKey } = fixture();
  decide(draft, snapshot, 0, 'met'); decide(draft, snapshot, 1, 'needs work');
  const review = signReceipt(payload(root, task, snapshot, 'review', ['results.txt']), privateKey);
  recordIntent(root, task, review, 'review'); reconcile(root, task, projected(snapshot, review));
  assert.equal(projected(snapshot, review).status, 'needs-modification');
  assert.throws(() => payload(root, task, snapshot, 'complete', ['results.txt']), /all-met/);
  assert.throws(() => payload(root, task, { ...snapshot, markdown: 'changed' }, 'review', ['results.txt']), /Every/);
  assert.throws(() => recordIntent(root, task, signReceipt({ ...review.payload, sequence: 1 }, privateKey)), /sequence/);
  root.revoked = true;
  assert.throws(() => payload(root, task, snapshot, 'review', ['results.txt']), /Revoked/);
  assert.equal(digest(snapshot), draft.digest);
  assert.equal(canonical(clone(review)), canonical(review));
});
console.log(`${passed} standalone pure state/ledger tests passed. Extension-host and installed human gates NOT covered.`);
