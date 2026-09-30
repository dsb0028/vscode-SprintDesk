const assert = require('node:assert/strict');
const vm = require('node:vm');
const { html } = require('../out/companion/src/webview.js');

// Bounded DOM surface used by the generated script; no browser or package install required.
class Element {
  constructor(tag, document) {
    this.tagName = tag.toLowerCase();
    this.document = document;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.value = '';
    this.disabled = false;
    this.open = false;
    this._text = '';
  }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set id(value) { this.attributes.id = value; }
  get id() { return this.attributes.id || ''; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  replaceChildren() {
    if (this.children.some(child => child.contains(this.document.activeElement))) {
      this.document.activeElement = this.document.body;
    }
    this.children = [];
  }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector) {
    const tags = selector.split(',');
    const result = [];
    for (const child of this.children) {
      if (tags.includes(child.tagName)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  focus() { if (!this.disabled) this.document.activeElement = this; }
  click() { if (!this.disabled && this.onclick) this.onclick(); }
  key(key, repeat = false) {
    const event = { key, repeat, prevented: false, preventDefault() { this.prevented = true; } };
    for (const handler of this.listeners.keydown || []) handler(event);
    if ((key === 'Enter' || key === ' ') && !event.prevented) this.click();
    return event;
  }
}

function harness() {
  const source = html();
  const script = source.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  const document = {
    createElement(tag) { return new Element(tag, this); },
    getElementById(id) { return this.body.querySelectorAll('*').find(e => e.id === id); },
    querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
  };
  document.getElementById = id => {
    const visit = node => node.id === id ? node : node.children.map(visit).find(Boolean);
    return visit(document.body);
  };
  document.body = document.createElement('body');
  document.activeElement = document.body;
  const staticMarkup = source.slice(source.indexOf('<body>'), source.indexOf('<script'));
  const stack = [document.body];
  for (const match of staticMarkup.matchAll(/<(\/?)([a-z][a-z0-9]*)([^>]*)>|([^<]+)/gi)) {
    if (match[4]) { stack.at(-1)._text += match[4]; continue; }
    const [, closing, tag, attributes] = match;
    if (tag === 'body') continue;
    if (closing) { stack.pop(); continue; }
    const element = document.createElement(tag);
    for (const attribute of attributes.matchAll(/([\w-]+)="([^"]*)"/g)) {
      element.setAttribute(attribute[1], attribute[2]);
    }
    stack.at(-1).appendChild(element);
    if (!['meta', 'input', 'br'].includes(tag)) stack.push(element);
  }
  const messages = [];
  let receive;
  vm.runInNewContext(script, {
    document,
    window: { addEventListener(name, handler) { assert.equal(name, 'message'); receive = handler; } },
    acquireVsCodeApi: () => ({ postMessage(message) { messages.push(JSON.parse(JSON.stringify(message))); } })
  }, { timeout: 1000 });
  return {
    source, document, messages,
    render(state) { receive({ data: state }); },
    text() { return document.body.textContent; },
    byId(id) { return document.getElementById(id); },
    action(action) { return document.querySelectorAll('button').find(b => b.dataset.action === action); }
  };
}

const snapshot = {
  taskId: 'canonical-id',
  metadata: { code: 'SPD-12', title: 'Readable task' },
  criteria: ['Exact first criterion', 'Exact second criterion'],
  evidence: [{ path: 'src/example.ts', content: 'Bound source evidence' }]
};
function state(phase, overrides = {}) {
  return {
    phase, token: 'token-a', error: '', taskId: 'canonical-id', busy: false,
    progress: '', taskStatus: 'under-review', verification: 'draft', draftSaved: true,
    identity: { reviewerId: 'human', reviewerName: 'Reviewer Name' },
    workspace: 'file:///workspace', host: 'LOCAL UI',
    snapshot, decisions: ['met', 'needs work'], index: 0,
    taskSource: { status: 'under-review' }, rawYaml: 'tasks: []',
    rawMarkdown: '# Task', markdownPath: '.SprintDesk/Tasks/task.md', ledger: {},
    allowedActions: ['met', 'needs work', 'needs-evidence', 'evidence', 'discard',
      'confirm-review', 'complete-summary', 'new-review', 'confirm-complete',
      'cancel', 'load', 'reconcile', 'retry', 'unblock', 'reset', 'mirror', 'revoke', 'recover', 'enroll'],
    ...overrides
  };
}
function test(name, check) { check(); console.log('PASS ' + name); }

test('friendly workflow, canonical identity, status, draft, stepper and bounded evidence', () => {
  const ui = harness();
  assert.deepEqual(ui.messages, [{ action: 'ready' }]);
  ui.render(state('criterion', { taskId: 'user-entered-code' }));
  assert.equal(ui.byId('workflow-heading').textContent, 'Review one acceptance criterion');
  assert.equal(ui.byId('task-name').textContent, 'SPD-12 — Readable task');
  assert.equal(ui.byId('task-id').textContent, 'Canonical task ID: canonical-id');
  assert.equal(ui.byId('task-status').textContent, 'Actual task status: under-review');
  assert.match(ui.text(), /Reviewer Name \(ID: human\)/);
  assert.match(ui.text(), /Workspace: file:\/\/\/workspace/);
  assert.match(ui.byId('draft').textContent, /2 of 2 criteria decided\. Draft saved locally/);
  assert.equal(ui.byId('stepper').children[2].getAttribute('aria-current'), 'step');
  assert.match(ui.text(), /Bound source evidence/);
  assert.equal(ui.action('met').textContent, 'Met');
  assert.equal(ui.action('needs work').textContent, 'Needs work');
  assert.equal(ui.document.activeElement.id, 'workflow-heading');
  assert.equal(ui.byId('progress').getAttribute('role'), 'status');
  assert.equal(ui.byId('error').getAttribute('role'), 'alert');
  assert.equal(ui.byId('technical').open, false);
  assert.equal(ui.byId('advanced').open, false);
  assert.equal(ui.action('revoke').parent.id, 'advanced');
  assert.match(ui.source, /default-src 'none'/);
  assert.doesNotMatch(ui.source, /innerHTML|command:|<script src=|https?:\/\//);
});

test('review summary and completion are separate, explicit, task-specific approvals', () => {
  const ui = harness();
  ui.render(state('summary'));
  assert.match(ui.text(), /Exact first criterionDecision: Met/);
  assert.match(ui.text(), /Exact second criterionDecision: Needs work/);
  assert.match(ui.text(), /never marks the task Done/);
  assert.equal(ui.messages.length, 1, 'rendering must never submit approval');
  assert.equal(ui.document.activeElement.id, 'workflow-heading');
  ui.action('confirm-review').focus();
  assert.equal(ui.action('confirm-review').key('Enter', true).prevented, true);
  assert.equal(ui.messages.length, 1, 'carried Enter cannot approve');
  assert.equal(ui.action('confirm-review').key('Enter').prevented, false);
  assert.deepEqual(ui.messages[1], { action: 'confirm-review', token: 'token-a' });
  ui.render(state('complete', { verification: 'verified', decisions: ['met', 'met'] }));
  assert.equal(ui.byId('workflow-heading').textContent, 'Review accepted — ready to complete');
  assert.equal(ui.byId('task-status').textContent, 'Actual task status: under-review');
  assert.match(ui.text(), /not Done yet/);
  assert.equal(ui.action('confirm-complete'), undefined);
  ui.action('complete-summary').click();
  assert.deepEqual(ui.messages[2], { action: 'complete-summary', token: 'token-a' });
  ui.render(state('completionSummary', { decisions: ['met', 'met'] }));
  assert.match(ui.text(), /Confirm and mark Done: SPD-12 — Readable task/);
  assert.match(ui.text(), /Task ID: canonical-id/);
  assert.equal(ui.action('cancel').textContent, 'Not now');
  assert.equal(ui.messages.length, 3, 'rendering completion is not confirmation');
  assert.equal(ui.document.activeElement.id, 'workflow-heading');
  ui.action('confirm-complete').focus();
  assert.equal(ui.action('confirm-complete').key('Enter', true).prevented, true);
  assert.equal(ui.action('confirm-complete').key('Enter').prevented, false);
  assert.deepEqual(ui.messages[3], { action: 'confirm-complete', token: 'token-a' });
  ui.render(state('done', { taskStatus: 'done', verification: 'verified' }));
  assert.equal(ui.byId('workflow-heading').textContent, 'Task is Done');
  assert.equal(ui.byId('task-status').textContent, 'Actual task status: done');
});

test('needs-evidence pauses unsigned; exact individual decisions and no bulk action', () => {
  for (const action of ['met', 'needs work', 'needs-evidence', 'evidence']) {
    const ui = harness();
    ui.render(state('criterion'));
    ui.action(action).click();
    assert.deepEqual(ui.messages[1], { action, token: 'token-a' });
    assert.equal(ui.messages.length, 2);
    assert.equal(ui.action(action).disabled, true);
    assert.equal(ui.document.querySelectorAll('button').some(b => /all.*met/i.test(b.textContent)), false);
  }
});

test('busy, authoritative availability, pending requests, and detached stale handlers refuse actions', () => {
  const ui = harness();
  ui.render(state('criterion'));
  const stale = ui.action('met');
  ui.render(state('criterion', { token: 'token-b', busy: true, progress: 'Reading independent evidence' }));
  stale.onclick();
  ui.action('met').onclick();
  assert.equal(ui.messages.length, 1);
  assert.equal(ui.byId('progress').textContent, 'Reading independent evidence');
  assert.equal(ui.byId('controls').getAttribute('aria-busy'), 'true');
  assert.ok(ui.document.querySelectorAll('button').every(b => b.disabled));
  ui.render(state('criterion', { allowedActions: ['needs-evidence'] }));
  assert.equal(ui.action('met'), undefined);
  assert.equal(ui.action('revoke'), undefined);
  ui.action('needs-evidence').onclick();
  ui.action('needs-evidence').onclick();
  assert.equal(ui.messages.length, 2);
  ui.render(state('error', { allowedActions: ['load'] }));
  assert.equal(ui.action('reconcile'), undefined);
  assert.equal(ui.action('reset'), undefined);
  assert.ok(ui.action('load'));
  ui.render(state('load', { allowedActions: [] }));
  assert.equal(ui.action('load'), undefined, 'readback actions also require availability');
  ui.render(state('uncertain', { allowedActions: ['reconcile'], pendingIntent: 'complete' }));
  assert.match(ui.text(), /Pending completion receipt/);
  ui.action('reconcile').click();
  assert.equal(ui.messages.at(-1).action, 'reconcile');
});

test('plain-text hostile sources, visible warnings, bounded preview, expandable full sources', () => {
  const hostile = '<img src=x onerror=alert(1)><script>attack()</script>[click](command:evil)';
  const ui = harness();
  ui.render(state('summary', {
    snapshot: { ...snapshot, metadata: { code: hostile, title: hostile },
      criteria: [hostile], evidence: [{ path: hostile, content: hostile + 'x'.repeat(5000) }] },
    rawMarkdown: hostile, rawYaml: hostile, ledger: { hostile },
    handoffWarning: 'TAMPER WARNING: independent source changed'
  }));
  assert.match(ui.text(), /TAMPER WARNING/);
  assert.ok(ui.text().includes(hostile));
  assert.equal(ui.document.querySelectorAll('img,script,a').length, 0);
  const warning = ui.byId('evidence').children.find(e => e.className === 'warning');
  assert.equal(warning.getAttribute('role'), 'note');
  assert.match(ui.text(), /Preview truncated/);
  const preview = ui.byId('evidence').children.find(e => e.tagName === 'pre');
  assert.ok(preview.textContent.length < 4200);
  const technical = ui.byId('technical');
  assert.ok(technical.textContent.includes('x'.repeat(5000)), 'full snapshot remains available');
  assert.match(technical.textContent, /Raw tasks.yml/);
  assert.match(technical.textContent, /Raw task Markdown/);
  assert.match(technical.textContent, /Independent local ledger/);
});

test('same-phase disclosure/input/focus persistence; errors announced; no approval autofocus', () => {
  const ui = harness();
  ui.render(state('load'));
  const field = ui.byId('load-task');
  assert.equal(field.type, 'text');
  assert.equal(field.getAttribute('aria-describedby'), 'error error-help');
  assert.equal(ui.byId('controls').children.find(e => e.tagName === 'label').getAttribute('for'), 'load-task');
  field.value = 'SPD-99';
  field.focus();
  ui.byId('technical').open = true;
  ui.byId('advanced').open = true;
  ui.render(state('load', { progress: 'Local draft checked' }));
  assert.equal(ui.byId('load-task').value, 'SPD-99');
  assert.equal(ui.document.activeElement.id, 'load-task');
  assert.equal(ui.byId('technical').open, true);
  assert.equal(ui.byId('advanced').open, true);
  ui.action('load').click();
  assert.deepEqual(ui.messages[1], { action: 'load', token: 'token-a', taskId: 'SPD-99' });
  ui.render(state('error', { error: 'TAMPER WARNING: changed source', errorHelp: 'Reload the exact task to inspect changes.' }));
  assert.equal(ui.document.activeElement.id, 'error');
  assert.match(ui.text(), /Reload the exact task/);
  ui.render(state('summary'));
  ui.action('confirm-review').focus();
  ui.render(state('summary', { progress: 'Evidence readback checked' }));
  assert.equal(ui.document.activeElement.id, 'workflow-heading');
  ui.render(state('load'));
  ui.byId('load-task').value = 'old-draft';
  ui.render(state('load', { taskId: 'new-task' }));
  assert.equal(ui.byId('load-task').value, 'new-task', 'new task identity must not inherit old input');
  ui.render(state('criterion'));
  ui.action('met').focus();
  ui.render(state('criterion', { index: 1 }));
  assert.equal(ui.document.activeElement.id, 'workflow-heading', 'advancing criteria cannot carry Enter to another decision');
});

test('enrollment schema and graceful no-snapshot rendering', () => {
  const ui = harness();
  ui.render(state('enroll', { snapshot: undefined, identity: undefined, taskStatus: undefined }));
  assert.equal(ui.byId('task-name').textContent, 'No task loaded');
  assert.match(ui.text(), /no local authority enrolled/);
  assert.equal(ui.byId('technical'), undefined);
  ui.byId('reviewer-id').value = 'human';
  ui.byId('reviewer-name').value = 'Human';
  ui.byId('placement').value = 'LOCAL UI HOST';
  ui.action('enroll').click();
  assert.deepEqual(ui.messages[1], { action: 'enroll', token: 'token-a',
    reviewerId: 'human', reviewerName: 'Human', placement: 'LOCAL UI HOST' });
  assert.equal(ui.messages.length, 2);
});

test('reviewed, recovery, reset, discard, cancellation and fresh review keep existing action schemas', () => {
  const cases = [
    ['reviewed', 'new-review'], ['revoked', 'recover'], ['revoked', 'unblock'],
    ['uncertain', 'retry'], ['error', 'reset'], ['error', 'discard'], ['error', 'mirror'],
    ['load', 'revoke'], ['summary', 'discard'], ['completionSummary', 'cancel']
  ];
  for (const [phase, action] of cases) {
    const ui = harness();
    ui.render(state(phase));
    ui.action(action).click();
    assert.deepEqual(ui.messages[1], { action, token: 'token-a' });
  }
  const ui = harness();
  ui.render(state('reviewed', { verification: 'verified' }));
  assert.match(ui.text(), /Review submitted — further work required/);
  assert.match(ui.text(), /needs-work review has been submitted and its receipt verified/);
  assert.match(ui.text(), /criteria are not all met/);
  assert.doesNotMatch(ui.text(), /Review accepted|ready to complete/);
  assert.equal(ui.byId('stepper').children[3].getAttribute('aria-current'), 'step');
  assert.equal(ui.action('confirm-complete'), undefined);
});

test('phase alone never claims accepted review or completion while unverified or busy', () => {
  for (const phase of ['done', 'complete', 'reviewed']) {
    for (const verification of ['verified', 'unverified', 'draft']) {
      for (const busy of [true, false]) {
        if (verification === 'verified' && !busy) continue;
        const ui = harness();
        ui.render(state(phase, { verification, busy, token: busy ? '' : 'token-a' }));
        assert.doesNotMatch(ui.byId('workflow-heading').textContent, /Review accepted|Task is Done/);
        assert.doesNotMatch(ui.byId('verification').textContent, /Verification: verified/);
        assert.doesNotMatch(ui.text(), /Your .*review has been accepted|Completion has been read back/);
        assert.match(ui.text(), /not yet independently verified/);
        assert.equal(ui.messages.length, 1);
      }
    }
  }
});

test('full bound Markdown and every evidence file remain plain-text inspectable beyond previews', () => {
  const ui = harness();
  const markdown = '# Bound Markdown\n' + '<script>notExecutable()</script>' + 'm'.repeat(5000);
  const files = Array.from({ length: 12 }, (_, i) => ({ path: 'file-' + i, content: 'full-' + i + 'x'.repeat(5000) }));
  ui.render(state('criterion', { snapshot: { ...snapshot, markdown, evidence: files } }));
  const technical = ui.byId('technical');
  assert.ok(technical.children.some(e => e.tagName === 'pre' && e.textContent === markdown));
  for (const file of files) assert.ok(technical.children.some(e => e.tagName === 'pre' && e.textContent === file.content));
  assert.equal(ui.document.querySelectorAll('script').length, 0);
  assert.match(ui.text(), /first 10 files/);
  assert.ok(ui.byId('evidence').children.some(e => e.className === 'warning'));
  assert.ok(!technical.children.some(e => e.className === 'warning'));
  ui.render(state('criterion', { snapshot: { ...snapshot, markdown, evidence: [] } }));
  assert.match(ui.text(), /No supplemental workspace evidence files selected/);
  assert.match(ui.text(), /bound task Markdown remains inspectable/);
  assert.doesNotMatch(ui.text(), /missing evidence|No evidence/i);
});

test('native disclosure summary focus survives same-phase progress', () => {
  const ui = harness();
  ui.render(state('criterion'));
  for (const id of ['technical', 'advanced']) {
    ui.byId(id).open = true;
    ui.byId(id + '-summary').focus();
    ui.render(state('criterion', { progress: 'Independent readback in progress' }));
    assert.equal(ui.byId(id).open, true);
    assert.equal(ui.document.activeElement.id, id + '-summary');
  }
});

test('intentional Space confirmations work; repeated Enter and queued activation never approve twice', () => {
  for (const [phase, action] of [['summary', 'confirm-review'], ['completionSummary', 'confirm-complete']]) {
    const ui = harness();
    ui.render(state(phase, { verification: 'verified' }));
    assert.equal(ui.document.activeElement.id, 'workflow-heading');
    const confirmation = ui.action(action);
    confirmation.focus();
    assert.equal(confirmation.key('Enter', true).prevented, true);
    assert.equal(ui.messages.length, 1);
    assert.equal(confirmation.key(' ').prevented, false);
    assert.deepEqual(ui.messages[1], { action, token: 'token-a' });
    confirmation.onclick();
    assert.equal(ui.messages.length, 2, 'in-flight guard still refuses queued duplicate actions');
    ui.render(state('complete', { verification: 'verified' }));
    assert.equal(ui.document.activeElement.id, 'workflow-heading');
    assert.equal(ui.messages.length, 2, 'rendering the next stage never approves');
    confirmation.onclick();
    assert.equal(ui.messages.length, 2, 'detached stale confirmation remains refused');
  }
});

console.log('Webview render/event regression tests passed.');
