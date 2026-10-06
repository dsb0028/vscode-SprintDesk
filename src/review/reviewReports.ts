/**
 * Strict stage-specific review report schema parser. Validates exact JSON-text review reports
 * against the canonical stage rubric (reviewRubrics.ts) and the shared workflow-binding/policy
 * helpers (workflowBinding.ts, reviewPolicy.ts), then mechanically cross-checks every supplied
 * computed field (sum/mean or rawTotal/effectiveScore and verdict) against the canonical
 * arithmetic in reviewVerdicts.ts. This module never selects a rating, never authenticates
 * evidence/consent and never certifies retained artifact bytes, source retrieval, authority or
 * human approval; it only proves internal schema/arithmetic consistency.
 */

import * as yaml from 'js-yaml';
import { ReviewPolicy, ReviewPolicyContext, ReviewPolicyError, parseReviewPolicy } from './reviewPolicy';
import { WorkflowBinding, assertWorkflowBinding } from './workflowBinding';
import { ReviewRubric, getReviewRubric } from './reviewRubrics';
import { evaluateReviewReport } from './reviewVerdicts';

export const REVIEW_REPORT_MAX_BYTES = 262144;

export interface ReviewDimensionResult {
  readonly id: string;
  readonly rating: number;
  readonly rationale: string;
  readonly references: readonly string[];
}

export type ReviewFindingSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ReviewFindingDestination =
  | 'human' | 'scenario_writer' | 'translator' | 'test_writer' | 'production_implementer'
  | 'execution_capture' | 'collector' | 'infrastructure';

export interface ReviewFinding {
  readonly id: string;
  readonly obligation: string;
  readonly references: readonly string[];
  readonly mandatory: boolean;
  readonly severity: ReviewFindingSeverity;
  readonly destination: ReviewFindingDestination;
  readonly correction: string;
}

export type ReviewVerdict = 'QUALITY_VERIFIED' | 'CHANGES_REQUIRED' | 'BLOCKED';

interface ReviewReportCommon {
  readonly version: 1;
  readonly rubricId: string;
  readonly binding: WorkflowBinding;
  readonly artifactDigests: Readonly<Record<string, string>>;
  readonly dimensions: readonly ReviewDimensionResult[];
  readonly findings: readonly ReviewFinding[];
  readonly blockers: readonly string[];
  readonly verdict: ReviewVerdict;
}

export interface SixDimensionReviewReport extends ReviewReportCommon {
  readonly evaluation: 'scored';
  readonly sum: number;
  readonly mean: number;
}

export interface EvidenceScoredReviewReport extends ReviewReportCommon {
  readonly evaluation: 'scored';
  readonly rawTotal: number;
  readonly effectiveScore: number;
}

export interface EvidenceUnavailableReviewReport extends ReviewReportCommon {
  readonly evaluation: 'unavailable';
}

export type ReviewReport = SixDimensionReviewReport | EvidenceScoredReviewReport | EvidenceUnavailableReviewReport;

export type ReviewReportErrorCode =
  | 'REPORT_INVALID' | 'REPORT_MALFORMED' | 'REPORT_TOO_LARGE'
  | 'REPORT_VERSION_UNSUPPORTED' | 'REPORT_RUBRIC_MISMATCH' | 'REPORT_RESULT_MISMATCH';

export class ReviewReportError extends Error {
  readonly code: ReviewReportErrorCode;
  readonly field: string;

  constructor(code: ReviewReportErrorCode, field: string, message: string) {
    super(message);
    this.name = 'ReviewReportError';
    this.code = code;
    this.field = field;
    Object.setPrototypeOf(this, ReviewReportError.prototype);
  }
}

function fail(code: ReviewReportErrorCode, field: string, message: string): never {
  throw new ReviewReportError(code, field, message);
}

const MAX_RATIONALE_UNITS = 8192;
const MAX_REFERENCE_UNITS = 2048;
const MAX_FINDING_ID_UNITS = 256;
const MAX_ARRAY_ENTRIES = 100;

const HEX_64 = /^[0-9a-f]{64}$/;

const ARTIFACT_KEYS: ReadonlyMap<WorkflowBinding['stage'], readonly string[]> = new Map([
  ['planning', ['scenario']],
  ['translation', ['original', 'translation']],
  ['test_code', ['original', 'translation', 'tests', 'execution', 'inputs']],
  ['evidence', ['evidence', 'change']],
]);

