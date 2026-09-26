# vscode-SprintDesk

A productivity extension for managing tasks, epics, backlogs, and sprints directly within Visual Studio Code. SprintDesk helps you organize your development workflow using Markdown files and a simple, intuitive sidebar interface.

---

## 🚀 Features

- **Task Management:** Create, view, and organize tasks as Markdown files in your workspace.
- **Epics & Backlogs:** Group tasks under epics and backlogs for better planning and tracking.
- **Quick Add Command:** Use the "Add Quickly" command to create tasks, epics, and backlog entries with a single input.
- **Sprint Planning:** Move tasks from backlogs to sprints for active development.
- **Task Calendar:** Browse a month view with aligned task bars, subtle sprint ribbons, and expandable busy weeks.
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

## Task Calendar

Run **SprintDesk: Show Sprint Calendar** from the Command Palette or a sprint's
context menu. The view includes sprint dates and explicitly scheduled tasks,
including tasks that are not assigned to a sprint.

### Browse the calendar

- The calendar opens on the current month. Use **Previous**, **Next**, and
  **Today** to navigate; the selected month is retained while the panel is open.
- Each month has six Monday-first weeks. Adjacent-month dates are subdued,
  weekends have a subtle background, and today's date is highlighted.
- Sprint ribbons provide context above the task lanes, with one label per
  weekly segment instead of a repeated label in every day.
- Single-day and multi-day tasks share the same aligned lanes. A multi-day
  bar spans its dates and continues in the following week when necessary.
- Busy weeks initially show up to two sprint lanes and three task lanes.
  Use the **more** controls to reveal the remaining items, then collapse
  the week again. Navigation to another month resets expanded weeks.
- Focus or hover over a task or sprint to read its full details. Navigation
  and expansion controls are keyboard accessible.
- On narrow panels, scroll the calendar horizontally to preserve readable
  date columns. Expand the secondary sprint membership section to inspect
  assigned tasks, including those without scheduled dates.

### Schedule tasks

To schedule a task, add both fields to its existing entry in
`.SprintDesk/data/tasks.yml` (the task source of truth):

```yaml
startDate: '2026-09-25'
endDate: '2026-09-28'
```

Use quoted `YYYY-MM-DD` strings; `DD-MM-YYYY` strings are also accepted.
Set both fields to the same date for a single-day task. Save the data file and
reopen the calendar to see the changes.

- End dates are inclusive and ranges include weekends. Dates are treated as
  calendar dates, without timezone conversion.
- Undated tasks stay off the grid; sprint membership, creation timestamps, and
  duration do not imply a schedule. The sprint task list still shows membership.
- Partial, invalid, or reversed task dates produce a visible warning and are not
  plotted. Task ranges are not clipped to their sprint's dates.

This is a read-only view; date pickers, drag-to-schedule, and automatic refresh
are not included. Navigation and expansion do not change task data. Reopen the
calendar after changing the data file to load the updated schedule. Editing a
task's Markdown description does not update its schedule in the YAML data.

Calendar development checks:

```sh
npm run test:calendar
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
