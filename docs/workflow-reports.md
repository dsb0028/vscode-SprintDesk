# Workflow stage review reports: rubrics, schema and verdict arithmetic

This increment adds three narrow modules under `src/review/`:

- `reviewRubrics.ts` — canonical per-stage rubric definitions (dimension ids, order and
  rating-anchor meanings).
- `reviewReports.ts` — a strict JSON-text parser for one stage's review report, reusing the
  existing `workflowBinding.ts` and `reviewPolicy.ts` helpers.
- `reviewVerdicts.ts` — mechanical sum/mean or raw/effective-score arithmetic and verdict
  derivation, reused (never duplicated) by the report parser.

None of these modules select a rating, authenticate evidence or consent, record a workflow
result, initialize storage, or grant implementation/status/signing authority. A computed
`QUALITY_VERIFIED` verdict is an arithmetic fact about supplied ratings/findings/blockers, not
a human acceptance or production authorization.

## Rubrics (`getReviewRubric`)

`getReviewRubric(stage: WorkflowStage): ReviewRubric` returns a **fresh, deeply frozen** copy of
the canonical rubric for one of the four workflow stages: `planning`, `translation`, `test_code`
or `evidence`. Each call returns a new object/array/anchor graph (no shared mutable singleton),
so callers cannot corrupt the canonical definition for later callers.

- `planning`, `translation`, `test_code` are six-dimension rubrics (`ratingMinimum: 1`,
  `ratingMaximum: 5`, `integerRatings: true`); each dimension carries exactly 5 rating anchors
  (meanings 1 through 5), transcribed verbatim from the selected plan's three rubric tables.
- `evidence` is a five-dimension rubric (`ratingMinimum: 0`, `ratingMaximum: 20`,
  `integerRatings: false`) using the shared literal support anchors 0/5/10/15/20 ("absent/invalid"
  through "fully supported"), identical text across all five evidence dimensions per the actual
  human clarification. Fractional evidence ratings (e.g. `17.5`) are valid; only the shared
  anchor *labels* sit at the five fixed points.
- An unsupported/unknown stage throws; there is no fallback rubric.
- Rubrics never embed any review-policy threshold (e.g. `minimum_average`); thresholds come only
  from the separately configured `reviewPolicy.ts` YAML policy.

## Report schema (`parseReviewReport`)

`parseReviewReport(text: string, expected: WorkflowBinding, policy: ReviewPolicy): ReviewReport`
parses **strict JSON text only** — no fenced/prose extraction, no repair, no coercion. The input
byte size is checked against `REVIEW_REPORT_MAX_BYTES` (262144 bytes, measured in UTF-8 bytes, not
characters) *before* parsing.

Every report carries the common fields `version` (`1`), `rubricId` (must equal the canonical
rubric id for `expected.stage`), `binding` (validated via the existing
`assertWorkflowBinding`/`parseWorkflowBinding` helpers — binding mismatches throw the existing
`WorkflowBindingError` with its accurate code, not a generic report error), `artifactDigests`
(an exact stage-specific key set of 64-lowercase-hex digests), `dimensions`, `findings`,
`blockers`, `verdict` and `evaluation`.

- The three six-dimension stages always evaluate `'scored'`; `dimensions` must have the stage's
  exact 6 canonical ids in canonical order, each `{id, rating, rationale, references}` with an
  integer rating 1–5. They additionally carry `sum` and `mean`.
- `evidence` may evaluate `'scored'` (5 dimensions, ratings 0–20 inclusive, fractions allowed;
  carries `rawTotal` and `effectiveScore`) or `'unavailable'` (explicit missing evaluation: empty
  `dimensions`, verdict `'BLOCKED'`, a nonempty `blockers` array, and **no** `rawTotal`,
  `effectiveScore`, `sum` or `mean` field at all — this is not a fabricated zero score).
- A dimension with empty `references` (missing support) is only accepted when the report also
  carries at least one explicit `blockers` entry — independent of how high that dimension's
  rating is.
- Every supplied computed field (`sum`/`mean` or `rawTotal`/`effectiveScore`) and the supplied
  `verdict` are mechanically recomputed via `reviewVerdicts.evaluateReviewReport` and compared
  with exact (`===`) equality; any mismatch throws `REPORT_RESULT_MISMATCH`. There is no rounding
  and no partial/self-validating "pass shopping".
