import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WORKFLOW_STAGES, WorkflowBinding, WorkflowBindingError,
  parseWorkflowBinding, assertWorkflowBinding,
} from './workflowBinding';

const HEX64_A = 'a'.repeat(64);
const HEX64_B = 'b'.repeat(64);
const LONG_256 = 'x'.repeat(256);
const LONG_257 = 'x'.repeat(257);

/**
 * All WorkflowBinding fields are plain string keys; this alias pins that down explicitly
 * so field-name tables type-check as `string` even while the real interface is unresolved
 * (an unresolved import widens to `any`, and `keyof any` includes `symbol`, which would
 * otherwise make template-literal and index usages below fail to compile).
 */
type BindingFieldKey = Extract<keyof WorkflowBinding, string>;


function validBinding(overrides: Partial<WorkflowBinding> = {}): WorkflowBinding {
  return {
    version: 1,
    stage: 'planning',
    projectId: 'project-1',
    taskId: 'task-1',
    incarnation: 'incarnation-1',
    criterionId: 'criterion-1',
    criterionRevision: 'rev-1',
    sourceRevision: 'src-rev-1',
    sourceDigest: HEX64_A,
    policyDigest: HEX64_B,
    attemptId: 'attempt-1',
    ...overrides,
  } as WorkflowBinding;
}

function bindingError(operation: () => unknown): WorkflowBindingError {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof WorkflowBindingError,
      `expected a WorkflowBindingError, received ${String(error)}`);
    return error as WorkflowBindingError;
  }
  throw new Error('Expected operation to throw');
}

function assertCode(operation: () => unknown, code: string, field?: string): WorkflowBindingError {
  const error = bindingError(operation);
  assert.equal(error.code, code, `expected code ${code}, received ${error.code}`);
  if (field !== undefined) {
    assert.equal(error.field, field, `expected field ${field}, received ${error.field}`);
  }
  return error;
}

test('WORKFLOW_STAGES is the exact canonical four-stage tuple', () => {
  assert.deepEqual(WORKFLOW_STAGES, ['planning', 'translation', 'test_code', 'evidence']);
  assert.equal(WORKFLOW_STAGES.length, 4);
});

test('parseWorkflowBinding accepts a fully valid binding and returns an immutable copy', () => {
  const input = validBinding();
  const result = parseWorkflowBinding(input);
  assert.deepEqual(result, input);
  assert.notEqual(result, input, 'result must be a copy, not the same reference');
  assert.ok(Object.isFrozen(result), 'returned binding must be frozen/immutable');
  assert.equal(Object.isFrozen(input), false, 'caller input must not be frozen as a side effect');
  input.projectId = 'mutated-after-parse';
  assert.equal(result.projectId, 'project-1', 'result must not observe later mutation of caller input');
  assert.throws(() => { (result as { projectId: string }).projectId = 'blocked'; });
});

test('parseWorkflowBinding accepts every exact stage name and the 256-unit boundary length', () => {
  for (const stage of WORKFLOW_STAGES) {
    const result = parseWorkflowBinding(validBinding({ stage }));
    assert.equal(result.stage, stage);
  }
  const atBoundary = parseWorkflowBinding(validBinding({ projectId: LONG_256 }));
  assert.equal(atBoundary.projectId.length, 256);
});

test('parseWorkflowBinding rejects a null, array or exotic-prototype root as BINDING_INVALID with field "$"', () => {
  assertCode(() => parseWorkflowBinding(null), 'BINDING_INVALID', '$');
  assertCode(() => parseWorkflowBinding(undefined), 'BINDING_INVALID', '$');
  assertCode(() => parseWorkflowBinding([validBinding()]), 'BINDING_INVALID', '$');
  assertCode(() => parseWorkflowBinding('not-an-object'), 'BINDING_INVALID', '$');
  assertCode(() => parseWorkflowBinding(42), 'BINDING_INVALID', '$');
  assertCode(() => parseWorkflowBinding(Object.create(null)), 'BINDING_INVALID', '$');
  class Exotic {}
  assertCode(() => parseWorkflowBinding(Object.assign(new Exotic(), validBinding())), 'BINDING_INVALID', '$');
});

test('parseWorkflowBinding rejects an unknown extra field as BINDING_INVALID', () => {
  assertCode(() => parseWorkflowBinding({ ...validBinding(), extra: 'nope' }), 'BINDING_INVALID');
});

const requiredFields: ReadonlyArray<BindingFieldKey> = [
  'version', 'stage', 'projectId', 'taskId', 'incarnation', 'criterionId',
  'criterionRevision', 'sourceRevision', 'sourceDigest', 'policyDigest', 'attemptId',
];

for (const field of requiredFields) {
  test(`parseWorkflowBinding rejects a missing "${field}" as BINDING_INVALID`, () => {
    const binding = validBinding();
    delete (binding as Record<string, unknown>)[field];
    assertCode(() => parseWorkflowBinding(binding), 'BINDING_INVALID', field);
  });
}

const stringFieldRejections: ReadonlyArray<[BindingFieldKey, unknown, string]> = [
  ['projectId', '', 'blank string'],
  ['projectId', '   ', 'whitespace-only string'],
  ['projectId', LONG_257, 'string exceeding 256 UTF-16 units'],
  ['projectId', 123, 'numeric value'],
  ['projectId', null, 'null value'],
  ['projectId', true, 'boolean value'],
  ['taskId', '', 'blank string'],
  ['incarnation', '', 'blank string'],
  ['criterionId', '', 'blank string'],
  ['criterionRevision', '', 'blank string'],
  ['sourceRevision', '', 'blank string'],
  ['attemptId', '', 'blank string'],
];

