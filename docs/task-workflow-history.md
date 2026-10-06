# Task Workflow History (`src/review/NodeTaskWorkflowHistory.ts`)

`NodeTaskWorkflowHistory` is a **task-bound custody adapter** over two already-independently
tested libraries: `NodeWorkflowIdentities` (canonical task context) and `NodeWorkflowHistory`
(bounded artifact/revision ledger). It fixes the canonical custody location for a given task to
`.SprintDesk/workflow/history/<protocol.digest({projectId, taskId, incarnation})>/`, re-verifies
the live canonical task context before and after every write, and gates every mutation behind a
trusted, constructor-injected `WorkflowMutationAuthority`.

It is **not**:

- a human approval, a signed reviewer receipt, or any authority/authentication claim of its own;
- a live host-execution/plan/phase authority adapter, cancellation observer, or cryptographic
  provenance source — this increment does not implement a real host adapter;
- a planning archive, an MCP endpoint, a task creation-event journal, or a writer of `status`,
  `assignee`, or any other live task field;
- a replacement for, or reimplementation of, `NodeWorkflowIdentities` or `NodeWorkflowHistory` —
  every byte-custody, chain, conflict, idempotency, and readback guarantee is delegated to the
  latter untouched.

## Trust boundary

`WorkflowMutationAuthority` is a trusted constructor-injected **host** adapter — never a model/tool
argument, a caller-authored approval flag, or a signed review receipt carried over from another
operation. A missing authority blocks **every** write with `CUSTODY_AUTHORITY_UNAVAILABLE`, even
for an otherwise-valid in-progress registered task; read-only operations (`context`, `head`,
`read`, `readBytes`, `list`) never require authority at all. A future real host adapter must
independently establish actual current scope/execution/phase/plan authority and cancellation; no
proposed JSON, chat-stored flag, status, signed review from another operation, or caller
confirmation is accepted here as a substitute. Every `WorkflowMutationAuthority` implementation
exercised in this module's own test suite is an explicitly labelled **SYNTHETIC** fixture — none
of them are, or substitute for, real human approval, signed consent, or an operational host trace.

## Shape

```ts
new NodeTaskWorkflowHistory(workspaceRoot, taskId, authority?, writer?, publisher?)
```

- `WorkflowMutationAuthority { assertAllowed(request: WorkflowMutationRequest): void }`.
- `WorkflowMutationRequest { workspaceRoot, context: WorkflowTaskContext, operation:
  WorkflowCustodyOperation }` — an immutable, deeply frozen copy handed to the authority.
- `WorkflowCustodyOperation` — `{ kind: 'initialize' }` or `{ kind: 'append', operationId,
  expectedLatest, binding, artifactKind, contentDigest }`. `contentDigest` is always computed from
  an **already-copied** snapshot of the caller's bytes, taken before binding parsing, authority
  consultation, or any lock/mutation — a later, or even an in-authority-callback, mutation of the
  caller's own original array can never affect the digest handed to authority or the bytes
  ultimately persisted.
- `WorkflowCustodyError` — `{ code, commitMayHaveChanged }`, never echoing artifact bytes, Base64
  content, binding digest material, invalid input values, submitted key names, or any authority
  provider's thrown exception text (which is always replaced with a static, sanitized message).
- Reuses the existing `WorkflowTaskContext`, `HistoryPublisher`, `HistoryHead`, `HistoryRevision`,
  `HistoryAppend`, `HistoryArtifactKind`, and `WorkflowBinding` types/parsers without any
  compatibility alias or reimplementation.

## Construction

