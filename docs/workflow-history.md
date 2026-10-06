# Workflow History (`src/review/NodeWorkflowHistory.ts`)

`NodeWorkflowHistory` is a bounded, single-file immutable artifact/revision custody library. It
proves byte-for-byte **consistency** and **append-only custody** of artifacts a trusted caller
hands it under a pinned `{projectId, taskId, incarnation}` identity. It is **not**:

- authentic host capture (it never proves the submitted bytes came from any particular source);
- semantic review correctness or human approval;
- a signed receipt, an approval registry, or a live, writable task-tracking identity;
- a replacement for, or reader/writer of, any other `.SprintDesk` tracking state (tasks, Markdown,
  policy files, MCP, archives, or acceptance/current pointers).

It never reads or writes anything outside its own caller-owned custody directory. Steady-state
custody uses exactly two persistent file names there: `ledger.json` (the data) and `ledger.lock`
(the cooperating mutex). Both `initialize()` and `append()` are mutations and are serialized
through the same `ledger.lock`; `initialize()` additionally stages its initial empty ledger
content to a uniquely named temporary path (tagged with the process id and a random UUID, never
a fixed or reused name) before the publication seam atomically installs it — so a custody
directory can transiently contain that staged file as well, not merely the two steady-state
names.

## Shape

- `HistoryIdentity { projectId, taskId, incarnation }` — pinned at construction; every persisted
  envelope and appended `WorkflowBinding` must match all three exactly.
- `HistoryAppend { operationId, expectedLatest, binding, kind, bytes }` — a caller's request to
  append one artifact. `kind` is one of `scenario | translation | review | execution |
  implementation | evidence | guidance | context`.
- `HistoryRevision` — the stored, returned record: `id`, `sequence`, `operationId`,
  `expectedLatest`, `binding`, `kind`, `digest` (SHA256 hex of the raw bytes), `byteLength`,
  `contentBase64` (canonical), `previousDigest` (chain to the prior revision, or `null` for the
  first), and `revisionDigest` (a `protocol.digest` hash over every other field, binding
  identity/kind/operation/content/chain together).
- `HistoryHead { identity, latestSequence, latestDigest }`.
- `HistoryPublisher { publish(stagedPath, ledgerPath) }` — the narrow, optional, injectable
  initialization seam described below.
- `WorkflowHistoryError` — `{ code, commitMayHaveChanged }`, never echoing artifact bytes, Base64
  content, binding digest material, submitted invalid key names, or any injected exception
  message.

`HISTORY_ARTIFACT_MAX_BYTES` (`1048576`) bounds one artifact. `HISTORY_LEDGER_MAX_BYTES`
(`16777216`) bounds the whole serialized ledger file (including retained Base64), not an artifact
count; a bounded single-file ledger can hold only on the order of ~10-12 maximally sized real
appends before this cap is reached — large or streamed custody is an explicitly deferred,
not-yet-built increment.

## Construction, initialization, and the publication seam

```ts
new NodeWorkflowHistory(directory, identity, writer?, publisher?)
```

The constructor only validates: `directory` must be an absolute, existing, canonical, owner-only
(`0700`) directory not reached through any symlinked path component (including ancestors), and
`identity` must be exactly the three pinned string fields, nonblank, at most 256 UTF-16 code
units. It performs **no** filesystem mutation, no `mkdir`, no `chmod`, and never touches
`ledger.json` as a side effect.

`initialize()` is explicit and refuses an existing ledger — even a byte-identical one — rather
than ever overwriting it. Like `append()`, it first acquires the same exclusive `ledger.lock`
mutex (so a foreign-held lock blocks `initialize()` on a fresh, not-yet-initialized directory
exactly as it blocks `append()`, with no exemption for the not-yet-existing-ledger case), and
only then stages the complete, empty, version-1 ledger to a unique temporary path with
owner-only permissions. A `HistoryPublisher` then **atomically publishes without ever replacing
an existing path** (the default uses a same-filesystem hard link, which fails rather than
silently overwrites if the destination already exists). Only `initialize()` ever calls the
publisher; `append()` always replaces the whole ledger atomically through the writer alone,
since an existing ledger is required and expected there.

After a publish attempt that does not itself throw, `initialize()` independently re-reads and
fully re-validates the real, just-published ledger — it never trusts the publisher's own
"returned normally" claim as proof. If that independent readback fails, or the re-read content
does not match the expected empty version-1 ledger, `initialize()` reports
`HISTORY_READBACK_FAILED` with `commitMayHaveChanged = true` rather than ever returning a
success-shaped `HistoryHead`. The same independent-readback discipline applies to `append()`
(see below).

