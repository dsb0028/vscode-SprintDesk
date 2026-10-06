/**
 * SYNTHETIC Node ACP protocol fixture.
 *
 * This module is a REAL, standalone Node.js child process that speaks a
 * narrow, explicitly fabricated subset of the Agent Client Protocol (ACP)
 * NDJSON JSON-RPC framing over its own real stdin/stdout. It is permanently
 * SYNTHETIC test scaffolding only:
 *   - It is NOT the installed `copilot` CLI and proves nothing about it or
 *     about real human plan approval / execution authority.
 *   - The only evidence of the real installed ACP host is the separately
 *     retained probe-events.json packets under authority-bootstrap/; this
 *     fixture exists purely so CopilotAcpSession's transport-layer parsing,
 *     correlation, cancellation, close and disposal logic can be exercised
 *     against a REAL spawned process instead of an in-memory mock.
 *
 * The three advertised mode URIs below are copied verbatim from the
 * retained real probe evidence
 * (authority-bootstrap/acp-session-corrected/probe-events.json) so tests
 * exercise the exact IDs the real host advertises. The notification/request
 * envelopes this fixture emits beyond those exact URIs are this increment's
 * own SYNTHETIC, documented convention (a reasonable ACP-shaped
 * `session/update` / `session/request_permission` envelope) -- they are not
 * independently confirmed against the real host and must never be read as
 * such.
 *
 * Wire protocol: stdin/stdout carry ONLY the NDJSON JSON-RPC frames a real
 * ACP client would send/receive. All fixture diagnostics (what was received,
 * what the "client" replied to a fixture-initiated request, scenario exit
 * reasons) are written as newline-delimited JSON to a separate log file
 * supplied on the command line, never mixed into the protocol stream and
 * never echoed to stderr.
 */