for (const [field, value, label] of stringFieldRejections) {
  test(`parseWorkflowBinding rejects "${field}" set to a ${label}`, () => {
    assertCode(() => parseWorkflowBinding(validBinding({ [field]: value } as Partial<WorkflowBinding>)),
      'BINDING_INVALID', field);
  });
}

const digestFieldRejections: ReadonlyArray<[BindingFieldKey, unknown, string]> = [
  ['sourceDigest', 'a'.repeat(63), '63-character digest'],
  ['sourceDigest', 'a'.repeat(65), '65-character digest'],
  ['sourceDigest', 'A'.repeat(64), 'uppercase hex digest'],
  ['sourceDigest', `${'a'.repeat(63)}g`, 'non-hexadecimal character'],
  ['sourceDigest', 123, 'non-string digest'],
  ['policyDigest', 'a'.repeat(63), '63-character digest'],
  ['policyDigest', 'A'.repeat(64), 'uppercase hex digest'],
];

for (const [field, value, label] of digestFieldRejections) {
  test(`parseWorkflowBinding rejects "${field}" as a ${label}`, () => {
    assertCode(() => parseWorkflowBinding(validBinding({ [field]: value } as Partial<WorkflowBinding>)),
      'BINDING_INVALID', field);
  });
}

test('parseWorkflowBinding rejects an unrecognized stage value as BINDING_INVALID', () => {
  assertCode(() => parseWorkflowBinding(validBinding({ stage: 'bogus-stage' as never })),
    'BINDING_INVALID', 'stage');
});

const versionRejections: ReadonlyArray<[unknown, string, string]> = [
  [2, 'BINDING_VERSION_UNSUPPORTED', 'the next numeric version'],
  [0, 'BINDING_VERSION_UNSUPPORTED', 'version zero'],
  [1.5, 'BINDING_VERSION_UNSUPPORTED', 'a fractional version'],
  ['1', 'BINDING_INVALID', 'a string version'],
  [null, 'BINDING_INVALID', 'a null version'],
  [true, 'BINDING_INVALID', 'a boolean version'],
];

for (const [value, code, label] of versionRejections) {
  test(`parseWorkflowBinding rejects ${label} with ${code}`, () => {
    assertCode(() => parseWorkflowBinding(validBinding({ version: value as never })), code, 'version');
  });
}

test('parseWorkflowBinding error never echoes the submitted invalid value', () => {
  const secret = 'SUBMITTED-SECRET-MARKER-VALUE';
  // The marker alone (29 code units) is a valid projectId under the 256-unit cap, so it would
  // never be rejected. Pad it to 257 UTF-16 code units (one past the contract-fixed boundary)
  // so the value is actually invalid while still containing the marker, and assert that the
  // marker is never echoed in the resulting rejection.
  const overlongWithSecret = `${secret}${'x'.repeat(257 - secret.length)}`;
  assert.equal(overlongWithSecret.length, 257);
  const error = bindingError(() => parseWorkflowBinding(validBinding({ projectId: overlongWithSecret })));
  assert.equal(error.field, 'projectId');
  assert.ok(!error.message.includes(secret), 'message must not leak the submitted value');
  assert.ok(!JSON.stringify(error).includes(secret), 'serialized error must not leak the submitted value');
});

test('assertWorkflowBinding accepts a matching actual/expected pair and returns an immutable copy', () => {
  const expected = validBinding();
  const actual = validBinding();
  const result = assertWorkflowBinding(actual, expected);
  assert.deepEqual(result, expected);
  assert.ok(Object.isFrozen(result));
});

const mismatchFields: ReadonlyArray<BindingFieldKey> = [
  'stage', 'projectId', 'taskId', 'incarnation', 'criterionId',
  'criterionRevision', 'sourceRevision', 'sourceDigest', 'policyDigest', 'attemptId',
];

for (const field of mismatchFields) {
  test(`assertWorkflowBinding rejects a mismatched "${field}" (stale/foreign/reordered) as BINDING_MISMATCH`, () => {
    const expected = validBinding();
    const differing = field === 'stage'
      ? 'translation'
      : field === 'sourceDigest' || field === 'policyDigest'
        ? 'f'.repeat(64)
        : `${expected[field]}-different`;
    const actual = validBinding({ [field]: differing } as Partial<WorkflowBinding>);
    assertCode(() => assertWorkflowBinding(actual, expected), 'BINDING_MISMATCH', field);
  });
}

test('assertWorkflowBinding rejects an invalid expected binding as BINDING_INVALID, not a mismatch', () => {
  const actual = validBinding();
  assertCode(() => assertWorkflowBinding(actual, { ...actual, projectId: '' }), 'BINDING_INVALID', 'projectId');
  assertCode(() => assertWorkflowBinding(actual, null as never), 'BINDING_INVALID', '$');
});

test('assertWorkflowBinding rejects an invalid actual binding (version/type/shape) before any comparison', () => {
  const expected = validBinding();
  assertCode(() => assertWorkflowBinding(null, expected), 'BINDING_INVALID', '$');
  assertCode(() => assertWorkflowBinding(validBinding({ version: 9 as never }), expected),
    'BINDING_VERSION_UNSUPPORTED', 'version');
  assertCode(() => assertWorkflowBinding({ ...expected, projectId: 42 as never }, expected),
    'BINDING_INVALID', 'projectId');
});

test('assertWorkflowBinding does not mutate the caller-supplied actual or expected inputs', () => {
  const expected = validBinding();
  const actual = validBinding();
  const expectedSnapshot = { ...expected };
  const actualSnapshot = { ...actual };
  assertWorkflowBinding(actual, expected);
  assert.deepEqual(expected, expectedSnapshot);
  assert.deepEqual(actual, actualSnapshot);
  assert.equal(Object.isFrozen(expected), false);
  assert.equal(Object.isFrozen(actual), false);
});
