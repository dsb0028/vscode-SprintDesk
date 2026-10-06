# Workflow Identities (`src/review/NodeWorkflowIdentities.ts`)

`NodeWorkflowIdentities` is a dedicated workflow identity registry and exact canonical
task-context read. It proves field-for-field, byte-for-byte consistency between a caller's exact
canonical `tasks.yml` task entry and a narrow, explicitly initialized registry
(`workflow-identities.json`) that pins a stable, randomly assigned per-workspace `projectId` and a
stable, randomly assigned per-task `incarnation` the first time a task is observed `in-progress`.

It is **not**:

- a human approval, a signed reviewer receipt, or any authority/authentication claim;
- a task mutation API (it never writes `assignee`, `status`, `workStatus`, or any other field of
  any task, and it never rewrites `tasks.yml`);
- a replacement for, or reader/writer of, any approval, Markdown, enrollment, or workforce state;
- an immutable creation-event journal — it honestly cannot distinguish a task deleted and
  recreated with an identical `id`+`createdAt` from the original task (see Limitations).

It never initializes anything implicitly: a missing registry is never silently created by
`read()`, `registerTask()`, or `resolveTask()`, and `initialize()` itself never creates a missing
`.SprintDesk/data` directory or a missing `tasks.yml` — both must already exist.

## Shape

- `WorkflowTaskIdentity { taskId, createdAt, incarnation }` — the persisted per-task registry
  record.
- `WorkflowIdentitySnapshot { version: 1, projectId, tasks, digest }` — `digest` is the lowercase
  SHA256 hex of the exact persisted registry bytes (content provenance, not a signature).
- `WorkflowTaskContext { projectId, taskId, createdAt, incarnation, status, taskDigest,
  registryDigest }` — exactly these seven fields, never any signing/reviewer/receipt data.
  `taskDigest` is `protocol.digest` over the entire actual selected plain task object, not merely
  `id`/`status`/`createdAt`.
- `WorkflowIdentityError` — `{ code, commitMayHaveChanged }`, never echoing raw task data, unknown
  key names, or the caller-submitted task id.

`WORKFLOW_IDENTITIES_MAX_BYTES` (`1048576`) bounds the registry file. `WORKFLOW_TASKS_MAX_BYTES`
(`8388608`) bounds the canonical `tasks.yml` source read.

## Construction, initialization, and the publication seam

```ts
new NodeWorkflowIdentities(workspaceRoot, writer?, publisher?)
```

The constructor only validates: `workspaceRoot` must be an absolute, existing, canonical directory
not reached through any symlinked path component (including ancestors). It performs **no**
filesystem mutation, no `mkdir`/`chmod`, and no task/policy reads — it never touches
`.SprintDesk/data` as a side effect, even if that directory already exists.

`initialize()` is an explicit, trusted-caller setup operation, not an authenticated human
approval. It requires a real `.SprintDesk/data` directory and an actual well-formed `tasks.yml` in
that exact workspace (`TASK_STORE_MISSING`/`TASK_STORE_INVALID` otherwise); it never creates
either, and never auto-creates any missing directory to satisfy that requirement. This check runs
strictly before the registry lock is ever opened: when `.SprintDesk/data` itself does not exist,
the lock file's own parent directory is also absent, so checking the task store first is what
makes that absence a `TASK_STORE_MISSING` rather than a misleading `IDENTITIES_BUSY` (lock
contention is reported only once the lock itself is actually attempted). This precondition check
is never treated as a substitute for authority: once the lock is held, `initialize()`
independently reloads and revalidates the task store again before anything is published. It
publishes a complete, empty, version-1 registry atomically without ever overwriting an
existing one — even a byte-identical one is `IDENTITIES_ALREADY_EXISTS`. The optional third
constructor argument reuses the existing `HistoryPublisher` interface from
`NodeWorkflowHistory` verbatim (not a parallel compatibility alias): the writer stages the
complete content to a uniquely named path, and the publisher then atomically installs it without
overwrite (the default uses a same-filesystem hard link). After a publish attempt that does not
itself throw, `initialize()` independently re-reads and fully re-validates the real, just-published
registry; any readback failure or content mismatch reports `IDENTITIES_READBACK_FAILED` with
`commitMayHaveChanged = true` rather than returning a success-shaped snapshot. A publish failure
that happens strictly before any real write (staging itself fails) reports
`commitMayHaveChanged = false`; a real publisher that installs then throws reports
`IDENTITIES_WRITE_FAILED`/`true`; a real publisher that installs then silently corrupts the
published bytes and returns normally reports `IDENTITIES_READBACK_FAILED`/`true`.

## Registration

```ts
registerTask(taskId: string, expectedRegistryDigest: string): WorkflowTaskContext
```

Malformed method arguments — including a malformed-shape `taskId` or `expectedRegistryDigest`
(not a well-formed but stale digest) — are rejected as `IDENTITIES_REQUEST_INVALID` strictly
before any lock or write, distinct from a well-formed-but-stale digest's `IDENTITIES_CONFLICT`.

Before either lock is ever opened, `registerTask()` confirms the registry has actually been
initialized (`IDENTITIES_MISSING` otherwise), for the same reason `initialize()` checks the task
store first: when `.SprintDesk/data` itself does not exist, `tasks.yml.lock`'s own parent directory
is also absent, and attempting to open it there would otherwise fail with a raw `ENOENT`
indistinguishable from real lock contention. This precondition check is never treated as a
substitute for authority — it is not reused as the registry state once locks are held.