const DIMENSION_FIELD_SET: ReadonlySet<string> = new Set(['id', 'rating', 'rationale', 'references']);
const FINDING_FIELD_SET: ReadonlySet<string> = new Set([
  'id', 'obligation', 'references', 'mandatory', 'severity', 'destination', 'correction',
]);
const SEVERITIES: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'critical']);
const DESTINATIONS: ReadonlySet<string> = new Set([
  'human', 'scenario_writer', 'translator', 'test_writer', 'production_implementer',
  'execution_capture', 'collector', 'infrastructure',
]);
const VERDICTS: ReadonlySet<string> = new Set(['QUALITY_VERIFIED', 'CHANGES_REQUIRED', 'BLOCKED']);

const BASE_TOP_FIELDS: readonly string[] = [
  'version', 'rubricId', 'binding', 'artifactDigests', 'dimensions', 'findings', 'blockers', 'verdict', 'evaluation',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype;
}

function isNonBlankBoundedString(value: unknown, maxUnits: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxUnits;
}

function isHex64(value: unknown): value is string {
  return typeof value === 'string' && HEX_64.test(value);
}

function validateUniqueReferenceArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ENTRIES) {
    fail('REPORT_INVALID', field, `Review report field "${field}" must be an array of at most ${MAX_ARRAY_ENTRIES} entries.`);
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (!isNonBlankBoundedString(entry, MAX_REFERENCE_UNITS)) {
      fail('REPORT_INVALID', field,
        `Review report field "${field}" entries must be nonblank strings of at most ${MAX_REFERENCE_UNITS} UTF-16 code units.`);
    }
    if (seen.has(entry)) {
      fail('REPORT_INVALID', field, `Review report field "${field}" must not contain duplicate entries.`);
    }
    seen.add(entry);
    result.push(entry);
  }
  return Object.freeze(result);
}

function validateRating(value: unknown, rubric: ReviewRubric, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)
    || value < rubric.ratingMinimum || value > rubric.ratingMaximum
    || (rubric.integerRatings && !Number.isInteger(value))) {
    fail('REPORT_INVALID', field,
      `Review report field "${field}" must be a valid rating for the rubric's dimension scale.`);
  }
  return value;
}

function validateDimensions(
  value: unknown,
  rubric: ReviewRubric,
  blockersLength: number,
): readonly ReviewDimensionResult[] {
  if (!Array.isArray(value) || value.length !== rubric.dimensions.length) {
    fail('REPORT_INVALID', 'dimensions',
      `Review report field "dimensions" must contain exactly ${rubric.dimensions.length} entries in canonical order.`);
  }
  const result: ReviewDimensionResult[] = [];
  for (const [index, canonicalDimension] of rubric.dimensions.entries()) {
    const entry = value[index];
    if (!isPlainObject(entry)) {
      fail('REPORT_INVALID', `dimensions[${index}]`, 'Review report dimension entry must be a plain object.');
    }
    for (const key of Object.keys(entry)) {
      if (!DIMENSION_FIELD_SET.has(key)) {
        fail('REPORT_INVALID', `dimensions[${index}]`, 'Review report dimension entry contains an unrecognized field.');
      }
    }
    if (entry.id !== canonicalDimension.id) {
      fail('REPORT_INVALID', `dimensions[${index}].id`,
        'Review report dimension id does not match the canonical rubric dimension id/order.');
    }
    const rating = validateRating(entry.rating, rubric, `dimensions[${index}].rating`);
    if (!isNonBlankBoundedString(entry.rationale, MAX_RATIONALE_UNITS)) {
      fail('REPORT_INVALID', `dimensions[${index}].rationale`,
        `Review report dimension rationale must be a nonblank string of at most ${MAX_RATIONALE_UNITS} UTF-16 code units.`);
    }
    const references = validateUniqueReferenceArray(entry.references, `dimensions[${index}].references`);
    if (references.length === 0 && blockersLength === 0) {
      fail('REPORT_INVALID', `dimensions[${index}].references`,
        'Review report dimension with missing support (empty references) requires an explicit report blocker.');
    }
    result.push(Object.freeze({ id: canonicalDimension.id, rating, rationale: entry.rationale, references }));
  }
  return Object.freeze(result);
}

