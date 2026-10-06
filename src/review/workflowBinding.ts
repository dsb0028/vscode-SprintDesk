/**
 * Canonical workflow-stage binding: a small, strictly validated, versioned identity record
 * that ties a piece of produced work to an exact stage/task/criterion/source/policy
 * combination. This module proves field-for-field consistency only; it never proves source
 * existence, authorization, semantic judgment, or human approval, and it never renames or
 * replaces any signed review receipt.
 */

export const WORKFLOW_STAGES = ['planning', 'translation', 'test_code', 'evidence'] as const;

export type WorkflowStage = typeof WORKFLOW_STAGES[number];

// A type alias (not an interface) so a plain unknown-value index cast remains structurally
// sound for callers and tests that need to inspect/delete fields generically by name; fields
// are intentionally not marked `readonly` here because TypeScript readonly is a caller-side
// authoring convenience only — true immutability of parsed results is enforced at runtime via
// `Object.freeze`, never by this type alone.
export type WorkflowBinding = {
  version: 1;
  stage: WorkflowStage;
  projectId: string;
  taskId: string;
  incarnation: string;
  criterionId: string;
  criterionRevision: string;
  sourceRevision: string;
  sourceDigest: string;
  policyDigest: string;
  attemptId: string;
};

export type WorkflowBindingErrorCode = 'BINDING_INVALID' | 'BINDING_VERSION_UNSUPPORTED' | 'BINDING_MISMATCH';

export class WorkflowBindingError extends Error {
  readonly code: WorkflowBindingErrorCode;
  readonly field: string;

  constructor(code: WorkflowBindingErrorCode, field: string, message: string) {
    super(message);
    this.name = 'WorkflowBindingError';
    this.code = code;
    this.field = field;
    Object.setPrototypeOf(this, WorkflowBindingError.prototype);
  }
}

const STRING_FIELDS = [
  'projectId', 'taskId', 'incarnation', 'criterionId', 'criterionRevision', 'sourceRevision', 'attemptId',
] as const;

const DIGEST_FIELDS = ['sourceDigest', 'policyDigest'] as const;

// Built explicitly (not derived) so the known-field set is easy to audit independently of the
// field-group constants above.
const KNOWN_FIELD_SET: ReadonlySet<string> = new Set([
  'version', 'stage', 'projectId', 'taskId', 'incarnation', 'criterionId',
  'criterionRevision', 'sourceRevision', 'sourceDigest', 'policyDigest', 'attemptId',
]);

const HEX_64 = /^[0-9a-f]{64}$/;
const MAX_STRING_UNITS = 256;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype;
}

function isNonBlankBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_STRING_UNITS;
}

function isHex64(value: unknown): value is string {
  return typeof value === 'string' && HEX_64.test(value);
}

function isWorkflowStage(value: string): value is WorkflowStage {
  return (WORKFLOW_STAGES as readonly string[]).includes(value);
}

function fail(code: WorkflowBindingErrorCode, field: string, message: string): never {
  throw new WorkflowBindingError(code, field, message);
}

export function parseWorkflowBinding(value: unknown): WorkflowBinding {
  if (!isPlainObject(value)) {
    fail('BINDING_INVALID', '$', 'Workflow binding must be a plain object.');
  }

  for (const key of Object.keys(value)) {
    if (!KNOWN_FIELD_SET.has(key)) {
      fail('BINDING_INVALID', '$', 'Workflow binding contains an unrecognized field.');
    }
  }

  if (!('version' in value)) {
    fail('BINDING_INVALID', 'version', 'Workflow binding is missing required field "version".');
  }
  const version = value.version;
  if (typeof version !== 'number') {
    fail('BINDING_INVALID', 'version', 'Workflow binding field "version" must be a number.');
  }
  if (version !== 1) {
    fail('BINDING_VERSION_UNSUPPORTED', 'version', 'Workflow binding version is not supported.');
  }

  if (!('stage' in value)) {
    fail('BINDING_INVALID', 'stage', 'Workflow binding is missing required field "stage".');
  }
  const stage = value.stage;
  if (typeof stage !== 'string' || !isWorkflowStage(stage)) {
    fail('BINDING_INVALID', 'stage', 'Workflow binding field "stage" must be one of the known workflow stages.');
  }

  for (const field of STRING_FIELDS) {
    if (!(field in value)) {
      fail('BINDING_INVALID', field, `Workflow binding is missing required field "${field}".`);
    }
    if (!isNonBlankBoundedString(value[field])) {
      fail('BINDING_INVALID', field,
        `Workflow binding field "${field}" must be a nonblank string of at most ${MAX_STRING_UNITS} UTF-16 code units.`);
    }
  }

  for (const field of DIGEST_FIELDS) {
    if (!(field in value)) {
      fail('BINDING_INVALID', field, `Workflow binding is missing required field "${field}".`);
    }
    if (!isHex64(value[field])) {
      fail('BINDING_INVALID', field, `Workflow binding field "${field}" must be exactly 64 lowercase hexadecimal characters.`);
    }
  }

  return Object.freeze({
    version: 1 as const,
    stage,
    projectId: value.projectId as string,
    taskId: value.taskId as string,
    incarnation: value.incarnation as string,
    criterionId: value.criterionId as string,
    criterionRevision: value.criterionRevision as string,
    sourceRevision: value.sourceRevision as string,
    sourceDigest: value.sourceDigest as string,
    policyDigest: value.policyDigest as string,
    attemptId: value.attemptId as string,
  });
}

const COMPARE_FIELDS: readonly (keyof WorkflowBinding)[] = [
  'stage', 'projectId', 'taskId', 'incarnation', 'criterionId',
  'criterionRevision', 'sourceRevision', 'sourceDigest', 'policyDigest', 'attemptId',
];

export function assertWorkflowBinding(actual: unknown, expected: WorkflowBinding): WorkflowBinding {
  const parsedActual = parseWorkflowBinding(actual);
  const parsedExpected = parseWorkflowBinding(expected);

  for (const field of COMPARE_FIELDS) {
    if (parsedActual[field] !== parsedExpected[field]) {
      fail('BINDING_MISMATCH', field, `Workflow binding field "${field}" does not match the expected value.`);
    }
  }

  return parsedExpected;
}
