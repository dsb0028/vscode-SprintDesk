# SprintDesk Local Reviewer (unpublished companion)

This **desktop UI-only** extension is an independent local authority for the
[version 1 authenticated review contract](../docs/authenticated-review.md).
It bundles the existing shared `../src/review/protocol.ts`; it neither loads
remote code nor trusts the remote enrollment registry. Parent SprintDesk owns
mutation enforcement. Install the parent in the workspace host and this
companion in the **local UI host**, separately. No installation/publication is
performed by the build.

## Build and standalone validation

Use the parent checkout's existing Node/TypeScript/webpack dependencies; no
dependency installation is required. From this directory:

```sh
npm run test
npm run lint
npm run package
```

`package` type-checks, builds a production `dist/extension.js`, then writes
`sprintdesk-local-reviewer-0.1.0.vsix`. Its ZIP packager is dependency-free and
includes the companion manifest, README, production bundle and bundled-source
license notices. The bundle
includes the frozen protocol, not the parent's enforcement/service modules.
Generated outputs are ignored. `test` executes real Ed25519 signatures, pure state/ledger and source-reader
checks, filesystem lease/durability tests, and actual-parent integration against
the checkout's existing `../out/data/DataService.js` (which must already be
compiled from the current parent sources). It does **not** run an extension host.
Integration covers both pre-existing and first-inserted generated handoff blocks
with assigned, claimed and absent work status. The companion imports the shared
`reviewedMarkdown` normalizer directly; it has no duplicate implementation.

## Human review workflow

1. Open **SprintDesk: Open Local Authenticated Review**. Select the exact workspace
   in multi-root windows. Open **Developer: Show Running Extensions** and verify
   this companion is running locally. The panel shows extension URI, extension
   kind, desktop app host, remote session name and workspace URI. A `file` URI
   alone does not prove local placement: workspace-kind, browser, unknown host,
   unsupported workspace schemes and remote workspaces without a remote session
   are refused.
2. Enter the reviewer identity and explicitly type `LOCAL UI HOST` after
   personally checking placement. The companion generates an Ed25519 private key
   in local SecretStorage and pins a random project UUID, public key and workspace
   URI in a local fsynced authority file; global state retains a project-presence
   index, not the authoritative receipt ledger. Only the public enrollment is mirrored
   remotely. If mirroring fails, retry **the same enrollment**; never generate a
   replacement key automatically.
3. Load an exact task ID in `under-review`. Read the complete plain-text snapshot.
   Choose additional UTF-8 workspace evidence files if needed; actual
   `workspace.fs` bytes must match the snapshot, including encoding/BOM/line
   endings. Non-UTF-8 files are rejected. Choosing new evidence resets decisions.
4. Decide **one exact criterion at a time**: met, needs work, or needs evidence.
   Needs-evidence pauses a durable local draft, never a signed decision. Closing
   and reopening resumes only the unchanged snapshot and evidence set. Changed
   drafts require explicit discard; old decisions never transfer to new evidence.
   Observed drift durably invalidates the draft even if the source later reverts;
   explicit key/reviewer recovery also invalidates all saved decisions.
5. Confirm the final displayed summary to sign **review only**. Completion
   requires an accepted, current all-met review, a separate completion summary,
   and a separate human confirmation. Every signing path starts exclusively from
   a valid webview confirmation event; the public command can only open the UI.

The parent calls `sprintdeskReviewer.openReview(taskId)`. Its optional task ID
only prefills a newly opened panel; it never submits decisions or signs, and it
does not replace an existing open review. Loading and signing remain human UI
actions. The companion exposes no signing command.

The webview uses a nonce CSP, no command URIs, no resources/network connections,
plain-text remote data, exact action schemas, per-render event tokens, phase
guards and serialized events. Ambiguous/duplicate criteria are refused.

## Independent ledger and recovery

Local state is scoped by the full workspace URI and pinned project UUID.
A filesystem-exclusive local lease is held for the entire review panel lifetime,
before loading its authority file. A second window cannot read, mutate or sign
the same authority. All signing/persistence/delivery paths recheck ownership.
The authority file is written with restricted permissions, fsynced, atomically
renamed and its POSIX directory fsynced **before** a remote commit is delivered.
The project-presence index detects a missing previously enrolled ledger and
blocks automatic replacement.