function validateFindings(value: unknown): readonly ReviewFinding[] {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ENTRIES) {
    fail('REPORT_INVALID', 'findings', `Review report field "findings" must be an array of at most ${MAX_ARRAY_ENTRIES} entries.`);
  }
  const seenIds = new Set<string>();
  const result: ReviewFinding[] = [];
  for (const [index, entry] of value.entries()) {
    const field = `findings[${index}]`;
    if (!isPlainObject(entry)) {
      fail('REPORT_INVALID', field, 'Review report finding entry must be a plain object.');
    }
    for (const key of Object.keys(entry)) {
      if (!FINDING_FIELD_SET.has(key)) {
        fail('REPORT_INVALID', field, 'Review report finding entry contains an unrecognized field.');
      }
    }
    if (!isNonBlankBoundedString(entry.id, MAX_FINDING_ID_UNITS)) {
      fail('REPORT_INVALID', `${field}.id`,
        `Review report finding id must be a nonblank string of at most ${MAX_FINDING_ID_UNITS} UTF-16 code units.`);
    }
    if (seenIds.has(entry.id)) {
      fail('REPORT_INVALID', `${field}.id`, 'Review report finding ids must be unique.');
    }
    seenIds.add(entry.id);
    if (!isNonBlankBoundedString(entry.obligation, MAX_RATIONALE_UNITS)) {
      fail('REPORT_INVALID', `${field}.obligation`,
        `Review report finding obligation must be a nonblank string of at most ${MAX_RATIONALE_UNITS} UTF-16 code units.`);
    }
    const references = validateUniqueReferenceArray(entry.references, `${field}.references`);
    if (typeof entry.mandatory !== 'boolean') {
      fail('REPORT_INVALID', `${field}.mandatory`, 'Review report finding mandatory flag must be a boolean.');
    }
    if (typeof entry.severity !== 'string' || !SEVERITIES.has(entry.severity)) {
      fail('REPORT_INVALID', `${field}.severity`, 'Review report finding severity must be one of the known severities.');
    }
    if (typeof entry.destination !== 'string' || !DESTINATIONS.has(entry.destination)) {
      fail('REPORT_INVALID', `${field}.destination`, 'Review report finding destination must be one of the known destinations.');
    }
    if (!isNonBlankBoundedString(entry.correction, MAX_RATIONALE_UNITS)) {
      fail('REPORT_INVALID', `${field}.correction`,
        `Review report finding correction must be a nonblank string of at most ${MAX_RATIONALE_UNITS} UTF-16 code units.`);
    }
    result.push(Object.freeze({
      id: entry.id,
      obligation: entry.obligation,
      references,
      mandatory: entry.mandatory,
      severity: entry.severity as ReviewFindingSeverity,
      destination: entry.destination as ReviewFindingDestination,
      correction: entry.correction,
    }));
  }
  return Object.freeze(result);
}

function validateBlockers(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ENTRIES) {
    fail('REPORT_INVALID', 'blockers', `Review report field "blockers" must be an array of at most ${MAX_ARRAY_ENTRIES} entries.`);
  }
  const result: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      fail('REPORT_INVALID', `blockers[${index}]`, 'Review report blocker entries must be nonblank text.');
    }
    result.push(entry);
  }
  return Object.freeze(result);
}

function validateArtifactDigests(value: unknown, stage: WorkflowBinding['stage']): Readonly<Record<string, string>> {
  if (!isPlainObject(value)) {
    fail('REPORT_INVALID', 'artifactDigests', 'Review report field "artifactDigests" must be a plain object.');
  }
  const expectedKeys = ARTIFACT_KEYS.get(stage)!;
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== expectedKeys.length || !expectedKeys.every(key => key in value)) {
    fail('REPORT_INVALID', 'artifactDigests',
      'Review report field "artifactDigests" must contain exactly the stage-specific artifact key set.');
  }
  const result: Record<string, string> = {};
  for (const key of expectedKeys) {
    if (!isHex64(value[key])) {
      fail('REPORT_INVALID', `artifactDigests.${key}`,
        'Review report artifact digest must be exactly 64 lowercase hexadecimal characters.');
    }
    result[key] = value[key] as string;
  }
  return Object.freeze(result);
}

const POLICY_REVALIDATION_CONTEXT: ReviewPolicyContext = {
  projectId: 'review-report-policy-revalidation',
  filePath: 'synthetic://review-report-policy-revalidation',
};

/**
 * Maximum nesting depth walked while validating a supplied policy's shape before
 * re-serialization. A generous, explicit bound (not a tunable threshold/range decision -- this
 * never duplicates any reviewPolicy.ts numeric gate) so a deliberately deep or cyclic object
 * fails fast and explicitly instead of overflowing the call stack.
 */
