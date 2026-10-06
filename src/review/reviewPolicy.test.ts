import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REVIEW_POLICY_MAX_BYTES, ReviewPolicy, ReviewPolicyContext, ReviewPolicyError,
  parseReviewPolicy, getDefaultReviewPolicy, renderDefaultReviewPolicy,
} from './reviewPolicy';

// Contract-derived expected defaults (src/review/reviewPolicy.ts.yaml_shape in contract.json),
// independent of the implementation under test. Built from a JSON string (rather than a TS object
// literal) so the contract's snake_case field names never appear as linted identifiers here.
const EXPECTED_DEFAULT_POLICY: ReviewPolicy = JSON.parse(`{
  "schema_version": 1,
  "reviewers": {
    "planning": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 },
    "translation": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 },
    "test_code": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 }
  },
  "evidence_validator": { "minimum_score": 85, "max_refinement_cycles": 3 }
}`) as ReviewPolicy;

function context(overrides: Partial<ReviewPolicyContext> = {}): ReviewPolicyContext {
  return { projectId: 'project-alpha', filePath: '/synthetic/review-thresholds.yml', ...overrides };
}

function policyError(operation: () => unknown): ReviewPolicyError {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof ReviewPolicyError,
      `expected a ReviewPolicyError, received ${String(error)}`);
    return error as ReviewPolicyError;
  }
  throw new Error('Expected operation to throw');
}

function assertCode(operation: () => unknown, code: string, field?: string): ReviewPolicyError {
  const error = policyError(operation);
  assert.equal(error.code, code, `expected code ${code}, received ${error.code}`);
  if (field !== undefined) {
    assert.equal(error.field, field, `expected field ${field}, received ${error.field}`);
  }
  return error;
}

function assertNoLeak(error: ReviewPolicyError, ...secrets: string[]): void {
  const serialized = `${error.message}\n${JSON.stringify(error)}`;
  for (const secret of secrets) {
    assert.ok(!serialized.includes(secret), `must not leak: ${secret}`);
  }
}


function validYaml(overrides: Partial<{
  schemaVersion: unknown;
  planningAvg: unknown; planningDim: unknown; planningCycles: unknown;
  translationAvg: unknown; translationDim: unknown; translationCycles: unknown;
  testCodeAvg: unknown; testCodeDim: unknown; testCodeCycles: unknown;
  evidenceScore: unknown; evidenceCycles: unknown;
}> = {}): string {
  const v = {
    schemaVersion: 1,
    planningAvg: 4, planningDim: 3, planningCycles: 3,
    translationAvg: 4, translationDim: 3, translationCycles: 3,
    testCodeAvg: 4, testCodeDim: 3, testCodeCycles: 3,
    evidenceScore: 85, evidenceCycles: 3,
    ...overrides,
  };
  return `schema_version: ${v.schemaVersion}
reviewers:
  planning:
    minimum_average: ${v.planningAvg}
    minimum_dimension: ${v.planningDim}
    max_refinement_cycles: ${v.planningCycles}
  translation:
    minimum_average: ${v.translationAvg}
    minimum_dimension: ${v.translationDim}
    max_refinement_cycles: ${v.translationCycles}
  test_code:
    minimum_average: ${v.testCodeAvg}
    minimum_dimension: ${v.testCodeDim}
    max_refinement_cycles: ${v.testCodeCycles}
evidence_validator:
  minimum_score: ${v.evidenceScore}
  max_refinement_cycles: ${v.evidenceCycles}
`;
}

test('REVIEW_POLICY_MAX_BYTES is the exact contract-fixed byte cap', () => {
  assert.equal(REVIEW_POLICY_MAX_BYTES, 65536);
});

