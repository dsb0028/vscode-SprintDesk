import assert from 'node:assert/strict';
import test from 'node:test';
import { WORKFLOW_STAGES, WorkflowStage } from './workflowBinding';
import { ReviewRubric, RubricDimension, getReviewRubric } from './reviewRubrics';

/**
 * Canonical ids, dimension order and rating-anchor meanings transcribed verbatim from the
 * selected plan snapshot's "Planning rubric", "Translation rubric", "Code rubric" tables and
 * the Evidence quality section's fixed 0/5/10/15/20 anchors (contract.json `rubrics`). These
 * are independently fixed expectations copied from the plan text, never derived by invoking
 * the rubric module under test.
 */
// Built as `Map`s (never snake_case object-literal keys) so the contract's exact snake_case
// stage/dimension identifiers never need to be restated as lint-flagged object-literal property
// names; each lookup below is by exact string key.
const CANONICAL_RUBRIC_ID: ReadonlyMap<WorkflowStage, string> = new Map([
  ['planning', 'planning-v1'],
  ['translation', 'translation-v1'],
  ['test_code', 'test-code-v1'],
  ['evidence', 'evidence-v1'],
]);

const ORDERED_DIMENSION_IDS: ReadonlyMap<WorkflowStage, readonly string[]> = new Map([
  ['planning', ['intent_alignment', 'planned_scope', 'expected_outcomes', 'planned_cases', 'setup_clarity', 'wording']],
  ['translation', ['meaning_outcomes', 'source_coverage', 'data_parameters', 'order_preconditions', 'traceability', 'neutral_clarity']],
  ['test_code', ['scenario_alignment', 'exercised_behavior', 'assertions', 'implemented_cases', 'fixtures_doubles', 'execution_diagnosis']],
  ['evidence', ['relevance', 'provenance_freshness', 'obligation_coverage', 'reproducibility_accessibility', 'completeness_clarity']],
]);

type SixDimensionStage = 'planning' | 'translation' | 'test_code';

const SIX_DIMENSION_MEANINGS: ReadonlyMap<SixDimensionStage, ReadonlyMap<string, readonly string[]>> = new Map([
  ['planning', new Map([
    ['intent_alignment', [
      'Intent absent/contradicted', 'Major mismatches',
      'Essential intent matches, mapping detail limited', 'Clear required-intent mapping',
      'Precise full mapping and exclusions',
    ]],
    ['planned_scope', [
      'No meaningful action/boundary', 'Required behavior bypassed', 'Required action/scope stated',
      'Appropriate integration/side-effect scope clear', 'Exact scope and double limits explicit',
    ]],
    ['expected_outcomes', [
      'Absent/unusable', 'Required outcomes vague', 'Essential observations specified',
      'Specific pass/fail outcomes', 'Precise discriminating comparisons and limits',
    ]],
    ['planned_cases', [
      'Required cases absent', 'Major applicable omissions', 'Required cases present, map limited',
      'Cases mapped/exclusions justified', 'Complete relevant interactions, no padding',
    ]],
    ['setup_clarity', [
      'Missing/invalid preconditions', 'Major assumptions undefined', 'Essential setup valid',
      'Setup/isolation/cleanup clear', 'Precise reproducible planned context',
    ]],
    ['wording', [
      'Cannot implement without invented intent', 'Major ambiguity', 'Understandable essential sequence',
      'Unambiguous setup/action/result', 'Concise precise sequence requiring no guesses',
    ]],
  ])],
  ['translation', new Map([
    ['meaning_outcomes', [
      'Source absent or contradicted', 'Required meaning altered',
      'Essential meaning preserved, explanation limited', 'Required semantics clearly preserved',
      'Precise full equivalence, no added intent',
    ]],
    ['source_coverage', [
      'Required source/cases absent', 'Required context/cases omitted',
      'Required context/cases retained, map limited', 'Background/rules/examples covered clearly',
      'Complete contextual coverage with exact mapping',
    ]],
    ['data_parameters', [
      'Wrong or fabricated values', 'Material substitutions wrong', 'Required data preserved, notes limited',
      'All parameter bindings/data correct and clear', 'Precise row/payload/condition fidelity',
    ]],
    ['order_preconditions', [
      'Required chronology/state contradicted', 'Dependencies/preconditions lost',
      'Required sequence/state preserved', 'Order and specified cleanup explicit',
      'Exact source-order/resource/dependency fidelity',
    ]],
    ['traceability', [
      'Source/revisions unavailable or wrong', 'Essential mappings unreliable',
      'Required revisions/cases identifiable', 'Clear step/row/instruction mapping',
      'Complete verified source mapping and limits',
    ]],
    ['neutral_clarity', [
      'Cannot use without invented behavior', 'Major ambiguity/new mechanics', 'Essential neutral prose usable',
      'Clear instructions, no unapproved choices', 'Precise neutral instructions without semantic guesses',
    ]],
  ])],
  ['test_code', new Map([
    ['scenario_alignment', [
      'Approved source absent/contradicted', 'Major expected-behavior mismatch',
      'Required intent matches, mapping limited', 'Clear source/translation-to-code mapping',
      'Precise complete obligation mapping',
    ]],
    ['exercised_behavior', [
      'Relevant path not tested', 'Wrong boundary/mock bypass', 'Required path present, support limited',
      'Required boundaries genuinely exercised', 'Exact path/double/integration limits supported',
    ]],
    ['assertions', [
      'No meaningful outcome check', 'Required wrong behavior can pass',
      'Required outcomes checked, clarity limited', 'Specific discriminating assertions',
      'Full required invariant sensitivity, no tautology/padding',
    ]],
    ['implemented_cases', [
      'Required cases absent', 'Major required omissions', 'Required cases present, mapping limited',
      'Applicable cases/exclusions supported', 'Complete relevant case/interaction mapping',
    ]],
    ['fixtures_doubles', [
      'Invalid/unreliable setup', 'Major isolation/patch/cleanup defects', 'Essential valid setup, detail limited',
      'Deterministic realistic scoped setup', 'Isolation/ownership/cleanup clearly demonstrated',
    ]],
    ['execution_diagnosis', [
      'Missing/misrepresented run support', 'Wrong selections/context undermine claim',
      'Required attempt/outcome known, detail limited', 'Correct source/run/Red/skip diagnosis',
      'Exact completed-run/context trace and honest limits',
    ]],
  ])],
]);

