# Scoped Edits (`NodeScopedEdits`)

`NodeScopedEdits` (`src/host/NodeScopedEdits.ts`) is a typed, host-local
service that lets one bound caller ("owner") acquire an exclusive lease over
a small set of **existing, regular, UTF-8 text files** under one
constructor-pinned code root, read or exact-text-replace them, and release
the lease. It is exported from `src/host/index.ts` alongside the existing
host singletons; it does not replace or alter any of them.

This document describes the first typed-service increment only. It is an
infrastructure bootstrap authorized for this increment specifically (see
`contract.json` v4 and the associated production approval record); it is
not a claim that the full ten-role SprintDesk workflow, its scenario gates,
or an authenticated human-approval chain executed.

## What this service is for

Concurrent or automated callers that need to make a small, auditable set of
exact text replacements to known files — without clobbering each other,
without silently acting on a file that has changed underneath them, and
without ever becoming a generic "run arbitrary code" or "create/delete
files" surface.

## What this service explicitly is not

- **Not an OS sandbox.** All guards (symlink rejection, drift detection,
  root-identity checks) are cooperative: they defend against this
  process's own mistakes and ordinary concurrent writers, not a hostile
  co-resident user who can race the filesystem between a check and a write
  (TOCTOU), and not a managed/jailed execution environment.
- **Not a creation or deletion API.** Every leased path must already exist
  as a regular UTF-8 text file at acquisition time. There is no API to
  create, delete, or rename a file through this service, and no authoring
  gateway is ported into it.
- **Not a production MCP mutation endpoint.** This increment adds a typed
  library class only. It is not wired to any MCP tool, stdio transport, or
  externally reachable mutation surface.
- **Not a globally atomic file/registry transaction.** A source file
  replacement and the lease-registry write that records it are each
  individually atomic (temp file + `fsync` + rename), but there is no
  distributed transaction spanning both. See "Partial-write uncertainty"
  below for the cases where this matters.
- **Not automatic lock recovery.** An abandoned ownership-mutex lock file
  is never reclaimed based on its age. See "Lock recovery limits" below.

## Trust boundaries

- `owner` is a **trusted-caller binding**, not an authenticated human
  identity. Any process able to construct a `NodeScopedEdits` instance
  against the same state directory and obtain a lease's `leaseId`/`fence`
  can act as that lease's owner. This service performs no authentication.
- The constructor pins both the code root and state directory at
  construction time (`constructor-root binding`). Every subsequent
  `read`/`edit`/`release` call is checked against the **lease's recorded
  root**, not just its `leaseId`/`fence`/`owner`: a lease acquired through
  one `NodeScopedEdits` instance cannot be replayed against a different
  instance pinned to a different root, even if both instances share the
  same lease-registry state directory. A mismatch fails closed as
  `LEASE_BINDING` without touching any file or releasing the rightful
  lease.
- The symlink, drift, and inode/mode checks are **cooperative guards**, not
  a security sandbox. They are effective against accidental external edits,
  renames, and permission changes made by ordinary tools between a lease's
  acquisition and its use; they are not certified against an adversarial
  same-user process deliberately racing this service's own check-then-write
  window, and they do not certify power-loss recovery.

## Partial-write uncertainty

`edit()` performs, in order: binding and scope checks, root-identity and
source-drift checks, the caller's optimistic-concurrency hash check, the
unique-match check, then the atomic source file replacement, then a
registry write that records the new hash/identity and appends an
operation record, and finally releases the ownership mutex.

`sourceMayHaveChanged: true` on a thrown `ScopedEditError` means this
specific `edit()` call's own atomic source-file replacement already
committed before the failure that caused it to throw. It does **not**, by
itself, say whether the following registry write also committed — two
distinct failures set it:

- **The registry write fails right after the source replacement.** The
  on-disk file **has** been changed to the new content, but the lease's
  recorded identity/hash and operation history **have not** been updated
  to reflect that change. This service does not attempt to roll the source
  file back (a rollback could itself race a second writer) and does not
  retry the registry write. A subsequent `edit()` against this lease will
  fail closed — typically with `SOURCE_DRIFT`, because the live file no
  longer matches the lease's last-recorded identity — rather than silently
  overwriting the unrecorded change.
- **The registry write succeeds, but the mutex release that follows it
  then fails** (see "Lock recovery limits" below) — for example because
  another process has replaced the ownership lock in that narrow window.
  Here the source file **and** the registry **both** already reflect the
  new content; what failed is only the bookkeeping around releasing the
  lock, reported as `STATE_BUSY`.