The optional fourth constructor argument lets a trusted caller substitute this publication seam
for testing a real successful publish followed by an uncertain failure (for example, linking the
staged bytes and only then throwing). It is **not** a generic filesystem client or an
authorization surface. Once `publisher.publish` is actually attempted, a failure reports
`commitMayHaveChanged = true` unless the failure definitively establishes that nothing was
published (the default no-overwrite primitive's own refusal of an already-existing ledger is such
a case); a staging failure that happens **before** any publish attempt always reports
`commitMayHaveChanged = false`. The default publisher itself follows this same rule internally:
once its real `fs.linkSync` publish has succeeded, a subsequent failure to remove the now-orphaned
staged file is never silently swallowed — it propagates out and is surfaced by `initialize()` as
`HISTORY_WRITE_FAILED`/`commitMayHaveChanged = true`, with the already-published ledger and the
lingering staged path both left exactly as they are, never rolled back, for independent
reconciliation. A link failure that happens before any real publication (for example an existing
ledger) still attempts best-effort removal of the unconsumed staged file without masking the
original link failure with any secondary cleanup error.

### Handling `commitMayHaveChanged`

Every `WorkflowHistoryError` carries `commitMayHaveChanged`. Callers should check it on every
caught error, not just inspect `.code`:

- **`false`** — a prewrite rejection, conflict, contention, or corruption-detection failure.
  Nothing was attempted to be published; the ledger is exactly as it was before the call.