/** Evidence anchors are the fixed 0/5/10/15/20 support anchors, identical text for every dimension. */
const EVIDENCE_RATINGS = [0, 5, 10, 15, 20] as const;
const EVIDENCE_MEANINGS: readonly string[] = [
  'absent/invalid', 'weak support', 'material gaps', 'minor nonessential gaps', 'fully supported',
];

function assertSixDimensionAnchors(dimension: RubricDimension, expectedMeanings: readonly string[]): void {
  assert.equal(dimension.anchors.length, 5, `dimension "${dimension.id}" must have exactly 5 anchors`);
  for (let rating = 1; rating <= 5; rating += 1) {
    const anchor = dimension.anchors[rating - 1];
    assert.equal(anchor.rating, rating, `dimension "${dimension.id}" anchor ${rating} has wrong rating`);
    assert.equal(anchor.meaning, expectedMeanings[rating - 1],
      `dimension "${dimension.id}" anchor ${rating} meaning does not match the selected plan's table`);
  }
}

function assertEvidenceAnchors(dimension: RubricDimension): void {
  assert.equal(dimension.anchors.length, 5, `dimension "${dimension.id}" must have exactly 5 anchors`);
  for (const [index, rating] of EVIDENCE_RATINGS.entries()) {
    const anchor = dimension.anchors[index];
    assert.equal(anchor.rating, rating, `dimension "${dimension.id}" anchor index ${index} has wrong rating`);
    assert.equal(anchor.meaning, EVIDENCE_MEANINGS[index],
      `dimension "${dimension.id}" anchor index ${index} meaning does not match the plan's fixed support anchors`);
  }
}

function deepFreezeCheck(rubric: ReviewRubric): void {
  assert.ok(Object.isFrozen(rubric), 'rubric must be frozen');
  assert.ok(Object.isFrozen(rubric.dimensions), 'rubric.dimensions array must be frozen');
  for (const dimension of rubric.dimensions) {
    assert.ok(Object.isFrozen(dimension), `dimension "${dimension.id}" must be frozen`);
    assert.ok(Object.isFrozen(dimension.anchors), `dimension "${dimension.id}".anchors array must be frozen`);
    for (const anchor of dimension.anchors) {
      assert.ok(Object.isFrozen(anchor), `dimension "${dimension.id}" anchor must be frozen`);
    }
  }
}

