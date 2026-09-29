# Change Log

All notable changes to the "vscode-async-postmessaging" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Guided review (0.6.0, pending installation validation)

- Separate local UI-only reviewer companion with independently retained keys,
  drafts, task incarnations and signed approval ledger.
- One human confirmation per criterion, final review confirmation, and distinct
  completion confirmation requiring an all-met current review.
- Shared protected-write checks cover MCP, task-service, create/import and bulk
  saves. Caller-supplied review decisions and reviewer IDs no longer authorize
  approvals. Legacy approvals remain unattested history.
- Snapshot-bound signatures, atomic task/approval-history persistence,
  idempotent delivery and stale/replayed/content-drift rejection.
- New request/read/signed-delivery MCP tools; raw task-file projections are not
  authoritative approval evidence.
- Automated tests and production builds are separate from installed local-host
  placement and actual human acceptance, which remain pending.

### Added

- **Reviewer registry:** `.SprintDesk/data/reviewers.yml` is now the authoritative source for
  SprintDesk human reviewers, with a strict `reviewers: [{ id, displayName }]` schema, an explicit
  `reviewers: []` empty state, and stable insertion-order listing.
- Registration, listing (`counts.reviewers` in `sprintdesk_projectContext` and `sprintdesk_refresh`),
  and human-verification lookup now share the `ReviewerStore` persistence boundary.
- Reviewer authority is tracked independently of `.SprintDesk/workforce/employees.yml`;
  registering a reviewer never deletes, rewrites, or repurposes an employee record, and an
  unregistered `role: human` employee cannot approve a task.
- Owner-only permissions, symlink rejection, atomic writes, and cross-process locking for the
  registry. Reviewer IDs and display names no longer appear in reviewer error messages or audit
  entries.
- `npm run test:reviewers` covering registry schema, security, and locking behavior.

- Initial release

## [0.4.0] - 2026-09-13

### Foundation (M1-M6)

- **Workforce (M5):** Employee/team model with YAML persistence under `.SprintDesk/workforce/`, workforce sidebar tree (teams, members with human/agent kind, status, skills), commands (Add Employee, Create Team, Assign to Team, Sync Workforce from Team), and dangling-lead cleanup on reassignment.
- **MCP servers (M6):** HTTP and stdio transports with shared tool core, expanded `sprintdesk_*` toolset (40 tools), auto-managed `.SprintDesk/project.mcp.json`, and headless CLI entry points (`npm run mcp`, `npm run standup`).
- **Data & persistence (M1/M2):** YAML store layer, migration service, audit/event/history tracking, run records.
- Settings, history service, and interactive command plumbing.

## [0.3.8] - 2025-11-06

- update task and add repo provider
- update task
- fix drop errors
- fix epic drags
- version bump to 0.3.8

## [released]

Add webview type to epics view and implement EpicsTree component
sprints name patterns
show task of backlogs sprints
humanized tasks names and open them when clicked
upcoming changes
change status in sprint files
open sprint file calendar should be fix it
show task status in sprint sidebar
fix: sprint name