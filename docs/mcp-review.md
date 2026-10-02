# MCP human-review API

Ordinary task edits and status-only `under-review` submission still use
`sprintdesk_updateTask`. It rejects `done`, raw `review` and `humanVerification`
arguments, even when the caller supplies a registered reviewer ID or a
`confirmed` flag. These inputs are not human authority.

| Tool | Inputs | Effect |
| --- | --- | --- |
| `sprintdesk_recordTaskEvidence` | `taskId`, ordered `evidence: [{ criterion, content }]` | Writes only an in-progress task's Evidence section; returns persisted `{ task, markdown }`, without status/run/approval changes. |
| `sprintdesk_requestHumanReview` | `taskId` | Opens the companion UI; records no approval. Headless hosts are refused. |
| `sprintdesk_getReviewSnapshot` | `taskId`, optional `evidencePaths` | Reads snapshot, lifecycle projections and signed receipts. Requires enrollment. |
| `sprintdesk_commitHumanReview` | `receipt: { payload, signature }` | Delivers an already signed review/completion intent, never signs. |

## Status-only execution handoff

After whole-task pre-review validation, the execution owner reads the task and
its exact ordered criteria. If current persisted evidence is absent or stale,
call `sprintdesk_recordTaskEvidence` while the task is `in-progress`:

```json
{
  "taskId": "SPD-101",
  "evidence": [
    {
      "criterion": "The fixture contains REVIEW-FIXTURE-OK.",
      "content": "File-byte inspection found REVIEW-FIXTURE-OK in the fixture."
    }
  ]
}
```

This synthetic example assumes that exact single criterion exists. The tool
requires one non-blank entry per actual criterion, with exact text and order.
Only `taskId` and `evidence` are accepted; evidence entries accept only
`criterion` and `content`. Unknown tasks, empty criteria and other task states
are rejected without writing. The returned Markdown is read after persistence,
not echoed input. Compare it with the intended evidence and verify unchanged
task metadata. Re-read identity, status, criteria and evidence before calling
`sprintdesk_updateTask` with only `taskId` and `status: "under-review"`, then
verify the transition's readback. No new human approval is created.

Missing tool support, invalid evidence or failed persistence/readback blocks the
handoff. A readback failure may follow a successful evidence write: inspect the
stored content before retrying, never infer that it was rolled back. Identical
evidence writes are repeatable while in-progress without duplicate sections.
Already-under-review tasks are read-only no-ops for this workflow; reconcile
missing/stale evidence with the execution owner rather than rewriting it.

`sprintdesk_tasksComplete` remains available for a different combined workflow:
it changes workStatus to `review` and may complete a run. Do not use it as a
fallback for a status-only submission.

## Signed human review

Evidence paths are bounded, repository-relative text files outside
`.SprintDesk`. Selected bytes, ordered criteria, description, notes and task
metadata are hashed. Generated handoff text is a projection. A signed review
records every result. An all-met signed review keeps the task Under Review;
one or more `needs work` results atomically changes it to
`needs-modification` (**Needs Modification**) while retaining the signed
review, receipt, and feedback. Separate signed completion requires the current
all-met review and changes status/work status to Done. Rejection leaves the
task unchanged.

Missing enrollment, invalid signatures, wrong intent/task/project/key, changed
content, reused operations and stale sequence numbers fail explicitly.
Cross-host command workspace mismatches report the requested path and the main
extension's open-folder URI/path pairs for diagnosis. These contain folder
locations, not signing keys. Preserve the existing local enrollment and retry
its public mirror only after resolving the mismatch; do not recover a key
merely because delivery failed.
Exact repeated delivery is idempotent after checking content and projections.
Task-YAML receipt/state/audit-history writes are atomic and protected by an
exclusive writer lock on the Node host. Contention is an explicit error.
See [lock recovery](authenticated-review.md#mutation-routes-and-recovery).
If Markdown refresh
fails after the commit, inspect readback and retry delivery of the same receipt;
never generate substitute human consent.

`needs-modification` is available in task reads and `sprintdesk_listTasks`
filters. It is intentionally not accepted by `sprintdesk_updateTask`: only a
valid, current signed Needs-work review can create this rework status.

Remote responses and YAML are not independent proof. Use the
[local companion](../companion/README.md) to check them against locally retained
trust roots and receipts. See the [trust contract](authenticated-review.md).

## Developer checks

From the extension repository:

```sh
npm run test:review-authorization
npm run test:mcp
npm run test:data-service
npm run test:reviewers
```

These exercise simulated signing keys and persistence, not actual human UI
consent or installed extension-host behavior.