const POLICY_SERIALIZATION_MAX_DEPTH = 32;

function policyShapeInvalid(): never {
  // Deliberately never includes the offending key name or value: the caller-supplied policy
  // content is untrusted and must never appear in a thrown error's message or serialized form.
  throw new ReviewPolicyError({
    code: 'POLICY_INVALID',
    message: 'Supplied review policy is not a JSON-compatible plain object/array/string/number/boolean/null shape.',
    operation: 'parse',
    correctiveAction: 'Supply a policy value built only from plain objects, arrays, finite numbers, strings, booleans and null, with no cyclic references.',
    projectId: POLICY_REVALIDATION_CONTEXT.projectId,
    filePath: POLICY_REVALIDATION_CONTEXT.filePath,
    field: '$',
  });
}

/**
 * Recursively confirms `value` is built only from JSON-compatible plain shapes (plain objects
 * with the `Object.prototype` prototype, arrays, finite numbers, strings, booleans, null),
 * contains no cyclic reference, and returns a freshly built, fully independent data-only deep
 * copy of it -- never the original object/array -- for the YAML serializer below to consume.
 *
 * This walk never reads a property through ordinary bracket/dot access (`value[key]`), which in
 * real JavaScript semantics *would* invoke an enumerable (or non-enumerable) accessor getter
 * defined via `Object.defineProperty`. Instead, every own string-keyed property is inspected
 * exclusively through its property *descriptor* (`Object.getOwnPropertyDescriptor`): a
 * descriptor with a `get`/`set` is rejected outright, by shape, without ever invoking it, and
 * only a plain data descriptor's already-present `.value` is read and recursed into. Arrays are
 * walked the same way, index by index via descriptor, so a value-controlled index getter on an
 * array cannot execute either. `toJSON` methods and any other function-valued field are likewise
 * never called -- a function-typed `.value` simply falls through to the final rejection branch.
 * An own `__proto__` key is treated as plain string-keyed data (copied via
 * `Object.defineProperty`, never bracket assignment) so it can never reach the `Object.prototype`
 * `__proto__` accessor and mutate the copy's prototype.
 *
 * Unsupported types (functions, symbols, bigint, Date, Map, Set, RegExp, class instances, etc.)
 * and cycles are rejected explicitly; there is no silent success-shaped `{}` fallback for a shape
 * this walk cannot represent. This is a data-shape boundary, not a sandbox: it assumes a trusted,
 * in-process caller and ordinary (non-Proxy) objects -- a `Proxy` can define arbitrary traps on
 * `Object.getOwnPropertyDescriptor`/`Object.keys`/`Object.getPrototypeOf` themselves and is out
 * of scope for this guarantee.
 */
function assertJsonCompatiblePolicyShape(value: unknown, depth: number, ancestors: Set<unknown>): unknown {
  if (depth > POLICY_SERIALIZATION_MAX_DEPTH) {
    policyShapeInvalid();
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      policyShapeInvalid();
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      policyShapeInvalid();
    }
    ancestors.add(value);
    const copy: unknown[] = [];
    const length = value.length;
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (descriptor && ('get' in descriptor || 'set' in descriptor)) {
        policyShapeInvalid();
      }
      copy.push(assertJsonCompatiblePolicyShape(descriptor ? descriptor.value : undefined, depth + 1, ancestors));
    }
    ancestors.delete(value);
    return copy;
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    if (ancestors.has(value)) {
      policyShapeInvalid();
    }
    ancestors.add(value);
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || 'get' in descriptor || 'set' in descriptor) {
        policyShapeInvalid();
      }
      const copiedValue = assertJsonCompatiblePolicyShape(descriptor.value, depth + 1, ancestors);
      // Defines the own data property directly rather than `copy[key] = copiedValue`: a bracket
      // assignment with key `"__proto__"` would invoke `Object.prototype`'s `__proto__` setter
      // and silently reassign the copy's prototype instead of creating an own data field.
      Object.defineProperty(copy, key, {
        value: copiedValue,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    ancestors.delete(value);
    return copy;
  }
  // Functions, symbols, bigint, undefined, Date/Map/Set/RegExp/class instances and any other
  // non-plain prototype land here and are rejected rather than silently coerced or dropped.
  policyShapeInvalid();
}

