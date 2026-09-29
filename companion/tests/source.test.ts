import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { reviewedMarkdown, SnapshotResponse } from '../../src/review/protocol';
import { markdownPath, parseTaskSource, readSource, sourceCriteria } from '../src/source';

function fixture() {
  const task = {
    id: 'SPD-1', code: 'SPD-1', title: 'Task', createdAt: '2026-09-29T12:00:00.000Z',
    path: '/project/.SprintDesk/Tasks/[SPD-1]_task.md', status: 'under-review',
    workStatus: 'review', updatedAt: '2026-09-29T12:01:00.000Z'
  };
  const markdown = '# 🧩 Task: Task\n\n## ✅ Acceptance Criteria\n- Tests pass\n- Docs accurate\n'
    + '### Review Handoff\n\nSummary: pending\n\n## 📝 Notes\nEvidence\n';
  const files: Record<string, Uint8Array> = {
    '.SprintDesk/data/tasks.yml': Buffer.from(yaml.dump({ tasks: [task] })),
    '.SprintDesk/Tasks/[SPD-1]_task.md': Buffer.from(markdown),
    'results.txt': Buffer.from('actual evidence\n')
  };
  const { status, workStatus, updatedAt, ...metadata } = task;
  const remote: SnapshotResponse = {
    snapshot: {
      version: 1, projectId: 'pinned-project', taskId: task.id, createdAt: task.createdAt,
      metadata, criteria: ['Tests pass', 'Docs accurate'],
      markdown: reviewedMarkdown(markdown), evidence: [{ path: 'results.txt', content: 'actual evidence\n' }]
    }, status, workStatus
  };
  const reader = { read: async (path: string) => {
    if (!files[path]) { throw new Error('Missing actual source file.'); }
    return files[path];
  } };
  const run = () => readSource(reader, '/project', 'pinned-project', task.id, ['results.txt'], remote);
  return { task, markdown, files, remote, reader, run };
}

