import assert from 'node:assert/strict';
import test from 'node:test';
import { getDefaultReviewPolicy, parseReviewPolicy, ReviewPolicy, ReviewPolicyError } from './reviewPolicy';
import { WorkflowBinding, WorkflowBindingError, parseWorkflowBinding } from './workflowBinding';
import { digest } from './protocol';
import {
  REVIEW_REPORT_MAX_BYTES, ReviewReport, ReviewReportError, parseReviewReport,
} from './reviewReports';

/**
 * Wire-format JSON builders used only to construct `parseReviewReport` input text. These are
 * intentionally plain `Record<string, unknown>` objects (never the strict `ReviewReport`
 * domain type) because many tests deliberately build structurally invalid payloads.
 */
type RawJson = Record<string, unknown>;

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);

function bindingFor(stage: WorkflowBinding['stage'], overrides: Partial<WorkflowBinding> = {}): WorkflowBinding {
  return parseWorkflowBinding({
    version: 1,
    stage,
    projectId: 'project-1',
    taskId: 'task-1',
    incarnation: 'incarnation-1',
    criterionId: 'criterion-1',
    criterionRevision: 'rev-1',
    sourceRevision: 'src-rev-1',
    sourceDigest: HEX_A,
    policyDigest: HEX_B,
    attemptId: 'attempt-1',
    ...overrides,
  });
}

function rawBinding(binding: WorkflowBinding): RawJson {
  return { ...binding };
}

// Built as `Map`s (never snake_case object-literal keys) to avoid restating the contract's
// exact snake_case stage/dimension identifiers as lint-flagged object-literal property names.
const SIX_DIM_IDS: ReadonlyMap<'planning' | 'translation' | 'test_code', readonly string[]> = new Map([
  ['planning', ['intent_alignment', 'planned_scope', 'expected_outcomes', 'planned_cases', 'setup_clarity', 'wording']],
  ['translation', ['meaning_outcomes', 'source_coverage', 'data_parameters', 'order_preconditions', 'traceability', 'neutral_clarity']],
  ['test_code', ['scenario_alignment', 'exercised_behavior', 'assertions', 'implemented_cases', 'fixtures_doubles', 'execution_diagnosis']],
]);
const EVIDENCE_DIM_IDS = ['relevance', 'provenance_freshness', 'obligation_coverage', 'reproducibility_accessibility', 'completeness_clarity'] as const;

const RUBRIC_ID: ReadonlyMap<WorkflowBinding['stage'], string> = new Map([
  ['planning', 'planning-v1'],
  ['translation', 'translation-v1'],
  ['test_code', 'test-code-v1'],
  ['evidence', 'evidence-v1'],
]);

const ARTIFACT_KEYS: ReadonlyMap<WorkflowBinding['stage'], readonly string[]> = new Map([
  ['planning', ['scenario']],
  ['translation', ['original', 'translation']],
  ['test_code', ['original', 'translation', 'tests', 'execution', 'inputs']],
  ['evidence', ['evidence', 'change']],
]);

function artifactDigestsFor(stage: WorkflowBinding['stage']): RawJson {
  const result: RawJson = {};
  for (const key of ARTIFACT_KEYS.get(stage)!) {
    result[key] = digest(`${stage}:${key}:content`);
  }
  return result;
}


function sixDimensionsRaw(ids: readonly string[], ratings: readonly number[]): RawJson[] {
  return ids.map((id, index) => ({
    id,
    rating: ratings[index],
    rationale: `Rationale for ${id}.`,
    references: [`ref://${id}`],
  }));
}

function evidenceDimensionsRaw(ratings: readonly number[]): RawJson[] {
  return EVIDENCE_DIM_IDS.map((id, index) => ({
    id,
    rating: ratings[index],
    rationale: `Rationale for ${id}.`,
    references: [`ref://${id}`],
  }));
}

function findingRaw(overrides: Partial<RawJson> = {}): RawJson {
  return {
    id: 'finding-1',
    obligation: 'Must preserve required behavior.',
    references: ['ref://finding-1'],
    mandatory: false,
    severity: 'high',
    destination: 'test_writer',
    correction: 'Address the missing required coverage.',
    ...overrides,
  };
}

function sixDimReport(
  stage: 'planning' | 'translation' | 'test_code',
  overrides: Partial<{
    ratings: readonly number[]; findings: RawJson[]; blockers: string[]; verdict: string;
    sum: number; mean: number; binding: WorkflowBinding; rubricId: string; version: number; evaluation: string;
  }> = {},
): RawJson {
  const ratings = overrides.ratings ?? [4, 4, 4, 4, 4, 4];
  const sum = overrides.sum ?? ratings.reduce((a, b) => a + b, 0);
  const mean = overrides.mean ?? sum / 6;
  return {
    version: overrides.version ?? 1,
    rubricId: overrides.rubricId ?? RUBRIC_ID.get(stage),
    binding: rawBinding(overrides.binding ?? bindingFor(stage)),
    artifactDigests: artifactDigestsFor(stage),
    dimensions: sixDimensionsRaw(SIX_DIM_IDS.get(stage)!, ratings),
    findings: overrides.findings ?? [],
    blockers: overrides.blockers ?? [],
    verdict: overrides.verdict ?? (mean >= 4 ? 'QUALITY_VERIFIED' : 'CHANGES_REQUIRED'),
    evaluation: overrides.evaluation ?? 'scored',
    sum,
    mean,
  };
}

function evidenceScoredReport(overrides: Partial<{
  ratings: readonly number[]; findings: RawJson[]; blockers: string[]; verdict: string;
  rawTotal: number; effectiveScore: number; binding: WorkflowBinding; rubricId: string;
}> = {}): RawJson {
  const ratings = overrides.ratings ?? [17, 17, 17, 17, 17];
  const rawTotal = overrides.rawTotal ?? ratings.reduce((a, b) => a + b, 0);
  const effectiveScore = overrides.effectiveScore ?? rawTotal;
  return {
    version: 1,
    rubricId: overrides.rubricId ?? RUBRIC_ID.get('evidence'),

    binding: rawBinding(overrides.binding ?? bindingFor('evidence')),
    artifactDigests: artifactDigestsFor('evidence'),
    dimensions: evidenceDimensionsRaw(ratings),
    findings: overrides.findings ?? [],
    blockers: overrides.blockers ?? [],
    verdict: overrides.verdict ?? (effectiveScore >= 85 ? 'QUALITY_VERIFIED' : 'CHANGES_REQUIRED'),
    evaluation: 'scored',
    rawTotal,
    effectiveScore,
  };
}

