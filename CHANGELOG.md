# Change Log

All notable changes to the "vscode-async-postmessaging" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]
 
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