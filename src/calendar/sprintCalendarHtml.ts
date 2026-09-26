import { CalendarSprint, SprintCalendar } from './sprintCalendar';

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
    <p class="scope">Tasks apply to the entire sprint.</p>
    ${taskList}
  </article>`;
}

function renderCalendarGrid(calendar: SprintCalendar): string {
  if (!calendar.startDate || !calendar.endDate) {
    return '';
  }

  const days = getCalendarDays(calendar.startDate, calendar.endDate);
  const cells = days.map((day) => {
    const activeSprints = calendar.sprints.filter((sprint) => (
      sprint.startDate <= day && day <= sprint.endDate
    ));
    const labels = activeSprints.map((sprint) => (
      `<span class="sprint-label">${escapeHtml(sprint.title)}</span>`
    )).join('');
    return `<div class="day"><time datetime="${day}">${formatDate(day)}</time>${labels}</div>`;
  }).join('');

  return `<section>
    <h2>Calendar</h2>
    <div class="calendar-grid">${cells}</div>
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
    .calendar-grid { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
    .day, .sprint-card { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 10px; }
    .day time { display: block; font-weight: 600; }
    .sprint-label { background: var(--vscode-badge-background); border-radius: 3px; color: var(--vscode-badge-foreground); display: block; font-size: 0.85em; margin-top: 6px; padding: 3px 5px; }
    .sprint-card { margin-top: 12px; }
    .scope, .empty, li span { color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <h1>Sprint Calendar</h1>
  <p>Assigned tasks are listed per sprint; they are not scheduled on individual days.</p>
  ${renderCalendarGrid(calendar)}
  <section>
    <h2>Sprint Tasks</h2>
    ${sprintCards}
  </section>
</body>
</html>`;
}
