import assert from 'node:assert/strict';
import test from 'node:test';
import { getDefaultReviewPolicy, parseReviewPolicy, ReviewPolicy } from './reviewPolicy';
import { WorkflowBinding, parseWorkflowBinding } from './workflowBinding';
import { digest } from './protocol';
import { ReviewReport, evaluateReviewReport } from './reviewVerdicts';

/**
 * This suite builds `ReviewReport`-shaped fixtures by hand (never via `parseReviewReport`) and
 * asserts against independently fixed arithmetic (plain sum/division, written directly as
 * numeric literals or simple expressions in each test), per contract.json `verdicts.rules`.
 * Expected verdicts/sums/means/raw/effective totals are never computed by calling
 * `evaluateReviewReport` itself.
 */

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);

function binding(stage: WorkflowBinding['stage']): WorkflowBinding {
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
  });
}

const SIX_DIM_IDS = ['intent_alignment', 'planned_scope', 'expected_outcomes', 'planned_cases', 'setup_clarity', 'wording'] as const;
const EVIDENCE_DIM_IDS = ['relevance', 'provenance_freshness', 'obligation_coverage', 'reproducibility_accessibility', 'completeness_clarity'] as const;

function sixDimensions(ratings: readonly number[]) {
  assert.equal(ratings.length, 6);
  return SIX_DIM_IDS.map((id, index) => ({
    id,
    rating: ratings[index],
    rationale: `Rationale for ${id}.`,
    references: [`ref://${id}`],
  }));
}

function evidenceDimensions(ratings: readonly number[]) {
  assert.equal(ratings.length, 5);
  return EVIDENCE_DIM_IDS.map((id, index) => ({
    id,
    rating: ratings[index],
    rationale: `Rationale for ${id}.`,
    references: [`ref://${id}`],
  }));
}

function finding(overrides: Partial<{ mandatory: boolean }> = {}) {
  return {
    id: 'finding-1',
    obligation: 'Must preserve required behavior.',
    references: ['ref://finding-1'],
    mandatory: overrides.mandatory ?? false,
    severity: 'high' as const,
    destination: 'test_writer' as const,
    correction: 'Address the missing required coverage.',
  };
}

function planningReport(overrides: Partial<{
  ratings: readonly number[];
  findings: ReturnType<typeof finding>[];
  blockers: string[];
  sum: number;
  mean: number;
}> = {}): ReviewReport {
  const ratings = overrides.ratings ?? [4, 4, 4, 4, 4, 4];
  const sum = overrides.sum ?? ratings.reduce((a, b) => a + b, 0);
  return {
    version: 1,
    rubricId: 'planning-v1',
    binding: binding('planning'),
    artifactDigests: { scenario: digest('scenario-content') },
    dimensions: sixDimensions(ratings),
    findings: overrides.findings ?? [],
    blockers: overrides.blockers ?? [],
    verdict: 'QUALITY_VERIFIED',
    evaluation: 'scored',
    sum,
    mean: overrides.mean ?? sum / 6,
  } as ReviewReport;
}

function evidenceScoredReport(overrides: Partial<{
  ratings: readonly number[];
  findings: ReturnType<typeof finding>[];
  blockers: string[];
}> = {}): ReviewReport {
  const ratings = overrides.ratings ?? [20, 20, 20, 20, 20];
  const rawTotal = ratings.reduce((a, b) => a + b, 0);
  return {
    version: 1,
    rubricId: 'evidence-v1',
    binding: binding('evidence'),
    artifactDigests: { evidence: digest('evidence-content'), change: digest('change-content') },
    dimensions: evidenceDimensions(ratings),
    findings: overrides.findings ?? [],
    blockers: overrides.blockers ?? [],
    verdict: 'QUALITY_VERIFIED',
    evaluation: 'scored',
    rawTotal,
    effectiveScore: rawTotal,
  } as ReviewReport;
}

function evidenceUnavailableReport(): ReviewReport {
  return {
    version: 1,
    rubricId: 'evidence-v1',
    binding: binding('evidence'),
    artifactDigests: { evidence: digest('evidence-content'), change: digest('change-content') },
    dimensions: [],
    findings: [],
    blockers: ['Required pre-review support is unavailable for this revision.'],
    verdict: 'BLOCKED',
    evaluation: 'unavailable',
  } as ReviewReport;
}