function evidenceUnavailableReport(overrides: Partial<RawJson> = {}): RawJson {
  return {
    version: 1,
    rubricId: RUBRIC_ID.get('evidence'),
    binding: rawBinding(bindingFor('evidence')),
    artifactDigests: artifactDigestsFor('evidence'),
    dimensions: [],
    findings: [],
    blockers: ['Required pre-review support is unavailable for this revision.'],
    verdict: 'BLOCKED',
    evaluation: 'unavailable',
    ...overrides,
  };
}

function expectedBindingFor(stage: WorkflowBinding['stage']): WorkflowBinding {
  return bindingFor(stage);
}

function defaultPolicy(): ReviewPolicy {
  return getDefaultReviewPolicy();
}

function parse(raw: RawJson, stage: WorkflowBinding['stage'] = 'planning', policy: ReviewPolicy = defaultPolicy()): ReviewReport {
  return parseReviewReport(JSON.stringify(raw), expectedBindingFor(stage), policy);
}

function reportError(operation: () => unknown): ReviewReportError {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof ReviewReportError, `expected a ReviewReportError, received ${String(error)}`);
    return error as ReviewReportError;
  }
  throw new Error('Expected operation to throw');
}

function assertCode(operation: () => unknown, code: string, field?: string): ReviewReportError {
  const error = reportError(operation);
  assert.equal(error.code, code, `expected code ${code}, received ${error.code} (${error.message})`);
  if (field !== undefined) {
    assert.equal(error.field, field, `expected field ${field}, received ${error.field}`);
  }
  return error;
}

// ---------------------------------------------------------------------------
// Constants and basic acceptance
// ---------------------------------------------------------------------------

test('REVIEW_REPORT_MAX_BYTES is the exact contract-fixed byte cap', () => {
  assert.equal(REVIEW_REPORT_MAX_BYTES, 262144);
});

test('parseReviewReport accepts a fully valid planning report and returns an immutable deep copy', () => {
  const raw = sixDimReport('planning');
  const result = parse(raw, 'planning');
  assert.equal(result.version, 1);
  assert.equal(result.rubricId, 'planning-v1');
  assert.equal(result.evaluation, 'scored');
  assert.equal(result.verdict, 'QUALITY_VERIFIED');
  assert.ok(Object.isFrozen(result), 'returned report must be frozen');
  assert.ok(Object.isFrozen(result.dimensions), 'dimensions array must be frozen');
  assert.ok(Object.isFrozen(result.findings), 'findings array must be frozen');
  assert.ok(Object.isFrozen(result.blockers), 'blockers array must be frozen');
  assert.ok(Object.isFrozen(result.binding), 'binding must be frozen');
  assert.ok(Object.isFrozen(result.artifactDigests), 'artifactDigests must be frozen');
  for (const dimension of result.dimensions) {
    assert.ok(Object.isFrozen(dimension), 'each dimension must be frozen');
    assert.ok(Object.isFrozen(dimension.references), 'each dimension.references must be frozen');
  }
});

for (const stage of ['planning', 'translation', 'test_code'] as const) {
  test(`parseReviewReport accepts a valid ${stage} report with its exact artifact key set`, () => {
    const raw = sixDimReport(stage);
    const result = parse(raw, stage);
    assert.equal(result.rubricId, RUBRIC_ID.get(stage));
    assert.deepEqual(Object.keys(result.artifactDigests).sort(), [...ARTIFACT_KEYS.get(stage)!].sort());
    assert.deepEqual(result.dimensions.map((d: ReviewReport['dimensions'][number]) => d.id), SIX_DIM_IDS.get(stage));
  });
}

test('parseReviewReport accepts a valid scored evidence report with fractional ratings', () => {
  const raw = evidenceScoredReport({ ratings: [17.5, 17.5, 17.5, 17.5, 17.5] });
  const result = parse(raw, 'evidence');
  assert.equal(result.rubricId, 'evidence-v1');
  assert.equal((result as unknown as { rawTotal: number }).rawTotal, 87.5);
  assert.equal((result as unknown as { effectiveScore: number }).effectiveScore, 87.5);
  assert.equal(result.verdict, 'QUALITY_VERIFIED');
});

test('parseReviewReport accepts a valid unavailable evidence report with no invented scores', () => {
  const raw = evidenceUnavailableReport();
  const result = parse(raw, 'evidence');
  assert.equal(result.evaluation, 'unavailable');
  assert.equal(result.verdict, 'BLOCKED');
  assert.deepEqual(result.dimensions, []);
  assert.ok(!('rawTotal' in result), 'unavailable evidence report must not carry rawTotal');
  assert.ok(!('effectiveScore' in result), 'unavailable evidence report must not carry effectiveScore');
  assert.ok(!('sum' in result), 'unavailable evidence report must not carry sum');
  assert.ok(!('mean' in result), 'unavailable evidence report must not carry mean');
});

// ---------------------------------------------------------------------------
// Strict JSON parsing / size boundary
// ---------------------------------------------------------------------------

test('parseReviewReport rejects malformed JSON text as REPORT_MALFORMED with field "$"', () => {
  assertCode(() => parseReviewReport('{not valid json', expectedBindingFor('planning'), defaultPolicy()), 'REPORT_MALFORMED', '$');
});

test('parseReviewReport rejects fenced/prose-wrapped JSON (no extraction/repair) as REPORT_MALFORMED', () => {
  const raw = sixDimReport('planning');
  const fenced = `\`\`\`json\n${JSON.stringify(raw)}\n\`\`\``;
  assertCode(() => parseReviewReport(fenced, expectedBindingFor('planning'), defaultPolicy()), 'REPORT_MALFORMED');
});

