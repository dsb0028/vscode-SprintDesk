/**
 * Strict, data-only parser and in-memory model for the four-profile numerical review policy
 * (`.SprintDesk/settings/review-thresholds.yml`). This layer only parses numerical thresholds;
 * it cannot weaken any semantic hard-failure gate and does not define human authority. It
 * intentionally has no `max_agent_invocations` / `max_production_attempts` fields or limits.
 */

import * as yaml from 'js-yaml';

export const REVIEW_POLICY_MAX_BYTES = 65536;

/**
 * Canonical review-policy wire field keys, defined once and reused for every typed
 * representation and constructed object below so the required YAML snake_case keys never
 * need to be restated as separate (lint-flagged) identifiers; each type is built from mapped
 * `Record` types over these literal key constants, and every value is constructed with a
 * matching computed property name.
 */
const FIELD = {
  minimumAverage: 'minimum_average',
  minimumDimension: 'minimum_dimension',
  maxRefinementCycles: 'max_refinement_cycles',
  minimumScore: 'minimum_score',
  schemaVersion: 'schema_version',
  testCode: 'test_code',
  evidenceValidator: 'evidence_validator',
} as const;

export type ReviewerProfile = Readonly<Record<
  typeof FIELD.minimumAverage | typeof FIELD.minimumDimension | typeof FIELD.maxRefinementCycles,
  number
>>;

export type EvidenceValidatorProfile = Readonly<Record<
  typeof FIELD.minimumScore | typeof FIELD.maxRefinementCycles,
  number
>>;

type ReviewPolicyReviewers = Readonly<
  Record<'planning' | 'translation', ReviewerProfile> & Record<typeof FIELD.testCode, ReviewerProfile>
>;

export type ReviewPolicy = Readonly<
  Record<typeof FIELD.schemaVersion, 1> &
  Record<'reviewers', ReviewPolicyReviewers> &
  Record<typeof FIELD.evidenceValidator, EvidenceValidatorProfile>
>;

export interface ReviewPolicyContext {
  readonly projectId: string;
  readonly filePath: string;
}

export type ReviewPolicyErrorCode =
  | 'POLICY_MALFORMED'
  | 'POLICY_VERSION_UNSUPPORTED'
  | 'POLICY_INVALID'
  | 'POLICY_TOO_LARGE'
  | 'POLICY_CONTEXT_INVALID'
  | 'POLICY_FILE_MISSING'
  | 'POLICY_UNREADABLE'
  | 'POLICY_PATH_INVALID'
  | 'POLICY_ENCODING_INVALID'
  | 'POLICY_CHANGED';

export interface ReviewPolicyErrorOptions {
  readonly code: ReviewPolicyErrorCode;
  readonly message: string;
  readonly operation: string;
  readonly correctiveAction: string;
  readonly projectId?: string;
  readonly filePath?: string;
  readonly field?: string;
  readonly line?: number;
  readonly column?: number;
}

export class ReviewPolicyError extends Error {
  readonly code: ReviewPolicyErrorCode;
  readonly operation: string;
  readonly correctiveAction: string;
  readonly projectId: string;
  readonly filePath: string;
  /**
   * Always present: a known dotted schema path (e.g. `reviewers.planning.minimum_average`)
   * when one is known, or the literal sentinel `'$'` when no specific schema field applies
   * (context errors, read-boundary errors, whole-document malformed-YAML errors, etc.).
   */
  readonly field: string;
  readonly line?: number;
  readonly column?: number;

  constructor(options: ReviewPolicyErrorOptions) {
    super(options.message);
    this.name = 'ReviewPolicyError';
    this.code = options.code;
    this.operation = options.operation;
    this.correctiveAction = options.correctiveAction;
    this.projectId = options.projectId ?? '';
    this.filePath = options.filePath ?? '';
    this.field = options.field ?? '$';
    if (options.line !== undefined) {
      this.line = options.line;
    }
    if (options.column !== undefined) {
      this.column = options.column;
    }
    Object.setPrototypeOf(this, ReviewPolicyError.prototype);
  }
}