- The supplied `policy` object's **complete shape is re-validated** through the existing
  canonical `parseReviewPolicy` YAML parser (via a synthetic, non-secret round-trip context)
  rather than re-implementing its threshold/range arithmetic. Every own, enumerable,
  string-keyed, JSON-compatible **data** field at every nesting level — never a non-enumerable
  or symbol-keyed property, and never an accessor (`get`/`set`) descriptor — is copied into an
  independent, data-only graph and preserved into the re-serialized YAML, including any field
  unknown to the schema, so an unrecognized/tampered key (at the document root, within
  `reviewers`, within a reviewer profile, or within `evidence_validator`) is never silently
  dropped before validation; `parseReviewPolicy`'s own unknown-key rejection is the sole
  authority that accepts or rejects it, with its real dotted field path (e.g.
  `reviewers.planning`) and `POLICY_INVALID` code. A policy value that is not built only from
  plain objects, arrays, finite numbers, strings, booleans and null (e.g. a function, a `Date`,
  a non-finite number, an accessor-shaped field, or a cyclic reference) is rejected explicitly as
  `POLICY_INVALID` with field `"$"` before any serialization is attempted, and before any
  accessor or function on the supplied value is ever invoked; there is no success-shaped `{}`
  fallback and no reliance on a `toJSON` method (a hostile `toJSON` can never execute). A
  structurally invalid-but-shape-valid policy (e.g. an out-of-range threshold) is rejected with
  the existing `ReviewPolicyError`'s accurate code.
- Parsing never mutates or freezes the caller-supplied `expected` binding or `policy` objects;
  the returned `ReviewReport` is a deep, independently frozen copy.
- `JSON.parse` (used to decode the report text) does not reject duplicate textual keys within one
  JSON object literal before decoding: per the JSON text grammar, when the same key appears twice
  in a source object, only the last occurrence's value survives parsing and no error is raised for
  the earlier, discarded occurrence. This module validates only the final decoded JavaScript
  object's shape; it makes no duplicate-key-authenticity guarantee about the original request
  text and cannot detect or report that a key was ever duplicated before decoding.
- Error codes: `REPORT_INVALID`, `REPORT_MALFORMED`, `REPORT_TOO_LARGE`,
  `REPORT_VERSION_UNSUPPORTED`, `REPORT_RUBRIC_MISMATCH`, `REPORT_RESULT_MISMATCH` (plus the
  reused, accurately-coded `WorkflowBindingError`/`ReviewPolicyError`). Error messages and
  serialized errors never echo submitted report text or values — only static field-path text.

## Verdict arithmetic (`evaluateReviewReport`)

`evaluateReviewReport(report: ReviewReport, policy: ReviewPolicy): ReviewVerdictResult` performs
**mechanical calculation only** over an already-typed, already-validated `ReviewReport`/
`ReviewPolicy` pair; it never selects a rating and never accepts a caller-supplied verdict as
truth. It is a pure arithmetic function, not an input validator: it performs no shape, range or
type checking of its own and must never be called directly on untrusted/unparsed JSON or an
unvalidated object. `parseReviewReport` is the untrusted-JSON boundary; only the already-validated
`ReviewReport` it returns should ever reach `evaluateReviewReport`.


- Six-dimension stages: `sum` is the sum of all 6 ratings, `mean = sum / 6` (exact, unrounded
  JavaScript division — a fractional mean like `23/6` is never rounded up to pass). A nonempty
  `blockers` array dominates as `'BLOCKED'` regardless of ratings. Otherwise, any mandatory
  finding forces `'CHANGES_REQUIRED'` regardless of how high the ratings are. Otherwise,
  `'QUALITY_VERIFIED'` requires `mean >= policy.reviewers[stage].minimum_average` **and** every
  individual rating `>= policy.reviewers[stage].minimum_dimension`; a single low dimension blocks
  a pass even with an otherwise-high mean.
- Evidence: `rawTotal` is the exact sum of the five (possibly fractional) ratings. If any finding
  is mandatory, `effectiveScore = Math.min(rawTotal, policy.evidence_validator.minimum_score - 1)`
  — the hard-failure cap always tracks the *configured* `minimum_score`, never a hardcoded value
  such as 84, and never exceeds the genuine `rawTotal`. Otherwise `effectiveScore = rawTotal`.
  A nonempty `blockers` array dominates as `'BLOCKED'`; otherwise `'QUALITY_VERIFIED'` requires
  `effectiveScore >= policy.evidence_validator.minimum_score`.