The constructor validates an absolute, already-normalized `workspaceRoot` string; a nonblank,
at-most-256-UTF-16-code-unit `taskId`; and the structural shape of an optional `authority` adapter
(`assertAllowed` must be a function) — all before ever consulting authority or resolving a task.
Immediately after its own argument checks, it also reuses `NodeWorkflowIdentities`' existing
canonical-root validation (constructing a `NodeWorkflowIdentities(workspaceRoot)` to run its
`lstat`/`realpath` existence, non-symlink-root, and no-symlinked-ancestor checks) so that a
nonexistent root, a root that is itself a symlink, or a root reached only through a symlinked
ancestor segment is rejected right here as `CUSTODY_CONTEXT_INVALID(false)` — with no task/
registry read, no authority consultation, and no filesystem mutation. This is a **read-only**
existence/shape check on the root path itself, never a duplicated filesystem parser: the actual
canonical-task-store parsing (registry/task file reads, status/digest resolution, etc.) remains
owned entirely by `NodeWorkflowIdentities#resolveTask`, invoked fresh the first time a context is
actually resolved. The constructor performs no filesystem mutation of any kind, no project/history
initialization, no `cwd`/global-host fallback, and no task-code/title similarity matching or
implicit task registration.

## Context resolution

`context()` calls `NodeWorkflowIdentities#resolveTask` fresh on every invocation — never cached —
and returns its already-frozen, independent `WorkflowTaskContext` snapshot untouched. Missing,
replaced, ambiguous, or source-failure identity errors (`TASK_UNREGISTERED`, `TASK_REPLACED`,
`TASK_STORE_MISSING`, etc.) propagate exactly as `NodeWorkflowIdentities` raises them; this module
never duplicates or reinterprets that parser or its error codes.

## Canonical custody location

The custody directory is always exactly
`workspaceRoot/.SprintDesk/workflow/history/<protocol.digest({projectId, taskId, incarnation})>/`,
with the identity tuple copied from the actual registry-resolved context — never from a
caller-supplied storage root, folder title, or submitted binding. There is no path-injection
surface: the directory string is derived solely from already-validated identity fields.

## `initialize()`

Only `initialize()` may allocate the fixed `.SprintDesk/workflow`, `.SprintDesk/workflow/history`,
and per-task digest directories, and only after every guard below has passed. Each boundary is
checked independently: a pre-existing symlink or non-directory node is rejected
(`CUSTODY_PATH_INVALID`) without ever being followed or overwritten; a pre-existing
permissive-mode directory is rejected without being `chmod`-recovered; a pre-existing strict
owner-only (`0700`) directory is reused rather than rejected. Freshly created directories are
created with mode `0700` and defensively `chmod`-verified against the process umask. Once the
directory chain is established, the actual ledger initialization is fully delegated to
`NodeWorkflowHistory#initialize()` — including its own existing-ledger refusal
(`HISTORY_ALREADY_EXISTS`), staging, publication seam, and independent post-publish readback.

## `append()`

`append()` never creates or `chmod`s any directory. A missing ledger propagates the exact
`HISTORY_MISSING` error `NodeWorkflowHistory` itself would raise — never an implicit
initialization and never a different code. The five-field `HistoryAppend` request (`operationId`,
`expectedLatest`, `binding`, `kind`, `bytes`) is validated — exact known fields only, safe
integers, a supported `HistoryArtifactKind`, a `Uint8Array`, and the existing `workflowBinding`
parser (its errors propagate unchanged) — entirely before any lock, authority consultation, or
mutation. The submitted binding's `projectId`/`taskId`/`incarnation` must match the actual current
task context exactly, or the request is rejected as `CUSTODY_BINDING_MISMATCH` without ever
allocating or writing anything. `HISTORY_ARTIFACT_MAX_BYTES` is reused directly from
`NodeWorkflowHistory`; there is no duplicated or looser size rule here. An old-operation replay
(the exact same `operationId` and fields, re-submitted after a later append moved the head) still
re-consults authority and re-validates task status/context on every attempt — it never
short-circuits straight to the cached ledger result, and it is still blocked if the task has since
left `in-progress` or if authority has since changed its mind.

## The task mutex and the guarded mutation sequence

Both `initialize()` and `append()` share one guarded sequence:

1. **Before the task lock**: resolve the actual current task context once, to surface an
   accurate missing/unregistered/source error rather than a confusing lock-contention failure
   when `.SprintDesk/data` itself does not yet exist.
