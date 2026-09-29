# Authenticated review protocol (version 1)

The remote extension cannot protect files from their owner. Supported writes
must enforce signatures, but only the separately installed local reviewer
companion can authenticate approvals against an independent trust root.
Remote public-key registration is a verification mirror, not local authority.

## Frozen integration contract

The local UI extension uses VS Code's cross-extension commands, not a forwarded
HTTP port. All commands take a workspace filesystem path as the first argument:

- `sprintdesk.reviewSnapshot(workspace, taskId, evidencePaths?)` returns
  `{ snapshot, status, reviewReceipt?, completionReceipt? }`.
- `sprintdesk.reviewEnroll(workspace, enrollment)` writes a public-key mirror.
- `sprintdesk.reviewCommit(workspace, receipt)` applies one signed operation.

`src/review/protocol.ts` is the shared wire contract. The companion bundles that
file, never remote code. Enrollment pins the workspace URI, random project ID,
reviewer identity and public key in local storage. The companion refuses a
remote-host extension URI. There is no command to sign supplied decisions.
Externally invoked commands may only open the local UI; signing requires
per-criterion UI events and a separate final UI confirmation.

Snapshots bind all task metadata except generated approval fields, lifecycle
status/work status and update timestamps. Receipts separately bind the expected
`under-review` state. Identity includes task ID and creation timestamp; the
local authority additionally issues and remembers a random task incarnation.
Deletion/reuse of an identity must require explicit local reset, never automatic
re-enrollment. Evidence binds the task Markdown and selected repository-relative
files by their actual text bytes. The reserved generated `### Review Handoff`
block is a projection, not evidence; do not place evidence inside it.

Canonical JSON sorts object keys, preserves array order, excludes undefined
object values, rejects non-finite numbers and unsupported values. SHA-256 binds
the canonical snapshot. Ed25519 signs the complete canonical receipt payload.
Payloads contain protocol version, intent, project, task incarnation, reviewer,
key ID, snapshot digest, operation UUID, monotonically increasing local
sequence and timestamp. A completion payload also references the review
operation. A review contains every exact criterion in order with met/needs-work
decisions; timestamps derive from the signed receipt. Undecided is draft-only.

## Mutation routes and recovery

`DataService.saveTasks` is the supported shared gate: MCP status/review writes,
task-service updates, path updates, create/import and bulk saves pass through it.
Introducing or changing submitted review, completion verification or signed
receipts requires a dedicated signed commit. New done/workStatus-done records
are denied on create/import. Ordinary metadata edits and pending handoffs remain
allowed. Existing legacy approvals are preserved as **unattested**, never
upgraded to signed approval by a mutable flag. Local readback warns when a
remote projection differs from the local ledger, snapshot or signed decisions.

Before commit, re-read snapshot/evidence and compare to the signed digest.
Review and completion are different intents; completion requires an accepted
current review. Exact repeated delivery is idempotent; reusing an operation with
different bytes, stale sequences, drift, or other task/project keys is rejected.
Store receipts in the same task-YAML write as the protected state. A failed
write cannot consume an operation in a separate remote ledger. The task store
also retains an `approvals` history in that atomic write; `sprintdesk_auditList`
projects its signed operations without creating duplicate audit events on
re-delivery. This remote history is still not an independent trust root.
The local ledger
records intent before delivery; uncertain delivery is reconciled by readback,
not another signature. Remote supported saves acquire an exclusive task-store lock, re-read the
snapshot and atomically persist state/receipts inside it. Lock contention fails
closed; do not blindly retry or remove a live writer's lock. After a process
crash, an operator must establish the writer has stopped, inspect readback and
explicitly recover the exact `tasks.yml.lock`. Outside filesystem writers
remain outside that guarantee.

## Limits and installation gates

Local computer, installed companion, SecretStorage and UI are trusted.
Signatures attest the displayed payload and consent, not test truth or legal
identity. Remote source may lie or destroy files; the local ledger must remain
independent. A compromised local extension or local UI automation is out of
scope. Private keys must never enter remote paths, arguments or logs.

Do not replace an enrolled key automatically. Local key loss or revocation
blocks new signing until explicit local re-enrollment; retained public keys
and historical receipts remain necessary to verify old operations.
Publication, local installation, enrollment and installed acceptance are
separate human checkpoints. Automated tests are not installed human evidence.