test('WORKFLOW_STAGES covers exactly the four stages used as rubric keys', () => {
  assert.deepEqual([...WORKFLOW_STAGES], ['planning', 'translation', 'test_code', 'evidence']);
});

for (const stage of ['planning', 'translation', 'test_code'] as const) {
  test(`getReviewRubric('${stage}') returns the canonical six-dimension rubric with exact id/order/anchors`, () => {
    const rubric = getReviewRubric(stage);
    assert.equal(rubric.version, 1);
    assert.equal(rubric.stage, stage);
    assert.equal(rubric.id, CANONICAL_RUBRIC_ID.get(stage));
    assert.equal(rubric.ratingMinimum, 1);
    assert.equal(rubric.ratingMaximum, 5);
    assert.equal(rubric.integerRatings, true);
    assert.equal(rubric.dimensions.length, 6, `${stage} rubric must have exactly 6 dimensions`);

    const actualIds = rubric.dimensions.map((d: RubricDimension) => d.id);
    assert.deepEqual(actualIds, ORDERED_DIMENSION_IDS.get(stage),
      `${stage} dimension ids/order must match the contract's ordered_dimension_ids exactly`);

    const meanings = SIX_DIMENSION_MEANINGS.get(stage)!;
    for (const dimension of rubric.dimensions) {
      assert.equal(typeof dimension.label, 'string');
      assert.ok(dimension.label.trim().length > 0, `dimension "${dimension.id}" must have a nonblank label`);

      assertSixDimensionAnchors(dimension, meanings.get(dimension.id)!);
    }

    deepFreezeCheck(rubric);
  });
}

test("getReviewRubric('evidence') returns the canonical five-dimension rubric with fractional 0..20 anchors", () => {
  const rubric = getReviewRubric('evidence');
  assert.equal(rubric.version, 1);
  assert.equal(rubric.stage, 'evidence');
  assert.equal(rubric.id, CANONICAL_RUBRIC_ID.get('evidence'));
  assert.equal(rubric.ratingMinimum, 0);
  assert.equal(rubric.ratingMaximum, 20);
  assert.equal(rubric.integerRatings, false, 'evidence ratings allow fractions per the actual human response');
  assert.equal(rubric.dimensions.length, 5);

  const actualIds = rubric.dimensions.map((d: RubricDimension) => d.id);
  assert.deepEqual(actualIds, ORDERED_DIMENSION_IDS.get('evidence'));

  for (const dimension of rubric.dimensions) {
    assert.equal(typeof dimension.label, 'string');
    assert.ok(dimension.label.trim().length > 0, `dimension "${dimension.id}" must have a nonblank label`);
    assertEvidenceAnchors(dimension);
  }

  deepFreezeCheck(rubric);
});

test('getReviewRubric returns a fresh, independently frozen copy on every call (no shared mutable singleton)', () => {
  const first = getReviewRubric('planning');
  const second = getReviewRubric('planning');
  assert.deepEqual(first, second);
  assert.notEqual(first, second, 'two calls must not return the identical object reference');
  assert.notEqual(first.dimensions, second.dimensions, 'dimensions array must not be the identical reference');
});

test('getReviewRubric never includes current review-policy thresholds in the returned rubric', () => {
  const rubric = getReviewRubric('planning');
  const serialized = JSON.stringify(rubric);
  assert.ok(!('minimumAverage' in rubric), 'rubric must not duplicate policy threshold fields');
  assert.ok(!('minimum_average' in (rubric as unknown as Record<string, unknown>)),
    'rubric must not duplicate policy threshold fields');
  assert.ok(!serialized.includes('minimum_dimension'), 'rubric must not embed policy thresholds');
});

test('getReviewRubric rejects an unsupported/unknown stage explicitly, with no fallback rubric', () => {
  assert.throws(() => getReviewRubric('bogus-stage' as unknown as WorkflowStage));
  assert.throws(() => getReviewRubric('' as unknown as WorkflowStage));
  assert.throws(() => getReviewRubric(undefined as unknown as WorkflowStage));
  assert.throws(() => getReviewRubric(null as unknown as WorkflowStage));
});

test('each canonical rubric id is unique across the four stages', () => {
  const ids = (WORKFLOW_STAGES as readonly WorkflowStage[]).map(stage => getReviewRubric(stage).id);
  assert.equal(new Set(ids).size, ids.length, 'rubric ids must be unique per stage');
});