Crash/stale lease recovery requires a modal human confirmation and proves the
previous owner process no longer exists; a live owner cannot be overridden.
A separate exclusive recovery guard serializes stale recovery. Malformed locks
or abandoned recovery guards fail closed and require explicit local storage
repair with all review windows closed. No TTL or automatic lock/key replacement
is used. Filesystem locking is automated evidence, not installed host evidence.
Before displaying, signing or reconciling, the companion independently reads
`.SprintDesk/data/tasks.yml`, the task Markdown and selected evidence through
`workspace.fs` rather than trusting the command response. Bundled existing
`js-yaml` parses bounded YAML with the JSON schema (no executable tags; duplicate
keys/IDs are rejected). Current metadata, criteria, normalized Markdown, evidence,
status/work status, receipts and review/human-verification projections must match
the remote response. Each source is re-read to detect mid-read changes.
The task path must remain in the pinned workspace; absent paths use the parent's
standard `.SprintDesk/Tasks` filename convention.

Raw Markdown is displayed locally. The reserved `### Review Handoff` block is
prominently labeled **unauthenticated**: it is excluded from the signed digest
and must never be used as approval/evidence. The actual YAML projection, checked
against local receipts, is the authenticated approval source. Arbitrary external
Full raw `tasks.yml` is also displayed, including its top-level `approvals`
history. Root-level approval history is excluded from per-task snapshot metadata
and never replaces the independent local authority/receipt ledger. Arbitrary external
writers can race any finite read; remote service/filesystem-provider honesty and
post-read mutation cannot be proved by a signature.

Each remembered task has its original ID/creation timestamp and random local
incarnation. Per-task receipt sequence increases from the newest local receipt.
Signed intent is persisted **before** remote delivery. Delivery results never
establish success: readback must match the local signature, snapshot, receipt,
status/work status, exact review projection and (for completion) human
verification plus the referenced review. Divergence raises a tamper warning.
Remote legacy/unknown approvals remain **unattested**, not accepted.
Review requires only `status=under-review`; its durable local intent remembers
and compares the actual prior `workStatus` (including assigned, claimed or
absent), without inventing a `review` transition. Only completion requires
`status=done` and `workStatus=done`. A needs-work review can be followed by an
explicit fresh per-criterion review; old decisions are not inherited.

Any pending/failed/uncertain operation blocks new signing project-wide, even for
other tasks. Reconcile by readback or retry **the identical durable receipt**;
neither path signs again. Read errors block remembered identities conservatively.
Explicit original-identity recovery requires a modal human check that the task
was not deleted/recreated and retains the original creation time/incarnation.
Deleted/reused identities require explicit local reset; history remains archived.
An unresolved intent cannot be discarded/reset. Remote project reset may be
needed after genuine deletion/recreation or enrollment recovery; it is not
automated by the companion.

Revocation durably disables local signing and deletes the active private key.
Key loss blocks signing without replacement. Explicit recovery requires
revocation, no unresolved intent, fresh enrollment consent and a new key, while
retaining historical public keys and receipts. Remote enrollment acceptance
remains the parent's responsibility; a failed mirror never changes local trust
based on a remote key. Revocation is local: the hostile remote owner cannot be
forced to erase a public mirror or an old accepted receipt.

## Pending real installation/UI gates

**Not yet certified:** installed VSIX acceptance; local UI versus SSH/container
workspace-host placement; cross-extension command routing; SecretStorage and
global-state persistence on the chosen VS Code installation; real webview clicks,
host-placement consent, evidence picker, cancellation/resume, final confirmations,
commit transport failure/restart reconciliation and tamper display. These require
human installed-extension checks; standalone tests are not human evidence.

Only one review window per enrolled workspace can hold the exclusive lease;
concurrent acquisition and stale recovery have executable tests. Actual installed
multi-window placement/UX still requires human verification. Parent stale-sequence
checks remain essential. A compromised local extension/UI automation is outside
the trust boundary. Remote evidence can lie: signatures attest displayed content
and consent, not test truth or legal identity. No publication or installation is
authorized by this implementation.