import { createInterface } from 'node:readline';
import { appendFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const SYNTHETIC_AGENT_MODE_ID = 'https://agentclientprotocol.com/protocol/session-modes#agent';
export const SYNTHETIC_PLAN_MODE_ID = 'https://agentclientprotocol.com/protocol/session-modes#plan';
export const SYNTHETIC_AUTOPILOT_MODE_ID = 'https://agentclientprotocol.com/protocol/session-modes#autopilot';

/** Bytes intentionally one unit over the contract.json NDJSON frame bound (1048576 UTF-8 bytes). */
export const SYNTHETIC_OVERSIZE_FRAME_BYTES = 1048577;

export const FIXTURE_SCENARIOS = [
  'happy',
  'foreign-session-update',
  'duplicate-response-id',
  'malformed-json',
  'oversize-frame',
  'permission-request',
  'unsupported-capability-request',
  'exit-after-new-session',
  'exit-during-set-mode',
  'no-mode-notification',
  'protocol-error-with-secret',
] as const;

export type FixtureScenario = typeof FIXTURE_SCENARIOS[number];

export const SYNTHETIC_LEAKED_SECRET = 'synthetic-fixture-secret-token-do-not-echo';

interface JsonRpcLike {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

function isJsonRpcLike(value: unknown): value is JsonRpcLike {
  return typeof value === 'object' && value !== null;
}

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function logEvent(logPath: string, entry: Record<string, unknown>): void {
  appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
}

function availableModesResult(currentModeId: string): Record<string, unknown> {
  return {
    availableModes: [
      { id: SYNTHETIC_AGENT_MODE_ID, name: 'Agent', description: 'Default agent mode for conversational interactions' },
      { id: SYNTHETIC_PLAN_MODE_ID, name: 'Plan', description: 'Plan mode for creating and executing multi-step plans' },
      {
        id: SYNTHETIC_AUTOPILOT_MODE_ID, name: 'Autopilot',
        description: 'Autonomous mode that enables allow-all and runs until task completion without user interaction (experimental)',
      },
    ],
    currentModeId,
  };
}

/**
 * Runs the SYNTHETIC fixture server loop against the current process's real
 * stdin/stdout. Never returns a value; the process exits itself per
 * scenario (matching a real ACP agent's own process lifecycle) or on
 * `session/close`.
 */
export function runSyntheticAcpFixture(scenario: FixtureScenario, logPath: string): void {
  writeFileSync(logPath, '', { encoding: 'utf8', mode: 0o600 });
  logEvent(logPath, { direction: 'fixture-started', scenario, pid: process.pid });

  let sessionId: string | null = null;
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  rl.on('line', (line) => {
    logEvent(logPath, { direction: 'received-raw-bytes', bytes: Buffer.byteLength(line, 'utf8') });
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      logEvent(logPath, { direction: 'received-unparsable' });
      return;
    }
    if (!isJsonRpcLike(parsed)) {
      logEvent(logPath, { direction: 'received-non-object' });
      return;
    }
    const msg = parsed;
    logEvent(logPath, {
      direction: 'received', method: msg.method, id: msg.id, params: msg.params ?? null,
    });

    if (msg.method === 'initialize' && typeof msg.id !== 'undefined') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: 1,
          agentInfo: { name: 'Copilot', title: 'Copilot', version: 'synthetic-fixture' },
          agentCapabilities: {
            loadSession: true,
            mcpCapabilities: { http: true, sse: true },
            promptCapabilities: { image: true, audio: false, embeddedContext: true },
            sessionCapabilities: { close: {}, list: {} },
          },
        },
      });
      return;
    }

    if (msg.method === 'session/new' && typeof msg.id !== 'undefined') {
      sessionId = randomUUID();

      if (scenario === 'malformed-json') {
        process.stdout.write('{this is not valid json\n');
        logEvent(logPath, { direction: 'sent-malformed-json' });
        return;
      }

      if (scenario === 'protocol-error-with-secret') {
        process.stderr.write(`leaked-for-test-only: ${SYNTHETIC_LEAKED_SECRET}\n`);
        send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32000, message: `remote failure containing ${SYNTHETIC_LEAKED_SECRET}`, data: { token: SYNTHETIC_LEAKED_SECRET } },
        });
        return;
      }

      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { sessionId, modes: availableModesResult(SYNTHETIC_AGENT_MODE_ID), modeOptions: [] },
      });

      if (scenario === 'exit-after-new-session') {
        logEvent(logPath, { direction: 'exiting', reason: 'exit-after-new-session' });
        process.exit(1);
      }

      if (scenario === 'oversize-frame') {
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, filler: 'x'.repeat(SYNTHETIC_OVERSIZE_FRAME_BYTES) } })}\n`);
        logEvent(logPath, { direction: 'sent-oversize-frame', bytes: SYNTHETIC_OVERSIZE_FRAME_BYTES });
      }

      if (scenario === 'permission-request') {
        send({
          jsonrpc: '2.0',
          id: 'fixture-permission-1',
          method: 'session/request_permission',
          params: {
            sessionId,
            toolCall: { title: 'synthetic tool call', kind: 'execute' },
            options: [
              { optionId: 'allow_once', name: 'Allow once' },
              { optionId: 'allow_always', name: 'Allow always' },
              { optionId: 'reject_once', name: 'Reject' },
            ],
          },
        });
      }

      if (scenario === 'unsupported-capability-request') {
        send({
          jsonrpc: '2.0',
          id: 'fixture-fsread-1',
          method: 'fs/read_text_file',
          params: { sessionId, path: '/tmp/synthetic-unsupported.txt' },
        });
      }
      return;
    }

    if (msg.method === 'session/set_mode' && typeof msg.id !== 'undefined') {
      const params = (msg.params ?? {}) as { sessionId?: unknown; modeId?: unknown };
      const requestedMode = typeof params.modeId === 'string' ? params.modeId : '';

      if (scenario === 'exit-during-set-mode') {
        logEvent(logPath, { direction: 'exiting', reason: 'exit-during-set-mode' });
        process.exit(1);
      }

      const targetSessionId = scenario === 'foreign-session-update' ? 'foreign-session-id-not-ours' : sessionId;
      if (scenario !== 'no-mode-notification') {
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: { sessionId: targetSessionId, update: { sessionUpdate: 'current_mode_update', currentModeId: requestedMode } },
        });
      }
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: targetSessionId,
          update: {
            sessionUpdate: 'config_option_update',
            modeOptions: [{
              type: 'select', id: 'mode', name: 'Mode', currentValue: requestedMode, options: [], category: 'mode', description: 'synthetic',
            }],
          },
        },
      });
      send({ jsonrpc: '2.0', id: msg.id, result: {} });
      if (scenario === 'duplicate-response-id') {
        send({ jsonrpc: '2.0', id: msg.id, result: {} });
      }
      return;
    }

    if (msg.method === 'session/cancel') {
      logEvent(logPath, { direction: 'observed-cancel-notification', hadId: typeof msg.id !== 'undefined' });
      if (typeof msg.id !== 'undefined') {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: '"Method not found": session/cancel', data: { method: 'session/cancel' } } });
      }
      return;
    }

    if (msg.method === 'session/close' && typeof msg.id !== 'undefined') {
      send({ jsonrpc: '2.0', id: msg.id, result: {} });
      logEvent(logPath, { direction: 'closing' });
      process.exit(0);
      return;
    }

    if (typeof msg.id !== 'undefined' && typeof msg.method === 'undefined') {
      logEvent(logPath, { direction: 'client-response', id: msg.id, result: msg.result, error: msg.error });
      return;
    }

    logEvent(logPath, { direction: 'unhandled-method', method: msg.method });
  });

  rl.on('close', () => {
    logEvent(logPath, { direction: 'stdin-closed' });
  });
}

/* istanbul ignore next -- exercised only as a real spawned child process, never required for its side effects in-process. */
if (require.main === module) {
  const argv = process.argv.slice(2);
  const scenario = argv[0] as FixtureScenario;
  const logPath = argv[1];
  if (!FIXTURE_SCENARIOS.includes(scenario) || typeof logPath !== 'string' || logPath.length === 0) {
    process.stderr.write('synthetic fixture requires a known scenario and a log file path\n');
    process.exit(2);
  }
  runSyntheticAcpFixture(scenario, logPath);
}
