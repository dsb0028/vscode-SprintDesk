/**
 * Canonical stage review rubrics: narrow, strict definitions of each workflow stage's
 * dimension ids, order and rating-anchor meanings, transcribed verbatim from the selected
 * plan snapshot's "Planning rubric", "Translation rubric" and "Code rubric" tables, plus the
 * Evidence quality section's fixed 0/5/10/15/20 support anchors (contract.json `rubrics`).
 *
 * This module performs no arithmetic and duplicates no review-policy threshold. It only
 * returns a fresh, deeply frozen canonical definition per call; unsupported stages fail
 * explicitly, with no fallback rubric.
 */

import { WORKFLOW_STAGES, WorkflowStage } from './workflowBinding';

export interface RubricAnchor {
  readonly rating: number;
  readonly meaning: string;
}

export interface RubricDimension {
  readonly id: string;
  readonly label: string;
  readonly anchors: readonly RubricAnchor[];
}

export interface ReviewRubric {
  readonly version: 1;
  readonly id: string;
  readonly stage: WorkflowStage;
  readonly dimensions: readonly RubricDimension[];
  readonly ratingMinimum: number;
  readonly ratingMaximum: number;
  readonly integerRatings: boolean;
}

type SixDimensionStage = 'planning' | 'translation' | 'test_code';

interface DimensionSpec {
  readonly id: string;
  readonly label: string;
  readonly meanings: readonly [string, string, string, string, string];
}

// Built as `Map`s (never snake_case object-literal keys) so the contract's exact snake_case
// stage/dimension identifiers never need to be restated as lint-flagged object-literal property
// names; each lookup below is by exact string key, matching this repository's existing style
// for this same canonical data (see reviewRubrics.test.ts).
const RUBRIC_ID: ReadonlyMap<WorkflowStage, string> = new Map([
  ['planning', 'planning-v1'],
  ['translation', 'translation-v1'],
  ['test_code', 'test-code-v1'],
  ['evidence', 'evidence-v1'],
]);

const SIX_DIMENSION_SPECS: ReadonlyMap<SixDimensionStage, readonly DimensionSpec[]> = new Map([
  ['planning', [
    { id: 'intent_alignment', label: 'Intent alignment', meanings: [
      'Intent absent/contradicted', 'Major mismatches',
      'Essential intent matches, mapping detail limited', 'Clear required-intent mapping',
      'Precise full mapping and exclusions',
    ] },
    { id: 'planned_scope', label: 'Planned scope', meanings: [
      'No meaningful action/boundary', 'Required behavior bypassed', 'Required action/scope stated',
      'Appropriate integration/side-effect scope clear', 'Exact scope and double limits explicit',
    ] },
    { id: 'expected_outcomes', label: 'Expected outcomes', meanings: [
      'Absent/unusable', 'Required outcomes vague', 'Essential observations specified',
      'Specific pass/fail outcomes', 'Precise discriminating comparisons and limits',
    ] },
    { id: 'planned_cases', label: 'Planned cases', meanings: [
      'Required cases absent', 'Major applicable omissions', 'Required cases present, map limited',
      'Cases mapped/exclusions justified', 'Complete relevant interactions, no padding',
    ] },
    { id: 'setup_clarity', label: 'Setup clarity', meanings: [
      'Missing/invalid preconditions', 'Major assumptions undefined', 'Essential setup valid',
      'Setup/isolation/cleanup clear', 'Precise reproducible planned context',
    ] },
    { id: 'wording', label: 'Wording', meanings: [
      'Cannot implement without invented intent', 'Major ambiguity', 'Understandable essential sequence',
      'Unambiguous setup/action/result', 'Concise precise sequence requiring no guesses',
    ] },
  ]],
  ['translation', [
    { id: 'meaning_outcomes', label: 'Meaning and outcomes', meanings: [
      'Source absent or contradicted', 'Required meaning altered',
      'Essential meaning preserved, explanation limited', 'Required semantics clearly preserved',
      'Precise full equivalence, no added intent',
    ] },
    { id: 'source_coverage', label: 'Source coverage', meanings: [
      'Required source/cases absent', 'Required context/cases omitted',
      'Required context/cases retained, map limited', 'Background/rules/examples covered clearly',
      'Complete contextual coverage with exact mapping',
    ] },
    { id: 'data_parameters', label: 'Data and parameters', meanings: [
      'Wrong or fabricated values', 'Material substitutions wrong', 'Required data preserved, notes limited',
      'All parameter bindings/data correct and clear', 'Precise row/payload/condition fidelity',
    ] },
    { id: 'order_preconditions', label: 'Order and preconditions', meanings: [
      'Required chronology/state contradicted', 'Dependencies/preconditions lost',
      'Required sequence/state preserved', 'Order and specified cleanup explicit',
      'Exact source-order/resource/dependency fidelity',
    ] },
    { id: 'traceability', label: 'Traceability', meanings: [
      'Source/revisions unavailable or wrong', 'Essential mappings unreliable',
      'Required revisions/cases identifiable', 'Clear step/row/instruction mapping',
      'Complete verified source mapping and limits',
    ] },
    { id: 'neutral_clarity', label: 'Neutral clarity', meanings: [
      'Cannot use without invented behavior', 'Major ambiguity/new mechanics', 'Essential neutral prose usable',
      'Clear instructions, no unapproved choices', 'Precise neutral instructions without semantic guesses',
    ] },
  ]],
  ['test_code', [
    { id: 'scenario_alignment', label: 'Scenario alignment', meanings: [
      'Approved source absent/contradicted', 'Major expected-behavior mismatch',
      'Required intent matches, mapping limited', 'Clear source/translation-to-code mapping',
      'Precise complete obligation mapping',
    ] },
    { id: 'exercised_behavior', label: 'Exercised behavior', meanings: [
      'Relevant path not tested', 'Wrong boundary/mock bypass', 'Required path present, support limited',
      'Required boundaries genuinely exercised', 'Exact path/double/integration limits supported',
    ] },
    { id: 'assertions', label: 'Assertions', meanings: [
      'No meaningful outcome check', 'Required wrong behavior can pass',
      'Required outcomes checked, clarity limited', 'Specific discriminating assertions',
      'Full required invariant sensitivity, no tautology/padding',
    ] },
    { id: 'implemented_cases', label: 'Implemented cases', meanings: [
      'Required cases absent', 'Major required omissions', 'Required cases present, mapping limited',
      'Applicable cases/exclusions supported', 'Complete relevant case/interaction mapping',
    ] },
    { id: 'fixtures_doubles', label: 'Fixtures and doubles', meanings: [
      'Invalid/unreliable setup', 'Major isolation/patch/cleanup defects', 'Essential valid setup, detail limited',
      'Deterministic realistic scoped setup', 'Isolation/ownership/cleanup clearly demonstrated',
    ] },
    { id: 'execution_diagnosis', label: 'Execution diagnosis', meanings: [
      'Missing/misrepresented run support', 'Wrong selections/context undermine claim',
      'Required attempt/outcome known, detail limited', 'Correct source/run/Red/skip diagnosis',
      'Exact completed-run/context trace and honest limits',
    ] },
  ]],
]);