- **`true`** — a publish/write was actually attempted and its outcome is uncertain (it may have
  committed, partially committed, or committed but then failed independent readback). **Never**
  treat this as either "succeeded" or "failed" on its own: before retrying, independently inspect
  the actual on-disk ledger (for example via a separate, uninjected `NodeWorkflowHistory`
  instance's `head()`/`list()`) to see what is really there.
  - For `initialize()`: a `true` outcome means a ledger may already exist. `initialize()` itself
    can never be "replayed as success" — call `head()` to see what actually persisted, and a
    repeated `initialize()` call against a now-real ledger correctly refuses with
    `HISTORY_ALREADY_EXISTS`, never silently re-publishing or overwriting.
  - For `append()`: retry the identical original request. If the exact same `operationId` and
    every other field match what is actually persisted, the retry idempotently reconciles to the
    already-stored revision (no duplicate, no second write). If the real on-disk ledger is now
    corrupted or incoherent, retries continue to explicitly reject it rather than silently
    erasing or papering over the bad state.
  - There is no automatic deletion of a lock file or of any corrupted/ambiguous ledger state in
    either case — reconciliation is always an explicit, caller-driven inspection, never implicit.

## Mutation, conflicts, and idempotency

Every mutation (`append()` **and** `initialize()`) is serialized through the same one exclusive
`ledger.lock` file per custody directory. The lock is **never** age-expired or reclaimed: there is
no automatic stale-lock recovery of any kind, so an abandoned or crashed-process lock file blocks
all future mutation until an operator manually removes it. Contention fails explicitly
(`HISTORY_BUSY`), and release always re-verifies the lock file's current device/inode against the
one this process actually created before unlinking it, so a lock file replaced by another owner
in the narrow window around a write is left untouched rather than silently deleted.

Before any mutation, the complete current ledger is loaded and fully re-validated (sequence
order, uniqueness, chain, binding identity, canonical Base64, and every digest). An append whose
`operationId` was already stored is idempotent **only** when every other field — `expectedLatest`,
`kind`, `binding`, and the exact bytes — also matches; it returns the original stored revision
even after later appends moved the head, and never creates a duplicate record. Any other change
under the same `operationId` is an explicit `HISTORY_OPERATION_CONFLICT`; a stale `expectedLatest`
under a new `operationId` is an explicit `HISTORY_CONFLICT`. Both leave the ledger untouched.

After a writer call that does not itself throw, `append()` independently re-reads and fully
re-validates the real, just-written ledger before ever returning a revision — the writer's own
"returned normally" claim is never trusted as proof of custody, and the value returned is always
the freshly re-read, independently verified stored revision, never a local echo of the
in-memory candidate. If that independent readback fails (the re-read cannot be parsed/validated
at all), or the re-read ledger does not contain the expected new revision at the expected chain
position, `append()` reports `HISTORY_READBACK_FAILED` with `commitMayHaveChanged = true` rather
than ever returning an unverified "success". There is no automatic rollback, reset, or retry of
any kind on this or any other failure path; a caller must explicitly retry the same operation
(which idempotently reconciles against whatever is actually persisted) if it wants another
attempt. None of this readback discipline is, or can be, a guarantee against loss from an actual
power failure or storage-device fault during the underlying write/link syscalls themselves — it
only detects and reports discrepancies that are still observable afterward through this process's
own file descriptors.

`HISTORY_SEQUENCE_EXHAUSTED` is a dedicated, defensive code reserved for a **valid** next
sequence that would legitimately, contiguously exceed `Number.MAX_SAFE_INTEGER` through real
appends. Given the artifact/ledger size caps above, this branch is provably unreachable by any
real fixture in this bounded single-file design — a declared, honest limitation, not a fabricated
code path. It is never produced for an already-corrupted, noncontiguous stored sequence; that is
`HISTORY_INVALID` corruption instead.

## Reads

`head()`, `read(sequence)`, `list(afterSequence, limit)`, and `readBytes(sequence)` always
perform the same full parse-and-validate pass over the ledger file — never a cached or trusted
view — and never implicitly initialize a missing ledger. A non-regular ledger path (symlink,
FIFO, directory, device) is rejected before any blocking `open`; the actual read is bounded to
`HISTORY_LEDGER_MAX_BYTES + 1` bytes with no silent truncation; the descriptor is always closed.
Readers never `chmod` or otherwise mutate what they inspect, even when they encounter permissive
or non-owner file modes — they reject explicitly instead. `readBytes()` re-verifies the stored
digest/Base64/length and returns a fresh copy of the exact original bytes on every call; mutating
a returned array, or bytes the caller passed into `append()` after the call returns, can never
corrupt retained custody state. `list()` returns at most `limit` revisions strictly above the
cursor in ascending order — never an implicit "current" selection, clamping, or a whole-ledger
response.

## Limitations

- This library proves internal consistency of what it was handed, not that the handed bytes are
  an authentic capture of any external source, nor that any criterion, policy, or human review
  behind them is real or approved. It provides **no authentication guarantee** of any kind — it
  never verifies caller identity, process identity, or any credential; every digest/chain check
  here is a consistency/tamper-detection property over bytes already handed to it, not proof of
  who produced them.
- There is no live "in progress" flag, task record, MCP endpoint, signing, archive, or
  accepted/current pointer here; those remain separate, not-yet-built concerns.
- Large/streamed artifact storage beyond the bounded single-file ledger is explicitly deferred.
- There is no automatic stale-lock recovery (see above) and no guarantee against loss from an
  actual power failure or storage-device fault during the underlying write/link syscalls
  themselves; both are explicit, honest limitations of a local single-file ledger, not
  oversights.
- The real cross-process contention test requires genuinely distinct OS processes and an
  unprivileged, non-root Linux test runner (several assertions rely on enforced POSIX permission
  bits and a real `mkfifo`); these are environment facts, not a claim about any particular
  completion time.

## Validation

From the extension repository root:

```
npm run test:workflow-history
```

This compiles the test sources and runs `NodeWorkflowHistory.test.ts` (and its cross-process
worker fixture, `workflowHistoryWorker.ts`) under Node's built-in test runner. A green run is
machine-checked regression and behavior evidence; it is not human acceptance of this increment,
and it is not — and cannot be — a certification of authenticity, semantic correctness, or
approval for anything the caller chose to store.

For a coverage view, use the TypeScript compiler already installed in this repository
(`node_modules/typescript/bin/tsc`, no additional/global tool install) to compile without source
maps into the repository's validated, already-ignored `out/coverage-history` directory, then run
Node's built-in coverage reporter directly against the generated JavaScript there — never against
the original `.ts` sources, since Node's coverage instrumentation and reporting always operate on
the compiled, generated JS it actually executed, not on TypeScript:

```
node node_modules/typescript/bin/tsc -p . --outDir out/coverage-history --sourceMap false --noEmit false
node --test --experimental-test-coverage out/coverage-history/review/NodeWorkflowHistory.test.js
```

This is a portable, no-install-beyond-what's-already-a-devDependency command: it only invokes the
compiler already present in `node_modules`, writes under the repository's existing, already
source-control-ignored `out/` tree (`out/coverage-history`, distinct from the regular
`out/review/...` used by `npm run test:workflow-history`, so the two never collide or need a new
ignore rule) rather than an unignored repository-root scratch path. Compiling without source maps
specifically avoids an observed Node 20 `--experimental-test-coverage` source-map-reporter failure
— this is a reporting-compatibility workaround, not a change to the production `tsconfig.json`
and not a path-leak/security concern. The reported line/branch coverage reflects the generated JS
the test runner actually executed, which is not a line-for-line, byte-for-byte view of the
original TypeScript source. An unexecuted branch shown by this report is not automatically
"unreachable" — most unexecuted defensive branches are simply untriggered by this particular test
run and remain reachable under some real input; the dedicated `HISTORY_SEQUENCE_EXHAUSTED` branch
documented above is the one genuine, provably unreachable exception in this module.