test('getDefaultReviewPolicy returns the exact contract-derived defaults, deeply frozen', () => {
  const policy = getDefaultReviewPolicy();
  assert.deepEqual(policy, EXPECTED_DEFAULT_POLICY);
  assert.ok(Object.isFrozen(policy));
  assert.ok(Object.isFrozen(policy.reviewers));
  assert.ok(Object.isFrozen(policy.reviewers.planning));
  assert.ok(Object.isFrozen(policy.reviewers.translation));
  assert.ok(Object.isFrozen(policy.reviewers.test_code));
  assert.ok(Object.isFrozen(policy.evidence_validator));
  assert.throws(() => Object.assign(policy.reviewers.planning, JSON.parse('{"minimum_average": 1}')));
});

test('getDefaultReviewPolicy returns a fresh, independently frozen object on every call (no shared mutable default)', () => {
  const first = getDefaultReviewPolicy();
  const second = getDefaultReviewPolicy();
  // Directly observable via object identity: distinct top-level and nested object references
  // prove no single mutable default object is shared/returned across calls, even though both
  // calls carry equal, independently frozen values.
  assert.notEqual(first, second, 'each call must return a distinct object, not a shared singleton');
  assert.notEqual(first.reviewers, second.reviewers, 'nested reviewers object must also be independent');
  assert.notEqual(first.reviewers.planning, second.reviewers.planning,
    'nested per-profile object must also be independent');
  assert.notEqual(first.evidence_validator, second.evidence_validator,
    'nested evidence_validator object must also be independent');
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(second));
  assert.ok(Object.isFrozen(first.reviewers.planning));
  assert.ok(Object.isFrozen(second.reviewers.planning));
});

test('renderDefaultReviewPolicy emits the exact literal default values as real YAML text', () => {
  const text = renderDefaultReviewPolicy();
  assert.match(text, /schema_version:\s*1\b/);
  assert.match(text, /minimum_score:\s*85\b/);
  const averageMatches = text.match(/minimum_average:\s*4\b/g) ?? [];
  assert.equal(averageMatches.length, 3, 'all three reviewer profiles must render minimum_average: 4');
  const dimensionMatches = text.match(/minimum_dimension:\s*3\b/g) ?? [];
  assert.equal(dimensionMatches.length, 3, 'all three reviewer profiles must render minimum_dimension: 3');
  const cycleMatches = text.match(/max_refinement_cycles:\s*3\b/g) ?? [];
  assert.equal(cycleMatches.length, 4, 'three reviewer profiles plus evidence_validator must render max_refinement_cycles: 3');
});

test('renderDefaultReviewPolicy output round-trips through parseReviewPolicy to the same defaults', () => {
  const parsed = parseReviewPolicy(renderDefaultReviewPolicy(), context());
  assert.deepEqual(parsed, EXPECTED_DEFAULT_POLICY);
  assert.ok(Object.isFrozen(parsed));
});

test('parseReviewPolicy accepts a non-default, within-bounds custom policy exactly', () => {
  const text = validYaml({
    planningAvg: 5, planningDim: 1, planningCycles: 0,
    evidenceScore: 1, evidenceCycles: Number.MAX_SAFE_INTEGER,
  });
  const parsed = parseReviewPolicy(text, context());
  assert.equal(parsed.reviewers.planning.minimum_average, 5);
  assert.equal(parsed.reviewers.planning.minimum_dimension, 1);
  assert.equal(parsed.reviewers.planning.max_refinement_cycles, 0);
  assert.equal(parsed.evidence_validator.minimum_score, 1);
  assert.equal(parsed.evidence_validator.max_refinement_cycles, Number.MAX_SAFE_INTEGER);
});

test('parseReviewPolicy accepts comments and varied formatting without altering values', () => {
  const text = `# review policy
schema_version: 1 # top level
reviewers:
  planning:
    minimum_average:   4.5
    minimum_dimension: 3
    max_refinement_cycles: 2
  translation:
    minimum_average: 4
    minimum_dimension: 3
    max_refinement_cycles: 3
  test_code:
    minimum_average: 4
    minimum_dimension: 3
    max_refinement_cycles: 3

evidence_validator:
  minimum_score: 85
  max_refinement_cycles: 3
`;
  const parsed = parseReviewPolicy(text, context());
  assert.equal(parsed.reviewers.planning.minimum_average, 4.5);
  assert.equal(parsed.reviewers.planning.max_refinement_cycles, 2);
});