/**
 * Re-serializes the caller-supplied policy to strict JSON-compatible YAML, preserving every own
 * field at every nesting level -- including any field unknown to the canonical schema -- so the
 * reused `parseReviewPolicy` validator (never this module) remains the sole authority on which
 * fields are accepted or rejected. This never projects onto a known-fields-only shape (which
 * would silently drop an unrecognized/tampered key before validation ever saw it) and never
 * calls `JSON.stringify`/relies on a `toJSON` method, so a hostile `toJSON` can never execute.
 * Serializes the independent data-only copy built above -- never the caller's original policy
 * object -- so no later serializer step can observe or trigger any accessor/function left on the
 * original. Uses the same `JSON_SCHEMA` the canonical loader uses, so the dumped-then-reloaded
 * value round-trips exactly; any value this schema cannot faithfully represent (already excluded
 * by the shape check above) fails loudly here rather than being silently skipped.
 */
function serializePolicyForRevalidation(policy: ReviewPolicy): string {
  const dataOnlyCopy = assertJsonCompatiblePolicyShape(policy, 0, new Set());
  try {
    return yaml.dump(dataOnlyCopy, { schema: yaml.JSON_SCHEMA, noRefs: true, skipInvalid: false });
  } catch {
    // Never leak the underlying serializer error message/content; collapse to the same
    // generic, non-echoing shape-invalid rejection used above.
    policyShapeInvalid();
  }
}

/**
 * Re-validates the caller-supplied policy object through the existing canonical YAML parser
 * (never duplicating its threshold/range arithmetic) by rendering it to strict JSON-compatible
 * YAML with a synthetic non-secret context, then reusing `parseReviewPolicy`. A structurally
 * tampered policy (e.g. an out-of-range threshold) is rejected with its accurate `ReviewPolicyError`.
 */
function revalidatePolicy(policy: ReviewPolicy): ReviewPolicy {
  return parseReviewPolicy(serializePolicyForRevalidation(policy), POLICY_REVALIDATION_CONTEXT);
}

