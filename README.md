# vscode-SprintDesk

A productivity extension for managing tasks, epics, backlogs, and sprints directly within Visual Studio Code. SprintDesk helps you organize your development workflow using Markdown files and a simple, intuitive sidebar interface.

---

## 🚀 Features

- **Task Management:** Create, view, and organize tasks as Markdown files in your workspace.
- **Epics & Backlogs:** Group tasks under epics and backlogs for better planning and tracking.
- **Quick Add Command:** Use the "Add Quickly" command to create tasks, epics, and backlog entries with a single input.
- **Sprint Planning:** Move tasks from backlogs to sprints for active development.
- **Task Calendar:** Browse sprint-colored task cards, date-range ribbons, and an interactive task-details sidebar.
- **Human Review:** Guided, individually confirmed decisions in a separately installed local reviewer companion. Signed review and separate completion receipts replace caller-supplied approval. See [Authenticated Review](docs/authenticated-review.md).
- **Needs Modification:** A verified signed Needs-work review transitions an
  Under Review task to **Needs Modification** while retaining its review
  receipt and feedback; all-met review and Done remain separate flows.
- **Human Reviewer Registry:** Discover registered reviewers through the owner-only registry. Registration alone cannot authorize approval. See [Reviewer Registry](docs/reviewer-registry.md).
- **VSCode Integration:** Access all features from the sidebar and command palette.
- **Markdown Linking:** Tasks, epics, and backlogs are interlinked using Markdown for easy navigation.

---

## 🛠️ Setup

1. **Clone the Repository:**
   ```sh
   git clone https://github.com/khmmamed/vscode-SprintDesk.git
   cd vscode-SprintDesk
   ```
2. **Install Dependencies:**
   ```sh
   npm install
   ```
3. **Build the Extension:**
   ```sh
   npm run compile
   ```
4. **Open in VSCode:**
   - Open the folder in VSCode: `File > Open Folder...`
   - Press `F5` to launch the extension in a new Extension Development Host window.

---

## Human reviewer registry

New completion requires a current all-met signed review and a separate local
human UI confirmation. Install and explicitly enroll the
[local companion](companion/README.md) on your own computer, not the SSH host.
Existing approvals remain unattested history; registration alone, remote file
edits and chat answers cannot create authenticated approvals.

For discovery, reviewers live in `<workspace>/.SprintDesk/data/reviewers.yml`,
which uses a strict schema shared by registration and listing:

```yaml
reviewers:
  - id: reviewer-1
    displayName: First Reviewer
```

An empty registry is written as `reviewers: []`. Reviewer IDs are trimmed,
display names are trimmed with inner whitespace collapsed, and duplicates are
rejected. The registry is maintained independently of
`.SprintDesk/workforce/employees.yml`: there is no migration between the two,
and a `role: human` employee has no signing authority. The file is created owner-only (`0600`), is written atomically under
a cross-process lock, and is excluded from source control.

Enable registration with the `sprintdesk.reviewerRegistrationEnabled` setting,
then register through the `sprintdesk_registerHumanReviewer` MCP tool. Full
schema, failure, permission, and locking behavior is documented in
[docs/reviewer-registry.md](docs/reviewer-registry.md).

Supported MCP clients can request/open/read reviews or deliver an already signed
receipt; they cannot approve unattended. See [MCP review API](docs/mcp-review.md).
Private keys and authoritative approval history stay local. Remote projections
are not authoritative; local verification detects mismatches but cannot prevent
the remote account from destroying files or replacing remote software.

---

## Backlog priority groups

Expand a backlog in the **Backlogs** pane to see **High**, **Medium**, and
**Low** priority groups, in that order. All three groups remain available even
when empty. Each group shows its name followed by a clipboard and its task count,
for example **Medium 📋 3 tasks**. Counts belong to that backlog and priority,
remain visible while the group is collapsed, and use **0 tasks** for empty groups
and **1 tasks** for a single task. Expand a group to open or drag its tasks as
before; drop tasks on the backlog itself, not on a priority heading.

Grouping uses stored task priority and backlog membership. It does not filter
out completed tasks or tasks assigned to sprints, change task metadata, or
alter the status groups in the **Tasks** pane. Refresh SprintDesk after editing
priority or backlog membership, or creating/deleting tasks, to update the
displayed groups and counts. Reopening SprintDesk reads the persisted counts.

Run the focused provider regression tests with `npm run test:backlog-priorities`.

## Task Calendar

Run **SprintDesk: Show Sprint Calendar** from the Command Palette or a sprint's
context menu. The view uses your workspace's actual sprint records, scheduled
tasks, statuses, priorities, and task Markdown descriptions. Only tasks assigned
to a sprint appear on the calendar; unassigned work stays in the backlog.

