# Workflow Binding and Review Policy

This document describes two small, read-only building blocks used by the review workflow:
a canonical stage/binding record and a strict four-profile numerical review policy loader.
Both layers prove **consistency**, never authorization, semantic judgment, or human approval.

## Workflow binding (`src/review/workflowBinding.ts`)

`WorkflowBinding` is a versioned identity record tying a piece of produced work to an exact
`projectId` / `stage` / `taskId` / `incarnation` / `criterionId` / `criterionRevision` /
`sourceRevision` / `sourceDigest` / `policyDigest` / `attemptId` combination.

- `WORKFLOW_STAGES` is the exact four-stage tuple: `planning`, `translation`, `test_code`,
  `evidence`.
- `parseWorkflowBinding(value)` validates an unknown value field-by-field (no coercion, no
  trimming, no invented identifiers) and returns a frozen copy. All fields are required; unknown
  extra fields are rejected.
- `assertWorkflowBinding(actual, expected)` validates both inputs independently, then compares
  every field (not only task/source) and throws `BINDING_MISMATCH` identifying the first
  differing field on any stale, foreign, reordered, or substituted value.
- Errors are instances of `WorkflowBindingError` with a `code`
  (`BINDING_INVALID` | `BINDING_VERSION_UNSUPPORTED` | `BINDING_MISMATCH`) and a `field` that
  identifies the known offending field or `$` for the whole value; submitted values are never
  echoed in error output.

This module proves field-for-field consistency only. It does not prove that the referenced
source, task, or criterion actually exist, and it is not a signed receipt or a replacement for
any existing human review field.

## Review policy (`src/review/reviewPolicy.ts`, `src/review/NodeReviewPolicy.ts`)

The review policy is a small YAML document with exactly four numerical profiles:

```yaml
schema_version: 1
reviewers:
  planning: { minimum_average: 4, minimum_dimension: 3, max_refinement_cycles: 3 }
  translation: { minimum_average: 4, minimum_dimension: 3, max_refinement_cycles: 3 }
  test_code: { minimum_average: 4, minimum_dimension: 3, max_refinement_cycles: 3 }
evidence_validator: { minimum_score: 85, max_refinement_cycles: 3 }
```

The `4` / `3` / `85` values above and each profile's `max_refinement_cycles: 3` are **initial
template defaults** only — the starting values rendered by `renderDefaultReviewPolicy()` and
returned by `getDefaultReviewPolicy()`. They are never silently applied as a fallback: if a real
policy file is missing a field, parsing fails with `POLICY_INVALID` rather than substituting
these (or any other) values. `max_refinement_cycles` is a count of **additional** refinement
rounds permitted after the initial review, not a total attempt count; `max_refinement_cycles: 0`
means the initial review only, with zero additional refinement rounds allowed — it is a strict
cap, never unlimited, and is never silently applied when absent from the input.

- `REVIEW_POLICY_MAX_BYTES` (`65536`) is the exact UTF-8 byte cap, enforced before parsing.
- `parseReviewPolicy(text, context)` parses with `js-yaml`'s `JSON_SCHEMA` (a strict, data-only
  schema): duplicate mapping keys, multi-document streams, and unrecognized YAML tags are
  rejected as `POLICY_MALFORMED`; the schema has no merge-key (`<<`) type, so a literal `<<` key
  is reported as an ordinary unrecognized field of its containing known mapping.
- Every required field is validated exactly: `minimum_average` is a finite number in `[1, 5]`;
  `minimum_dimension` is an integer in `[1, 5]`; `minimum_score` is an integer in `[1, 100]`;
  every `max_refinement_cycles` is a nonnegative safe integer (`Number.MAX_SAFE_INTEGER` is
  valid; the next integer value is not). There are no implicit defaults for missing fields.
- `getDefaultReviewPolicy()` returns a fresh, deeply frozen default policy on every call (no
  shared mutable object). `renderDefaultReviewPolicy()` renders the same default values as YAML
  text from a single authoritative set of constants, so the two can never drift apart.
- Errors are instances of `ReviewPolicyError` with `code`, `operation` (`'parse'` for parser
  failures, `'read'` for loader read-boundary failures, `'context'` for invalid context),
  `projectId`, `filePath`, a required `field` string (a dotted known schema path, e.g.
  `reviewers.planning.minimum_average`, when one is known, or the literal sentinel `'$'` when
  no specific schema field applies — it is always present, never omitted), optional one-based
  `line`/`column` when available from the YAML parser, and a nonempty `correctiveAction`. Error
  output never includes raw source text, YAML snippets, or attacker-controlled unknown key
  names.