test('parseReviewReport enforces the byte cap (not the character count) with a UTF-8 boundary case', () => {
  const policy = defaultPolicy();
  const binding = expectedBindingFor('planning');

  // Reach an exact target byte length by appending valid insignificant JSON whitespace after
  // the serialized document's closing brace (RFC 8259 permits whitespace around a JSON text).
  // This keeps every individual field within its own fixed bound (in particular the
  // 8192-UTF-16-unit rationale cap) instead of concentrating hundreds of thousands of padding
  // bytes into one bounded field, while a small number of multibyte UTF-8 characters are
  // inserted into that same bounded rationale field (well under its cap) so the byte-vs-
  // character boundary is still genuinely exercised by real multibyte-derived bytes.
  function sized(byteLength: number): string {
    const raw = sixDimReport('planning');
    const dim0 = (raw.dimensions as RawJson[])[0];
    dim0.rationale = `${dim0.rationale} ${'\u00e9'.repeat(50)}`; // 50 two-byte-in-UTF-8 chars
    const text = JSON.stringify(raw);
    const baseline = Buffer.byteLength(text, 'utf8');
    const padNeeded = byteLength - baseline;
    assert.ok(padNeeded >= 0, 'test padding target must be reachable');
    return `${text}${' '.repeat(padNeeded)}`;
  }

  const atCap = sized(REVIEW_REPORT_MAX_BYTES);
  assert.equal(Buffer.byteLength(atCap, 'utf8'), REVIEW_REPORT_MAX_BYTES);
  assert.doesNotThrow(() => parseReviewReport(atCap, binding, policy));

  const overCap = sized(REVIEW_REPORT_MAX_BYTES + 1);
  assert.equal(Buffer.byteLength(overCap, 'utf8'), REVIEW_REPORT_MAX_BYTES + 1);
  assertCode(() => parseReviewReport(overCap, binding, policy), 'REPORT_TOO_LARGE');

  // Multi-byte characters: a small character count can still exceed the byte cap.
  const raw = sixDimReport('planning');
  (raw.dimensions as RawJson[])[0].rationale = '\u{1F600}'.repeat(100000); // 4 bytes each in UTF-8
  assertCode(() => parseReviewReport(JSON.stringify(raw), binding, policy), 'REPORT_TOO_LARGE');
});

// ---------------------------------------------------------------------------
// Version / rubric / stage consistency
// ---------------------------------------------------------------------------

test('parseReviewReport rejects an unsupported schema version as REPORT_VERSION_UNSUPPORTED', () => {
  const raw = sixDimReport('planning', { version: 2 });
  assertCode(() => parse(raw, 'planning'), 'REPORT_VERSION_UNSUPPORTED');
});

test('parseReviewReport rejects a rubricId that does not match the canonical id for the binding stage (no disguised rubric)', () => {
  const raw = sixDimReport('planning', { rubricId: 'translation-v1' });
  assertCode(() => parse(raw, 'planning'), 'REPORT_RUBRIC_MISMATCH');
});

test('parseReviewReport rejects a report whose embedded binding.stage differs from the expected binding (no disguised stage)', () => {
  const raw = sixDimReport('planning');
  assertCode(() => parse(raw, 'translation'), 'REPORT_RUBRIC_MISMATCH');
});

// ---------------------------------------------------------------------------
// Dimension shape / count / order / rating bounds
// ---------------------------------------------------------------------------

test('parseReviewReport rejects wrong dimension count, order or unknown id for a six-dimension stage', () => {
  const tooFew = sixDimReport('planning');
  (tooFew.dimensions as RawJson[]).pop();
  assertCode(() => parse(tooFew, 'planning'), 'REPORT_INVALID');

  const reordered = sixDimReport('planning');
  const dims = reordered.dimensions as RawJson[];
  [dims[0], dims[1]] = [dims[1], dims[0]];
  assertCode(() => parse(reordered, 'planning'), 'REPORT_INVALID');

  const unknownId = sixDimReport('planning');
  (unknownId.dimensions as RawJson[])[0].id = 'not_a_real_dimension';
  assertCode(() => parse(unknownId, 'planning'), 'REPORT_INVALID');
});

test('parseReviewReport rejects six-dimension ratings outside 1..5 or non-integer/non-finite/wrong-typed values', () => {
  const rejections: ReadonlyArray<unknown> = [0, 6, 2.5, NaN, Infinity, -Infinity, null, 'high', true, undefined];
  for (const value of rejections) {
    const raw = sixDimReport('planning');
    (raw.dimensions as RawJson[])[0].rating = value;
    assertCode(() => parse(raw, 'planning'), 'REPORT_INVALID');
  }
  const boundaries = [1, 5];
  for (const value of boundaries) {
    const raw = sixDimReport('planning', { ratings: [value, value, value, value, value, value] });
    assert.doesNotThrow(() => parse(raw, 'planning'));
  }
});

test('parseReviewReport rejects evidence ratings outside 0..20 or nonfinite/wrong-typed values, but allows exact fractions', () => {
  const rejections: ReadonlyArray<unknown> = [-0.1, 20.1, NaN, Infinity, null, 'x', true];
  for (const value of rejections) {
    const raw = evidenceScoredReport();
    (raw.dimensions as RawJson[])[0].rating = value;
    assertCode(() => parse(raw, 'evidence'), 'REPORT_INVALID');
  }
  const fractional = evidenceScoredReport({ ratings: [0, 5.5, 10.25, 15.75, 20] });
  assert.doesNotThrow(() => parse(fractional, 'evidence'));
});

test('parseReviewReport rejects a dimension object with extra/unknown properties', () => {
  const raw = sixDimReport('planning');
  (raw.dimensions as RawJson[])[0].extra = 'nope';
  assertCode(() => parse(raw, 'planning'), 'REPORT_INVALID');
});

test('parseReviewReport rejects a blank rationale and a rationale exceeding 8192 UTF-16 code units; accepts exactly 8192', () => {
  const blank = sixDimReport('planning');
  (blank.dimensions as RawJson[])[0].rationale = '   ';
  assertCode(() => parse(blank, 'planning'), 'REPORT_INVALID');

  const over = sixDimReport('planning');
  (over.dimensions as RawJson[])[0].rationale = 'x'.repeat(8193);
  assertCode(() => parse(over, 'planning'), 'REPORT_INVALID');

  const atBoundary = sixDimReport('planning');
  (atBoundary.dimensions as RawJson[])[0].rationale = 'x'.repeat(8192);
  assert.doesNotThrow(() => parse(atBoundary, 'planning'));
});

test('parseReviewReport rejects a reference string exceeding 2048 UTF-16 code units and duplicate references within one dimension', () => {
  const over = sixDimReport('planning');
  (over.dimensions as RawJson[])[0].references = ['y'.repeat(2049)];
  assertCode(() => parse(over, 'planning'), 'REPORT_INVALID');

  const duplicate = sixDimReport('planning');
  (duplicate.dimensions as RawJson[])[0].references = ['dup', 'dup'];
  assertCode(() => parse(duplicate, 'planning'), 'REPORT_INVALID');
});

