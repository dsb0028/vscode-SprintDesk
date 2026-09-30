import * as vscode from 'vscode';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { digest, Enrollment, signReceipt, SnapshotResponse } from '../../src/review/protocol';
import {
  assertPlacement, decide, evidencePath, LocalRoot, observeTask, payload, pending,
  reconcile, recordIntent, resumeDraft, TaskLedger, validateSnapshot
} from './state';
import { html } from './webview';
import { readSource, resolveTaskReference, SourceReadback } from './source';
import { assertStorageLocation, LocalLease, RootStore, verifyLocalStorageMapping } from './storage';
import { ActionContext, availableActions, errorHelp, ReviewPhase } from './presentation';

type Message = { action: string; token: string; taskId?: string; reviewerId?: string;
  reviewerName?: string; placement?: string };

class ReviewPanel {
  private root?: LocalRoot;
  private response?: SnapshotResponse;
  private source?: SourceReadback;
  private taskId = '';
  private paths: string[] = [];
  private token = '';
  private phase: ReviewPhase = 'load';
  private busy = false;
  private progress = '';
  private reconciled = false;
  private unsavedIntent = false;
  private disposed = false;
  private readonly storageKey: string;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly context: vscode.ExtensionContext,
    private readonly workspace: vscode.WorkspaceFolder, private readonly panel: vscode.WebviewPanel,
    private readonly store: RootStore, private readonly lease: LocalLease,
    initialRoot?: LocalRoot, initialTaskId = '') {
    this.storageKey = `authority:${workspace.uri.toString()}`;
    this.root = initialRoot;
    if (this.root && (this.root.version !== 1 || this.root.workspace !== workspace.uri.toString()
      || !this.root.keys.some(key => key.keyId === this.root!.enrollment.keyId
        && key.projectId === this.root!.enrollment.projectId))) {
      throw new Error('Stored local workspace/project/enrollment identity differs. Explicit recovery required.');
    }
    this.taskId = initialTaskId;
    this.paths = this.root?.tasks[initialTaskId]?.draft?.evidencePaths
      ?? this.root?.tasks[initialTaskId]?.operations.slice(-1)[0]?.receipt.payload.evidencePaths ?? [];
    panel.webview.html = html();
    this.subscription = panel.webview.onDidReceiveMessage(message => { void this.receive(message); });
    panel.onDidDispose(() => {
      this.disposed = true; this.subscription.dispose();
      void this.lease.release().catch(error => vscode.window.showErrorMessage(String(error)));
    });
    this.phase = this.root ? 'load' : 'enroll';
    this.render();
  }

  private placement(): void {
    assertPlacement(this.context.extensionUri.scheme,
      vscode.extensions.getExtension(this.context.extension.id)?.extensionKind, vscode.env.appHost);
    const scheme = this.workspace.uri.scheme;
    if (scheme !== 'file' && scheme !== 'vscode-remote') {
      throw new Error('Unsupported workspace URI scheme.');
    }
    if (scheme === 'vscode-remote' && !vscode.env.remoteName) {
      throw new Error('Remote workspace without a recognized remote session.');
    }
  }

  private secretKey(enrollment: Enrollment): string {
    return `${this.storageKey}:${enrollment.projectId}:${enrollment.keyId}`;
  }

  private async persist(): Promise<void> {
    if (!this.root) { throw new Error('No local authority.'); }
    await this.store.write(this.root);
    await this.context.globalState.update(`authority-index:${this.workspace.uri.toString()}`,
      this.root.enrollment.projectId);
  }

  private task(): TaskLedger {
    const task = this.root?.tasks[this.taskId];
    if (!task) { throw new Error('Load a task first.'); }
    return task;
  }

  private async snapshot(): Promise<SnapshotResponse> {
    this.showProgress('Reading the pinned workspace and current task source...');
    await this.lease.assertHeld();
    if (!this.root || !this.taskId) { throw new Error('Select a task.'); }
    let result: SnapshotResponse;
    try {
      result = await vscode.commands.executeCommand<SnapshotResponse>('sprintdesk.reviewSnapshot',
        this.workspace.uri.toString(), this.taskId, this.paths);
      validateSnapshot(result!, this.root.enrollment.projectId, this.taskId, this.paths);
    } catch (error) {
      const task = this.root.tasks[this.taskId];
      if (task) {
        task.blocked = true;
        if (task.draft) { task.draft.invalidated = true; }
        await this.persist();
      }
      throw new Error(`Task read failed; remembered identity is blocked until explicit reset. ${String(error)}`);
    }
    try {
      this.source = await readSource({
        read: async relative => vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.workspace.uri, relative))
      }, this.workspace.uri.path, this.root.enrollment.projectId, this.taskId, this.paths, result!);
    } catch (error) {
      const task = this.root.tasks[this.taskId];
      if (task?.draft) { task.draft.invalidated = true; }
      if (task && /deleted|missing|identity|Invalid tasks.yml/i.test(String(error))) {
        task.blocked = true;
      }
      if (task) { await this.persist(); }
      throw error;
    }
    return this.source.response;
  }

  private async load(): Promise<void> {
    this.reconciled = false;
    this.response = await this.snapshot();
    let task: TaskLedger;
    try {
      task = observeTask(this.root!, this.response.snapshot);
    } catch (error) {
      await this.persist(); throw error;
    }
    await this.persist();
    reconcile(this.root!, task, this.response);
    await this.persist();
    this.reconciled = true;
    if (this.response.status === 'done') { this.phase = 'done'; return; }
    if (this.response.status !== 'under-review') { throw new Error('Task must be under-review.'); }
    const latest = task.operations[task.operations.length - 1];
    if (latest?.state === 'accepted' && latest.receipt.payload.intent === 'review') {
      this.phase = latest.receipt.payload.criteria.every(c => c.result === 'met') ? 'complete' : 'reviewed';
      return;
    }
    let draft;
    try {
      draft = resumeDraft(task, this.response.snapshot, this.paths);
    } catch (error) {
      await this.persist(); throw error;
    }
    this.phase = draft.decisions.length === this.response.snapshot.criteria.length
      && !draft.decisions.includes('needs-evidence') ? 'summary' : 'criterion';
    await this.persist();
  }

  private async selectTask(reference: string): Promise<void> {
    this.showProgress('Resolving the exact task code or ID from the pinned workspace...');
    let id: string;
    try {
      id = await resolveTaskReference({
        read: async relative => vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.workspace.uri, relative))
      }, reference);
    } catch (error) {
      const remembered = (this.root && Object.prototype.hasOwnProperty.call(this.root.tasks, reference)
        ? this.root.tasks[reference] : undefined)
        ?? (reference === this.source?.taskSource.code ? this.root?.tasks[this.taskId] : undefined);
      if (remembered) {
        remembered.blocked = true;
        if (remembered.draft) { remembered.draft.invalidated = true; }
        await this.persist();
      }
      throw error;
    }
    if (id !== this.taskId) {
      this.paths = this.root?.tasks[id]?.draft?.evidencePaths
        ?? this.root?.tasks[id]?.operations.slice(-1)[0]?.receipt.payload.evidencePaths ?? [];
      this.response = undefined;
      this.source = undefined;
    }
    this.taskId = id;
    await this.load();
  }

  private async enroll(message: Message): Promise<void> {
    this.placement();
    if (message.placement !== 'LOCAL UI HOST'
      || !message.reviewerId?.trim() || !message.reviewerName?.trim()
      || message.reviewerId.length > 128 || message.reviewerName.length > 200) {
      throw new Error('Human host-placement confirmation and reviewer identity are required.');
    }
    if (this.root && (!this.root.revoked || pending(this.root))) {
      throw new Error('Revoke first; resolve all uncertain operations before recovery.');
    }
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const { keyId } = await import('../../src/review/protocol');
    const enrollment: Enrollment = {
      version: 1, projectId: this.root?.enrollment.projectId ?? randomUUID(),
      reviewerId: message.reviewerId.trim(), reviewerName: message.reviewerName.trim(),
      keyId: keyId(pem), publicKey: pem
    };
    await this.context.secrets.store(this.secretKey(enrollment),
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    this.root = this.root
      ? { ...this.root, enrollment, keys: [...this.root.keys, enrollment], revoked: false }
      : { version: 1, workspace: this.workspace.uri.toString(), enrollment,
        keys: [enrollment], revoked: false, tasks: {}, archives: [] };
    for (const task of Object.values(this.root.tasks)) {
      if (task.draft) { task.draft.invalidated = true; }
    }
    await this.persist();
    this.phase = 'load';
    await this.mirror();
  }

  private async mirror(): Promise<void> {
    this.placement();
    if (!this.root || this.root.revoked) { throw new Error('No active local authority.'); }
    await vscode.commands.executeCommand('sprintdesk.reviewEnroll',
      this.workspace.uri.toString(), this.root.enrollment);
  }

  // This method is private and invoked exclusively from the webview's final-confirm events.
  private async commit(intent: 'review' | 'complete'): Promise<void> {
    this.placement();
    if (!this.root || !this.response || this.disposed) { throw new Error('Review UI closed.'); }
    const current = await this.snapshot();
    if (current.status !== 'under-review' || current.workStatus !== this.response.workStatus
      || digest(current.snapshot) !== digest(this.response.snapshot)) {
      const draft = this.task().draft;
      if (draft) { draft.invalidated = true; await this.persist(); }
      throw new Error('Task changed since it was displayed. No signature issued.');
    }
    const task = this.task();
    reconcile(this.root, task, current);
    if (intent === 'complete' && task.operations[task.operations.length - 1]?.state !== 'accepted') {
      throw new Error('Current review is not accepted.');
    }
    const secret = await this.context.secrets.get(this.secretKey(this.root.enrollment));
    if (!secret) {
      this.root.revoked = true;
      await this.persist();
      throw new Error('Local key missing. Explicit revocation/recovery required; never auto-replaced.');
    }
    if (this.disposed) { throw new Error('Review UI closed.'); }
    await this.lease.assertHeld();
    if (this.disposed) { throw new Error('Review UI closed.'); }
    this.showProgress('Signing this confirmed operation locally...');
    const receipt = signReceipt(payload(this.root, task, current.snapshot, intent, this.paths), secret);
    recordIntent(this.root, task, receipt, current.workStatus);
    this.unsavedIntent = true;
    this.showProgress('Saving the signed intent to the durable local ledger...');
    await this.persist();
    this.unsavedIntent = false;
    // Delivery results are never authority. Only readback against the durable local intent can accept.
    try {
      await this.lease.assertHeld();
      this.showProgress('Submitting the saved signed operation...');
      await vscode.commands.executeCommand('sprintdesk.reviewCommit', this.workspace.uri.toString(), receipt);
    } catch {
      this.phase = 'uncertain';
    }
    try {
      this.showProgress('Checking persisted results against independent local authority...');
      await this.load();
    } catch (error) {
      this.phase = 'uncertain';
      throw new Error(`Commit uncertain; no new signing allowed. Reconcile or retry identical receipt. ${String(error)}`);
    }
  }

  private async receive(value: unknown): Promise<void> {
    if (this.busy || this.disposed) { return; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) { return; }
    if (Object.keys(value).length === 1 && (value as { action: unknown }).action === 'ready') {
      this.render(); return;
    }
    const message = value as Message;
    const keys = Object.keys(message);
    if (keys.some(k => !['action', 'token', 'taskId', 'reviewerId', 'reviewerName', 'placement'].includes(k))
      || typeof message.action !== 'string' || message.token !== this.token) { return; }
    if (!availableActions(this.phase, this.actionContext()).includes(message.action)) { return; }
    const enrollmentEvent = message.action === 'enroll';
    if (keys.some(k => !['action', 'token', ...(enrollmentEvent
      ? ['reviewerId', 'reviewerName', 'placement'] : message.action === 'load' ? ['taskId'] : [])].includes(k))) { return; }
    this.busy = true;
    this.token = '';
    this.reconciled = false;
    let diagnostic = '';
    this.showProgress('Processing the local action...');
    try {
      this.placement();
      switch (message.action) {
        case 'enroll': await this.enroll(message); break;
        case 'recover':
          if (!this.root?.revoked || pending(this.root)) { throw new Error('Resolve pending operations first.'); }
          this.phase = 'enroll'; break;
        case 'mirror': await this.mirror(); this.phase = 'load'; break;
        case 'load':
          if (typeof message.taskId !== 'string') {
            throw new Error('Enter an exact task code or canonical ID.');
          }
          await this.selectTask(message.taskId); break;
        case 'met': case 'needs work': case 'needs-evidence': {
          const draft = this.task().draft!;
          const waiting = draft.decisions.indexOf('needs-evidence');
          decide(draft, this.response!.snapshot, waiting < 0 ? draft.decisions.length : waiting, message.action);
          this.showProgress('Saving your individual decision in the local draft...');
          await this.persist();
          this.phase = draft.decisions.length === this.response!.snapshot.criteria.length
            && !draft.decisions.includes('needs-evidence') ? 'summary' : 'criterion';
          break;
        }
        case 'evidence': await this.selectEvidence(); break;
        case 'discard':
          if (this.root && pending(this.root)) { throw new Error('Resolve uncertain intent first.'); }
          this.task().draft = undefined; await this.persist(); await this.load(); break;
        case 'complete-summary':
          await this.load();
          if (this.phase !== 'complete') { throw new Error('Current review is not verified all-met.'); }
          this.phase = 'completionSummary'; break;
        case 'new-review': {
          if (pending(this.root!)) { throw new Error('Resolve prior operation first.'); }
          const current = await this.snapshot();
          reconcile(this.root!, this.task(), current);
          if (current.status !== 'under-review') { throw new Error('Task must be under-review.'); }
          this.response = current;
          this.task().draft = undefined;
          resumeDraft(this.task(), current.snapshot, this.paths);
          await this.persist(); this.phase = 'criterion'; break;
        }
        case 'cancel': await this.load(); break;
        case 'confirm-review': await this.commit('review'); break;
        case 'confirm-complete': await this.commit('complete'); break;
        case 'reconcile': await this.load(); break;
        case 'retry': {
          const op = this.task().operations.slice(-1)[0];
          if (!op || op.state !== 'pending') { throw new Error('No pending durable receipt.'); }
          await this.lease.assertHeld();
          this.showProgress('Ensuring the identical signed intent is saved durably before retry...');
          await this.persist();
          this.unsavedIntent = false;
          this.showProgress('Retrying the identical saved receipt, without a new signature...');
          await vscode.commands.executeCommand('sprintdesk.reviewCommit', this.workspace.uri.toString(), op.receipt);
          await this.load(); break;
        }
        case 'reset': {
          if (!this.root || pending(this.root)) { throw new Error('Uncertain intent cannot be reset.'); }
          const answer = await vscode.window.showWarningMessage(
            'Explicitly reset remembered task identity? Historical receipts are retained. Remote reset may also be required.',
            { modal: true }, 'Reset identity');
          if (answer === 'Reset identity') {
            const task = this.task();
            this.root.archives.push(task);
            delete this.root.tasks[this.taskId];
            await this.persist(); this.phase = 'load';
          }
          break;
        }
        case 'unblock': {
          const task = this.task();
          if (!task.blocked) { throw new Error('No blocked task identity.'); }
          const answer = await vscode.window.showWarningMessage(
            'Explicitly recover this inaccessible identity? Confirm it was NOT deleted/recreated. The original creation time and incarnation remain pinned.',
            { modal: true }, 'Recover original identity');
          if (answer === 'Recover original identity') {
            const response = await this.snapshot();
            if (response.snapshot.createdAt !== task.createdAt) { throw new Error('Task identity was reused.'); }
            task.blocked = false; await this.persist(); await this.load();
          }
          break;
        }
        case 'revoke':
          if (this.root) {
            const answer = await vscode.window.showWarningMessage('Revoke this local signing key?',
              { modal: true }, 'Revoke');
            if (answer === 'Revoke') {
              this.root.revoked = true; await this.persist();
              await this.context.secrets.delete(this.secretKey(this.root.enrollment)); this.phase = 'revoked';
            }
          }
          break;
      }
    } catch (error) {
      if (this.phase !== 'uncertain') { this.phase = this.root?.revoked ? 'revoked' : this.root ? 'error' : 'enroll'; }
      diagnostic = String(error);
    } finally {
      this.busy = false;
      this.progress = '';
      this.render(diagnostic);
    }
  }

  private async selectEvidence(): Promise<void> {
    if (pending(this.root!)) { throw new Error('Resolve prior operation first.'); }
    const selected = await vscode.window.showOpenDialog({
      canSelectMany: true, canSelectFiles: true, canSelectFolders: false,
      defaultUri: this.workspace.uri, title: 'Choose UTF-8 evidence within this workspace'
    });
    if (!selected) { return; }
    const base = this.workspace.uri;
    const prefix = base.path.replace(/\/$/, '') + '/';
    this.paths = selected.map(uri => {
      if (uri.scheme !== base.scheme || uri.authority !== base.authority || !uri.path.startsWith(prefix)) {
        throw new Error('Evidence must be in the enrolled workspace.');
      }
      return evidencePath(uri.path.slice(prefix.length));
    });
    if (new Set(this.paths).size !== this.paths.length) { throw new Error('Duplicate evidence paths.'); }
    // New evidence invalidates all old decisions; never transfer them to a different digest.
    this.task().draft = undefined;
    await this.persist();
    await this.load();
  }

  private actionContext(): ActionContext {
    const task = this.root?.tasks[this.taskId];
    return {
      authority: !!this.root, task: !!task, draft: !!task?.draft, blocked: !!task?.blocked,
      pending: !!this.root && pending(this.root),
      retry: task?.operations.slice(-1)[0]?.state === 'pending', revoked: !!this.root?.revoked
    };
  }

  private showProgress(message: string): void {
    this.progress = message;
    this.render();
  }

  private render(error = ''): void {
    if (this.disposed) { return; }
    if (!this.busy) { this.token = randomUUID(); }
    if (this.root?.revoked && !['enroll', 'uncertain'].includes(this.phase)) { this.phase = 'revoked'; }
    const draft = this.root?.tasks[this.taskId]?.draft;
    const waiting = draft?.decisions.indexOf('needs-evidence') ?? -1;
    const index = waiting < 0 ? draft?.decisions.length ?? 0 : waiting;
    const task = this.root?.tasks[this.taskId];
    const latest = task?.operations.slice(-1)[0];
    const context = this.actionContext();
    void this.panel.webview.postMessage({
      token: this.token, phase: this.phase, error, taskId: this.taskId,
      busy: this.busy, progress: this.progress, taskStatus: this.response?.status,
      verification: !this.busy && this.reconciled && latest?.state === 'accepted'
        && ['complete', 'reviewed', 'completionSummary', 'done'].includes(this.phase)
        ? 'verified' : draft && !draft.invalidated && !this.busy && !error ? 'draft' : 'unverified',
      draftSaved: !!draft && !draft.invalidated && !this.busy && !error,
      pendingIntent: latest?.state === 'pending' ? latest.receipt.payload.intent : undefined,
      allowedActions: this.busy ? [] : availableActions(this.phase, context),
      errorHelp: error ? this.unsavedIntent
        ? 'The signed intent is not confirmed saved durably. It has not been delivered. '
          + 'Resolve the local storage error, then retry the same intent; retry saves it durably before delivery. '
          + 'Do not start another signature or replace your key.'
        : errorHelp(error, context.pending, context.blocked) : undefined,
      identity: this.root?.enrollment, workspace: this.workspace.uri.toString(),
      host: `extensionUri=${this.context.extensionUri.scheme}; extensionKind=${vscode.extensions.getExtension(this.context.extension.id)?.extensionKind}; appHost=${vscode.env.appHost}; remoteName=${vscode.env.remoteName ?? '(none)'}`,
      snapshot: this.response?.snapshot, decisions: draft?.decisions, index,
      rawMarkdown: this.source?.rawMarkdown, markdownPath: this.source?.markdownPath,
      handoffWarning: this.source?.handoffWarning,
      taskSource: this.source?.taskSource,
      rawYaml: this.source?.rawYaml,
      ledger: this.root?.tasks[this.taskId]?.operations.map(op => ({
        operationId: op.receipt.payload.operationId, sequence: op.receipt.payload.sequence, state: op.state
      }))
    });
  }
}

