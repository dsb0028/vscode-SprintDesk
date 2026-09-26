import { CalendarSprint, ScheduledTask, SprintCalendar } from './sprintCalendar';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getCalendarDays(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

function renderSprintCard(sprint: CalendarSprint): string {
  const taskList = sprint.tasks.length
    ? `<ul>${sprint.tasks.map((task) => (
      `<li><strong>${escapeHtml(task.title)}</strong> `
      + `<span>${escapeHtml(task.status)} · ${escapeHtml(task.priority)}</span></li>`
    )).join('')}</ul>`
    : '<p class="empty">No tasks are assigned to this sprint.</p>';

  return `<article class="sprint-card">
    <h2>${escapeHtml(sprint.title)}</h2>
    <p>${formatDate(sprint.startDate)} – ${formatDate(sprint.endDate)}</p>
    <p class="scope">Sprint membership only; tasks without planned dates are not shown on the calendar.</p>
    ${taskList}
  </article>`;
}

function renderTask(task: ScheduledTask, startColumn?: number, span?: number, weekStart?: string, weekEnd?: string): string {
  const placement = startColumn === undefined ? '' : ` task-bar col-${startColumn} span-${span}`;
  const continuesBefore = weekStart !== undefined && task.startDate < weekStart;
  const continuesAfter = weekEnd !== undefined && task.endDate > weekEnd;
  const range = `${formatDate(task.startDate)} – ${formatDate(task.endDate)}`;
  return `<article class="task-card${placement}" aria-label="${escapeHtml(`${task.code}: ${task.title}; ${task.status}; ${range}`)}">
    ${continuesBefore ? '<span class="continuation">Continued from previous week</span>' : ''}
    <strong class="task-title" title="${escapeHtml(`${task.code}: ${task.title}`)}"><span class="task-code">${escapeHtml(task.code)}</span> ${escapeHtml(task.title)}</strong>
    <span class="task-status">${escapeHtml(task.status)}</span>
    <span class="task-range">${range}</span>
    ${continuesAfter ? '<span class="continuation">Continues next week</span>' : ''}
  </article>`;
}

function renderCalendarGrid(calendar: SprintCalendar): string {
  if (!calendar.startDate || !calendar.endDate) {
    return '<p class="empty">No sprints or tasks with valid date ranges are available.</p>';
  }

  const firstDay = new Date(`${calendar.startDate}T00:00:00Z`);
  firstDay.setUTCDate(firstDay.getUTCDate() - (firstDay.getUTCDay() + 6) % 7);
  const lastDay = new Date(`${calendar.endDate}T00:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() + (7 - lastDay.getUTCDay()) % 7);
  const days = getCalendarDays(firstDay.toISOString().slice(0, 10), lastDay.toISOString().slice(0, 10));
  const weeks: string[] = [];
  for (let offset = 0; offset < days.length; offset += 7) {
    const week = days.slice(offset, offset + 7);
    const weekStart = week[0];
    const weekEnd = week[6];
    const cells = week.map((day) => {
      const labels = calendar.sprints.filter((sprint) => (
        sprint.startDate <= day && day <= sprint.endDate
      )).map((sprint) => (
        `<span class="sprint-label">${escapeHtml(sprint.title)}</span>`
      )).join('');
      const cards = calendar.tasks.filter((task) => (
        task.startDate === day && task.endDate === day
      )).map((task) => renderTask(task)).join('');
      return `<div class="day"><time datetime="${day}">${formatDate(day)}</time>${labels}${cards}</div>`;
    }).join('');
    const bars = calendar.tasks.filter((task) => (
      task.startDate !== task.endDate && task.startDate <= weekEnd && task.endDate >= weekStart
    )).map((task) => {
      const start = task.startDate < weekStart ? 0 : week.indexOf(task.startDate);
      const end = task.endDate > weekEnd ? 6 : week.indexOf(task.endDate);
      return renderTask(task, start + 1, end - start + 1, weekStart, weekEnd);
    }).join('');
    weeks.push(`<div class="calendar-week" aria-label="Week of ${formatDate(weekStart)}">${cells}${bars}</div>`);
  }

  return `<section>
    <h2>Calendar</h2>
    <div class="calendar-scroll" role="region" aria-label="Task calendar" tabindex="0">
      <div class="calendar-grid">
        <div class="weekdays">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => `<strong>${day}</strong>`).join('')}</div>
        ${weeks.join('')}
      </div>
    </div>
  </section>`;
}

export function renderSprintCalendarHtml(calendar: SprintCalendar, nonce: string): string {
  const sprintCards = calendar.sprints.length
    ? calendar.sprints.map(renderSprintCard).join('')
    : '<p class="empty">No sprints with valid date ranges are available.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
  <title>Sprint Calendar</title>
  <style nonce="${nonce}">
    body { color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); margin: 0; padding: 24px; }
    h1 { margin-top: 0; }
    h2 { margin-bottom: 4px; }
    .calendar-scroll { overflow-x: auto; }
    .calendar-grid { min-width: 840px; }
    .calendar-week, .weekdays { display: grid; gap: 6px; grid-template-columns: repeat(7, minmax(0, 1fr)); }
    .calendar-week { margin-top: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    .weekdays { text-align: center; }
    .day { min-width: 0; grid-row: 1; }
    .day, .sprint-card { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 10px; }
    .day time { display: block; font-weight: 600; }
    .sprint-label { background: var(--vscode-badge-background); border-radius: 3px; color: var(--vscode-badge-foreground); display: block; font-size: 0.85em; margin-top: 6px; padding: 3px 5px; }
    .sprint-card { margin-top: 12px; }
    .scope, .empty, li span { color: var(--vscode-descriptionForeground); }
    .task-card { min-width: 0; margin-top: 8px; padding: 6px; border: 1px solid var(--vscode-focusBorder); border-left-width: 4px; border-radius: 4px; background: var(--vscode-editor-inactiveSelectionBackground); overflow-wrap: anywhere; }
    .task-bar { margin-top: 0; }
    .task-title { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .task-code { font-weight: 700; }
    .task-status, .task-range, .continuation { display: block; font-size: 0.85em; margin-top: 3px; }
    .continuation { font-style: italic; }
    .warnings { border: 1px solid var(--vscode-editorWarning-foreground); padding: 12px; }
    ${Array.from({ length: 7 }, (_, index) => `.col-${index + 1} { grid-column-start: ${index + 1}; } .span-${index + 1} { grid-column-end: span ${index + 1}; }`).join('\n    ')}
  </style>
</head>
<body>
  <h1>Sprint Calendar</h1>
  <p>Tasks with explicit planned dates appear as day cards or multi-day bars. End dates are inclusive; undated tasks stay off the calendar.</p>
  ${calendar.warnings.length ? `<section class="warnings" role="alert"><h2>Tasks not plotted</h2><ul>${calendar.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></section>` : ''}
  ${renderCalendarGrid(calendar)}
  <section>
    <h2>Sprint Tasks</h2>
    ${sprintCards}
  </section>
</body>
</html>`;
}