interface NormalizedContext {
  readonly projectId: string;
  readonly filePath: string;
}

function rawContextValues(context: ReviewPolicyContext): { projectId?: string; filePath?: string } {
  const result: { projectId?: string; filePath?: string } = {};
  if (typeof context?.projectId === 'string') {
    result.projectId = context.projectId;
  }
  if (typeof context?.filePath === 'string') {
    result.filePath = context.filePath;
  }
  return result;
}

function contextInvalid(context: ReviewPolicyContext, reason: string): never {
  const raw = rawContextValues(context);
  throw new ReviewPolicyError({
    code: 'POLICY_CONTEXT_INVALID',
    message: reason,
    operation: 'context',
    correctiveAction: 'Supply a nonblank projectId and a nonblank filePath for the review policy context.',
    projectId: raw.projectId,
    filePath: raw.filePath,
  });
}

function validateContext(context: ReviewPolicyContext): NormalizedContext {
  if (typeof context?.projectId !== 'string' || context.projectId.trim().length === 0) {
    contextInvalid(context, 'Review policy context requires a nonblank projectId.');
  }
  if (typeof context?.filePath !== 'string' || context.filePath.trim().length === 0) {
    contextInvalid(context, 'Review policy context requires a nonblank filePath.');
  }
  return { projectId: context.projectId, filePath: context.filePath };
}

function invalid(field: string, ctx: NormalizedContext, message: string): never {
  throw new ReviewPolicyError({
    code: 'POLICY_INVALID',
    message,
    operation: 'parse',
    correctiveAction: 'Correct the identified field to match the required review policy schema.',
    projectId: ctx.projectId,
    filePath: ctx.filePath,
    field,
  });
}

function versionUnsupported(field: string, ctx: NormalizedContext): never {
  throw new ReviewPolicyError({
    code: 'POLICY_VERSION_UNSUPPORTED',
    message: 'Review policy schema_version is not supported.',
    operation: 'parse',
    correctiveAction: 'Use a supported review policy schema_version.',
    projectId: ctx.projectId,
    filePath: ctx.filePath,
    field,
  });
}

function tooLarge(ctx: NormalizedContext): never {
  throw new ReviewPolicyError({
    code: 'POLICY_TOO_LARGE',
    message: `Review policy text exceeds the maximum allowed size of ${REVIEW_POLICY_MAX_BYTES} bytes.`,
    operation: 'parse',
    correctiveAction: `Reduce the review policy file to at most ${REVIEW_POLICY_MAX_BYTES} bytes.`,
    projectId: ctx.projectId,
    filePath: ctx.filePath,
  });
}

function malformed(ctx: NormalizedContext, line?: number, column?: number): never {
  throw new ReviewPolicyError({
    code: 'POLICY_MALFORMED',
    message: 'Review policy contains malformed YAML.',
    operation: 'parse',
    correctiveAction: 'Fix the YAML syntax of the review policy file (single well-formed document, unique keys, no custom tags).',
    projectId: ctx.projectId,
    filePath: ctx.filePath,
    line,
    column,
  });
}

function requirePlainObject(value: unknown, path: string, ctx: NormalizedContext): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    invalid(path, ctx, `Review policy field "${path}" must be a mapping.`);
  }
  return value as Record<string, unknown>;
}

function fieldPath(parent: string, key: string): string {
  return parent === '$' ? key : `${parent}.${key}`;
}

