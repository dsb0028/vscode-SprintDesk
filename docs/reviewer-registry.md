# Reviewer Registry

SprintDesk stores every registered human reviewer in one authoritative file.
Registration, listing, and reviewer discovery all read and write that
file through a single persistence boundary, so a reviewer registered once stays
discoverable across process restarts. This remote registry no longer authorizes
new approvals: use the [local signed-review authority](authenticated-review.md).

## Registry Location And Schema

| Item | Value |
| --- | --- |
| Canonical path | `<workspace>/.SprintDesk/data/reviewers.yml` |
| Lock file | `<workspace>/.SprintDesk/data/reviewers.yml.lock` |
| Loader / API | [`ReviewerStore`](../src/data/stores/ReviewerStore.ts), reachable as `getStores().reviewers` |

An empty registry is represented explicitly:

```yaml
reviewers: []
```

A populated registry stores exactly two fields per record:

```yaml
reviewers:
  - id: reviewer-1
    displayName: First Reviewer
  - id: reviewer-2
    displayName: Second Reviewer
```

- `id` and `displayName` are required non-empty strings.
- `id` is at most 128 characters; `displayName` is at most 200 characters.
- No other fields are stored, and unknown fields are rejected on read.
- **Listing order is insertion order** and is stable across reads and restarts.

## Normalization And Duplicates

| Field | Normalization |
| --- | --- |
| `id` | leading and trailing whitespace trimmed |
| `displayName` | trimmed, then inner whitespace runs collapsed to one space |

Reviewer IDs are the `humanVerification.reviewerId` value after this
normalization. Two IDs that normalize to the same string are the same reviewer,
so `" reviewer-1 "` and `"reviewer-1"` collide and the second registration is
rejected. Duplicate display names are rejected during registration as well.

## Shared Interface

| Caller | Entry point |
| --- | --- |
| Registration (`sprintdesk_registerHumanReviewer`) | `workforceService.registerHumanReviewer` → `ReviewerStore.register` |
| Reviewer discovery | `workforceService.findHumanReviewer` → `ReviewerStore.find` |
| Listing / counts (`sprintdesk_projectContext`, `sprintdesk_refresh`) | `workforceService.listHumanReviewers` → `ReviewerStore.list`, surfaced as `counts.reviewers` |

`ReviewerStore.find` resolves a normalized `id` first and then falls back to an
exact normalized `displayName`. Supplying even a registered identity to
`sprintdesk_updateTask` cannot approve or complete a task; those arguments are
rejected without mutation. Signing enrollment and per-operation human consent
belong to the separate local companion.

`workforceService.registerHumanReviewer` also makes sure the person is visible
in `.SprintDesk/workforce/employees.yml` so existing workforce views keep
listing them. If a `role: human` employee with that ID already exists it is
reused exactly as stored and never rewritten; otherwise a new employee record is
added. That employee record is a presentation copy only — the registry remains
the authoritative source for remote registration/discovery. It is not the local
approval trust root.

Reviewer-management commands (interactive registration, listing, and removal
UI) are intentionally out of scope for this registry.

## Relationship To The Employee Registry

The reviewer registry and `.SprintDesk/workforce/employees.yml` are two
independently maintained sources. There is no migration between them, in either
direction, at any time.

- Being a `role: human` employee grants **no** reviewer authority. An employee
  cannot sign approvals merely by appearing in this file.
- Registering a reviewer never deletes, rewrites, or repurposes an existing
  employee record. A matching `role: human` record is reused byte-for-byte.
- Agents and the `.SprintDesk/data/team.yml` roster are never reviewers.
- The registry never reads or writes `employees.yml`. A malformed or missing
  employee file has no effect on reviewer registration or verification.
- Registration is rejected when the requested reviewer ID is already owned by a
  non-human employee, or by an agent ID or agent name, so a single identity is
  never split across two different kinds of actor.

Reading the registry never creates the file; a workspace with no `reviewers.yml`
simply has no reviewers. Only `register` creates it.

## Failure Behavior

Reads and writes fail explicitly, never silently. Errors are raised for:

- malformed YAML, a non-mapping document, unknown top-level keys, or a
  non-list `reviewers` value;
- records that are not mappings, carry unknown fields, use non-string values,
  are empty after normalization, or exceed the length limits;
- duplicate records inside the file and duplicate registrations;
- read failures, write failures, lock timeouts, and lock errors;
- verification misses, which reject the status change without mutation.

Writes are atomic: content is staged in a sibling temporary file, flushed with
`fsync`, and then renamed over the registry. A failed write never reports
success and never replaces a previously valid registry with partial data.

**Error messages and audit entries never contain reviewer IDs or display
names.** The audit trail records the registration event and its target only.

## Permissions, Symlinks, And Platforms

| Host | Behavior |
| --- | --- |
| Unix-like | `.SprintDesk/data/` is created `0700`; `reviewers.yml` is created and kept `0600`. A registry found with group or other permission bits is tightened back to `0600` on the next access. If tightening fails — for example when the file is owned by another user — the operation fails with an explicit message telling you to run `chmod 600` on it. |
| Windows | POSIX mode bits are not enforced; the registry inherits directory ACLs. Atomic replacement, locking, and symlink rejection still apply. Protect the workspace directory with filesystem ACLs. |

If `.SprintDesk/data/reviewers.yml` or its parent directory is a symbolic link,
the operation is refused instead of followed, so the link target cannot be
overwritten.

The registry is excluded from source control through `.gitignore`. Do not commit
it.

## Concurrency

Concurrent registrations from cooperating processes are serialized with an
exclusive lock file created with `O_EXCL` at
`.SprintDesk/data/reviewers.yml.lock`.

| Setting | Default |
| --- | --- |
| Lock acquisition timeout | 5000 ms, then an explicit timeout error |
| Stale-lock age | 30000 ms, after which the lock is reclaimed and retried |
| Retry interval | 20 ms |

A stale lock is one whose modification time is older than the stale-lock age; it
is assumed to belong to a process that exited without cleaning up and is removed
so work can continue. The lock is always released when the guarded operation
finishes, including on failure.

## Tests

```bash
npm run test:reviewers   # registry schema, security, and locking
npm run test:mcp         # registration, verification, and listing through MCP
```

[`ReviewerStore.test.ts`](../src/data/stores/ReviewerStore.test.ts) covers the
empty state, normalization, duplicates, independence from the employee file,
registration readback, restart persistence, listing order, verification lookup
and unknown reviewers, malformed input, failed reads and writes, permission and
symlink protection, lock timeout and stale-lock reclamation, cross-process
contention, and preservation of the prior registry after a failed write. The
cross-process test registers 50 reviewers from two concurrent processes and
proves that all records survive.