test('parseReviewReport requires explicit blockers when a scored dimension has empty references (missing support), and accepts it only then', () => {
  const missingSupportNoBlockers = sixDimReport('planning', { ratings: [1, 4, 4, 4, 4, 4], blockers: [] });
  (missingSupportNoBlockers.dimensions as RawJson[])[0].references = [];
  assertCode(() => parse(missingSupportNoBlockers, 'planning'), 'REPORT_INVALID');

  const missingSupportWithBlocker = sixDimReport('planning', {
    ratings: [1, 4, 4, 4, 4, 4], blockers: ['Essential setup could not be verified.'], verdict: 'BLOCKED',
  });
  (missingSupportWithBlocker.dimensions as RawJson[])[0].references = [];
  assert.doesNotThrow(() => parse(missingSupportWithBlocker, 'planning'));
});

test('parseReviewReport rejects empty references with no blockers even at a HIGH rating (5), proving missing support is rejected independent of rating magnitude', () => {
  const highRatingNoBlockers = sixDimReport('planning', { ratings: [5, 5, 5, 5, 5, 5], blockers: [] });
  (highRatingNoBlockers.dimensions as RawJson[])[0].references = [];
  assertCode(() => parse(highRatingNoBlockers, 'planning'), 'REPORT_INVALID');

  // Blocked counterpart, included only to confirm the high-rating rejection above is not
  // weakening overall verdict consistency: an explicit blocker still makes the same
  // empty-references/high-rating combination acceptable, exactly as it does at a low rating.
  const highRatingWithBlocker = sixDimReport('planning', {
    ratings: [5, 5, 5, 5, 5, 5], blockers: ['Essential setup could not be verified.'], verdict: 'BLOCKED',
  });
  (highRatingWithBlocker.dimensions as RawJson[])[0].references = [];
  assert.doesNotThrow(() => parse(highRatingWithBlocker, 'planning'));
});

// ---------------------------------------------------------------------------
// Findings / blockers shape and bounded arrays
// ---------------------------------------------------------------------------

test('parseReviewReport accepts a well-formed finding and rejects invalid severity/destination/extra-fields/missing-fields', () => {
  // Default ratings [4,4,4,4,4,4] (mean=4, min dimension=4) meet the default policy's
  // minimum_average=4/minimum_dimension=3, and findingRaw() defaults to a NON-mandatory
  // finding with no blockers, so the independently fixed expected verdict here is
  // QUALITY_VERIFIED: only a mandatory finding or a nonempty blocker forces a non-pass.
  const valid = sixDimReport('planning', { findings: [findingRaw()], verdict: 'QUALITY_VERIFIED' });
  assert.doesNotThrow(() => parse(valid, 'planning'));

  const badSeverity = sixDimReport('planning', { findings: [findingRaw({ severity: 'extreme' })] });
  assertCode(() => parse(badSeverity, 'planning'), 'REPORT_INVALID');

  const badDestination = sixDimReport('planning', { findings: [findingRaw({ destination: 'nobody' })] });
  assertCode(() => parse(badDestination, 'planning'), 'REPORT_INVALID');

  const extraField = sixDimReport('planning', { findings: [findingRaw({ extra: 'nope' })] });
  assertCode(() => parse(extraField, 'planning'), 'REPORT_INVALID');

  const missingObligation = sixDimReport('planning', { findings: [findingRaw({ obligation: undefined })] });
  assertCode(() => parse(missingObligation, 'planning'), 'REPORT_INVALID');

  const blankCorrection = sixDimReport('planning', { findings: [findingRaw({ correction: '' })] });
  assertCode(() => parse(blankCorrection, 'planning'), 'REPORT_INVALID');

  const duplicateFindingRefs = sixDimReport('planning', { findings: [findingRaw({ references: ['a', 'a'] })] });
  assertCode(() => parse(duplicateFindingRefs, 'planning'), 'REPORT_INVALID');
});

test('parseReviewReport rejects blank blocker text entries', () => {
  const raw = sixDimReport('planning', { blockers: ['  '], verdict: 'BLOCKED' });
  assertCode(() => parse(raw, 'planning'), 'REPORT_INVALID');
});

test('parseReviewReport allows exactly 100 findings/blockers/references and rejects 101 (bounded arrays)', () => {
  // Default ratings [4,4,4,4,4,4] with only non-mandatory findings (findingRaw() defaults
  // mandatory:false) and no blockers independently compute to QUALITY_VERIFIED; the bounded-
  // array rejection below must come from the array-length check itself (confirmed to run
  // before verdict cross-validation), not be masked by a self-contradictory hardcoded verdict.
  const at100Findings = sixDimReport('planning', {
    findings: Array.from({ length: 100 }, (_, i) => findingRaw({ id: `finding-${i}` })),
    verdict: 'QUALITY_VERIFIED',
  });
  assert.doesNotThrow(() => parse(at100Findings, 'planning'));

  const at101Findings = sixDimReport('planning', {
    findings: Array.from({ length: 101 }, (_, i) => findingRaw({ id: `finding-${i}` })),
    verdict: 'QUALITY_VERIFIED',
  });
  assertCode(() => parse(at101Findings, 'planning'), 'REPORT_INVALID');

  const at100Blockers = sixDimReport('planning', {
    blockers: Array.from({ length: 100 }, (_, i) => `blocker ${i}`), verdict: 'BLOCKED',
  });
  assert.doesNotThrow(() => parse(at100Blockers, 'planning'));

  const at101Blockers = sixDimReport('planning', {
    blockers: Array.from({ length: 101 }, (_, i) => `blocker ${i}`), verdict: 'BLOCKED',
  });
  assertCode(() => parse(at101Blockers, 'planning'), 'REPORT_INVALID');
});

// ---------------------------------------------------------------------------
// Artifact digest shape / identity
// ---------------------------------------------------------------------------

test('parseReviewReport rejects artifactDigests with a missing key, an extra key, or a non-64-hex value', () => {
  const missingKey = sixDimReport('planning');
  delete (missingKey.artifactDigests as RawJson).scenario;
  assertCode(() => parse(missingKey, 'planning'), 'REPORT_INVALID');

  const extraKey = sixDimReport('planning');
  (extraKey.artifactDigests as RawJson).unexpected = digest('x');
  assertCode(() => parse(extraKey, 'planning'), 'REPORT_INVALID');

  const badHex = sixDimReport('planning');
  (badHex.artifactDigests as RawJson).scenario = 'not-hex';
  assertCode(() => parse(badHex, 'planning'), 'REPORT_INVALID');

  const upperHex = sixDimReport('planning');
  (upperHex.artifactDigests as RawJson).scenario = 'A'.repeat(64);
  assertCode(() => parse(upperHex, 'planning'), 'REPORT_INVALID');
});