function customReviewerPolicy(minimumAverage: number, minimumDimension: number): ReviewPolicy {
  return parseReviewPolicy(`schema_version: 1
reviewers:
  planning:
    minimum_average: ${minimumAverage}
    minimum_dimension: ${minimumDimension}
    max_refinement_cycles: 1
  translation:
    minimum_average: ${minimumAverage}
    minimum_dimension: ${minimumDimension}
    max_refinement_cycles: 1
  test_code:
    minimum_average: ${minimumAverage}
    minimum_dimension: ${minimumDimension}
    max_refinement_cycles: 1
evidence_validator:
  minimum_score: 50
  max_refinement_cycles: 1
`, { projectId: 'project-1', filePath: '/synthetic/review-thresholds.yml' });
}

function customEvidencePolicy(minimumScore: number): ReviewPolicy {
  return parseReviewPolicy(`schema_version: 1
reviewers:
  planning:
    minimum_average: 4
    minimum_dimension: 3
    max_refinement_cycles: 1
  translation:
    minimum_average: 4
    minimum_dimension: 3
    max_refinement_cycles: 1
  test_code:
    minimum_average: 4
    minimum_dimension: 3
    max_refinement_cycles: 1
evidence_validator:
  minimum_score: ${minimumScore}
  max_refinement_cycles: 1
`, { projectId: 'project-1', filePath: '/synthetic/review-thresholds.yml' });
}

// ---------------------------------------------------------------------------
// Six-dimension stages: sum/mean arithmetic, dimension floor and mandatory/blocker rules.
// ---------------------------------------------------------------------------

test('evaluateReviewReport: all 4s exactly equals the initial default minimum_average (4.0) -> QUALITY_VERIFIED', () => {
  const policy = getDefaultReviewPolicy();
  const report = planningReport({ ratings: [4, 4, 4, 4, 4, 4] });
  const result = evaluateReviewReport(report, policy) as { verdict: string; sum: number; mean: number };
  assert.equal(result.sum, 24);
  assert.equal(result.mean, 4);
  assert.equal(result.verdict, 'QUALITY_VERIFIED');
});

test('evaluateReviewReport: mean just below the initial default minimum_average -> CHANGES_REQUIRED, exact fraction, no rounding', () => {
  const policy = getDefaultReviewPolicy();
  const report = planningReport({ ratings: [4, 4, 4, 4, 4, 3] });
  const result = evaluateReviewReport(report, policy) as { verdict: string; sum: number; mean: number };
  assert.equal(result.sum, 23);
  assert.equal(result.mean, 23 / 6, 'mean must be the exact unrounded fraction, not rounded up to 4');
  assert.ok(result.mean < 4);
  assert.equal(result.verdict, 'CHANGES_REQUIRED');
});

test('evaluateReviewReport: a single low dimension below minimum_dimension blocks QUALITY_VERIFIED despite a high mean', () => {
  const policy = getDefaultReviewPolicy();
  const report = planningReport({ ratings: [5, 5, 5, 5, 5, 1] });
  const result = evaluateReviewReport(report, policy) as { verdict: string; sum: number; mean: number };
  assert.equal(result.sum, 26);
  assert.equal(result.mean, 26 / 6);
  assert.ok(result.mean > 4, 'mean is well above minimum_average, yet the floor dimension must still block a pass');
  assert.equal(result.verdict, 'CHANGES_REQUIRED');
});

test('evaluateReviewReport: custom (nondefault) policy boundary - equal to custom minimum_average passes, just below fails', () => {
  const policy = customReviewerPolicy(3.5, 2);
  const passing = planningReport({ ratings: [4, 4, 4, 4, 3, 2] }); // sum 21, mean 3.5 exactly
  const passingResult = evaluateReviewReport(passing, policy) as { verdict: string; sum: number; mean: number };
  assert.equal(passingResult.sum, 21);
  assert.equal(passingResult.mean, 3.5);
  assert.equal(passingResult.verdict, 'QUALITY_VERIFIED');

  const failing = planningReport({ ratings: [4, 4, 4, 4, 3, 1] }); // sum 20, mean 20/6 < 3.5
  const failingResult = evaluateReviewReport(failing, policy) as { verdict: string; sum: number; mean: number };
  assert.equal(failingResult.sum, 20);
  assert.equal(failingResult.mean, 20 / 6);
  assert.ok(failingResult.mean < 3.5);
  assert.equal(failingResult.verdict, 'CHANGES_REQUIRED');
});

test('evaluateReviewReport: a mandatory finding without any blocker yields CHANGES_REQUIRED even at full ratings', () => {
  const policy = getDefaultReviewPolicy();
  const report = planningReport({ ratings: [5, 5, 5, 5, 5, 5], findings: [finding({ mandatory: true })] });
  const result = evaluateReviewReport(report, policy) as { verdict: string; sum: number; mean: number };
  assert.equal(result.sum, 30);
  assert.equal(result.mean, 5);
  assert.equal(result.verdict, 'CHANGES_REQUIRED',
    'a mandatory defect must not be compensated by a perfect mean');
});