2. **Acquire** the exact `.SprintDesk/data/tasks.yml.lock` mutex already used by other task
   writers (never a parallel lock, never age-reclaimed, never used to call `registerTask`). A
   foreign holder fails immediately and explicitly as `CUSTODY_BUSY(false)`, without ever
   consulting authority.
3. **While the lock is held**: resolve the canonical context again and compare every one of its
   seven fields (including `taskDigest` and `registryDigest`) against the caller's validated
   expected context. Any mismatch is `CUSTODY_CONTEXT_CHANGED(false)` — nothing has been written
   yet. The task's live status must be exactly `in-progress` (including for an idempotent replay),
   or the operation is rejected as `CUSTODY_TASK_STATE_INVALID(false)`.
4. **Authority**: an immutable, deeply frozen `WorkflowMutationRequest` (current workspace root,
   current context, and the exact operation fields) is handed to `authority.assertAllowed(...)`
   immediately before any custody setup or write. A missing authority is
   `CUSTODY_AUTHORITY_UNAVAILABLE(false)`; a rejecting or throwing authority is
   `CUSTODY_AUTHORITY_REJECTED(false)` with a static message — the provider's own thrown detail is
   never echoed.
5. **Post-authority re-check**: the canonical context is resolved **again** and re-compared before
   any mutation. A callback that merely ran is not proof of consent — an authority that mutated the
   real task source from within its own `assertAllowed()` is still blocked here,
   `CUSTODY_CONTEXT_CHANGED(false)`, with nothing yet allocated.
6. **The actual delegated operation**: `initialize()`'s guarded directory allocation plus
   `NodeWorkflowHistory#initialize()`, or `NodeWorkflowHistory#append()` against the already
   existing ledger.
7. **Post-mutation re-check**: with the task lock still held, the canonical context is resolved
   and compared a final time. From this point on, any drift — or any failure to even re-resolve
   the source — is reported as a genuinely uncertain outcome, `CUSTODY_CONTEXT_CHANGED(true)`: a
   real write may already have committed, and it is never rolled back, silently retried, or used
   to advance any gate.
8. **Lock release**: the mutex is released only if this process's own held file (verified by
   device/inode, never by age) is still the one on disk. A replacement lock is left completely
   untouched and reported as `CUSTODY_BUSY`, with the commit flag set `true` only when a mutation
   was genuinely attempted beforehand — a pre-guard/authority/source rejection always reports
   `commitMayHaveChanged=false`.

## `commitMayHaveChanged`

Every `WorkflowCustodyError` carries `commitMayHaveChanged`:

- **`false`** — a prewrite rejection: malformed request/context, context drift, invalid task
  state, binding mismatch, missing/rejected authority, a pre-existing invalid custody path, or
  lock contention detected before any custody setup. Nothing was attempted; existing custody state
  is exactly as it was.
