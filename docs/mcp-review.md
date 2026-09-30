# MCP human-review API

Ordinary task edits and status-only `under-review` submission still use
`sprintdesk_updateTask`. It rejects `done`, raw `review` and `humanVerification`
arguments, even when the caller supplies a registered reviewer ID or a
`confirmed` flag. These inputs are not human authority.

| Tool | Inputs | Effect |
| --- | --- | --- |
| `sprintdesk_requestHumanReview` | `taskId` | Opens the companion UI; records no approval. Headless hosts are refused. |
| `sprintdesk_getReviewSnapshot` | `taskId`, optional `evidencePaths` | Reads snapshot, lifecycle projections and signed receipts. Requires enrollment. |
| `sprintdesk_commitHumanReview` | `receipt: { payload, signature }` | Delivers an already signed review/completion intent, never signs. |

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
