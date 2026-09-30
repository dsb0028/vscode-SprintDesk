const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { generateKeyPairSync, randomUUID } = require('node:crypto');
const { DataService } = require('../../out/data/DataService.js');
const { NodeFileSystem, setFileSystem, setHost } = require('../../out/host/index.js');
const { keyId, digest } = require('../out/src/review/protocol.js');

function uri(file) {
  return {
    scheme: 'file', authority: '', query: '', fragment: '', path: file, fsPath: file,
    toString: () => `file://${file}`,
    with: changes => ({ ...uri(file), ...changes })
  };
}

async function waitFor(predicate, description) {
  const limit = Date.now() + 5000;
  while (Date.now() < limit) {
    if (await predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function fixture(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sprintdesk-controller-'));
  const disposals = [], messages = [], errors = [], receipts = [], snapshotIDs = [];
  let receive, opening, panel, failDelivery = false, failPersistence = false, deliveryGate;
  const originalLoad = Module._load;
  try {
    setFileSystem(new NodeFileSystem());
    setHost({
      getWorkspaceRoot: () => directory, getConfig: (_key, fallback) => fallback,
      showMessage: () => undefined, getGitUser: async () => undefined,
      execSync: () => ({ stdout: '', stderr: '' }), exec: async () => ({ stdout: '', stderr: '' })
    });
    const service = new DataService(directory);
    const id = randomUUID();
    const task = {
      id, number: 1, code: 'SPD-1', name: 'controller', title: 'Controller fixture',
      type: 'test', status: 'under-review', priority: 'low', epic: null, sprint: null,
      backlog: 'fixture', path: path.join(directory, '.SprintDesk/Tasks/[SPD-1]_controller.md'),
      createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z'
    };
    service.addTask(task);
    await fs.mkdir(path.dirname(task.path), { recursive: true });
    await fs.writeFile(task.path,
      '# Task\n\n## ✅ Acceptance Criteria\n- First exact criterion\n- Second exact criterion\n\n## 📝 Notes\nActual evidence\n');
    const pair = generateKeyPairSync('ed25519');
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const secret = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const enrollment = { version: 1, projectId: randomUUID(), reviewerId: 'fixture-human',
      reviewerName: 'Fixture human', keyId: keyId(publicKey), publicKey };
    service.enrollReview(enrollment);
    const workspace = { name: 'Fixture', uri: uri(directory) };
    const root = { version: 1, workspace: workspace.uri.toString(), enrollment, keys: [enrollment],
      revoked: false, tasks: {}, archives: [] };
    const globalState = new Map([[`authority:${workspace.uri.toString()}`, root]]);
    const vscode = {
      Uri: { joinPath: (base, ...parts) => uri(path.join(base.path, ...parts)) },
      env: { appHost: 'desktop', remoteName: undefined },
      extensions: { getExtension: () => ({ extensionKind: 1 }) },
      workspace: { workspaceFolders: [workspace], fs: { readFile: target => fs.readFile(target.path) } },
      ViewColumn: { One: 1 },
      window: {
        showWarningMessage: async () => undefined,
        showErrorMessage: error => errors.push(error),
        createWebviewPanel: () => {
          panel = {
            webview: { html: '', postMessage: model => { messages.push(model); return Promise.resolve(true); },
              onDidReceiveMessage: handler => { receive = handler; return { dispose() {} }; } },
            onDidDispose: handler => disposals.push(handler),
            reveal() {}, dispose: () => disposals.splice(0).forEach(handler => handler())
          };
          return panel;
        }
      },
      commands: {
        registerCommand: (_name, handler) => { opening = handler; return { dispose() {} }; },
        executeCommand: async (name, workspaceURI, value) => {
          assert.equal(workspaceURI, workspace.uri.toString());
          if (name === 'sprintdesk.reviewSnapshot') {
            snapshotIDs.push(value);
            return service.reviewSnapshot(value);
          }
          if (name === 'sprintdesk.reviewCommit') {
            receipts.push(value);
            if (deliveryGate) await deliveryGate;
            if (failDelivery) throw new Error('Simulated delivery unavailable');
            return service.commitReview(value);
          }
          throw new Error(`Unexpected command: ${name}`);
        }
      }
    };
    const context = {
      extension: { id: 'fixture-reviewer' }, extensionUri: uri('/fixture-extension'),
      globalStorageUri: uri(path.join(directory, 'local-storage')), subscriptions: [],
      globalState: { get: key => globalState.get(key), update: async (key, value) => {
        if (failPersistence) throw new Error('Simulated local persistence failure');
        globalState.set(key, value);
      } },
      secrets: { get: async () => secret, store: async () => { throw new Error('No enrollment authorized'); },
        delete: async () => { throw new Error('No key deletion authorized'); } }
    };
    Module._load = function(request, parent, main) {
      return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, main);
    };
    const extensionPath = require.resolve('../out/companion/src/extension.js');
    delete require.cache[extensionPath];
    require(extensionPath).activate(context);
    await opening('SPD-1');
    assert.equal(errors.length, 0);
    const current = () => messages[messages.length - 1];
    const send = async (action, extra = {}) => {
      const token = current().token;
      receive({ action, token, ...extra });
      await waitFor(() => current().token !== token && !current().busy, action);
      return current();
    };
    await run({ current, send, receive, messages, receipts, snapshotIDs, service, task, open: opening,
      reopen: async () => {
        panel.dispose();
        const lock = path.join(directory, 'local-storage',
          `authority-${digest(workspace.uri.toString())}.lock`);
        await waitFor(async () => {
          try { await fs.access(lock); return false; }
          catch (error) { if (error.code === 'ENOENT') return true; throw error; }
        }, 'closed panel lease release');
        await opening(task.id);
      },
      setFailure: value => { failDelivery = value; },
      setPersistenceFailure: value => { failPersistence = value; },
      holdDelivery: () => {
        let release;
        deliveryGate = new Promise(resolve => { release = resolve; });
        return () => { deliveryGate = undefined; release(); };
      }
    });
  } finally {
    Module._load = originalLoad;
    if (panel) {
      panel.dispose();
      const lock = path.join(directory, 'local-storage', `authority-${digest(`file://${directory}`)}.lock`);
      await waitFor(async () => {
        try { await fs.access(lock); return false; }
        catch (error) { if (error.code === 'ENOENT') return true; throw error; }
      }, 'local lease release');
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  await fixture(async f => {
    const view = await f.send('load', { taskId: '__proto__' });
    assert.equal(view.phase, 'error');
    assert.equal(Object.prototype.blocked, undefined);
    assert.equal(f.receipts.length, 0);
    await f.send('load', { taskId: 'SPD-1' });
    assert.equal(f.current().phase, 'criterion');
  });
  console.log('PASS malformed task references cannot mutate prototype/authority or prevent a valid lookup');
  await fixture(async f => {
    let view = await f.send('load', { taskId: 'SPD-1' });
    assert.equal(view.taskId, f.task.id);
    assert.equal(view.snapshot.metadata.code, 'SPD-1');
    assert(f.snapshotIDs.every(id => id === f.task.id));
    assert.equal(view.phase, 'criterion');
    assert.equal(view.verification, 'draft');
    assert.equal(view.draftSaved, true);
    assert.equal(f.receipts.length, 0);
    await f.open('SPD-999');
    assert.equal(f.current().taskId, f.task.id, 'Public open never replaces an existing review');
    assert.equal(f.receipts.length, 0, 'Public open never signs or submits');
    const token = view.token, count = f.messages.length;
    f.receive({ action: 'confirm-complete', token });
    f.receive({ action: 'met', token: 'stale-token' });
    f.receive({ action: 'met', token, taskId: 'forged-extra-field' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.messages.length, count);
    view = await f.send('met');
    assert.equal(view.index, 1);
    view = await f.send('met');
    assert.equal(view.phase, 'summary');
    assert.equal(f.receipts.length, 0, 'Decisions and summary do not sign automatically');
    const release = f.holdDelivery();
    const confirmToken = view.token;
    f.receive({ action: 'confirm-review', token: confirmToken });
    await waitFor(() => f.receipts.length === 1, 'first durable review delivery');
    assert(f.current().busy);
    assert.equal(f.current().token, '');
    assert.deepEqual(f.current().allowedActions, []);
    f.receive({ action: 'confirm-review', token: confirmToken });
    f.receive({ action: 'confirm-complete', token: '' });
    release();
    await waitFor(() => !f.current().busy && f.current().phase === 'complete', 'verified review');
    assert.equal(f.receipts.length, 1, 'Rapid/queued confirmations never create a second signature');
    assert.equal(f.current().taskStatus, 'under-review');
    assert.equal(f.current().verification, 'verified');
    assert(f.messages.some(message => /Signing.*locally/.test(message.progress)));
    assert(f.messages.some(message => /Saving the signed intent/.test(message.progress)));
    assert(f.messages.some(message => /Submitting/.test(message.progress)));
    view = await f.send('complete-summary');
    assert.equal(view.phase, 'completionSummary');
    await f.send('cancel');
    assert.equal(f.receipts.length, 1, 'Cancelling completion issues no receipt');
    await f.send('complete-summary');
    view = await f.send('confirm-complete');
    assert.equal(view.phase, 'done');
    assert.equal(view.verification, 'verified');
    assert.equal(view.taskStatus, 'done');
    assert.equal(f.receipts.length, 2);
    assert.equal(f.receipts[1].payload.reviewOperationId, f.receipts[0].payload.operationId);
    await f.send('load', { taskId: f.task.id });
    assert.equal(f.receipts.length, 2, 'Readback never signs');
  });
  console.log('PASS controller exact lookup, individual draft, stale/phase/schema guards, busy progress and separate completion');
  await fixture(async f => {
    await f.send('load', { taskId: 'SPD-1' });
    await f.send('met'); await f.send('met');
    f.setFailure(true);
    let view = await f.send('confirm-review');
    assert.equal(view.phase, 'uncertain');
    assert.equal(view.verification, 'unverified');
    assert.equal(view.pendingIntent, 'review');
    assert.match(view.errorHelp, /same saved receipt/);
    assert(!view.allowedActions.includes('revoke'));
    const saved = f.receipts[0];
    f.setFailure(false);
    view = await f.send('retry');
    assert.equal(view.phase, 'complete');
    assert.deepEqual(f.receipts[1], saved, 'Retry delivers identical receipt, never a new signature');
    assert.equal(f.service.getTask(f.task.id).status, 'under-review');
  });
  console.log('PASS controller uncertain delivery and same-receipt retry; actual local-human host consent NOT established by mocks');
  await fixture(async f => {
    await f.send('load', { taskId: 'SPD-1' });
    await f.send('met'); await f.send('met');
    f.setPersistenceFailure(true);
    let view = await f.send('confirm-review');
    assert.equal(view.phase, 'error');
    assert.match(view.errorHelp, /not confirmed saved durably/);
    assert.equal(f.receipts.length, 0, 'Local persistence failure must prevent all remote delivery');
    const operationId = view.ledger[0].operationId;
    await f.send('retry');
    assert.equal(f.receipts.length, 0, 'Retry cannot bypass continued local persistence failure');
    f.setPersistenceFailure(false);
    view = await f.send('retry');
    assert.equal(view.phase, 'complete');
    assert.equal(f.receipts.length, 1);
    assert.equal(f.receipts[0].payload.operationId, operationId, 'Repaired retry keeps the original signed intent');
  });
  console.log('PASS persistence failure prevents delivery and retry must save the same intent durably first');
  await fixture(async f => {
    await f.send('load', { taskId: 'SPD-1' });
    await f.send('met');
    f.service.deleteTask(f.task.id);
    await f.reopen();
    let view = await f.send('load', { taskId: f.task.id });
    assert.equal(view.phase, 'error');
    assert.equal(view.verification, 'unverified');
    assert.equal(view.draftSaved, false);
    assert.match(view.errorHelp, /remembered identity is blocked/);
    f.service.addTask(f.task);
    view = await f.send('load', { taskId: f.task.id });
    assert.equal(view.phase, 'error', 'A restored identity does not silently resume invalidated decisions');
    assert.match(view.error, /explicit local reset|required|blocked/i);
    assert.equal(f.receipts.length, 0);
  });
  console.log('PASS failed code lookup invalidates remembered identity and refuses silent restored-draft reuse');
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