- **`true`** — a custody setup/write was genuinely attempted (directory allocation, ledger
  initialize/append) and the outcome is uncertain: the post-mutation context recheck detected
  drift or could not re-resolve the source, or the task lock could not be safely confirmed
  released afterward. Callers must independently inspect actual on-disk state (for example, a
  fresh, uninjected reader instance's `head()`/`list()`) before assuming either success or
  failure — this module never retries, rolls back, or silently papers over this state.

Errors originating from the delegated libraries (`NodeWorkflowHistory`, `NodeWorkflowIdentities`,
`workflowBinding`) keep their own accurate codes and flags unchanged; this module only introduces
its own codes for genuinely task-custody-specific guards: `CUSTODY_CONTEXT_INVALID`,
`CUSTODY_REQUEST_INVALID`, `CUSTODY_CONTEXT_CHANGED`, `CUSTODY_TASK_STATE_INVALID`,
`CUSTODY_BINDING_MISMATCH`, `CUSTODY_AUTHORITY_UNAVAILABLE`, `CUSTODY_AUTHORITY_REJECTED`,
`CUSTODY_PATH_INVALID`, `CUSTODY_BUSY`, and `CUSTODY_SETUP_FAILED`.

## Reads

`head()`, `read(sequence)`, `readBytes(sequence)`, and `list(afterSequence, limit)` never acquire
the task mutex, never require authority, and never create, `chmod`, or delete anything. Any known
registered task status — including `under-review` and `done` — still permits reads; only an
actual replacement/source/identity mismatch (propagated from `NodeWorkflowIdentities`) or a
genuinely missing/invalid ledger (propagated from `NodeWorkflowHistory`, including
`HISTORY_MISSING` for a never-initialized task) blocks them.

## Limitations

- **Synthetic vs. real authority.** Every `WorkflowMutationAuthority` exercised by this module's
  own tests is an explicitly labelled SYNTHETIC fixture. None of them are, or can stand in for,
  real human approval, signed consent, or an operational host trace. A real host adapter —
  independently establishing actual current scope/execution/phase/plan authority and
  cancellation — remains a separate, not-yet-built increment.
- **Birth-journal limitation, inherited.** `NodeWorkflowIdentities` cannot distinguish a task
  deleted and recreated with an identical `id` + `createdAt` from the original task; this adapter
  does not, and cannot, cure that limitation. A real task creation-event journal and enrolled
  project reconciliation remain deferred.
- **No archive, MCP, or live task mutation.** This module reads and writes nothing beyond its own
  fixed custody tree; it never touches `tasks.yml`, approval/Markdown/enrollment state, a planning
  archive, or any MCP endpoint, and it never performs a live `status`/`assignee` write or human
  acceptance/completion.
- **Local, single-filesystem guarantees only.** As with `NodeWorkflowHistory`, no guarantee is
  made against loss from an actual power failure or storage-device fault during the underlying
  write/link syscalls themselves; every consistency check here is a tamper/drift-detection
  property over bytes and task state already observed through this process's own file
  descriptors, not an authentication guarantee of who produced them.
- **Portable, no-install coverage tooling.** A coverage view can be produced the same way as for
  `NodeWorkflowHistory`, using only the TypeScript compiler already present in `node_modules` and
  Node's own `--experimental-test-coverage` reporter against generated JavaScript under `out/`
  (never against the original `.ts` sources, and never introducing a new installed tool). From the
  extension repository root, with no `npx` fetch and no change to the project's own `tsconfig.json`:

  ```
  node node_modules/typescript/bin/tsc -p . --outDir out/coverage-task-custody --sourceMap false --noEmit false
  node --test --experimental-test-coverage out/coverage-task-custody/review/NodeTaskWorkflowHistory.test.js
  ```

  The first command is a separate, ignored (`out/coverage-task-custody`) compiler invocation — it
  reuses the repository's own already-installed `typescript` binary and the project's existing
  `tsconfig.json` project settings, only overriding `outDir` and forcing `sourceMap false`. This
  separate no-source-map build is required because Node 20's built-in
  `--experimental-test-coverage` reporter has been observed to fail when attempting to resolve
  source maps back to `.ts` originals; emitting without maps avoids that failure entirely, without
  touching the project's real `tsconfig.json` or its normal `out/` build. The second command then
  runs the already-reviewed compiled test file directly from that separate output directory. The
  resulting coverage reflects the actually-executed **emitted JavaScript**, line-for-line against
  `out/coverage-task-custody`, not a TypeScript-source-mapped certification, and it is not a
  substitute for the real `npm run test:task-workflow-history` regression run above. An unexecuted
  branch in such a report is not automatically "unreachable" — it may simply be untriggered by a
  particular run.


## Validation

From the extension repository root:

```
npm run test:task-workflow-history
```

This compiles the test sources and runs `NodeTaskWorkflowHistory.test.ts` (and its cross-process
worker fixture, `taskWorkflowHistoryWorker.ts`) under Node's built-in test runner. A green run is
machine-checked regression and behavior evidence; it is not human acceptance of this increment,
and it is not — and cannot be — a certification of authenticity, semantic correctness, or approval
for anything a real future host authority chooses to authorize.