- An `'unavailable'` evidence evaluation returns only `{ verdict: 'BLOCKED' }` — no invented
  scores of any kind.
- This function never mutates its inputs.

## Portable validation commands

```
npm run test:workflow-reports
```

equivalent to:

```
npm run compile-tests && node --test out/review/reviewRubrics.test.js out/review/reviewReports.test.js out/review/reviewVerdicts.test.js
```

A separate, portable, **no-source-map** coverage build compiles to a dedicated output directory
and runs the same three test files under Node's built-in coverage collector. This separate
no-map build exists because Node 20's test-coverage reporter was previously observed to fail when
instrumenting output that carries source maps; emitting plain JavaScript with no source map lets
the coverage collector report coverage against the emitted JS itself, and this override is passed
only on the command line (`--outDir`/`--sourceMap false`) — it never modifies the project's
production `tsconfig.json`:

```
node node_modules/typescript/bin/tsc -p . --outDir out/coverage-reports --sourceMap false --noEmit false \
  && node --test --experimental-test-coverage \
    out/coverage-reports/review/reviewRubrics.test.js \
    out/coverage-reports/review/reviewReports.test.js \
    out/coverage-reports/review/reviewVerdicts.test.js
```

Both commands invoke this checkout's own installed `node_modules/typescript/bin/tsc` binary
directly (never `npx`, which can fetch and run an unpinned/unreviewed package) against this
checkout's own `tsconfig.json` and `out/` layout; neither references any session-local path,
machine or user-specific location.

## Limits and no-authority guarantee

- Parser byte/field/count limits (exact, explicit, never silently truncated): report text is
  capped at `REVIEW_REPORT_MAX_BYTES` (262144 UTF-8 bytes) before JSON parsing; `rationale`/
  finding `obligation`/`correction` are capped at 8192 UTF-16 code units; each reference string is
  capped at 2048 UTF-16 code units; finding `id` is capped at 256 UTF-16 code units; `findings`,
  `blockers` and each dimension's/finding's `references` array are each capped at 100 entries.
  `artifactDigests` requires the exact stage-specific key set, no more and no fewer. The
  re-validated `policy` object is walked to an explicit maximum nesting depth of 32 before
  re-serialization, and the policy YAML text itself remains subject to `reviewPolicy.ts`'s own
  `REVIEW_POLICY_MAX_BYTES` (65536 bytes) cap. Every one of these bounds is a structural/format
  safety limit, not a semantic score, calibration or authority decision.
- This increment proves schema/arithmetic consistency only. It does not authenticate evidence or
  human consent, does not certify that retained artifact bytes/source were actually retrieved,
  does not initialize or write any workflow record, and does not enforce any invocation/
  production budget or cap.
- A computed `QUALITY_VERIFIED` verdict never by itself authorizes production implementation,
  status transition, signing, publication or human acceptance; those remain separate,
  independently authorized actions elsewhere in the workflow.
- Semantic judgment (whether a rating is *correct*) remains an instruction-governed human/
  reviewer responsibility; this code only proves that a report's arithmetic, schema and
  cross-references are internally consistent.
- The supplied-policy re-serialization step builds an independent, data-only copy containing
  only the policy's own *enumerable, string-keyed, plain-data* fields (every ordinary own key at
  every nesting level, including any unknown to the schema) — it never reads a non-enumerable
  property, a symbol-keyed property, or any accessor (`get`/`set`) descriptor; an accessor-shaped
  field is rejected outright by shape alone, never invoked, read or copied. It then re-validates
  that independent copy — never the caller's original object — through the existing canonical
  `parseReviewPolicy`, and rejects non-representable/cyclic input explicitly; it does not itself
  define, weaken or re-derive any threshold/range decision — `reviewPolicy.ts` remains the sole
  numeric authority. This is an ordinary-property-access boundary that assumes a trusted,
  in-process, non-`Proxy` caller: a `Proxy`-wrapped policy object can define its own traps on the
  reflective operations this step relies on (`Object.keys`, `Object.getOwnPropertyDescriptor`,
  `Object.getPrototypeOf`) and is explicitly out of scope for this guarantee. Successfully
  re-serializing and re-validating a policy's *shape* never by itself certifies that the supplied
  policy object originated from an authenticated or approved source — this generic serialization
  step proves shape fidelity only, never authenticity.