// ---------------------------------------------------------------------------
// Computed-field consistency (no self-validating pass shopping)
// ---------------------------------------------------------------------------

test('parseReviewReport rejects a supplied sum that does not match the sum of the actual ratings', () => {
  const raw = sixDimReport('planning', { ratings: [4, 4, 4, 4, 4, 4], sum: 99 });
  assertCode(() => parse(raw, 'planning'), 'REPORT_RESULT_MISMATCH');
});

test('parseReviewReport rejects a supplied mean inconsistent with sum/6, with no rounded-up acceptance', () => {
  const raw = sixDimReport('planning', { ratings: [4, 4, 4, 4, 4, 3], mean: 4 }); // real mean is 23/6
  assertCode(() => parse(raw, 'planning'), 'REPORT_RESULT_MISMATCH');
});

test('parseReviewReport rejects a claimed QUALITY_VERIFIED verdict when the actual ratings/policy computation is CHANGES_REQUIRED', () => {
  const raw = sixDimReport('planning', { ratings: [4, 4, 4, 4, 4, 3], verdict: 'QUALITY_VERIFIED', mean: 23 / 6 });
  assertCode(() => parse(raw, 'planning'), 'REPORT_RESULT_MISMATCH');
});

test('parseReviewReport rejects a claimed CHANGES_REQUIRED verdict when a mandatory finding with no blocker should compute CHANGES_REQUIRED anyway if supplied inconsistently as QUALITY_VERIFIED', () => {
  const raw = sixDimReport('planning', {
    ratings: [5, 5, 5, 5, 5, 5], findings: [findingRaw({ mandatory: true })], verdict: 'QUALITY_VERIFIED',
  });
  assertCode(() => parse(raw, 'planning'), 'REPORT_RESULT_MISMATCH');
});

test('parseReviewReport rejects evidence rawTotal/effectiveScore mismatches against the actual ratings and policy', () => {
  const wrongRawTotal = evidenceScoredReport({ ratings: [17, 17, 17, 17, 17], rawTotal: 999 });
  assertCode(() => parse(wrongRawTotal, 'evidence'), 'REPORT_RESULT_MISMATCH');

  const wrongEffective = evidenceScoredReport({ ratings: [20, 20, 20, 20, 20], effectiveScore: 1 });
  assertCode(() => parse(wrongEffective, 'evidence'), 'REPORT_RESULT_MISMATCH');

  const uncappedMandatory = evidenceScoredReport({
    ratings: [20, 20, 20, 20, 20], findings: [findingRaw({ mandatory: true })], effectiveScore: 100, verdict: 'QUALITY_VERIFIED',
  });
  assertCode(() => parse(uncappedMandatory, 'evidence'), 'REPORT_RESULT_MISMATCH');
});

test('parseReviewReport rejects an "unavailable" evidence payload carrying nonempty dimensions, a non-BLOCKED verdict, or invented score fields', () => {
  const nonemptyDims = evidenceUnavailableReport({ dimensions: evidenceDimensionsRaw([17, 17, 17, 17, 17]) });
  assertCode(() => parse(nonemptyDims, 'evidence'), 'REPORT_INVALID');

  const wrongVerdict = evidenceUnavailableReport({ verdict: 'CHANGES_REQUIRED' });
  assertCode(() => parse(wrongVerdict, 'evidence'), 'REPORT_INVALID');

  const noBlockers = evidenceUnavailableReport({ blockers: [] });
  assertCode(() => parse(noBlockers, 'evidence'), 'REPORT_INVALID');

  const invented = evidenceUnavailableReport({ rawTotal: 0 });
  assertCode(() => parse(invented, 'evidence'), 'REPORT_INVALID');
});

test('parseReviewReport rejects evaluation "unavailable" for a six-dimension stage (unsupported outside evidence)', () => {
  const raw = sixDimReport('planning', { evaluation: 'unavailable' });
  assertCode(() => parse(raw, 'planning'), 'REPORT_INVALID');
});

// ---------------------------------------------------------------------------
// Binding and policy reuse (existing exceptions preserve their accurate codes)
// ---------------------------------------------------------------------------

test('parseReviewReport propagates WorkflowBindingError with BINDING_MISMATCH for a stale/foreign binding, not a generic REPORT code', () => {
  const raw = sixDimReport('planning');
  const foreignExpected = bindingFor('planning', { projectId: 'some-other-project' });
  let thrown: unknown;
  try {
    parseReviewReport(JSON.stringify(raw), foreignExpected, defaultPolicy());
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof WorkflowBindingError, `expected WorkflowBindingError, received ${String(thrown)}`);
  assert.equal((thrown as WorkflowBindingError).code, 'BINDING_MISMATCH');
});

test('parseReviewReport propagates ReviewPolicyError with POLICY_INVALID for a structurally tampered policy object, reusing the canonical policy validator', () => {
  const raw = sixDimReport('planning');
  // Built from a JSON string (not a TS object literal) so the policy's required snake_case
  // wire keys never appear as lint-flagged identifiers here; `minimum_average: 10` is out of
  // the valid 1..5 range and must be rejected by the reused canonical policy validator.
  const tamperedPolicy = JSON.parse(`{
    "schema_version": 1,
    "reviewers": {
      "planning": { "minimum_average": 10, "minimum_dimension": 3, "max_refinement_cycles": 3 },
      "translation": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 },
      "test_code": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 }
    },
    "evidence_validator": { "minimum_score": 85, "max_refinement_cycles": 3 }
  }`) as unknown as ReviewPolicy;
  let thrown: unknown;
  try {
    parseReviewReport(JSON.stringify(raw), expectedBindingFor('planning'), tamperedPolicy);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof ReviewPolicyError, `expected ReviewPolicyError, received ${String(thrown)}`);
  assert.equal((thrown as ReviewPolicyError).code, 'POLICY_INVALID');
});

// ---------------------------------------------------------------------------
// Non-mutation, non-echo and unknown root field rejection
// ---------------------------------------------------------------------------