`NodeReviewPolicy` is the read-only, per-project loader:

- The constructor validates workspace/project identity **eagerly** (nonblank `projectId`, an
  absolute, existing, canonical, directory `workspaceRoot` not reached through any symlinked
  path component, including ancestor directories) using real, read-only filesystem reads
  (`lstat`/`realpath`); it performs no filesystem mutation. Invalid context throws
  `POLICY_CONTEXT_INVALID` immediately, before any policy-file access is attempted.
- `read()` only reads `.SprintDesk/settings/review-thresholds.yml` below the validated
  workspace. It never creates, initializes, touches, or `chmod`s any file.
- The path from workspace root to the policy file is walked using `lstat` only (never a
  blocking `open`), rejecting symlinked intermediate directories, non-directory intermediates,
  and any final target that is not a plain regular file. This means a FIFO at the policy path
  is rejected before any blocking open is ever attempted.
- The actual read is bounded to `REVIEW_POLICY_MAX_BYTES + 1` bytes using a single open file
  descriptor, which is always closed on both success and failure.
- `read()` returns the lowercase SHA256 digest of the exact bytes that were parsed (not
  normalized YAML, not a path hash). Digest equality is not authenticity or approval.
- Observed identity (device, inode, size, modification time) is compared across the pre-open
  `lstat`, the post-open `fstat`, and the post-read `fstat`; any mismatch is reported as
  `POLICY_CHANGED` rather than silently attributing mixed bytes to a single policy snapshot.
  **Known limitation:** this only detects drift that is *observable* by comparing those three
  snapshots — it has NOT been deterministically tested against a drift that occurs strictly
  *during* the bounded read call itself (between individual read syscalls, before the final
  `fstat`), and this loader offers no guarantee against a hostile, co-located actor racing the
  same user's own writes mid-read.

### Limitations

- This loader detects concurrent-modification signals it can actually observe at its
  pre-open/post-open/post-read checkpoints; mid-read drift between individual syscalls is not
  deterministically tested here and is not guaranteed to be caught, and this is not a security
  boundary against a determined, co-located, same-user attacker.
- Digest and identity checks say nothing about whether the parsed values are an *approved*
  policy; an explicit policy initializer, pinned approved-task snapshots, and policy-change
  authorization are separate, not-yet-built concerns outside this loader's scope.

## Validation

From the extension repository root, run:

```
npm run test:workflow-policy
```

This compiles the test sources and runs the three suites (`workflowBinding.test.ts`,
`reviewPolicy.test.ts`, `NodeReviewPolicy.test.ts`) under Node's built-in test runner.

For a coverage-instrumented run, emit a separate, no-sourcemap output directory and run the
compiled suites directly against it:

```
node node_modules/typescript/bin/tsc -p . --outDir out/coverage-policy --sourceMap false --noEmit false
node --test --experimental-test-coverage out/coverage-policy/review/workflowBinding.test.js out/coverage-policy/review/reviewPolicy.test.js out/coverage-policy/review/NodeReviewPolicy.test.js
```

A separate, no-sourcemap `out/coverage-policy` output is used instead of reusing the ordinary
`out` build because Node 20's `--experimental-test-coverage` reporter has an observed issue
correlating coverage back to source when source maps are present; emitting without source maps
into its own directory avoids that issue, leaves the production `tsconfig.json`/`tsconfig.build.json`
entirely unchanged, and reports coverage directly against the real emitted JavaScript rather than
a remapped or inferred location.

**Test environment requirements:** an unprivileged (non-root) Linux user — several tests assert
`POLICY_UNREADABLE` from a permission-denied file, which has no effect when run as root; a
working `/proc/self/fd` (used by the descriptor-leak tests); and `/usr/bin/mkfifo` on `PATH`
(used by the FIFO-rejection test). These are environment facts, not a claim that the suite
completes within any particular time limit.

**These commands exercise only what the test suite actually asserts.** A green run is
machine-checked regression and behavior evidence; it is not human acceptance of this increment,
and it is not — and cannot be — a certification that the mid-read `POLICY_CHANGED` race
(see the known limitation above) has been tested or is absent. That race remains untested by
design, as stated above.
