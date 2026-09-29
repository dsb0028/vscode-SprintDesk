const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { generateKeyPairSync, randomUUID } = require('node:crypto');
const yaml = require('../../node_modules/js-yaml');
const { DataService } = require('../../out/data/DataService.js');
const { NodeFileSystem, setFileSystem, setHost } = require('../../out/host/index.js');
const { canonical, digest, keyId, reviewedMarkdown, signReceipt } = require('../out/src/review/protocol.js');
const { decide, observeTask, payload, recordIntent, reconcile, resumeDraft } = require('../out/companion/src/state.js');
const { readSource } = require('../out/companion/src/source.js');
const { LocalLease, RootStore } = require('../out/companion/src/storage.js');

async function run(workStatus, existingHandoff) {
  const directory = path.join(__dirname, '..', `.integration-${randomUUID()}`);
  await fs.mkdir(directory, { recursive: true });
  let lease;
  try {
    setFileSystem(new NodeFileSystem());
    setHost({
      getWorkspaceRoot: () => directory,
      getConfig: (_key, defaultValue) => defaultValue,
      showMessage: () => undefined,
      getGitUser: async () => undefined,
      execSync: () => ({ stdout: '', stderr: '' }),
      exec: async () => ({ stdout: '', stderr: '' })
    });
    const ds = new DataService(directory);
    const mdPath = path.join(directory, '.SprintDesk/Tasks/[SPD-1]_integration.md');
    const task = {
      id: 'integration', number: 1, code: 'SPD-1', name: 'integration',
      title: 'Integration', type: 'test', status: 'waiting', priority: 'low',
      epic: null, sprint: null, backlog: 'features', path: mdPath,
      createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z',
      ...(existingHandoff ? { review: { summary: 'pending',
        criteria: [{ criterion: 'Tests pass' }, { criterion: 'Docs accurate' }] } } : {}),
      ...(workStatus === undefined ? {} : { workStatus })
    };
    ds.addTask(task);
    await fs.mkdir(path.dirname(mdPath), { recursive: true });
    const markdown = '# 🧩 Task: Integration\n\n## 📋 Description\n\n## ✅ Acceptance Criteria\n- Tests pass\n- Docs accurate\n\n## 📝 Notes\nStable evidence\n';
    await fs.writeFile(mdPath, markdown, 'utf8');
    ds.updateTask(task.id, { status: 'under-review' });
    ds.saveTaskMd(ds.getTask(task.id));
    assert.equal((await fs.readFile(mdPath, 'utf8')).includes('### Review Handoff'), existingHandoff);
    const signedMarkdown = reviewedMarkdown(await fs.readFile(mdPath, 'utf8'));
    assert.equal(ds.getTask(task.id).workStatus, workStatus, 'status-only handoff preserves workStatus');
    const pair = generateKeyPairSync('ed25519');
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const secret = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const enrollment = { version: 1, projectId: randomUUID(), reviewerId: 'human',
      reviewerName: 'Human', keyId: keyId(publicKey), publicKey };
    ds.enrollReview(enrollment);
    lease = await LocalLease.acquire(path.join(directory, 'local-authority.lock'));
    const store = new RootStore(path.join(directory, 'local-authority.json'), lease);
    const root = { version: 1, workspace: `file://${directory}`, enrollment, keys: [enrollment],
      revoked: false, tasks: {}, archives: [] };
    const files = { read: relative => fs.readFile(path.join(directory, relative)) };
    const readback = async () => (await readSource(files, directory, enrollment.projectId,
      task.id, [], ds.reviewSnapshot(task.id))).response;
    let current = await readback();
    const baseline = digest(current.snapshot);
    const baselineSnapshot = current.snapshot;
    const ledger = observeTask(root, current.snapshot);
    async function commit(intent, decisions) {
      if (intent === 'review') {
        ledger.draft = undefined;
        const draft = resumeDraft(ledger, current.snapshot, []);
        decisions.forEach((result, index) => decide(draft, current.snapshot, index, result));
      }
      const receipt = signReceipt(payload(root, ledger, current.snapshot, intent, []), secret);
      recordIntent(root, ledger, receipt, current.workStatus);
      await store.write(root);
      const durable = await store.read();
      assert.equal(durable.tasks[task.id].operations.slice(-1)[0].state, 'pending');
      assert.equal(canonical(durable.tasks[task.id].operations.slice(-1)[0].receipt), canonical(receipt));
      ds.commitReview(receipt); // Actual parent implementation, only AFTER fsynced local pending intent.
      const sourceDocument = yaml.load(await fs.readFile(path.join(directory, '.SprintDesk/data/tasks.yml'), 'utf8'));
      assert.equal(sourceDocument.approvals.length, ledger.operations.length,
        'actual parent retains approval history in the same task-state store');
      assert.equal(canonical(sourceDocument.approvals.slice(-1)[0]), canonical(receipt));
      current = await readback();
      assert.deepEqual(current.snapshot, baselineSnapshot, 'actual parent preserves every signed snapshot field');
      assert.equal(current.workStatus, intent === 'review' ? workStatus : 'done');
      reconcile(root, ledger, current);
      await store.write(root);
      assert.equal(digest(current.snapshot), baseline, 'all signed metadata/Markdown remain stable');
      assert.equal(reviewedMarkdown(await fs.readFile(mdPath, 'utf8')), signedMarkdown,
        'evidence Markdown is stable; only explicitly unauthenticated generated handoff may change');
      return receipt;
    }
    await commit('review', ['met', 'needs work']);
    assert.equal(current.status, 'under-review');
    assert.equal(current.workStatus, workStatus);
    assert.equal(current.review.summary, 'further work required');
    assert.throws(() => payload(root, ledger, current.snapshot, 'complete', []), /all-met/);
    const review = await commit('review', ['met', 'met']);
    assert.equal(current.review.summary, 'accepted');
    assert.equal(current.workStatus, workStatus);
    const completion = await commit('complete');
    assert.equal(current.status, 'done'); assert.equal(current.workStatus, 'done');
    assert.equal(completion.payload.sequence, 3);
    assert.equal(completion.payload.reviewOperationId, review.payload.operationId);
    assert.equal(current.humanVerification.approvedAt, completion.payload.timestamp);
    const raw = await readSource(files, directory, enrollment.projectId, task.id, [], ds.reviewSnapshot(task.id));
    assert.ok(raw.rawYaml.includes('approvals:'));
    console.log(`PASS actual parent DataService ${existingHandoff ? 'existing' : 'first-insertion'} handoff ${workStatus ?? '(undefined)'}: needs-work -> accepted -> completion; full snapshot stable; durable intent before delivery`);
  } finally {
    if (lease) await lease.release();
    await fs.rm(directory, { recursive: true, force: true });
  }
}
(async () => {
  for (const existingHandoff of [true, false]) {
    for (const workStatus of ['assigned', 'claimed', undefined]) await run(workStatus, existingHandoff);
  }
  console.log('6 actual-parent integration cases passed; no extension-host/human evidence claimed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