test('evaluateReviewReport: nonempty blockers dominate as BLOCKED even at full ratings and no mandatory findings', () => {
  const policy = getDefaultReviewPolicy();
  const report = planningReport({ ratings: [5, 5, 5, 5, 5, 5], blockers: ['Required approved source is unavailable.'] });
  const result = evaluateReviewReport(report, policy) as { verdict: string; sum: number; mean: number };
  assert.equal(result.verdict, 'BLOCKED');
});

test('evaluateReviewReport: blockers dominate over a simultaneous mandatory finding (BLOCKED, not CHANGES_REQUIRED)', () => {
  const policy = getDefaultReviewPolicy();
  const report = planningReport({
    ratings: [5, 5, 5, 5, 5, 5],
    findings: [finding({ mandatory: true })],
    blockers: ['Required approved source is unavailable.'],
  });
  const result = evaluateReviewReport(report, policy) as { verdict: string };
  assert.equal(result.verdict, 'BLOCKED');
});

// ---------------------------------------------------------------------------
// Evidence stage: five 0..20 dimensions, hard-failure cap, fractional exactness, blockers.
// ---------------------------------------------------------------------------

test('evaluateReviewReport (evidence): rawTotal 0 and rawTotal 100 boundaries against the initial default minimum_score (85)', () => {
  const policy = getDefaultReviewPolicy();

  const zero = evidenceScoredReport({ ratings: [0, 0, 0, 0, 0] });
  const zeroResult = evaluateReviewReport(zero, policy) as { verdict: string; rawTotal: number; effectiveScore: number };
  assert.equal(zeroResult.rawTotal, 0);
  assert.equal(zeroResult.effectiveScore, 0);
  assert.equal(zeroResult.verdict, 'CHANGES_REQUIRED');

  const full = evidenceScoredReport({ ratings: [20, 20, 20, 20, 20] });
  const fullResult = evaluateReviewReport(full, policy) as { verdict: string; rawTotal: number; effectiveScore: number };
  assert.equal(fullResult.rawTotal, 100);
  assert.equal(fullResult.effectiveScore, 100);
  assert.equal(fullResult.verdict, 'QUALITY_VERIFIED');
});

test('evaluateReviewReport (evidence): exact fractional rawTotal, equality boundary at minimum_score passes, no rounding', () => {
  const policy = getDefaultReviewPolicy();

  const atBoundary = evidenceScoredReport({ ratings: [17, 17, 17, 17, 17] }); // rawTotal exactly 85
  const atBoundaryResult = evaluateReviewReport(atBoundary, policy) as { verdict: string; rawTotal: number; effectiveScore: number };
  assert.equal(atBoundaryResult.rawTotal, 85);
  assert.equal(atBoundaryResult.effectiveScore, 85);
  assert.equal(atBoundaryResult.verdict, 'QUALITY_VERIFIED');

  const fractional = evidenceScoredReport({ ratings: [17.5, 17.5, 17.5, 17.5, 17.5] }); // rawTotal exactly 87.5
  const fractionalResult = evaluateReviewReport(fractional, policy) as { verdict: string; rawTotal: number; effectiveScore: number };
  assert.equal(fractionalResult.rawTotal, 87.5);
  assert.equal(fractionalResult.effectiveScore, 87.5);
  assert.equal(fractionalResult.verdict, 'QUALITY_VERIFIED');

  const justBelow = evidenceScoredReport({ ratings: [17, 17, 17, 17, 16.9] }); // rawTotal exactly 84.9
  const justBelowResult = evaluateReviewReport(justBelow, policy) as { verdict: string; rawTotal: number; effectiveScore: number };
  assert.equal(justBelowResult.rawTotal, 84.9);
  assert.equal(justBelowResult.effectiveScore, 84.9);
  assert.equal(justBelowResult.verdict, 'CHANGES_REQUIRED',
    'a rawTotal fractionally below minimum_score must not round up to a pass');
});