const minimumAverageRejections: ReadonlyArray<[unknown, string]> = [
  [0, 'below minimum 1'],
  [5.0001, 'above maximum 5'],
  [6, 'far above maximum'],
  [Number.NaN, 'NaN'],
  [Number.POSITIVE_INFINITY, 'Infinity'],
  ['4', 'string value'],
  [true, 'boolean value'],
  [null, 'null value'],
];

for (const [value, label] of minimumAverageRejections) {
  test(`parseReviewPolicy rejects planning.minimum_average = ${label} as POLICY_INVALID`, () => {
    const text = validYaml({ planningAvg: typeof value === 'string' ? `"${value}"` : value });
    assertCode(() => parseReviewPolicy(text, context()), 'POLICY_INVALID', 'reviewers.planning.minimum_average');
  });
}

test('parseReviewPolicy accepts minimum_average fractional and exact boundary values', () => {
  for (const value of [1, 5, 2.5, 4.999]) {
    const parsed = parseReviewPolicy(validYaml({ planningAvg: value }), context());
    assert.equal(parsed.reviewers.planning.minimum_average, value);
  }
});

const minimumDimensionRejections: ReadonlyArray<[unknown, string]> = [
  [0, 'below minimum 1'],
  [6, 'above maximum 5'],
  [2.5, 'fractional value'],
  ['3', 'string value'],
  [null, 'null value'],
  [Number.NaN, 'NaN'],
];

for (const [value, label] of minimumDimensionRejections) {
  test(`parseReviewPolicy rejects planning.minimum_dimension = ${label} as POLICY_INVALID`, () => {
    const text = validYaml({ planningDim: typeof value === 'string' ? `"${value}"` : value });
    assertCode(() => parseReviewPolicy(text, context()), 'POLICY_INVALID', 'reviewers.planning.minimum_dimension');
  });
}

test('parseReviewPolicy accepts minimum_dimension integer boundary values 1 and 5', () => {
  for (const value of [1, 5]) {
    const parsed = parseReviewPolicy(validYaml({ planningDim: value }), context());
    assert.equal(parsed.reviewers.planning.minimum_dimension, value);
  }
});

const minimumScoreRejections: ReadonlyArray<[unknown, string]> = [
  [0, 'below minimum 1'],
  [101, 'above maximum 100'],
  [50.5, 'fractional value'],
  ['50', 'string value'],
  [null, 'null value'],
];

for (const [value, label] of minimumScoreRejections) {
  test(`parseReviewPolicy rejects evidence_validator.minimum_score = ${label} as POLICY_INVALID`, () => {
    const text = validYaml({ evidenceScore: typeof value === 'string' ? `"${value}"` : value });
    assertCode(() => parseReviewPolicy(text, context()), 'POLICY_INVALID', 'evidence_validator.minimum_score');
  });
}

test('parseReviewPolicy accepts minimum_score integer boundary values 1 and 100', () => {
  for (const value of [1, 100]) {
    const parsed = parseReviewPolicy(validYaml({ evidenceScore: value }), context());
    assert.equal(parsed.evidence_validator.minimum_score, value);
  }
});

const cycleRejections: ReadonlyArray<[unknown, string]> = [
  [-1, 'negative value'],
  [Number.MAX_SAFE_INTEGER + 1, 'the next-unsafe integer'],
  [1.5, 'fractional value'],
  ['3', 'string value'],
  [Number.NaN, 'NaN'],
  [Number.POSITIVE_INFINITY, 'Infinity'],
  [null, 'null value'],
];

for (const [value, label] of cycleRejections) {
  test(`parseReviewPolicy rejects planning.max_refinement_cycles = ${label} as POLICY_INVALID`, () => {
    const text = validYaml({ planningCycles: typeof value === 'string' ? `"${value}"` : value });
    assertCode(() => parseReviewPolicy(text, context()), 'POLICY_INVALID', 'reviewers.planning.max_refinement_cycles');
  });
}