In either case, `read()` can show the current on-disk bytes, but it does
not refresh the lease's stored identity or by itself authorize a retry:
this increment has no API that resynchronizes a lease's recorded identity
other than a subsequent successful `edit()` or a fresh `acquire()`.
Reconciling after either failure may require authorized inspection of both
the source file and the lease registry.

`sourceMayHaveChanged: false` means this specific call did not replace any
source file. Every rejection that never reaches the atomic source-file
replacement (binding, scope, drift, hash mismatch, match count, registry
schema, lock contention before the mutex is held, fence exhaustion)
reports `false` and leaves the source file untouched — but `false` is not,
by itself, proof that every registry-side effect of a failed call was
rolled back.

## Lock recovery limits

Lease-registry mutations (`acquire`, `edit`, `release`) are serialized by a
plain exclusive-create lock file (`leases.lock`) in the state directory,
with a short bounded retry. This is a deliberately minimal mutex:

- It does **not** reuse `NodeSecureStore.withFileLock`'s age-based
  stale-lock reclamation. An "old" lock file cannot be reliably
  distinguished from one held by a slow-but-live writer, so this service
  never reclaims one on that basis.
- If a process holding the lock is killed or crashes without cleaning up,
  the lock file is left in place and every subsequent mutating call fails
  with `STATE_BUSY` until an operator manually removes the lock file.
  There is no automatic recovery path in this increment.
- Releasing the mutex re-checks the lock file's device/inode identity —
  captured right after this process created it — immediately before
  unlinking. If another process has since replaced `leases.lock` with its
  own (for example, a legitimate holder that started a new lock after this
  process's write appeared to hang), release refuses to delete that file
  and reports `STATE_BUSY` instead of silently discarding a lock it does
  not own. The same applies if the lock file is simply gone, or if the
  final `unlink` itself fails: every one of these is surfaced as
  `STATE_BUSY`, never swallowed.
- **Checking `sourceMayHaveChanged` on that failure is mandatory**, not
  optional, because a mutex-release failure can happen *after* an edit's
  source replacement and registry write have both already committed; the
  flag still carries whichever value applied to the operation actually in
  progress. Re-reading the file's current bytes does not by itself refresh
  a stale lease. Reconciling after any such failure may require authorized
  inspection of both the source file and the lease registry, and
  `sourceMayHaveChanged: false` on its own does not prove every
  registry-side effect of the failed call was rolled back — only that this
  particular failure was not caused by an in-flight source edit.

## POSIX permission preservation

Source files are ordinary project files, not secrets: edits never route
through the secure-text store's 0600-forcing write path. Instead,
`edit()` reads the file's current mode bits before making any change and
explicitly re-applies them (via `chmod`) to the replacement file before the
atomic rename — so a restrictive process `umask` cannot silently tighten
(or loosen) a file's permissions as a side effect of an otherwise
successful edit.

## Error vocabulary

Every rejection throws a `ScopedEditError` with a stable `.code` drawn from
a fixed, approved vocabulary (see `NodeScopedEdits.ts`'s `APPROVED_CODES`).
Callers must check `.code`; the free-form `.message` text is not part of
the contract and may change. The vocabulary distinguishes, among other
things, `SOURCE_DRIFT` (a leased file's content, inode, or mode changed)
from `ROOT_DRIFT` (the code root directory itself was replaced), and
`LEASE_BINDING` (wrong owner/lease/fence/root) from `LEASE_INACTIVE`
(correct binding, but the lease has already been released).

## Validation scope

This service is implemented against and validated on the verified Linux
development host only. It relies on POSIX permission-bit and symlink
semantics and on Node's `fs` bigint stat APIs (`fs.statSync(path, {
bigint: true })`) for 64-bit device/inode identity comparisons; none of
this has been validated on Windows or other platforms in this increment.

Actual validation commands run for this increment:

- `npx tsc -p . --outDir out --noEmit false`
- `node --test out/host/NodeScopedEdits.test.js` (equivalently,
  `npm run test:scoped-edits`, which runs the same compile-then-test steps)
- `npx eslint --max-warnings 0 src/host/NodeScopedEdits.ts src/host/index.ts
  src/host/NodeScopedEdits.test.ts src/host/scopedEditLeaseWorker.ts`
- A separate, generated coverage-probe build — not the production
  `tsconfig`, and not the test files — used only to work around a known
  Node test-runner source-map reporter failure: `npx tsc -p . --outDir
  out/coverage-probe --sourceMap false --noEmit false` followed by
  `node --test --experimental-test-coverage
  out/coverage-probe/host/NodeScopedEdits.test.js`

These commands emit the actual test, coverage, lint, and build results.
Retain the results with the implementation review evidence; the commands
above are not a claim that a particular checkout has passed validation.