test('evaluateReviewReport (evidence): nondefault minimum_score thresholds 1 and 100 are honored exactly', () => {
  const almostNothingPolicy = customEvidencePolicy(1);
  const almostNothing = evidenceScoredReport({ ratings: [1, 0, 0, 0, 0] }); // rawTotal 1
  const almostNothingResult = evaluateReviewReport(almostNothing, almostNothingPolicy) as { verdict: string; rawTotal: number };
  assert.equal(almostNothingResult.rawTotal, 1);
  assert.equal(almostNothingResult.verdict, 'QUALITY_VERIFIED');

  const belowOne = evidenceScoredReport({ ratings: [0, 0, 0, 0, 0] }); // rawTotal 0
  const belowOneResult = evaluateReviewReport(belowOne, almostNothingPolicy) as { verdict: string };
  assert.equal(belowOneResult.verdict, 'CHANGES_REQUIRED');

  const strictPolicy = customEvidencePolicy(100);
  const notQuiteFull = evidenceScoredReport({ ratings: [20, 20, 20, 20, 19.999999999] });
  const notQuiteFullResult = evaluateReviewReport(notQuiteFull, strictPolicy) as { verdict: string };
  assert.equal(notQuiteFullResult.verdict, 'CHANGES_REQUIRED');

  const exactlyFull = evidenceScoredReport({ ratings: [20, 20, 20, 20, 20] });
  const exactlyFullResult = evaluateReviewReport(exactlyFull, strictPolicy) as { verdict: string };
  assert.equal(exactlyFullResult.verdict, 'QUALITY_VERIFIED');
});

test('evaluateReviewReport (evidence): a mandatory finding caps effectiveScore at minimum_score-1 at the configured threshold, never a fixed 84', () => {
  const defaultPolicy = getDefaultReviewPolicy(); // minimum_score 85 -> cap 84
  const defaultCapped = evidenceScoredReport({ ratings: [20, 20, 20, 20, 20], findings: [finding({ mandatory: true })] });
  const defaultResult = evaluateReviewReport(defaultCapped, defaultPolicy) as { verdict: string; rawTotal: number; effectiveScore: number };
  assert.equal(defaultResult.rawTotal, 100);
  assert.equal(defaultResult.effectiveScore, 84);
  assert.equal(defaultResult.verdict, 'CHANGES_REQUIRED');

  const customPolicy = customEvidencePolicy(50); // minimum_score 50 -> cap 49
  const customCapped = evidenceScoredReport({ ratings: [20, 20, 20, 20, 20], findings: [finding({ mandatory: true })] });
  const customResult = evaluateReviewReport(customCapped, customPolicy) as { verdict: string; rawTotal: number; effectiveScore: number };
  assert.equal(customResult.rawTotal, 100);
  assert.equal(customResult.effectiveScore, 49, 'the hard-failure cap must track minimum_score-1, not a hardcoded 84');
  assert.equal(customResult.verdict, 'CHANGES_REQUIRED');

  const capBelowRawTotal = evidenceScoredReport({ ratings: [10, 0, 0, 0, 0], findings: [finding({ mandatory: true })] }); // rawTotal 10 < cap 49
  const capBelowRawTotalResult = evaluateReviewReport(capBelowRawTotal, customPolicy) as { verdict: string; rawTotal: number; effectiveScore: number };
  assert.equal(capBelowRawTotalResult.rawTotal, 10);
  assert.equal(capBelowRawTotalResult.effectiveScore, 10, 'effectiveScore is Math.min(rawTotal, cap), not always the cap itself');
  assert.equal(capBelowRawTotalResult.verdict, 'CHANGES_REQUIRED');
});

test('evaluateReviewReport (evidence): nonempty blockers dominate as BLOCKED even with a full score and no mandatory finding', () => {
  const policy = getDefaultReviewPolicy();
  const report = evidenceScoredReport({ ratings: [20, 20, 20, 20, 20], blockers: ['Required support is unavailable.'] });
  const result = evaluateReviewReport(report, policy) as { verdict: string; rawTotal: number; effectiveScore: number };
  assert.equal(result.verdict, 'BLOCKED');
  assert.equal(result.rawTotal, 100);
  assert.equal(result.effectiveScore, 100);
});

test('evaluateReviewReport (evidence): an unavailable evaluation yields only {verdict: BLOCKED}, no invented scores', () => {
  const policy = getDefaultReviewPolicy();
  const report = evidenceUnavailableReport();
  const result = evaluateReviewReport(report, policy) as Record<string, unknown>;
  assert.deepEqual(Object.keys(result).sort(), ['verdict']);
  assert.equal(result.verdict, 'BLOCKED');
});

test('evaluateReviewReport never mutates the supplied report or policy objects', () => {
  const policy = getDefaultReviewPolicy();
  const report = planningReport({ ratings: [4, 4, 4, 4, 4, 4] });
  const reportSnapshot = JSON.parse(JSON.stringify(report));
  const policySnapshot = JSON.parse(JSON.stringify(policy));
  evaluateReviewReport(report, policy);
  assert.deepEqual(JSON.parse(JSON.stringify(report)), reportSnapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(policy)), policySnapshot);
});