test('parseReviewPolicy accepts max_refinement_cycles zero and Number.MAX_SAFE_INTEGER', () => {
  const zero = parseReviewPolicy(validYaml({ planningCycles: 0 }), context());
  assert.equal(zero.reviewers.planning.max_refinement_cycles, 0);
  const max = parseReviewPolicy(validYaml({ evidenceCycles: Number.MAX_SAFE_INTEGER }), context());
  assert.equal(max.evidence_validator.max_refinement_cycles, Number.MAX_SAFE_INTEGER);
});

test('parseReviewPolicy rejects an unsupported numeric schema_version as POLICY_VERSION_UNSUPPORTED', () => {
  assertCode(() => parseReviewPolicy(validYaml({ schemaVersion: 2 }), context()), 'POLICY_VERSION_UNSUPPORTED', 'schema_version');
  assertCode(() => parseReviewPolicy(validYaml({ schemaVersion: 0 }), context()), 'POLICY_VERSION_UNSUPPORTED', 'schema_version');
});

test('parseReviewPolicy rejects a missing or wrongly typed schema_version as POLICY_INVALID', () => {
  assertCode(() => parseReviewPolicy(validYaml({ schemaVersion: '"1"' }), context()), 'POLICY_INVALID', 'schema_version');
  const withoutVersion = validYaml().replace(/^schema_version:.*\n/, '');
  assertCode(() => parseReviewPolicy(withoutVersion, context()), 'POLICY_INVALID', 'schema_version');
});

const requiredSectionRemovals: ReadonlyArray<[RegExp, string]> = [
  [/ {2}planning:\n(?:.*\n){3}/, 'reviewers.planning'],
  [/ {2}translation:\n(?:.*\n){3}/, 'reviewers.translation'],
  [/ {2}test_code:\n(?:.*\n){3}/, 'reviewers.test_code'],
  [/evidence_validator:\n(?:.*\n){2}/, 'evidence_validator'],
];

for (const [pattern, label] of requiredSectionRemovals) {
  test(`parseReviewPolicy rejects a missing required "${label}" section as POLICY_INVALID`, () => {
    const text = validYaml().replace(pattern, '');
    assertCode(() => parseReviewPolicy(text, context()), 'POLICY_INVALID', label);
  });
}

test('parseReviewPolicy rejects an unknown top-level key as POLICY_INVALID, identifying the root container', () => {
  const text = `${validYaml()}unexpected_top_level: true\n`;
  assertCode(() => parseReviewPolicy(text, context()), 'POLICY_INVALID', '$');
});

test('parseReviewPolicy rejects an unknown nested field as POLICY_INVALID, identifying the containing known mapping (not the unknown key)', () => {
  const text = validYaml().replace('minimum_average: 4\n    minimum_dimension: 3',
    'minimum_average: 4\n    minimum_dimension: 3\n    unexpected_nested: 1');
  assertCode(() => parseReviewPolicy(text, context()), 'POLICY_INVALID', 'reviewers.planning');
});

test('parseReviewPolicy rejects an unknown reviewer profile key as POLICY_INVALID, identifying the containing known mapping (not the unknown profile name)', () => {
  // Insert the unknown profile as a nested entry inside the existing (single) top-level
  // "reviewers" mapping, immediately before "evidence_validator", rather than appending a
  // second top-level "reviewers:" key. This varies only the "unknown nested key under a known
  // mapping" condition without also triggering the unrelated duplicate-top-level-key rule.
  const text = validYaml().replace('evidence_validator:',
    '  unexpected_profile:\n    minimum_average: 4\n    minimum_dimension: 3\n    max_refinement_cycles: 3\nevidence_validator:');
  assertCode(() => parseReviewPolicy(text, context()), 'POLICY_INVALID', 'reviewers');
});

