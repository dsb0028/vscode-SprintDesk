import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, symlinkSync, statSync, readdirSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { NodeReviewPolicy } from './NodeReviewPolicy';
import { renderDefaultReviewPolicy, REVIEW_POLICY_MAX_BYTES, ReviewPolicyError } from './reviewPolicy';

interface Fixture {
  readonly base: string;
  readonly root: string;
}

function createFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), 'node-review-policy-'));
  const root = join(base, 'project');
  mkdirSync(join(root, '.SprintDesk', 'settings'), { recursive: true });
  return { base, root };
}

function withFixture(run: (f: Fixture) => void): void {
  const f = createFixture();
  try {
    run(f);
  } finally {
    rmSync(f.base, { recursive: true, force: true });
  }
}

function settingsPath(root: string): string {
  return join(root, '.SprintDesk', 'settings', 'review-thresholds.yml');
}

function writePolicy(root: string, text: string | Buffer): string {
  const target = settingsPath(root);
  writeFileSync(target, text);
  return target;
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Real, Linux-specific open-file-descriptor count for this process (used to verify cleanup). */
function openFdCount(): number {
  return readdirSync('/proc/self/fd').length;
}

function anyError(operation: () => unknown): unknown {
  try {
    operation();
    throw new Error('Expected operation to throw');
  } catch (error) {
    return error;
  }
}

function assertCode(operation: () => unknown, code: string): ReviewPolicyError & Record<string, unknown> {
  const error = anyError(operation) as ReviewPolicyError & Record<string, unknown>;
  assert.equal((error as { code?: unknown }).code, code,
    `expected code ${code}, received ${(error as { code?: unknown }).code}`);
  return error;
}

function readWithPolicy(root: string, projectId: string): ReturnType<NodeReviewPolicy['read']> {
  return new NodeReviewPolicy(root, projectId).read();
}

test('NodeReviewPolicy.read() succeeds for a valid policy with correct identity, digest and parsed values', () => {
  withFixture(f => {
    const text = renderDefaultReviewPolicy();
    const target = writePolicy(f.root, text);
    const result = readWithPolicy(f.root, 'project-alpha');
    assert.equal(result.projectId, 'project-alpha');
    assert.equal(result.workspaceRoot, f.root);
    assert.equal(result.filePath, target);
    assert.equal(result.digest, sha256Hex(readFileSync(target)));
    assert.equal(result.policy.schema_version, 1);
    assert.equal(result.policy.reviewers.planning.minimum_average, 4);
    assert.equal(result.policy.reviewers.planning.minimum_dimension, 3);
    assert.equal(result.policy.reviewers.planning.max_refinement_cycles, 3);
    assert.equal(result.policy.reviewers.translation.minimum_average, 4);
    assert.equal(result.policy.reviewers.test_code.minimum_average, 4);
    assert.equal(result.policy.evidence_validator.minimum_score, 85);
    assert.equal(result.policy.evidence_validator.max_refinement_cycles, 3);
  });
});

test('NodeReviewPolicy.read() never creates, initializes or mutates filesystem state', () => {
  withFixture(f => {
    const target = writePolicy(f.root, renderDefaultReviewPolicy());
    const before = statSync(target);
    const beforeEntries = readdirSync(join(f.root, '.SprintDesk', 'settings')).sort();
    readWithPolicy(f.root, 'project-alpha');
    readWithPolicy(f.root, 'project-alpha');
    const after = statSync(target);
    const afterEntries = readdirSync(join(f.root, '.SprintDesk', 'settings')).sort();
    assert.equal(before.mtimeMs, after.mtimeMs);
    assert.equal(before.mode, after.mode);
    assert.deepEqual(afterEntries, beforeEntries);
  });
});

test('NodeReviewPolicy enforces project isolation across two independent workspace roots', () => {
  withFixture(f1 => {
    withFixture(f2 => {
      writePolicy(f1.root, renderDefaultReviewPolicy());
      writePolicy(f2.root, 'schema_version: 1\nreviewers:\n  planning: { minimum_average: 5, minimum_dimension: 1, max_refinement_cycles: 0 }\n  translation: { minimum_average: 4, minimum_dimension: 3, max_refinement_cycles: 3 }\n  test_code: { minimum_average: 4, minimum_dimension: 3, max_refinement_cycles: 3 }\nevidence_validator: { minimum_score: 1, max_refinement_cycles: 0 }\n');
      const r1 = readWithPolicy(f1.root, 'project-one');
      const r2 = readWithPolicy(f2.root, 'project-two');
      assert.equal(r1.policy.reviewers.planning.minimum_average, 4);
      assert.equal(r2.policy.reviewers.planning.minimum_average, 5);
      assert.notEqual(r1.digest, r2.digest);
      assert.notEqual(r1.workspaceRoot, r2.workspaceRoot);
      assert.equal(r1.projectId, 'project-one');
      assert.equal(r2.projectId, 'project-two');
      // Re-reading the first project after reading the second must not have been affected.
      const r1Again = readWithPolicy(f1.root, 'project-one');
      assert.equal(r1Again.digest, r1.digest);
    });
  });
});

test('NodeReviewPolicy.read() rejects a missing policy file as POLICY_FILE_MISSING', () => {
  withFixture(f => {
    const error = assertCode(() => readWithPolicy(f.root, 'project-alpha'), 'POLICY_FILE_MISSING');
    assert.equal((error as { operation?: unknown }).operation, 'read');
    assert.ok(typeof (error as { correctiveAction?: unknown }).correctiveAction === 'string'
      && ((error as { correctiveAction: string }).correctiveAction.length > 0));
  });
});

test('NodeReviewPolicy rejects bytes beyond REVIEW_POLICY_MAX_BYTES as POLICY_TOO_LARGE', () => {
  withFixture(f => {
    const oversized = Buffer.alloc(REVIEW_POLICY_MAX_BYTES + 1, 'a'.charCodeAt(0));
    writePolicy(f.root, oversized);
    assertCode(() => readWithPolicy(f.root, 'project-alpha'), 'POLICY_TOO_LARGE');
  });
});

test('NodeReviewPolicy rejects invalid UTF-8 bytes as POLICY_ENCODING_INVALID', () => {
  withFixture(f => {
    // Lone continuation byte (0x80) is never valid as the start of a UTF-8 sequence.
    const invalid = Buffer.concat([Buffer.from('schema_version: 1\n'), Buffer.from([0x80, 0x80, 0x80])]);
    writePolicy(f.root, invalid);
    assertCode(() => readWithPolicy(f.root, 'project-alpha'), 'POLICY_ENCODING_INVALID');
  });
});

/**
 * Requires an unprivileged (non-root) test runner: this suite is validated on the actual
 * Linux host with uid 434020, where POSIX permission bits are enforced normally. Root would
 * bypass the chmod 0o000 restriction and make this assertion meaningless, so this test is
 * stated as depending on that unprivileged-host prerequisite rather than silently skipped.
 */
test('NodeReviewPolicy rejects a permission-denied policy file as POLICY_UNREADABLE (requires an unprivileged/non-root test runner)', () => {
  withFixture(f => {
    const target = writePolicy(f.root, renderDefaultReviewPolicy());
    chmodSync(target, 0o000);
    try {
      assertCode(() => readWithPolicy(f.root, 'project-alpha'), 'POLICY_UNREADABLE');
    } finally {
      chmodSync(target, 0o644);
    }
  });
});

/**
 * Creates a real FIFO at the exact policy path using the system mkfifo binary (no shell,
 * checked exit code), then asserts the loader rejects it as POLICY_PATH_INVALID without this
 * test itself ever opening the FIFO or installing any timeout: the production rule requires
 * rejection to happen before any blocking open is attempted, and that call is expected to
 * return (by throwing) promptly under normal supervised test execution.
 */
test('NodeReviewPolicy rejects a FIFO policy file as POLICY_PATH_INVALID without blocking on open', () => {
  withFixture(f => {
    const fifoPath = settingsPath(f.root);
    rmSync(fifoPath, { force: true });
    const mkfifo = spawnSync('/usr/bin/mkfifo', [fifoPath]);
    assert.equal(mkfifo.status, 0,
      `mkfifo must succeed to create the fixture FIFO (stderr: ${mkfifo.stderr?.toString() ?? ''})`);
    try {
      assertCode(() => readWithPolicy(f.root, 'project-alpha'), 'POLICY_PATH_INVALID');
    } finally {
      rmSync(fifoPath, { force: true });
    }
  });
});

test('NodeReviewPolicy rejects a directory in place of the policy file as POLICY_PATH_INVALID', () => {
  withFixture(f => {
    mkdirSync(settingsPath(f.root));
    assertCode(() => readWithPolicy(f.root, 'project-alpha'), 'POLICY_PATH_INVALID');
  });
});

test('NodeReviewPolicy rejects a symlinked policy file as POLICY_PATH_INVALID', () => {
  withFixture(f => {
    const realTarget = join(f.base, 'external-policy.yml');
    writeFileSync(realTarget, renderDefaultReviewPolicy());
    symlinkSync(realTarget, settingsPath(f.root));
    assertCode(() => readWithPolicy(f.root, 'project-alpha'), 'POLICY_PATH_INVALID');
  });
});

test('NodeReviewPolicy rejects a symlinked settings parent directory as POLICY_PATH_INVALID', () => {
  withFixture(f => {
    const externalSettings = join(f.base, 'external-settings');
    mkdirSync(externalSettings);
    writeFileSync(join(externalSettings, 'review-thresholds.yml'), renderDefaultReviewPolicy());
    rmSync(join(f.root, '.SprintDesk', 'settings'), { recursive: true, force: true });
    symlinkSync(externalSettings, join(f.root, '.SprintDesk', 'settings'));
    assertCode(() => readWithPolicy(f.root, 'project-alpha'), 'POLICY_PATH_INVALID');
  });
});

/**
 * Human-clarified timing: a symlinked workspace *root* must be rejected immediately from the
 * bare constructor call as POLICY_CONTEXT_INVALID, before any read() is ever attempted -- this
 * is distinct from symlinked *policy-path components below a valid root* (policy file, settings
 * parent directory), which remain POLICY_PATH_INVALID at read() and are covered by the separate
 * tests above. Asserting on `new NodeReviewPolicy(...)` alone (never calling `.read()`) keeps
 * this case unambiguous, and the before/after directory-listing comparison is direct evidence
 * that the rejected construction had no filesystem side effects.
 */
test('NodeReviewPolicy constructor throws immediately for a symlinked workspace root as POLICY_CONTEXT_INVALID', () => {
  withFixture(f => {
    writePolicy(f.root, renderDefaultReviewPolicy());
    const linkedRoot = join(f.base, 'linked-root');
    symlinkSync(f.root, linkedRoot);
    const beforeEntries = readdirSync(f.base).sort();
    assertCode(() => new NodeReviewPolicy(linkedRoot, 'project-alpha'), 'POLICY_CONTEXT_INVALID');
    const afterEntries = readdirSync(f.base).sort();
    assert.deepEqual(afterEntries, beforeEntries);
  });
});

/**
 * Distinct from the symlinked-workspace-root case above: here the workspace root path itself
 * is a real, non-symlink directory (`lstat` on it reports a plain directory), but one of its
 * *ancestor* path components is reached only through a symlink (`alias -> real-container`).
 * The OS transparently resolves that intermediate symlink when the final component is
 * `lstat`-ed, so a constructor that only inspects the final path component never observes the
 * symlink at all. The human-clarified rule requires rejecting any symlinked workspace root
 * eagerly and immediately in the constructor -- this must include a root reached through a
 * symlinked ancestor, not merely a root that is itself a direct symlink. No policy file is
 * written anywhere and `.read()` is never called: only `new NodeReviewPolicy(...)` is
 * exercised, and the before/after directory listings of both the real container and the base
 * temp directory are direct evidence that the rejected construction had no filesystem side
 * effects on either tree.
 */
test('NodeReviewPolicy constructor throws immediately for a workspace root reached through a symlinked ancestor directory as POLICY_CONTEXT_INVALID', () => {
  withFixture(f => {
    const realContainer = join(f.base, 'real-container');
    mkdirSync(realContainer);
    const realWorkspace = join(realContainer, 'workspace');
    mkdirSync(join(realWorkspace, '.SprintDesk', 'settings'), { recursive: true });
    const alias = join(f.base, 'alias');
    symlinkSync(realContainer, alias);
    const aliasedRoot = join(alias, 'workspace');

    const beforeContainerEntries = readdirSync(realContainer).sort();
    const beforeBaseEntries = readdirSync(f.base).sort();
    assertCode(() => new NodeReviewPolicy(aliasedRoot, 'project-alpha'), 'POLICY_CONTEXT_INVALID');
    const afterContainerEntries = readdirSync(realContainer).sort();
    const afterBaseEntries = readdirSync(f.base).sort();
    assert.deepEqual(afterContainerEntries, beforeContainerEntries);
    assert.deepEqual(afterBaseEntries, beforeBaseEntries);
  });
});

/**
 * The missing-policy-file contract requires `field` to identify a known schema path or the
 * sentinel `'$'` -- never `undefined` -- alongside `operation: 'read'`, the real supplied
 * context, a nonempty correctiveAction, and no fabricated `line`/`column` location (those are
 * only ever meaningful for an actual parse of actual bytes, which never happens when the file
 * does not exist). This is independent of the existing "rejects a missing policy file" test
 * above, which only checks `operation` and `correctiveAction`; this test is scoped exclusively
 * to the `field`/`line`/`column` shape of that same error.
 */
test('NodeReviewPolicy.read() missing-file error identifies field "$" with operation "read" and a real context, never a fabricated YAML location', () => {
  withFixture(f => {
    const error = assertCode(() => readWithPolicy(f.root, 'project-alpha'), 'POLICY_FILE_MISSING');
    assert.equal(error.operation, 'read');
    assert.equal(error.field, '$');
    assert.equal(error.projectId, 'project-alpha');
    assert.equal(error.filePath, settingsPath(f.root));
    assert.ok(typeof error.correctiveAction === 'string' && error.correctiveAction.length > 0);
    assert.equal(error.line, undefined);
    assert.equal(error.column, undefined);
  });
});

const invalidContextCases: ReadonlyArray<[(f: Fixture) => { root: string; projectId: string }, string]> = [
  [f => ({ root: f.root, projectId: '' }), 'blank projectId'],
  [f => ({ root: f.root, projectId: '   ' }), 'whitespace-only projectId'],
  [f => ({ root: join(f.root, 'does-not-exist'), projectId: 'project-alpha' }), 'nonexistent workspace root'],
  [f => ({ root: 'relative/workspace/path', projectId: 'project-alpha' }), 'non-absolute workspace root'],
  [f => ({ root: join(f.root, '.SprintDesk', 'settings', 'review-thresholds.yml'), projectId: 'project-alpha' }),
    'workspace root that is a file, not a directory'],
  // Built as a literal string (not via path.join, which normalizes away '..') so the raw
  // '..' segment actually reaches the constructor unmodified.
  [f => ({ root: `${f.root}${sep}sub${sep}..`, projectId: 'project-alpha' }), 'non-canonical workspace root (.. segment)'],
];

for (const [build, label] of invalidContextCases) {
  test(`NodeReviewPolicy constructor throws immediately for ${label} as POLICY_CONTEXT_INVALID`, () => {
    withFixture(f => {
      // No valid policy content is ever written for these cases: an immediately-throwing
      // constructor must reject before attempting any filesystem access related to the policy
      // file itself. The "is a file" case still needs *some* regular file to exist at that exact
      // path so the rejection is actually driven by "not a directory", not by "does not exist".
      if (label.includes('is a file')) {
        writeFileSync(settingsPath(f.root), 'irrelevant: true\n');
      }
      if (label.includes('non-canonical')) {
        mkdirSync(join(f.root, 'sub'), { recursive: true });
      }
      const { root, projectId } = build(f);
      assertCode(() => new NodeReviewPolicy(root, projectId), 'POLICY_CONTEXT_INVALID');
    });
  });
}

test('NodeReviewPolicy constructor throws immediately even when a valid policy file exists (construction never reaches read())', () => {
  withFixture(f => {
    writePolicy(f.root, renderDefaultReviewPolicy());
    assertCode(() => new NodeReviewPolicy(join(f.root, 'does-not-exist'), 'project-alpha'), 'POLICY_CONTEXT_INVALID');
  });
});

test('a failed NodeReviewPolicy construction never creates, initializes or mutates filesystem state', () => {
  withFixture(f => {
    const beforeEntries = readdirSync(f.root).sort();
    anyError(() => new NodeReviewPolicy(join(f.root, 'does-not-exist'), 'project-alpha'));
    anyError(() => new NodeReviewPolicy(f.root, ''));
    const afterEntries = readdirSync(f.root).sort();
    assert.deepEqual(afterEntries, beforeEntries);
  });
});

test('NodeReviewPolicy construction succeeds for a valid context and read() can then be called independently', () => {
  withFixture(f => {
    writePolicy(f.root, renderDefaultReviewPolicy());
    const loader = new NodeReviewPolicy(f.root, 'project-alpha');
    const result = loader.read();
    assert.equal(result.projectId, 'project-alpha');
    assert.equal(result.policy.schema_version, 1);
  });
});

test('NodeReviewPolicy parser failures retain operation "parse" and the supplied read context', () => {
  withFixture(f => {
    writePolicy(f.root, 'schema_version: [unterminated\n');
    const error = assertCode(() => readWithPolicy(f.root, 'project-alpha'), 'POLICY_MALFORMED');
    assert.equal((error as { operation?: unknown }).operation, 'parse');
    assert.equal((error as { projectId?: unknown }).projectId, 'project-alpha');
    assert.equal((error as { filePath?: unknown }).filePath, settingsPath(f.root));
  });
});

test('descriptor cleanup: successful reads do not leak open file descriptors (Linux /proc check)', () => {
  withFixture(f => {
    writePolicy(f.root, renderDefaultReviewPolicy());
    const before = openFdCount();
    for (let i = 0; i < 25; i += 1) {
      readWithPolicy(f.root, 'project-alpha');
    }
    const after = openFdCount();
    assert.equal(after, before, 'successful read() calls must close every descriptor they open');
  });
});

test('descriptor cleanup: failed reads (missing, oversized, invalid encoding) do not leak descriptors', () => {
  withFixture(f => {
    const before = openFdCount();
    for (let i = 0; i < 5; i += 1) {
      anyError(() => readWithPolicy(f.root, 'project-alpha'));
    }
    writePolicy(f.root, Buffer.alloc(REVIEW_POLICY_MAX_BYTES + 1, 'a'.charCodeAt(0)));
    for (let i = 0; i < 5; i += 1) {
      anyError(() => readWithPolicy(f.root, 'project-alpha'));
    }
    writePolicy(f.root, Buffer.from([0x80, 0x80]));
    for (let i = 0; i < 5; i += 1) {
      anyError(() => readWithPolicy(f.root, 'project-alpha'));
    }
    const after = openFdCount();
    assert.equal(after, before, 'failed read() calls must still close every descriptor they open');
  });
});