### Browse the calendar

- The calendar opens on the current month. Use **Previous**, **Next**, and
  **Today** to navigate; the selected month is retained while the panel is open.
- Each month contains the Monday-first weeks needed to show every date. Adjacent-month dates are subdued,
  weekends have a subtle background, and today's date is highlighted.
- Sprint ribbons sit above the weekday header in separate date-positioned lanes.
  Each sprint's ribbon, task cards, legend marker, selected details, and task
  dropdown share its independently stored color.
- Task cards appear inside their scheduled date cells. Multi-day tasks appear on
  every date in their inclusive range, including weekends and following weeks.
- Busy dates initially show up to three task cards.
  Use the **more** controls to reveal the remaining items, then collapse
  the week again. Navigation to another month resets expanded weeks.
- Hover or focus a task for a short title/date/status preview. Click a card or
  choose a task from **Tasks** to display its full details in the existing sidebar.
  There is no second **Show details** action. **Open task** opens its Markdown
  file; **Clear selection** or **Escape** clears the selection.
- The **Tasks** dropdown lists the selected sprint's tasks. Removal controls are
  visible only while the dropdown is open. Removing a task unassigns it from the
  sprint without deleting the task, its backlog membership, or its planned dates.
  The current sprint's undated members are available here even when its grid is empty.
- Choose the target sprint and use **Add a task** to open the backlog picker,
  then explicitly choose a task. Assignment does not invent dates; undated tasks
  remain off the grid until scheduled.
- Hover or focus a sprint ribbon to open its anchored color picker and delete control.
  Deleting a sprint returns its assigned tasks to their backlogs.
- Empty ranges show the full calendar with a compact **No sprint tasks in this
  range** message. **View unassigned tasks** opens a backlog-task chooser.
- On narrow panels, scroll the calendar region horizontally to preserve date
  columns; the same task-details sidebar moves below it.
- Use **Refresh** to reload changes made by other SprintDesk views or tools.
  Month navigation also reloads workspace records. Calendar membership and color
  changes update the calendar immediately and refresh the other SprintDesk views.

### Schedule tasks

To schedule a task, add both fields to its existing entry in
`.SprintDesk/data/tasks.yml` (the task source of truth):

```yaml
startDate: '2026-09-25'
endDate: '2026-09-28'
```

Use quoted `YYYY-MM-DD` strings; `DD-MM-YYYY` strings are also accepted.
Set both fields to the same date for a single-day task. Save the data file and
choose **Refresh** in the calendar to see the changes.

- End dates are inclusive and ranges include weekends. Dates are treated as
  calendar dates, without timezone conversion.
- Undated tasks stay off the grid; sprint membership, creation timestamps, and
  duration do not imply a schedule. The sprint task list still shows membership.
- Partial, invalid, or reversed task dates produce a visible warning and are not
  plotted. Task ranges are not clipped to their sprint's dates.

Date pickers, drag-to-schedule, and background file watching are not included.
Navigation and expansion do not change task data. Sprint membership, sprint
color, and sprint deletion are updated directly in the calendar. Editing a
task's Markdown description does not update its schedule in the YAML data.

Calendar development checks:

```sh
npm run test:calendar
```

---

## Task View status directories

The **Tasks** sidebar groups tasks into collapsible status directories. A task
appears in exactly one directory based on its `status` field in
`.SprintDesk/data/tasks.yml`; moving a task through its workflow changes its
directory automatically.

- **In Progress**, **Under Review**, and **Blocked** are expanded initially.
- **Waiting**, **Done**, and **Cancelled** are collapsed initially.
- VS Code retains expanded/collapsed directory state by status.
- Status directories show their task count, and tasks are sorted by task number.
- Directories with more than 100 tasks show a **Load more tasks** row. Selecting
  it reveals the next 100 tasks without changing task data.

The Task View is virtual: status directories do not move task Markdown files or
introduce parent/subtask relationships.

Task View grouping checks:

```sh
npm run test:task-statuses
```

---

## 🤝 How to Collaborate

1. **Fork the repository** on GitHub and clone your fork locally.
2. **Create a new branch** for your feature or bugfix:
   ```sh
   git checkout -b feature/my-feature
   ```
3. **Make your changes** and commit them with clear messages.
4. **Push your branch** to your fork:
   ```sh
   git push origin feature/my-feature
   ```
5. **Open a Pull Request** on GitHub describing your changes.
6. **Discuss and review**: Participate in code reviews and address feedback.

**Guidelines:**
- Follow the existing code style and structure.
- Write clear, concise commit messages.
- Add or update documentation as needed.
- Test your changes before submitting a PR.

---

## 📝 License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0).

```
Copyright (C) 2024 khmamed

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
```