function checkUnknownKeys(node: Record<string, unknown>, knownKeys: readonly string[], path: string, ctx: NormalizedContext): void {
  for (const key of Object.keys(node)) {
    if (!knownKeys.includes(key)) {
      invalid(path, ctx, `Review policy contains an unrecognized key within "${path}".`);
    }
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isAverage(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 1 && value <= 5;
}

function isDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

function isScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100;
}

function isCycles(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function requireValidated(
  node: Record<string, unknown>,
  key: string,
  path: string,
  predicate: (value: unknown) => value is number,
  ctx: NormalizedContext,
  message: string,
): number {
  const full = fieldPath(path, key);
  if (!(key in node)) {
    invalid(full, ctx, `Review policy is missing required field "${full}".`);
  }
  const value = node[key];
  if (!predicate(value)) {
    invalid(full, ctx, message);
  }
  return value;
}

function parseProfile(
  parent: Record<string, unknown>,
  key: string,
  path: string,
  ctx: NormalizedContext,
): ReviewerProfile {
  if (!(key in parent)) {
    invalid(path, ctx, `Review policy is missing required section "${path}".`);
  }
  const node = requirePlainObject(parent[key], path, ctx);
  checkUnknownKeys(node, ['minimum_average', 'minimum_dimension', 'max_refinement_cycles'], path, ctx);
  const minimumAverage = requireValidated(node, 'minimum_average', path, isAverage, ctx,
    `Review policy field "${fieldPath(path, 'minimum_average')}" must be a finite number from 1 through 5 inclusive.`);
  const minimumDimension = requireValidated(node, 'minimum_dimension', path, isDimension, ctx,
    `Review policy field "${fieldPath(path, 'minimum_dimension')}" must be an integer from 1 through 5 inclusive.`);
  const maxRefinementCycles = requireValidated(node, 'max_refinement_cycles', path, isCycles, ctx,
    `Review policy field "${fieldPath(path, 'max_refinement_cycles')}" must be a nonnegative safe integer.`);
  return {
    [FIELD.minimumAverage]: minimumAverage,
    [FIELD.minimumDimension]: minimumDimension,
    [FIELD.maxRefinementCycles]: maxRefinementCycles,
  };
}

function parseStructured(root: unknown, ctx: NormalizedContext): ReviewPolicy {
  const rootObj = requirePlainObject(root, '$', ctx);
  checkUnknownKeys(rootObj, ['schema_version', 'reviewers', 'evidence_validator'], '$', ctx);

  if (!('schema_version' in rootObj)) {
    invalid('schema_version', ctx, 'Review policy is missing required field "schema_version".');
  }
  const schemaVersion = rootObj.schema_version;
  if (typeof schemaVersion !== 'number' || !Number.isFinite(schemaVersion)) {
    invalid('schema_version', ctx, 'Review policy field "schema_version" must be a number.');
  }
  if (schemaVersion !== 1) {
    versionUnsupported('schema_version', ctx);
  }

  if (!('reviewers' in rootObj)) {
    invalid('reviewers', ctx, 'Review policy is missing required field "reviewers".');
  }
  const reviewersObj = requirePlainObject(rootObj.reviewers, 'reviewers', ctx);
  checkUnknownKeys(reviewersObj, ['planning', 'translation', 'test_code'], 'reviewers', ctx);

  const planning = parseProfile(reviewersObj, 'planning', 'reviewers.planning', ctx);
  const translation = parseProfile(reviewersObj, 'translation', 'reviewers.translation', ctx);
  const testCode = parseProfile(reviewersObj, 'test_code', 'reviewers.test_code', ctx);

  if (!('evidence_validator' in rootObj)) {
    invalid('evidence_validator', ctx, 'Review policy is missing required field "evidence_validator".');
  }
  const evidenceObj = requirePlainObject(rootObj.evidence_validator, 'evidence_validator', ctx);
  checkUnknownKeys(evidenceObj, ['minimum_score', 'max_refinement_cycles'], 'evidence_validator', ctx);
  const minimumScore = requireValidated(evidenceObj, 'minimum_score', 'evidence_validator', isScore, ctx,
    'Review policy field "evidence_validator.minimum_score" must be an integer from 1 through 100 inclusive.');
  const maxRefinementCycles = requireValidated(evidenceObj, 'max_refinement_cycles', 'evidence_validator', isCycles, ctx,
    'Review policy field "evidence_validator.max_refinement_cycles" must be a nonnegative safe integer.');

  return Object.freeze({
    [FIELD.schemaVersion]: 1 as const,
    reviewers: Object.freeze({
      planning: Object.freeze(planning),
      translation: Object.freeze(translation),
      [FIELD.testCode]: Object.freeze(testCode),
    }),
    [FIELD.evidenceValidator]: Object.freeze({
      [FIELD.minimumScore]: minimumScore,
      [FIELD.maxRefinementCycles]: maxRefinementCycles,
    }),
  });
}

function loadYamlDocument(text: string, ctx: NormalizedContext): unknown {
  try {
    return yaml.load(text, { schema: yaml.JSON_SCHEMA });
  } catch (error) {
    if (error instanceof yaml.YAMLException) {
      const mark = (error as { mark?: { line: number; column: number } }).mark;
      const line = mark && Number.isInteger(mark.line) ? mark.line + 1 : undefined;
      const column = mark && Number.isInteger(mark.column) ? mark.column + 1 : undefined;
      malformed(ctx, line, column);
    }
    throw error;
  }
}

export function parseReviewPolicy(text: string, context: ReviewPolicyContext): ReviewPolicy {
  const ctx = validateContext(context);
  if (Buffer.byteLength(text, 'utf8') > REVIEW_POLICY_MAX_BYTES) {
    tooLarge(ctx);
  }
  const parsed = loadYamlDocument(text, ctx);
  return parseStructured(parsed, ctx);
}

const DEFAULT_REVIEWER_AVERAGE = 4;
const DEFAULT_REVIEWER_DIMENSION = 3;
const DEFAULT_REVIEWER_CYCLES = 3;
const DEFAULT_EVIDENCE_SCORE = 85;
const DEFAULT_EVIDENCE_CYCLES = 3;

function defaultProfile(): ReviewerProfile {
  return Object.freeze({
    [FIELD.minimumAverage]: DEFAULT_REVIEWER_AVERAGE,
    [FIELD.minimumDimension]: DEFAULT_REVIEWER_DIMENSION,
    [FIELD.maxRefinementCycles]: DEFAULT_REVIEWER_CYCLES,
  });
}

export function getDefaultReviewPolicy(): ReviewPolicy {
  return Object.freeze({
    [FIELD.schemaVersion]: 1 as const,
    reviewers: Object.freeze({
      planning: defaultProfile(),
      translation: defaultProfile(),
      [FIELD.testCode]: defaultProfile(),
    }),
    [FIELD.evidenceValidator]: Object.freeze({
      [FIELD.minimumScore]: DEFAULT_EVIDENCE_SCORE,
      [FIELD.maxRefinementCycles]: DEFAULT_EVIDENCE_CYCLES,
    }),
  });
}

export function renderDefaultReviewPolicy(): string {
  return `schema_version: 1
reviewers:
  planning:
    minimum_average: ${DEFAULT_REVIEWER_AVERAGE}
    minimum_dimension: ${DEFAULT_REVIEWER_DIMENSION}
    max_refinement_cycles: ${DEFAULT_REVIEWER_CYCLES}
  translation:
    minimum_average: ${DEFAULT_REVIEWER_AVERAGE}
    minimum_dimension: ${DEFAULT_REVIEWER_DIMENSION}
    max_refinement_cycles: ${DEFAULT_REVIEWER_CYCLES}
  test_code:
    minimum_average: ${DEFAULT_REVIEWER_AVERAGE}
    minimum_dimension: ${DEFAULT_REVIEWER_DIMENSION}
    max_refinement_cycles: ${DEFAULT_REVIEWER_CYCLES}
evidence_validator:
  minimum_score: ${DEFAULT_EVIDENCE_SCORE}
  max_refinement_cycles: ${DEFAULT_EVIDENCE_CYCLES}
`;
}