export function activate(context: vscode.ExtensionContext): void {
  let panel: vscode.WebviewPanel | undefined;
  let opening = false;
  context.subscriptions.push(vscode.commands.registerCommand('sprintdeskReviewer.openReview', async (taskId?: unknown) => {
    if (opening) { return; }
    opening = true;
    let lease: LocalLease | undefined;
    try {
      assertPlacement(context.extensionUri.scheme,
        vscode.extensions.getExtension(context.extension.id)?.extensionKind, vscode.env.appHost);
      if (panel) { panel.reveal(); return; }
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) { throw new Error('Open a SprintDesk workspace first.'); }
      const choice = folders.length === 1 ? folders[0] : await vscode.window.showQuickPick(
        folders.map(folder => ({ label: folder.name, description: folder.uri.toString(), folder })),
        { title: 'Pin the exact workspace URI for local review' });
      const workspace = choice && ('folder' in choice ? choice.folder : choice);
      if (!workspace) { return; }
      const storageUri = context.globalStorageUri;
      const storageDirectory = storageUri.with({ scheme: 'file' }).fsPath;
      assertStorageLocation(storageUri.scheme, storageUri.authority, storageUri.query,
        storageUri.fragment, storageDirectory);
      await verifyLocalStorageMapping(storageDirectory, async name =>
        vscode.workspace.fs.readFile(vscode.Uri.joinPath(storageUri, name)));
      const authority = digest(workspace.uri.toString());
      const lockPath = path.join(storageDirectory, `authority-${authority}.lock`);
      try {
        lease = await LocalLease.acquire(lockPath);
      } catch (error) {
        const answer = await vscode.window.showWarningMessage(
          `${String(error)} Recover ONLY after confirming the previous local review window/host exited. Live owners cannot be overridden.`,
          { modal: true }, 'Recover stale local lease');
        if (answer !== 'Recover stale local lease') { return; }
        lease = await LocalLease.recover(lockPath, true);
      }
      const store = new RootStore(path.join(storageDirectory, `authority-${authority}.json`), lease);
      const stored = await store.read();
      const projectIndex = context.globalState.get<string>(`authority-index:${workspace.uri.toString()}`);
      if (!stored && projectIndex) {
        throw new Error('Previously enrolled local ledger is missing. Explicit local recovery required; no automatic replacement.');
      }
      const root = stored ?? context.globalState.get<LocalRoot>(`authority:${workspace.uri.toString()}`);
      if (root && projectIndex && root.enrollment.projectId !== projectIndex) {
        throw new Error('Local project index differs from durable ledger. Explicit recovery required.');
      }
      if (root) { await store.write(root); }
      panel = vscode.window.createWebviewPanel('sprintdeskLocalReview', 'Local Authenticated Review',
        vscode.ViewColumn.One, { enableScripts: true, enableCommandUris: false,
          localResourceRoots: [], retainContextWhenHidden: true });
      panel.onDidDispose(() => { panel = undefined; });
      const initialTaskId = typeof taskId === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(taskId)
        && !['__proto__', 'constructor', 'prototype'].includes(taskId) ? taskId : '';
      new ReviewPanel(context, workspace, panel, store, lease, root, initialTaskId);
      lease = undefined;
    } catch (error) {
      if (lease) { await lease.release().catch(() => undefined); }
      panel?.dispose(); panel = undefined;
      void vscode.window.showErrorMessage(String(error));
    } finally { opening = false; }
  }));
}