test('parseReviewPolicy does not fall back to defaults when a required field is simply absent', () => {
  const text = validYaml().replace('    max_refinement_cycles: 3\n  translation:', '  translation:');
  assertCode(() => parseReviewPolicy(text, context()), 'POLICY_INVALID', 'reviewers.planning.max_refinement_cycles');
});

test('parseReviewPolicy rejects malformed YAML syntax as POLICY_MALFORMED with operation "parse" and never leaks the raw source', () => {
  const secretScalar = 'sk-malformed-syntax-secret-should-not-leak';
  const error = assertCode(() => parseReviewPolicy(`schema_version: [${secretScalar}\n`, context()), 'POLICY_MALFORMED');
  assert.equal(error.operation, 'parse');
  if (error.line !== undefined) {
    assert.ok(Number.isInteger(error.line) && error.line >= 1);
  }
  if (error.column !== undefined) {
    assert.ok(Number.isInteger(error.column) && error.column >= 1);
  }
  assertNoLeak(error, secretScalar);
});

test('parseReviewPolicy rejects duplicate mapping keys as POLICY_MALFORMED and never leaks the raw source', () => {
  const secretScalar = 'sk-duplicate-key-secret-should-not-leak';
  const text = `schema_version: "${secretScalar}"
schema_version: 1
reviewers:
  planning: { minimum_average: 4, minimum_dimension: 3, max_refinement_cycles: 3 }
  translation: { minimum_average: 4, minimum_dimension: 3, max_refinement_cycles: 3 }
  test_code: { minimum_average: 4, minimum_dimension: 3, max_refinement_cycles: 3 }
evidence_validator: { minimum_score: 85, max_refinement_cycles: 3 }
`;
  const error = assertCode(() => parseReviewPolicy(text, context()), 'POLICY_MALFORMED');
  assertNoLeak(error, secretScalar);
});

test('parseReviewPolicy rejects a multi-document YAML stream as POLICY_MALFORMED and never leaks the raw source', () => {
  const secretScalar = 'sk-multidoc-secret-should-not-leak';
  const attackerKey = 'x-attacker-multidoc-key';
  const text = `${validYaml()}# ${attackerKey}: ${secretScalar}\n---\n${validYaml()}`;
  const error = assertCode(() => parseReviewPolicy(text, context()), 'POLICY_MALFORMED');
  assertNoLeak(error, secretScalar, attackerKey);
});

test('parseReviewPolicy rejects a custom YAML tag as POLICY_MALFORMED and never leaks the raw source', () => {
  const secretScalar = 'sk-custom-tag-secret-should-not-leak';
  const text = validYaml({ planningAvg: `!!python/object:builtins.object ${secretScalar}` as unknown as number });
  const error = assertCode(() => parseReviewPolicy(text, context()), 'POLICY_MALFORMED');
  assertNoLeak(error, secretScalar);
});

test('parseReviewPolicy rejects a plain "<<" mapping key as POLICY_INVALID for its known containing mapping (merge expansion is disabled, so "<<" is an unknown key, not a YAML syntax failure) and never leaks the raw source', () => {
  const secretScalar = 'sk-merge-key-secret-should-not-leak';
  const text = validYaml().replace('minimum_average: 4\n    minimum_dimension: 3',
    `<<: "${secretScalar}"\n    minimum_average: 4\n    minimum_dimension: 3`);
  const error = assertCode(() => parseReviewPolicy(text, context()), 'POLICY_INVALID', 'reviewers.planning');
  assertNoLeak(error, secretScalar);
});


test('parseReviewPolicy rejects a non-mapping YAML root as POLICY_INVALID', () => {
  assertCode(() => parseReviewPolicy('- just\n- a\n- list\n', context()), 'POLICY_INVALID');
  assertCode(() => parseReviewPolicy('"just a scalar string"\n', context()), 'POLICY_INVALID');
  assertCode(() => parseReviewPolicy('', context()), 'POLICY_INVALID');
});

