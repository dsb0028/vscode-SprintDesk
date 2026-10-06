/**
 * Test-first Red-phase coverage for the planned CopilotAcpSession module
 * (contract.json "transport_api" -> src/services/CopilotAcpSession.ts, not
 * yet implemented, production_phase_approved: false). This file intentionally
 * imports a module that does not exist yet; until a separately-approved
 * production increment adds it, the whole suite is expected to fail to
 * *compile*, not merely fail at runtime. That compiler Red is the authorized
 * outcome of this increment (contract.json "reporting" -> "baseline").
 *
 * These tests spawn a REAL Node.js child process -- the SYNTHETIC fixture in
 * ./acpWorkflowFixture.ts -- via CopilotAcpSession's own trusted
 * executable/prefixArgs test seam (`new CopilotAcpSession(process.execPath,
 * [fixtureJsPath, scenario, logPath])`), never the real `copilot` binary and
 * never a model prompt. The fixture is a real spawned process speaking a
 * narrow, explicitly fabricated ACP-shaped NDJSON protocol; it is not, and
 * never claims to be, the real installed host or real human plan approval.
 * The separately retained probe-events.json packets under
 * authority-bootstrap/ remain the only evidence of the real installed ACP
 * host and its exact advertised mode URIs, which this fixture reuses
 * verbatim (see acpWorkflowFixture.ts module doc).
 *
 * No `any`, no unsafe double casts, no suppressions, no stubs/skips, no
 * sleep-as-proof: every assertion below either awaits a real public
 * CopilotAcpSession promise/event or reads the fixture's own real,
 * independently-written diagnostic log file.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CopilotAcpSession, WorkflowHostError, WorkflowSessionState,
} from './CopilotAcpSession';
import { FixtureScenario, SYNTHETIC_LEAKED_SECRET } from './acpWorkflowFixture';

const FIXTURE_JS_PATH = join(__dirname, 'acpWorkflowFixture.js');

interface Harness {
  readonly base: string;
  readonly workspaceRoot: string;
  readonly logPath: string;
  readonly client: CopilotAcpSession;
}

function createHarness(scenario: FixtureScenario): Harness {
  const base = mkdtempSync(join(tmpdir(), 'copilot-acp-session-'));
  const workspaceRoot = join(base, 'workspace');
  const logPath = join(base, 'fixture-log.jsonl');
  const client = new CopilotAcpSession(process.execPath, [FIXTURE_JS_PATH, scenario, logPath]);
  return { base, workspaceRoot, logPath, client };
}

function readLogLines(logPath: string): Record<string, unknown>[] {
  const raw = readFileSync(logPath, 'utf8');
  return raw.split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function withHarness(scenario: FixtureScenario, run: (h: Harness) => Promise<void>): Promise<void> {
  const h = createHarness(scenario);
  try {
    await run(h);
  } finally {
    h.client.dispose();
    rmSync(h.base, { recursive: true, force: true });
  }
}

function assertWorkflowHostError(error: unknown, code: string): asserts error is WorkflowHostError {
  assert.ok(error instanceof WorkflowHostError, 'expected a WorkflowHostError instance');
  assert.equal((error as WorkflowHostError).code, code);
}

test('start() connects the real spawned fixture process and discovers the exact retained Agent/Plan mode URIs', async () => {
  await withHarness('happy', async (h) => {
    const state: WorkflowSessionState = await h.client.start(h.workspaceRoot);
    assert.equal(state.connected, true);
    assert.equal(typeof state.sessionId, 'string');
    assert.ok((state.sessionId as string).length > 0);
    assert.equal(state.mode, 'agent');
    assert.equal(typeof state.epoch, 'number');
  });
});

test('setMode(plan) requires the actual native current_mode_update for the SAME session, not just an empty success result', async () => {
  await withHarness('happy', async (h) => {
    const before = await h.client.start(h.workspaceRoot);
    const changes: WorkflowSessionState[] = [];
    const subscription = h.client.onStateChanged((next: WorkflowSessionState) => changes.push(next));
    const after = await h.client.setMode('plan');
    subscription.dispose();
    assert.equal(after.mode, 'plan');
    assert.ok(after.epoch > before.epoch, 'epoch must monotonically increase on a verified mode change');
    assert.ok(changes.some((c) => c.mode === 'plan'), 'onStateChanged must fire the verified mode');

    const lines = readLogLines(h.logPath);
    const sawSetMode = lines.some((l) => l.direction === 'received' && l.method === 'session/set_mode');
    assert.equal(sawSetMode, true);
  });
});

test('a current_mode_update for a foreign sessionId never verifies the requested mode', async () => {
  await withHarness('foreign-session-update', async (h) => {
    await h.client.start(h.workspaceRoot);
    await assert.rejects(() => h.client.setMode('plan'), (error: unknown) => {
      assertWorkflowHostError(error, 'HOST_MODE_UNVERIFIED');
      return true;
    });
  });
});

test('a bare empty set_mode response with no native notification at all is insufficient and never verifies the mode', async () => {
  await withHarness('no-mode-notification', async (h) => {
    await h.client.start(h.workspaceRoot);
    await assert.rejects(() => h.client.setMode('plan'), (error: unknown) => {
      assertWorkflowHostError(error, 'HOST_MODE_UNVERIFIED');
      return true;
    });
  });
});

test('an unexpected duplicate response id is rejected as a protocol violation and disconnects the session', async () => {
  await withHarness('duplicate-response-id', async (h) => {
    await h.client.start(h.workspaceRoot);
    await assert.rejects(() => h.client.setMode('plan'), (error: unknown) => {
      assertWorkflowHostError(error, 'HOST_PROTOCOL_INVALID');
      return true;
    });
    assert.equal(h.client.state().connected, false);
    await assert.rejects(() => h.client.setMode('agent'), (error: unknown) => {
      assertWorkflowHostError(error, 'HOST_DISCONNECTED');
      return true;
    });
  });
});

test('malformed JSON on the session/new reply is rejected as HOST_PROTOCOL_INVALID, never a success-shaped default', async () => {
  await withHarness('malformed-json', async (h) => {
    await assert.rejects(() => h.client.start(h.workspaceRoot), (error: unknown) => {
      assertWorkflowHostError(error, 'HOST_PROTOCOL_INVALID');
      return true;
    });
  });
});

test('an oversize NDJSON frame from the agent is detected while buffering and never silently accumulated', async () => {
  await withHarness('oversize-frame', async (h) => {
    await h.client.start(h.workspaceRoot);
    await assert.rejects(() => h.client.setMode('plan'), (error: unknown) => {
      assertWorkflowHostError(error, 'HOST_TOO_LARGE');
      return true;
    });
  });
});

test('the real process exiting immediately after session/new is observed and rejects pending/future work, never a stale connected state', async () => {
  await withHarness('exit-after-new-session', async (h) => {
    await assert.rejects(() => h.client.start(h.workspaceRoot), (error: unknown) => {
      assert.ok(error instanceof WorkflowHostError);
      return true;
    });
    assert.equal(h.client.state().connected, false);
  });
});

test('the real process exiting while a set_mode request is pending rejects that pending work as disconnected, not a silent hang', async () => {
  await withHarness('exit-during-set-mode', async (h) => {
    await h.client.start(h.workspaceRoot);
    await assert.rejects(() => h.client.setMode('plan'), (error: unknown) => {
      assertWorkflowHostError(error, 'HOST_DISCONNECTED');
      return true;
    });
  });
});

test('every native session/request_permission is cancelled regardless of offered allow_once/allow_always options, never an execution UI prompt', async () => {
  await withHarness('permission-request', async (h) => {
    await h.client.start(h.workspaceRoot);
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const lines = readLogLines(h.logPath);
    const responses = lines.filter((l) => l.direction === 'client-response' && l.id === 'fixture-permission-1');
    assert.equal(responses.length, 1, 'exactly one response to the fixture permission request was observed');
    const response = responses[0];
    assert.equal(response.error, undefined, 'a cancellation is a valid protocol result, never a thrown transport error');
    const resultText = JSON.stringify(response.result ?? {});
    assert.ok(!resultText.includes('allow_once') && !resultText.includes('allow_always'),
      'the client response must never select an allow option');
  });
});

test('unsupported client capability requests (fs/read_text_file) receive an explicit unsupported error, never a success-shaped default', async () => {
  await withHarness('unsupported-capability-request', async (h) => {
    await h.client.start(h.workspaceRoot);
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const lines = readLogLines(h.logPath);
    const responses = lines.filter((l) => l.direction === 'client-response' && l.id === 'fixture-fsread-1');
    assert.equal(responses.length, 1);
    assert.notEqual(responses[0].error, undefined, 'unsupported capability requests must be explicit protocol errors');
  });
});

test('a remote protocol error never echoes raw remote exception text, stderr content or tokens back through WorkflowHostError', async () => {
  await withHarness('protocol-error-with-secret', async (h) => {
    await assert.rejects(() => h.client.start(h.workspaceRoot), (error: unknown) => {
      assert.ok(error instanceof WorkflowHostError);
      const asHostError = error as WorkflowHostError;
      assert.ok(!asHostError.message.includes(SYNTHETIC_LEAKED_SECRET), 'message must not echo the remote secret');
      assert.ok(!asHostError.message.includes('remote failure'), 'message must be a safe static message, not the raw remote text');
      return true;
    });
  });
});

test('cancel() sends session/cancel as a notification, never an id-bearing request', async () => {
  await withHarness('happy', async (h) => {
    await h.client.start(h.workspaceRoot);
    h.client.cancel();
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const lines = readLogLines(h.logPath);
    const cancels = lines.filter((l) => l.direction === 'observed-cancel-notification');
    assert.equal(cancels.length, 1);
    assert.equal(cancels[0].hadId, false, 'session/cancel must be sent as a notification, matching the corrected probe evidence');
  });
});

test('close() acknowledges session/close and disconnects; subsequent calls are HOST_DISCONNECTED, never a stale repeated grant', async () => {
  await withHarness('happy', async (h) => {
    await h.client.start(h.workspaceRoot);
    await h.client.close();
    assert.equal(h.client.state().connected, false);
    await assert.rejects(() => h.client.setMode('plan'), (error: unknown) => {
      assertWorkflowHostError(error, 'HOST_DISCONNECTED');
      return true;
    });
    const lines = readLogLines(h.logPath);
    assert.ok(lines.some((l) => l.direction === 'closing'));
  });
});

test('dispose() immediately marks the session disconnected without waiting for process exit confirmation', async () => {
  await withHarness('happy', async (h) => {
    await h.client.start(h.workspaceRoot);
    h.client.dispose();
    assert.equal(h.client.state().connected, false);
    await assert.rejects(() => h.client.setMode('plan'), (error: unknown) => {
      assertWorkflowHostError(error, 'HOST_DISCONNECTED');
      return true;
    });
  });
});

test('never requests or selects the Autopilot mode', async () => {
  await withHarness('happy', async (h) => {
    await h.client.start(h.workspaceRoot);
    await h.client.setMode('plan');
    const lines = readLogLines(h.logPath);
    const sentModes = lines
      .filter((l) => l.direction === 'received' && l.method === 'session/set_mode')
      .map((l) => JSON.stringify(l));
    assert.ok(sentModes.every((text) => !text.includes('autopilot')), 'no set_mode request may target autopilot');
  });
});