async function main(): Promise<void> {
  let passed = 0;
  async function test(name: string, run: () => Promise<void>): Promise<void> {
    await run(); passed++; console.log(`PASS ${name}`);
  }
  await test('independent workspace source reproduces snapshot without trusting remote enrollment', async () => {
    const f = fixture();
    const source = await f.run();
    assert.deepEqual(source.response, { ...f.remote, reviewReceipt: undefined, completionReceipt: undefined,
      review: undefined, humanVerification: undefined });
    assert.equal(source.rawMarkdown, f.markdown);
    assert.match(source.handoffWarning, /UNAUTHENTICATED/);
    assert.match(source.handoffWarning, /actual YAML/);
  });
  await test('old valid command snapshot cannot hide altered actual metadata or identity', async () => {
    for (const change of [{ title: 'Tampered' }, { createdAt: '2026-09-30T12:00:00.000Z' },
      { path: '/project/.SprintDesk/Tasks/different.md' }]) {
      const f = fixture();
      f.files['.SprintDesk/data/tasks.yml'] = Buffer.from(yaml.dump({ tasks: [{ ...f.task, ...change }] }));
      await assert.rejects(f.run());
    }
  });
  await test('old command snapshot cannot hide altered actual Markdown, criteria or evidence', async () => {
    for (const [path, text] of [
      ['.SprintDesk/Tasks/[SPD-1]_task.md', fixture().markdown.replace('Tests pass', 'Tests fail')],
      ['.SprintDesk/Tasks/[SPD-1]_task.md', fixture().markdown + '\nTampered notes'],
      ['results.txt', 'different real bytes\n']
    ]) {
      const f = fixture(); f.files[path] = Buffer.from(text);
      await assert.rejects(f.run(), /TAMPER/);
    }
  });
  await test('actual lifecycle/protected projection tampering cannot be hidden by digest exclusions', async () => {
    for (const change of [
      { status: 'done' }, { workStatus: 'done' },
      { review: { summary: 'accepted', reviewerId: 'fake', criteria: [] } },
      { humanVerification: { reviewerId: 'fake', reviewerName: 'Fake', approvedAt: 'now' } },
      { reviewReceipt: { payload: {}, signature: 'fake' } }
    ]) {
      const f = fixture();
      f.files['.SprintDesk/data/tasks.yml'] = Buffer.from(yaml.dump({ tasks: [{ ...f.task, ...change }] }));
      await assert.rejects(f.run(), /TAMPER/);
    }
  });
  await test('generated handoff edits do not authenticate themselves and always produce explicit warning', async () => {
    const f = fixture();
    const changed = f.markdown.replace('Summary: pending', 'Summary: accepted\nReviewer: impostor');
    f.files['.SprintDesk/Tasks/[SPD-1]_task.md'] = Buffer.from(changed);
    const source = await f.run();
    assert.equal(source.response.snapshot.markdown, f.remote.snapshot.markdown);
    assert.equal(source.rawMarkdown, changed);
    assert.match(source.handoffWarning, /do not use it as approval or evidence/);
  });
  await test('top-level remote approval history is displayed raw but excluded from task snapshot metadata', async () => {
    const f = fixture();
    const rawYaml = yaml.dump({ tasks: [f.task], approvals: [{ payload: { operationId: 'remote-history' },
      signature: 'unattested remote history' }] });
    f.files['.SprintDesk/data/tasks.yml'] = Buffer.from(rawYaml);
    const source = await f.run();
    assert.equal(source.rawYaml, rawYaml);
    assert.ok(source.rawYaml.includes('approvals:'));
    assert.ok(!('approvals' in source.response.snapshot.metadata));
    assert.deepEqual(source.response.snapshot, f.remote.snapshot);
  });
  await test('deleted task and ambiguous/executable YAML, duplicate IDs/headings and outside paths fail closed', async () => {
    const f = fixture();
    f.files['.SprintDesk/data/tasks.yml'] = Buffer.from('tasks: []');
    await assert.rejects(f.run(), /deleted/);
    for (const yamlText of [
      'tasks: []\ntasks: []', 'tasks: !!js/function "function(){}"',
      yaml.dump({ tasks: [f.task, f.task] }), 'tasks: not-an-array'
    ]) assert.throws(() => parseTaskSource(yamlText, 'SPD-1'));
    assert.throws(() => markdownPath({ ...f.task, path: '/outside/task.md' }, '/project'), /outside/);
    assert.throws(() => markdownPath({ ...f.task, path: '../outside.md' }, '/project'));
    assert.throws(() => sourceCriteria(f.markdown + '\n## ✅ Acceptance Criteria\n- forged\n'), /ambiguous/);
    assert.equal(markdownPath({ id: 'SPD-1', code: 'SPD-1', title: 'Task' }, '/project'),
      '.SprintDesk/Tasks/[SPD-1]_task.md');
  });
  await test('mid-read source mutations, non-UTF8, BOM and selected task evidence fail closed', async () => {
    const f = fixture();
    let reads = 0;
    await assert.rejects(readSource({
      read: async path => {
        if (path === '.SprintDesk/data/tasks.yml' && ++reads > 1) { return Buffer.from('tasks: []'); }
        return f.reader.read(path);
      }
    }, '/project', 'pinned-project', 'SPD-1', ['results.txt'], f.remote), /changed during/);
    for (const bytes of [Buffer.from([0xff]), Buffer.from('\ufeffactual evidence\n')]) {
      const invalid = fixture(); invalid.files['results.txt'] = bytes;
      await assert.rejects(invalid.run());
    }
    const bad = fixture();
    bad.remote.snapshot.evidence = [{ path: '.SprintDesk/data/tasks.yml', content: 'x' }];
    await assert.rejects(readSource(bad.reader, '/project', 'pinned-project', 'SPD-1',
      ['.SprintDesk/data/tasks.yml'], bad.remote), /non-task/);
  });
  console.log(`${passed} independent source-reader tests passed. workspace.fs extension-host/human gates NOT covered.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