test('parseReviewPolicy accepts text at the exact byte-limit boundary, including multibyte characters', () => {
  const base = validYaml();
  const baseBytes = Buffer.byteLength(base, 'utf8');
  // Pad with a multibyte YAML comment so the exact byte count (not character count) is exercised.
  const filler = '\u00e9'; // 'é', 2 UTF-8 bytes
  const fillerBytes = Buffer.byteLength(filler, 'utf8');
  const remaining = REVIEW_POLICY_MAX_BYTES - baseBytes - 2; // "# " prefix
  const count = Math.floor(remaining / fillerBytes);
  const padded = `${base}# ${filler.repeat(count)}\n`;
  const actualBytes = Buffer.byteLength(padded, 'utf8');
  assert.ok(actualBytes <= REVIEW_POLICY_MAX_BYTES, `padded text must not exceed the cap (was ${actualBytes})`);
  const parsed = parseReviewPolicy(padded, context());
  assert.deepEqual(parsed, EXPECTED_DEFAULT_POLICY);
});

test('parseReviewPolicy rejects text exceeding the byte limit by exactly one byte as POLICY_TOO_LARGE', () => {
  const base = validYaml();
  const baseBytes = Buffer.byteLength(base, 'utf8');
  const padding = 'a'.repeat(REVIEW_POLICY_MAX_BYTES - baseBytes + 1);
  const oversized = `${base}# ${padding}\n`;
  assert.ok(Buffer.byteLength(oversized, 'utf8') > REVIEW_POLICY_MAX_BYTES);
  assertCode(() => parseReviewPolicy(oversized, context()), 'POLICY_TOO_LARGE');
});

const invalidContexts: ReadonlyArray<[Partial<ReviewPolicyContext>, string]> = [
  [{ projectId: '' }, 'blank projectId'],
  [{ projectId: '   ' }, 'whitespace-only projectId'],
  [{ filePath: '' }, 'blank filePath'],
  [{ projectId: 123 as unknown as string }, 'non-string projectId'],
  [{ filePath: null as unknown as string }, 'null filePath'],
];

for (const [overrides, label] of invalidContexts) {
  test(`parseReviewPolicy rejects ${label} as POLICY_CONTEXT_INVALID`, () => {
    assertCode(() => parseReviewPolicy(validYaml(), context(overrides)), 'POLICY_CONTEXT_INVALID');
  });
}

test('parseReviewPolicy preserves the supplied valid context on both success and failure', () => {
  const ctx = context({ projectId: 'preserved-project', filePath: '/synthetic/path/review-thresholds.yml' });
  const error = policyError(() => parseReviewPolicy('not: [valid\n', ctx));
  assert.equal(error.projectId, ctx.projectId);
  assert.equal(error.filePath, ctx.filePath);
});

test('every ReviewPolicyError carries a nonempty correctiveAction', () => {
  const errors = [
    policyError(() => parseReviewPolicy('not: [valid\n', context())),
    policyError(() => parseReviewPolicy(validYaml({ planningAvg: 0 }), context())),
    policyError(() => parseReviewPolicy(validYaml({ schemaVersion: 2 }), context())),
    policyError(() => parseReviewPolicy(validYaml(), context({ projectId: '' }))),
  ];
  for (const error of errors) {
    assert.equal(typeof error.correctiveAction, 'string');
    assert.ok(error.correctiveAction.length > 0);
  }
});

test('ReviewPolicyError never leaks source text, YAML snippets or attacker-controlled key names', () => {
  const secretScalar = 'sk-super-secret-should-not-leak';
  const attackerKey = 'x-attacker-controlled-unknown-key';
  const text = `${validYaml()}${attackerKey}: "${secretScalar}"\n`;
  const error = assertCode(() => parseReviewPolicy(text, context()), 'POLICY_INVALID', '$');
  const serialized = `${error.message}\n${JSON.stringify(error)}`;
  assert.ok(!serialized.includes(secretScalar), 'must not leak secret-looking scalar values');
  assert.ok(!serialized.includes(attackerKey), 'must not leak attacker-controlled unknown key names');
});