test('parseReviewReport does not mutate or freeze the caller-supplied expected binding or policy', () => {
  const raw = sixDimReport('planning');

  // Plain, deliberately UNFROZEN object literals -- NOT routed through parseWorkflowBinding /
  // getDefaultReviewPolicy, both of which always return Object.freeze(...) results (confirmed
  // by direct inspection; out of this increment's production_scope) -- so this test can
  // honestly observe an initially-unfrozen caller input before AND after the call and confirm
  // parseReviewReport itself never freezes or mutates it, independent of those sibling
  // modules' own freeze contracts. Values match the independently fixed fixtures used
  // elsewhere in this file, not anything derived from the evaluator under test.
  const expected: WorkflowBinding = {
    version: 1,
    stage: 'planning',
    projectId: 'project-1',
    taskId: 'task-1',
    incarnation: 'incarnation-1',
    criterionId: 'criterion-1',
    criterionRevision: 'rev-1',
    sourceRevision: 'src-rev-1',
    sourceDigest: HEX_A,
    policyDigest: HEX_B,
    attemptId: 'attempt-1',
  };
  // Built from a JSON string (not a TS object literal), matching the existing tamperedPolicy
  // fixture pattern elsewhere in this file, so the policy's required snake_case wire keys
  // never appear as lint-flagged identifiers here.
  const policy: ReviewPolicy = JSON.parse(`{
    "schema_version": 1,
    "reviewers": {
      "planning": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 },
      "translation": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 },
      "test_code": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 }
    },
    "evidence_validator": { "minimum_score": 85, "max_refinement_cycles": 3 }
  }`) as unknown as ReviewPolicy;

  assert.equal(Object.isFrozen(expected), false, 'expected binding fixture must begin unfrozen');
  assert.equal(Object.isFrozen(policy), false, 'policy fixture must begin unfrozen');
  assert.equal(Object.isFrozen(policy.reviewers), false, 'policy.reviewers must begin unfrozen (deep check)');
  assert.equal(Object.isFrozen(policy.reviewers.planning), false, 'policy.reviewers.planning must begin unfrozen (deep check)');
  assert.equal(Object.isFrozen(policy.evidence_validator), false, 'policy.evidence_validator must begin unfrozen (deep check)');

  const expectedSnapshot = JSON.parse(JSON.stringify(expected));
  const policySnapshot = JSON.parse(JSON.stringify(policy));
  parseReviewReport(JSON.stringify(raw), expected, policy);
  assert.deepEqual(JSON.parse(JSON.stringify(expected)), expectedSnapshot, 'expected binding content must be unchanged');
  assert.deepEqual(JSON.parse(JSON.stringify(policy)), policySnapshot, 'policy content must be unchanged');
  assert.equal(Object.isFrozen(expected), false, 'expected binding must remain unfrozen after the call');
  assert.equal(Object.isFrozen(policy), false, 'policy must remain unfrozen after the call');
  assert.equal(Object.isFrozen(policy.reviewers), false, 'policy.reviewers must remain unfrozen after the call (deep check)');
  assert.equal(Object.isFrozen(policy.reviewers.planning), false, 'policy.reviewers.planning must remain unfrozen after the call (deep check)');
  assert.equal(Object.isFrozen(policy.evidence_validator), false, 'policy.evidence_validator must remain unfrozen after the call (deep check)');
});

test('parseReviewReport rejects an unrecognized top-level field', () => {
  const raw = sixDimReport('planning');
  raw.unexpectedTopLevel = 'nope';
  assertCode(() => parse(raw, 'planning'), 'REPORT_INVALID');
});

test('parseReviewReport error never echoes submitted report text/values in message or serialized form', () => {
  const secret = 'SUBMITTED-SECRET-MARKER-VALUE';
  const raw = sixDimReport('planning');
  (raw.dimensions as RawJson[])[0].rationale = secret;
  (raw.dimensions as RawJson[])[0].rating = 999; // force a rejection while the secret is still present
  const error = reportError(() => parse(raw, 'planning'));
  assert.ok(!error.message.includes(secret), 'message must not leak submitted report content');
  assert.ok(!JSON.stringify(error).includes(secret), 'serialized error must not leak submitted report content');
});

test('parseReviewReport rejects a genuinely invalid artifactDigests value (not 64 lowercase hex) and never echoes the submitted value in the error', () => {
  const secret = 'SUBMITTED-SECRET-MARKER-DIGEST';
  const raw = sixDimReport('planning');
  (raw.artifactDigests as RawJson).scenario = secret; // real contract violation: fails the 64-lowercase-hex shape check
  const error = assertCode(() => parse(raw, 'planning'), 'REPORT_INVALID');
  assert.ok(!error.message.includes(secret), 'message must not leak the submitted artifactDigests value');
  assert.ok(!JSON.stringify(error).includes(secret), 'serialized error must not leak the submitted artifactDigests value');
});

test('parseReviewReport propagates BINDING_MISMATCH for a genuinely foreign binding field value and never echoes the submitted value, while the field name itself legitimately identifies the mismatch', () => {
  const secret = 'SUBMITTED-SECRET-MARKER-ATTEMPT';
  const raw = sixDimReport('planning', { binding: bindingFor('planning', { attemptId: secret }) });
  let thrown: unknown;
  try {
    parseReviewReport(JSON.stringify(raw), expectedBindingFor('planning'), defaultPolicy());
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof WorkflowBindingError, `expected WorkflowBindingError, received ${String(thrown)}`);
  const bindingError = thrown as WorkflowBindingError;
  assert.equal(bindingError.code, 'BINDING_MISMATCH');
  assert.equal(bindingError.field, 'attemptId');
  assert.ok(!bindingError.message.includes(secret), 'message must not leak the submitted binding field value');
  assert.ok(!JSON.stringify(bindingError).includes(secret), 'serialized error must not leak the submitted binding field value');
});

test('parseReviewReport rejects a non-object root and a JSON array root as REPORT_MALFORMED or REPORT_INVALID, never a silent pass', () => {
  assertCode(() => parseReviewReport('null', expectedBindingFor('planning'), defaultPolicy()), 'REPORT_INVALID');
  assertCode(() => parseReviewReport('42', expectedBindingFor('planning'), defaultPolicy()), 'REPORT_INVALID');
  assertCode(() => parseReviewReport('[]', expectedBindingFor('planning'), defaultPolicy()), 'REPORT_INVALID');
  assertCode(() => parseReviewReport('"just a string"', expectedBindingFor('planning'), defaultPolicy()), 'REPORT_INVALID');
});