const EVIDENCE_DIMENSION_IDS: readonly string[] = [
  'relevance', 'provenance_freshness', 'obligation_coverage', 'reproducibility_accessibility', 'completeness_clarity',
];

const EVIDENCE_DIMENSION_LABELS: ReadonlyMap<string, string> = new Map([
  ['relevance', 'Relevance'],
  ['provenance_freshness', 'Provenance and freshness'],
  ['obligation_coverage', 'Obligation coverage'],
  ['reproducibility_accessibility', 'Reproducibility and accessibility'],
  ['completeness_clarity', 'Completeness and clarity'],
]);

/** Evidence anchors are the fixed 0/5/10/15/20 support anchors, identical text for every dimension. */
const EVIDENCE_RATINGS: readonly number[] = [0, 5, 10, 15, 20];
const EVIDENCE_MEANINGS: readonly string[] = [
  'absent/invalid', 'weak support', 'material gaps', 'minor nonessential gaps', 'fully supported',
];

function freezeDimension(id: string, label: string, anchors: readonly RubricAnchor[]): RubricDimension {
  const frozenAnchors = Object.freeze(anchors.map(anchor => Object.freeze({ ...anchor })));
  return Object.freeze({ id, label, anchors: frozenAnchors });
}

function buildSixDimensionRubric(stage: SixDimensionStage): ReviewRubric {
  const specs = SIX_DIMENSION_SPECS.get(stage)!;
  const dimensions = specs.map(spec => freezeDimension(
    spec.id,
    spec.label,
    spec.meanings.map((meaning, index) => ({ rating: index + 1, meaning })),
  ));
  return Object.freeze({
    version: 1 as const,
    id: RUBRIC_ID.get(stage)!,
    stage,
    dimensions: Object.freeze(dimensions),
    ratingMinimum: 1,
    ratingMaximum: 5,
    integerRatings: true,
  });
}

function buildEvidenceRubric(): ReviewRubric {
  const dimensions = EVIDENCE_DIMENSION_IDS.map(id => freezeDimension(
    id,
    EVIDENCE_DIMENSION_LABELS.get(id)!,
    EVIDENCE_RATINGS.map((rating, index) => ({ rating, meaning: EVIDENCE_MEANINGS[index] })),
  ));
  return Object.freeze({
    version: 1 as const,
    id: RUBRIC_ID.get('evidence')!,
    stage: 'evidence',
    dimensions: Object.freeze(dimensions),
    ratingMinimum: 0,
    ratingMaximum: 20,
    integerRatings: false,
  });
}

function isWorkflowStage(value: unknown): value is WorkflowStage {
  return typeof value === 'string' && (WORKFLOW_STAGES as readonly string[]).includes(value);
}

export function getReviewRubric(stage: WorkflowStage): ReviewRubric {
  if (!isWorkflowStage(stage)) {
    throw new Error('Unsupported workflow stage for review rubric lookup.');
  }
  if (stage === 'evidence') {
    return buildEvidenceRubric();
  }
  return buildSixDimensionRubric(stage);
}