export function parseReviewReport(text: string, expected: WorkflowBinding, policy: ReviewPolicy): ReviewReport {
  if (Buffer.byteLength(text, 'utf8') > REVIEW_REPORT_MAX_BYTES) {
    fail('REPORT_TOO_LARGE', '$', `Review report text exceeds the maximum allowed size of ${REVIEW_REPORT_MAX_BYTES} bytes.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('REPORT_MALFORMED', '$', 'Review report text is not well-formed JSON.');
  }

  if (!isPlainObject(parsed)) {
    fail('REPORT_INVALID', '$', 'Review report must be a plain JSON object.');
  }

  for (const field of BASE_TOP_FIELDS) {
    if (!(field in parsed)) {
      fail('REPORT_INVALID', field, `Review report is missing required field "${field}".`);
    }
  }

  const version = parsed.version;
  if (typeof version !== 'number') {
    fail('REPORT_INVALID', 'version', 'Review report field "version" must be a number.');
  }
  if (version !== 1) {
    fail('REPORT_VERSION_UNSUPPORTED', 'version', 'Review report schema version is not supported.');
  }

  const rubric = getReviewRubric(expected.stage);

  const rubricId = parsed.rubricId;
  if (typeof rubricId !== 'string' || rubricId !== rubric.id) {
    fail('REPORT_RUBRIC_MISMATCH', 'rubricId', 'Review report rubricId does not match the canonical rubric for the expected stage.');
  }

  const isEvidence = expected.stage === 'evidence';

  const evaluation = parsed.evaluation;
  if (evaluation !== 'scored' && evaluation !== 'unavailable') {
    fail('REPORT_INVALID', 'evaluation', 'Review report field "evaluation" must be "scored" or "unavailable".');
  }
  if (!isEvidence && evaluation !== 'scored') {
    fail('REPORT_INVALID', 'evaluation', 'Only the evidence stage supports an "unavailable" evaluation.');
  }

  const extraRequiredFields: readonly string[] = evaluation === 'unavailable'
    ? []
    : (isEvidence ? ['rawTotal', 'effectiveScore'] : ['sum', 'mean']);
  const knownFields = new Set<string>([...BASE_TOP_FIELDS, ...extraRequiredFields]);
  for (const key of Object.keys(parsed)) {
    if (!knownFields.has(key)) {
      fail('REPORT_INVALID', key, 'Review report contains an unrecognized top-level field.');
    }
  }
  for (const field of extraRequiredFields) {
    const value = parsed[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail('REPORT_INVALID', field, `Review report field "${field}" must be a finite number.`);
    }
  }

  const binding = assertWorkflowBinding(parsed.binding, expected);
  const artifactDigests = validateArtifactDigests(parsed.artifactDigests, expected.stage);

  const blockers = validateBlockers(parsed.blockers);

  const verdict = parsed.verdict;
  if (typeof verdict !== 'string' || !VERDICTS.has(verdict)) {
    fail('REPORT_INVALID', 'verdict', 'Review report field "verdict" must be one of the known verdict values.');
  }
  if (verdict === 'BLOCKED' && blockers.length === 0) {
    fail('REPORT_INVALID', 'blockers', 'Review report verdict "BLOCKED" requires at least one explicit blocker.');
  }

  const findings = validateFindings(parsed.findings);

  let dimensions: readonly ReviewDimensionResult[];
  if (evaluation === 'unavailable') {
    if (!Array.isArray(parsed.dimensions) || parsed.dimensions.length !== 0) {
      fail('REPORT_INVALID', 'dimensions', 'Review report with an unavailable evaluation must carry no dimensions.');
    }
    dimensions = Object.freeze([]);
  } else {
    dimensions = validateDimensions(parsed.dimensions, rubric, blockers.length);
  }

  const revalidatedPolicy = revalidatePolicy(policy);

  if (evaluation === 'unavailable') {
    if (verdict !== 'BLOCKED') {
      fail('REPORT_INVALID', 'verdict', 'Review report with an unavailable evaluation must carry verdict "BLOCKED".');
    }
    const candidate: EvidenceUnavailableReviewReport = Object.freeze({
      version: 1 as const,
      rubricId,
      binding,
      artifactDigests,
      dimensions,
      findings,
      blockers,
      verdict: 'BLOCKED' as const,
      evaluation: 'unavailable' as const,
    });
    const computed = evaluateReviewReport(candidate, revalidatedPolicy);
    if (computed.verdict !== candidate.verdict) {
      fail('REPORT_RESULT_MISMATCH', 'verdict', 'Review report verdict does not match the computed verdict.');
    }
    return candidate;
  }

  if (isEvidence) {
    const rawTotal = parsed.rawTotal as number;
    const effectiveScore = parsed.effectiveScore as number;
    const candidate: EvidenceScoredReviewReport = Object.freeze({
      version: 1 as const,
      rubricId,
      binding,
      artifactDigests,
      dimensions,
      findings,
      blockers,
      verdict: verdict as ReviewVerdict,
      evaluation: 'scored' as const,
      rawTotal,
      effectiveScore,
    });
    const computed = evaluateReviewReport(candidate, revalidatedPolicy) as {
      verdict: ReviewVerdict; rawTotal: number; effectiveScore: number;
    };
    if (computed.rawTotal !== candidate.rawTotal) {
      fail('REPORT_RESULT_MISMATCH', 'rawTotal', 'Review report rawTotal does not match the computed total.');
    }
    if (computed.effectiveScore !== candidate.effectiveScore) {
      fail('REPORT_RESULT_MISMATCH', 'effectiveScore', 'Review report effectiveScore does not match the computed effective score.');
    }
    if (computed.verdict !== candidate.verdict) {
      fail('REPORT_RESULT_MISMATCH', 'verdict', 'Review report verdict does not match the computed verdict.');
    }
    return candidate;
  }

  const sum = parsed.sum as number;
  const mean = parsed.mean as number;
  const candidate: SixDimensionReviewReport = Object.freeze({
    version: 1 as const,
    rubricId,
    binding,
    artifactDigests,
    dimensions,
    findings,
    blockers,
    verdict: verdict as ReviewVerdict,
    evaluation: 'scored' as const,
    sum,
    mean,
  });
  const computed = evaluateReviewReport(candidate, revalidatedPolicy) as {
    verdict: ReviewVerdict; sum: number; mean: number;
  };
  if (computed.sum !== candidate.sum) {
    fail('REPORT_RESULT_MISMATCH', 'sum', 'Review report sum does not match the computed sum.');
  }
  if (computed.mean !== candidate.mean) {
    fail('REPORT_RESULT_MISMATCH', 'mean', 'Review report mean does not match the computed mean.');
  }
  if (computed.verdict !== candidate.verdict) {
    fail('REPORT_RESULT_MISMATCH', 'verdict', 'Review report verdict does not match the computed verdict.');
  }
  return candidate;
}