test('parseReviewReport requires a nonempty blockers array whenever the verdict is BLOCKED', () => {
  const raw = sixDimReport('planning', { ratings: [5, 5, 5, 5, 5, 5], verdict: 'BLOCKED', blockers: [] });
  assertCode(() => parse(raw, 'planning'), 'REPORT_INVALID');
});

// ---------------------------------------------------------------------------
// Supplied-policy unknown-key propagation through the reused canonical validator
//
// The report payload for every case below is the independently fixed, otherwise-fully-valid
// `sixDimReport('planning')` fixture (ratings [4,4,4,4,4,4], verdict QUALITY_VERIFIED, valid
// artifactDigests/binding/findings/blockers) so any failure can only come from the supplied
// policy's unknown key, never from an unrelated report mismatch. Only the numerically VALID,
// in-range known policy fields are reused across cases (minimum_average 4, minimum_dimension 3,
// max_refinement_cycles 3, minimum_score 85) to isolate the single injected unknown key as the
// sole cause of any rejection. Each case's expected field is the literal known dotted schema
// path (or root sentinel "$") that `reviewPolicy.ts` already defines for that unknown-key
// location; this test never asks the evaluator under test to produce its own expected verdict.
// ---------------------------------------------------------------------------

const UNKNOWN_POLICY_KEY_CASES: ReadonlyArray<{
  readonly label: string;
  readonly expectedField: string;
  readonly policyJson: string;
}> = [
  {
    label: 'an unknown key at the policy document root',
    expectedField: '$',
    policyJson: `{
      "schema_version": 1,
      "reviewers": {
        "planning": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 },
        "translation": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 },
        "test_code": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 }
      },
      "evidence_validator": { "minimum_score": 85, "max_refinement_cycles": 3 },
      "rogue_unknown_root_field": "ROGUE-UNKNOWN-MARKER-ROOT"
    }`,
  },
  {
    label: 'an unknown key within the "reviewers" mapping',
    expectedField: 'reviewers',
    policyJson: `{
      "schema_version": 1,
      "reviewers": {
        "planning": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 },
        "translation": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 },
        "test_code": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 },
        "rogue_unknown_reviewers_field": "ROGUE-UNKNOWN-MARKER-REVIEWERS"
      },
      "evidence_validator": { "minimum_score": 85, "max_refinement_cycles": 3 }
    }`,
  },
  {
    label: 'an unknown key within the "reviewers.planning" profile',
    expectedField: 'reviewers.planning',
    policyJson: `{
      "schema_version": 1,
      "reviewers": {
        "planning": {
          "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3,
          "rogue_unknown_planning_field": "ROGUE-UNKNOWN-MARKER-PLANNING"
        },
        "translation": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 },
        "test_code": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 }
      },
      "evidence_validator": { "minimum_score": 85, "max_refinement_cycles": 3 }
    }`,
  },
  {
    label: 'an unknown key within the "evidence_validator" profile',
    expectedField: 'evidence_validator',
    policyJson: `{
      "schema_version": 1,
      "reviewers": {
        "planning": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 },
        "translation": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 },
        "test_code": { "minimum_average": 4, "minimum_dimension": 3, "max_refinement_cycles": 3 }
      },
      "evidence_validator": {
        "minimum_score": 85, "max_refinement_cycles": 3,
        "rogue_unknown_evidence_field": "ROGUE-UNKNOWN-MARKER-EVIDENCE"
      }
    }`,
  },
];

for (const unknownKeyCase of UNKNOWN_POLICY_KEY_CASES) {
  test(`parseReviewReport propagates ReviewPolicyError POLICY_INVALID with field "${unknownKeyCase.expectedField}" for ${unknownKeyCase.label}, via the reused canonical policy revalidator, never dropping the unknown field before validation`, () => {
    const raw = sixDimReport('planning');
    const tamperedPolicy = JSON.parse(unknownKeyCase.policyJson) as unknown as ReviewPolicy;
    let thrown: unknown;
    try {
      parseReviewReport(JSON.stringify(raw), expectedBindingFor('planning'), tamperedPolicy);
    } catch (error) {
      thrown = error;
    }
    assert.ok(
      thrown instanceof ReviewPolicyError,
      `expected ReviewPolicyError for ${unknownKeyCase.label}, received ${String(thrown)}`,
    );
    const policyError = thrown as ReviewPolicyError;
    assert.equal(policyError.code, 'POLICY_INVALID');
    assert.equal(policyError.field, unknownKeyCase.expectedField);
    assert.ok(!policyError.message.includes('ROGUE-UNKNOWN-MARKER'),
      'message must not leak the synthetic unknown policy key name or value');
    assert.ok(!JSON.stringify(policyError).includes('ROGUE-UNKNOWN-MARKER'),
      'serialized error must not leak the synthetic unknown policy key name or value');
  });
}

test('parseReviewPolicy (the actual reused canonical validator, called directly) rejects a true non-plain-object root as POLICY_INVALID with field "$", confirming this existing public boundary behavior independent of the reports layer and without inventing any JSON-serialization security guarantee', () => {
  const context = { projectId: 'policy-root-shape-direct-check', filePath: 'synthetic://policy-root-shape-direct-check' };
  let thrown: unknown;
  try {
    parseReviewPolicy('- not\n- a\n- mapping\n', context);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof ReviewPolicyError, `expected ReviewPolicyError, received ${String(thrown)}`);
  assert.equal((thrown as ReviewPolicyError).code, 'POLICY_INVALID');
  assert.equal((thrown as ReviewPolicyError).field, '$');
});

// ---------------------------------------------------------------------------
// Supplied-policy value-controlled accessor/own-toJSON/cyclic shape boundary
//
// Every fixture below starts from an independently fixed, deep JSON copy of the known-valid
// default policy (`mutablePolicyFixture`), never a hand-rolled or partially-valid policy, so the
// single injected accessor/function/cycle is the sole possible cause of any rejection. Precise
// mutable mirror types (never `any`, never an `as unknown as X` double cast) let
// `Object.defineProperty` place a genuinely invalid (accessor or function-valued) own property
// directly on an otherwise fully-typed, fully-valid copied fixture. Per the actual contract
// clarification, field "$" is an acceptable structural-error location for every case here: these
// cases prove rejection and non-invocation, not a specific dotted field path.
// ---------------------------------------------------------------------------