`registerTask()` acquires the exact same `tasks.yml.lock` used by existing task writers **before**
the dedicated `workflow-identities.json.lock` (no custom parallel task lock name, no lock-order
reversal); an occupied lock is always `IDENTITIES_BUSY`, with no stale-age reclamation and no
inference about whether an owner is active or crashed. Under both locks it independently
re-reads the current registry and the canonical task from scratch — the precondition check above
is never reused as that authority. A stale/mismatched `expectedRegistryDigest` is
`IDENTITIES_CONFLICT` before any write, even for an otherwise-idempotent replay. A new
registration is accepted only for a canonical task currently in status `in-progress`; every other
status (`waiting`, `under-review`, `needs-modification`, `done`, `blocked`, `cancelled`, or an
unsupported value) is `TASK_STATE_INVALID`, with no registry write. If the task is already
registered with a matching `createdAt`, the call is a verified, no-write no-op that still performs
every prewrite check (digest, canonical identity, `in-progress`) rather than bypassing them for
idempotence. If the registered `createdAt` no longer matches the canonical value, it is
`TASK_REPLACED` — the prior incarnation and registry entry are left exactly as they were; no
incarnation is reassigned, no history is copied or reset.

After a real registry write, `registerTask()` independently re-reads and validates the exact
persisted bytes, then re-reads the canonical task under the still-held task lock. Any drift in the
task's digest, status, or `createdAt` detected at that point is `TASK_CHANGED` with
`commitMayHaveChanged = true` — the registry publication itself already committed; this library
makes no global atomicity claim against an external, noncooperating writer. Every other uncertain
writer outcome (a writer that fails after a real committed write, one that silently discards the
write while claiming success, or one that performs a real but truncated/wrong write) is
distinguished by independently comparing the real on-disk bytes against both the prior and the
intended content, never by trusting the injected writer's own return value or thrown exception
alone.

## Reads

`read()` and `resolveTask()` never implicitly initialize a missing registry
(`IDENTITIES_MISSING`) and never perform a write. `resolveTask()` checks, in exact order: the
`taskId` argument shape, then that the registry has actually been initialized
(`IDENTITIES_MISSING` otherwise), then the canonical task source's own health and exact lookup
(`TASK_STORE_MISSING`/`TASK_STORE_INVALID`/`TASK_STORE_TOO_LARGE`/`TASK_STORE_UNREADABLE`/
`TASK_NOT_FOUND`/`TASK_AMBIGUOUS`/`TASK_STATE_INVALID`) — all of which take precedence over a
missing-registration verdict. Only once the canonical task itself is confirmed to exist and be
well-formed does `resolveTask()` decide whether it is registered at all: a never-registered task
is `TASK_UNREGISTERED`, and a replaced task is rejected in reads exactly as in `registerTask()`
(`TASK_REPLACED`). `resolveTask()` may resolve any known current task status, including
`under-review`/`done`, as long as the registered `taskId`/`createdAt` are still stable.

Both the registry and the canonical `tasks.yml` are read with the same discipline: bounded to the
exported byte cap, opened nonblocking, with descriptors always closed, symlink/FIFO/directory/
nonregular sources rejected before any blocking open, and explicit UTF-8 decode errors. The
registry additionally requires an owner-only file mode on verified Linux hosts; the canonical task
source may carry a normal, non-secret project mode. `tasks.yml` is parsed as strict, data-only
YAML: duplicate mapping keys, custom tags, and merge-key (`<<`) expansion are all rejected as
`TASK_STORE_INVALID`. Task lookup is by exact `id` only — never by code, title, or path — and
duplicate exact ids are `TASK_AMBIGUOUS` with no first-match/fuzzy fallback. Unrelated task
fields and any top-level `approvals` data are never interpreted, rewritten, or lost.

## Limitations

- This registry proves consistency, not authenticity, semantic review correctness, or human
  approval; a passing check here is never a signed receipt or an authorization decision.
- A task deleted and recreated with an **identical** `id` and `createdAt` is, by design,
  indistinguishable from the original by this source alone — there is no creation-event journal to
  compare against. This is a disclosed limitation, not a fabricated detection capability.
- There is no automatic stale-lock recovery: an abandoned or crashed-process lock blocks all
  future mutation until an operator manually removes it.
- Task-bound custody mutation (`NodeWorkflowHistory` adapter wiring), the planning archive, and
  canonical task-creation hooks/immutable creation-event journaling all remain separate,
  not-yet-built, deferred concerns.

## Validation

From the extension repository root:

```
npm run test:workflow-identities
```

This compiles the test sources and runs `NodeWorkflowIdentities.test.ts` (and its cross-process
worker fixture, `workflowIdentityWorker.ts`) under Node's built-in test runner. A green run is
machine-checked regression and behavior evidence; it is not human acceptance of this increment and
not a certification of authenticity or semantic correctness.

For a coverage view, compile without source maps into the repository's already-ignored `out/`
tree (`out/coverage-identities`, distinct from the regular `out/review/...` tree used by
`npm run test:workflow-identities`) and run Node's built-in coverage reporter against the
generated JavaScript there — never against the original `.ts` sources:

```
node node_modules/typescript/bin/tsc -p . --outDir out/coverage-identities --sourceMap false --noEmit false
node --test --experimental-test-coverage out/coverage-identities/review/NodeWorkflowIdentities.test.js
```

The reported line/branch coverage reflects the generated JS the test runner actually executed, not
a line-for-line view of the original TypeScript source, and an unexecuted branch is not
automatically unreachable.