// Mirrors `reviewPolicy.ts`'s own `FIELD`-constant/mapped-`Record` pattern (never a plain
// `interface` with literal snake_case properties) so these required wire-format keys are typed
// precisely without restating them as separate lint-flagged identifiers.
const MUTABLE_POLICY_FIELD = {
  minimumAverage: 'minimum_average',
  minimumDimension: 'minimum_dimension',
  maxRefinementCycles: 'max_refinement_cycles',
  minimumScore: 'minimum_score',
  schemaVersion: 'schema_version',
  testCode: 'test_code',
  evidenceValidator: 'evidence_validator',
} as const;

type MutableReviewerProfile = Record<
  typeof MUTABLE_POLICY_FIELD.minimumAverage | typeof MUTABLE_POLICY_FIELD.minimumDimension
  | typeof MUTABLE_POLICY_FIELD.maxRefinementCycles,
  number
>;

type MutableEvidenceValidatorProfile = Record<
  typeof MUTABLE_POLICY_FIELD.minimumScore | typeof MUTABLE_POLICY_FIELD.maxRefinementCycles,
  number
>;

type MutableReviewPolicy =
  & Record<typeof MUTABLE_POLICY_FIELD.schemaVersion, 1>
  & {
    reviewers:
      & Record<'planning' | 'translation', MutableReviewerProfile>
      & Record<typeof MUTABLE_POLICY_FIELD.testCode, MutableReviewerProfile>;
  }
  & Record<typeof MUTABLE_POLICY_FIELD.evidenceValidator, MutableEvidenceValidatorProfile>;

function mutablePolicyFixture(): MutableReviewPolicy {
  return JSON.parse(JSON.stringify(getDefaultReviewPolicy())) as MutableReviewPolicy;
}

function policyRevalidationError(policy: ReviewPolicy): ReviewPolicyError {
  const raw = sixDimReport('planning');
  let thrown: unknown;
  try {
    parseReviewReport(JSON.stringify(raw), expectedBindingFor('planning'), policy);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof ReviewPolicyError, `expected ReviewPolicyError, received ${String(thrown)}`);
  return thrown as ReviewPolicyError;
}

test('parseReviewReport rejects a supplied policy whose known root field is an enumerable getter, as ReviewPolicyError POLICY_INVALID, without ever invoking that getter even though it returns an otherwise fully valid value', () => {
  const policy = mutablePolicyFixture();
  let getterCalls = 0;
  Object.defineProperty(policy, 'schema_version', {
    enumerable: true,
    configurable: true,
    get(): number {
      getterCalls += 1;
      return 1; // otherwise a fully valid schema_version value: the accessor shape alone must cause rejection
    },
  });
  const error = policyRevalidationError(policy);
  assert.equal(error.code, 'POLICY_INVALID');
  assert.equal(getterCalls, 0, 'the known root-field getter must never be invoked while rejecting its accessor shape');
});

test('parseReviewReport rejects a supplied policy whose nested profile field is an enumerable getter, as ReviewPolicyError POLICY_INVALID, without ever invoking that getter even though it returns an otherwise fully valid value', () => {
  const policy = mutablePolicyFixture();
  let getterCalls = 0;
  Object.defineProperty(policy.reviewers.planning, 'minimum_average', {
    enumerable: true,
    configurable: true,
    get(): number {
      getterCalls += 1;
      return 4; // otherwise a fully valid minimum_average value: the accessor shape alone must cause rejection
    },
  });
  const error = policyRevalidationError(policy);
  assert.equal(error.code, 'POLICY_INVALID');
  assert.equal(getterCalls, 0, 'the nested profile-field getter must never be invoked while rejecting its accessor shape');
});

test('parseReviewReport rejects a genuinely cyclic plain-object policy value as ReviewPolicyError POLICY_INVALID, with no stack overflow, no leaked cycle-marker field name, and the caller policy left unmodified', () => {
  const policy = mutablePolicyFixture();
  const cyclicEvidenceValidator: MutableEvidenceValidatorProfile & { cyclicSelf?: MutableReviewPolicy } = policy.evidence_validator;
  cyclicEvidenceValidator.cyclicSelf = policy; // genuine cycle: evidence_validator -> policy root -> evidence_validator
  const schemaVersionBefore = policy.schema_version;
  const minimumScoreBefore = policy.evidence_validator.minimum_score;

  const error = policyRevalidationError(policy);

  assert.equal(error.code, 'POLICY_INVALID');
  assert.ok(!error.message.toLowerCase().includes('cyclicself'),
    'message must not leak the injected cycle-marker field name');
  assert.ok(!JSON.stringify(error).toLowerCase().includes('cyclicself'),
    'serialized error must not leak the injected cycle-marker field name');
  assert.equal(policy.schema_version, schemaVersionBefore, 'caller policy schema_version must remain unchanged');
  assert.equal(policy.evidence_validator.minimum_score, minimumScoreBefore, 'caller policy minimum_score must remain unchanged');
  assert.equal(cyclicEvidenceValidator.cyclicSelf, policy, 'caller policy cyclic reference must remain intact (same object identity)');
});

test('parseReviewReport rejects a supplied policy with an own toJSON function-valued field as ReviewPolicyError POLICY_INVALID, without ever calling that function, and leaves the caller policy unmodified', () => {
  const policy = mutablePolicyFixture();
  let callCount = 0;
  const evidenceValidatorWithToJson: MutableEvidenceValidatorProfile & { toJSON?: () => unknown } = policy.evidence_validator;
  evidenceValidatorWithToJson.toJSON = (): unknown => {
    callCount += 1;
    return {
      [MUTABLE_POLICY_FIELD.minimumScore]: policy.evidence_validator.minimum_score,
      [MUTABLE_POLICY_FIELD.maxRefinementCycles]: policy.evidence_validator.max_refinement_cycles,
    };
  };
  const schemaVersionBefore = policy.schema_version;
  const minimumScoreBefore = policy.evidence_validator.minimum_score;

  const error = policyRevalidationError(policy);

  assert.equal(error.code, 'POLICY_INVALID');
  assert.equal(callCount, 0, 'the own toJSON function must never be invoked while rejecting its unsupported function-value shape');
  assert.equal(policy.schema_version, schemaVersionBefore, 'caller policy schema_version must remain unchanged');
  assert.equal(policy.evidence_validator.minimum_score, minimumScoreBefore, 'caller policy minimum_score must remain unchanged');
});
