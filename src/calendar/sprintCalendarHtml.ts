import { CalendarSprint, CalendarTask, ScheduledTask, SprintCalendar, SPRINT_COLORS } from './sprintCalendar';
import { buildMonthLayout, CalendarWeek, TASK_LANES } from './sprintCalendarLayout';
import { CalendarViewState, initialCalendarState, localCalendarDate } from './sprintCalendarState';
import { CALENDAR_STYLES } from './sprintCalendarStyles';
import { CALENDAR_SCRIPT } from './sprintCalendarScript';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00Z`));
}

function dateRange(task: CalendarTask): string {
  return task.startDate && task.endDate
    ? `${formatDate(task.startDate)} – ${formatDate(task.endDate)}` : 'Not scheduled';
}

function sprintClass(id: string | null, calendar: SprintCalendar): string {
  return `sprint-${calendar.sprints.findIndex(sprint => sprint.id === id)}`;
}

function taskId(task: CalendarTask): string {
  return `task-${encodeURIComponent(task.id)}`;
}

function luminance(color: string): number {
  const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function sprintForeground(color: string): string {
  const light = luminance(color) + 0.05;
  if (light / (luminance('#162130') + 0.05) >= 4.5) {return '#162130';}
  return 1.05 / light >= 4.5 ? '#ffffff' : '#000000';
}

function renderPicker(sprint: CalendarSprint, index: number): string {
  const palette = [...new Set([...SPRINT_COLORS, sprint.color])];
  return `<div class="picker" id="sprint-picker-${index}" role="group" aria-label="${escapeHtml(sprint.title)} controls" hidden>
    <strong>${escapeHtml(sprint.title)}</strong><small>Choose sprint color</small><div class="swatches">
    ${palette.map(color => `<button class="swatch swatch-${color.slice(1)}${color === sprint.color ? ' selected' : ''}"
      data-action="setSprintColor" data-sprint-id="${escapeHtml(sprint.id)}" data-color="${color}"
      aria-label="Set ${escapeHtml(sprint.title)} color to ${color}" aria-pressed="${color === sprint.color}"></button>`).join('')}
    <button class="delete-sprint" data-action="deleteSprint" data-sprint-id="${escapeHtml(sprint.id)}"
      aria-label="Delete ${escapeHtml(sprint.title)} sprint and return its tasks to backlog">×</button></div></div>`;
}

function renderWeek(week: CalendarWeek, calendar: SprintCalendar, state: CalendarViewState): string {
  const expanded = state.expandedWeeks.includes(week.id);
  const hidden = new Set<string>();
  const days = week.days.map((day, index) => {
    const tasks = calendar.tasks.filter(task => task.startDate <= day.date && task.endDate >= day.date);
    const shown = expanded ? tasks : tasks.slice(0, TASK_LANES);
    if (!expanded) {tasks.slice(TASK_LANES).forEach(task => hidden.add(task.id));}
    const cards = shown.map(task => `<button class="card ${sprintClass(task.sprintId, calendar)}${task.id === state.selectedTaskId ? ' selected' : ''}"
      id="${taskId(task)}-${day.date}" data-action="selectTask" data-task-id="${escapeHtml(task.id)}"
      data-date="${day.date}" aria-pressed="${task.id === state.selectedTaskId}"
      aria-label="${escapeHtml(`${task.code}: ${task.title}; ${task.status}; ${dateRange(task)}`)}"
      data-preview="${escapeHtml(`${task.title}\n${dateRange(task)}\n${task.status}`)}">
      <strong>${escapeHtml(task.code)}</strong> · ${escapeHtml(task.title)}<span class="task-status">${escapeHtml(task.status)}</span></button>`).join('');
    return `<div class="day${index > 4 ? ' weekend' : ''}${day.inMonth ? '' : ' adjacent'}" data-date="${day.date}">
      <time datetime="${day.date}" class="${day.isToday ? 'today' : ''}"${day.isToday ? ' aria-current="date"' : ''}
        aria-label="${formatDate(day.date)}">${Number(day.date.slice(-2))}</time>${cards}</div>`;
  }).join('');
  const crowded = week.days.some(day => calendar.tasks.filter(task => task.startDate <= day.date && task.endDate >= day.date).length > TASK_LANES);
  return `<section class="calendar-week" aria-label="Week of ${formatDate(week.id)}"><div class="dates" id="week-${week.id}">${days}</div>
    <div class="week-controls">${crowded ? `<button id="week-${week.id}-toggle" data-action="toggle" data-week="${week.id}"
      aria-controls="week-${week.id}" aria-expanded="${expanded}">${expanded ? 'Collapse week' : `${hidden.size} more tasks`}</button>` : ''}</div></section>`;
}

function renderSidebar(calendar: SprintCalendar, visibleTasks: ScheduledTask[], state: CalendarViewState, description: string): string {
  const selected = calendar.sprints.flatMap(sprint => sprint.tasks).find(task => task.id === state.selectedTaskId);
  const activeSprint = calendar.sprints.find(sprint => sprint.id === state.selectedSprintId)
    ?? calendar.sprints.find(sprint => sprint.startDate.slice(0, 7) <= state.month && sprint.endDate.slice(0, 7) >= state.month);
  const options = selected ? calendar.sprints.find(sprint => sprint.id === selected.sprintId)?.tasks ?? []
    : activeSprint?.tasks ?? visibleTasks;
  const color = selected ? sprintClass(selected.sprintId, calendar) : '';
  const menu = options.map(task => `<div class="task-option">
    <button class="task-choice" data-action="selectTask" data-task-id="${escapeHtml(task.id)}">
      <strong>${escapeHtml(task.code)} · ${escapeHtml(task.title)}</strong><small>${escapeHtml(task.status)} · ${escapeHtml(dateRange(task))}</small></button>
    <button class="remove-task" data-action="removeTask" data-task-id="${escapeHtml(task.id)}" data-sprint-id="${escapeHtml(task.sprintId ?? '')}"
      aria-label="Remove ${escapeHtml(task.code)} from sprint">×</button></div>`).join('');
  const membership = selected && calendar.sprints.find(sprint => sprint.id === selected.sprintId);
  const details = selected ? `<div class="details">
    <strong class="taskname">${escapeHtml(selected.code)} · ${escapeHtml(selected.title)}</strong>
    <dl class="meta"><dt>Status</dt><dd>${escapeHtml(selected.status)}</dd>
      <dt>Priority</dt><dd>${escapeHtml(selected.priority)}</dd><dt>Date range</dt><dd>${escapeHtml(dateRange(selected))}</dd>
      <dt>Sprint</dt><dd>${escapeHtml(membership ? membership.title : '')}</dd>
      <dt>Backlog</dt><dd>${escapeHtml(selected.backlog || 'None')}</dd>
      ${selected.epic ? `<dt>Epic</dt><dd>${escapeHtml(selected.epic)}</dd>` : ''}
      ${selected.assignee ? `<dt>Assignee</dt><dd>${escapeHtml(selected.assignee)}</dd>` : ''}</dl>
    <h3>Description</h3><p class="description">${escapeHtml(description || 'No description provided.')}</p>
    <div class="detail-actions"><button data-action="openTask" data-task-id="${escapeHtml(selected.id)}">Open task</button>
    <button data-action="clearSelection">Clear selection</button></div></div>` :
    `<p class="muted">${options.length ? 'Choose a task to see its details.' : 'No sprint tasks are available in this range.'}</p>`;
  const add = calendar.backlogTasks.length && activeSprint ? `<label for="sprint-target">Add to sprint</label>
    <select id="sprint-target" class="sprint-target">${calendar.sprints.map(sprint => `<option value="${escapeHtml(sprint.id)}"${sprint.id === activeSprint.id ? ' selected' : ''}>${escapeHtml(sprint.title)}</option>`).join('')}</select>
    <button id="add-task" class="add-task" data-action="popup" aria-controls="backlog-picker" aria-expanded="false">Add a task</button>
    <div class="backlog-picker" id="backlog-picker" role="group" aria-label="Available backlog tasks" hidden>
    ${calendar.backlogTasks.map(task => `<button class="backlog-choice" data-action="assignTask" data-task-id="${escapeHtml(task.id)}">${escapeHtml(task.code)} · ${escapeHtml(task.title)} (${escapeHtml(dateRange(task))})</button>`).join('')}</div>` : '';
  return `<aside class="side ${color}" aria-label="Task details"><h2>Task details</h2><label for="tasks">Tasks</label>
    <button id="tasks" class="task-trigger${selected ? ` selected ${color}` : ''}" data-action="popup" aria-controls="task-menu" aria-expanded="false"${options.length ? '' : ' disabled'}>
      ${selected ? `${escapeHtml(selected.code)} · ${escapeHtml(selected.title)}` : 'Tasks'} <span aria-hidden="true">▾</span></button>
    <div class="task-menu" id="task-menu" role="group" aria-label="Sprint tasks" hidden>${menu}</div>${details}${add}</aside>`;
}

export interface CalendarRenderOptions {
  state?: CalendarViewState;
  today?: string;
  description?: string;
}

/** Render real calendar data using the approved prototype's shell and interactions. */
export function renderSprintCalendarHtml(calendar: SprintCalendar, nonce: string, options: CalendarRenderOptions = {}): string {
  if (!/^[A-Za-z0-9+/_=-]+$/.test(nonce)) {throw new Error('Invalid calendar nonce.');}
  const today = options.today ?? localCalendarDate();
  const state = options.state ?? initialCalendarState(today);
  const assigned = calendar.tasks.filter(task => calendar.sprints.some(sprint => sprint.id === task.sprintId));
  const scheduled = { ...calendar, tasks: assigned };
  const layout = buildMonthLayout(scheduled, state.month, today);
  const first = layout.weeks[0].id;
  const last = layout.weeks.at(-1)!.days[6].date;
  const visibleTasks = assigned.filter(task => task.startDate <= last && task.endDate >= first);
  const visibleSprints = visibleTasks.length ? calendar.sprints.filter(sprint => (
    sprint.startDate <= last && sprint.endDate >= first
  ) || visibleTasks.some(task => task.sprintId === sprint.id)) : [];
  const label = new Intl.DateTimeFormat('en', {month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${state.month}-01T00:00:00Z`));
  const monthStart = `${state.month}-01`;
  const monthEnd = new Date(`${monthStart}T00:00:00Z`);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  monthEnd.setUTCDate(0);
  const monthDays = monthEnd.getUTCDate();
  const rules = calendar.sprints.map((sprint, index) => {
    const start = sprint.startDate < monthStart ? 0 : Math.min(monthDays - 1, Number(sprint.startDate.slice(-2)) - 1);
    const end = sprint.endDate > monthEnd.toISOString().slice(0,10) ? monthDays : Math.max(start + 1, Number(sprint.endDate.slice(-2)));
    return `.sprint-${index}{--sprint:${sprint.color};--sprint-fg:${sprintForeground(sprint.color)}} .ribbon.sprint-${index}{left:${start/monthDays*100}%;width:${(end-start)/monthDays*100}%}`;
  }).join('\n');
  const swatches = [...new Set([...SPRINT_COLORS,...calendar.sprints.map(sprint => sprint.color)])]
    .map(color => `.swatch-${color.slice(1)}{--swatch:${color}}`).join('\n');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <title>${label} · Sprint Calendar</title><style nonce="${nonce}">${CALENDAR_STYLES}\n${rules}\n${swatches}</style></head>
    <body data-month="${state.month}" data-focus="${escapeHtml(state.focusId ?? '')}" data-selected="${escapeHtml(state.selectedTaskId ?? '')}">
    <main class="app"><header class="top"><strong class="brand">SprintDesk</strong><span class="crumb">Calendar</span><span class="spacer"></span>
      <button data-action="refresh" id="refresh" aria-label="Refresh calendar from workspace">Refresh</button></header>
    <div class="main"><section class="cal"><header class="bar"><h1 id="month-heading">${label}</h1>
      <nav aria-label="Calendar month"><button id="nav-previous" data-action="previous">Previous</button><button id="nav-today" data-action="today">Today</button><button id="nav-next" data-action="next">Next</button></nav></header>
    <div class="ribbons">${visibleSprints.map(sprint => { const index = calendar.sprints.indexOf(sprint); return `<div class="ribbon-lane">
      <button class="ribbon sprint-${index}" id="ribbon-${index}" data-action="popup" aria-controls="sprint-picker-${index}" aria-expanded="false"
        aria-label="${escapeHtml(`${sprint.title}; ${formatDate(sprint.startDate)} – ${formatDate(sprint.endDate)}`)}">${escapeHtml(sprint.title)} · ${formatDate(sprint.startDate)} – ${formatDate(sprint.endDate)}</button></div>${renderPicker(sprint,index)}`; }).join('')}</div>
    <div class="calendar-scroll" id="calendar-scroll" role="region" aria-labelledby="month-heading" tabindex="0"><div class="calendar-grid">
      <div class="weekdays">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=>`<span>${day}</span>`).join('')}</div>
      ${layout.weeks.map(week=>renderWeek(week,scheduled,state)).join('')}</div></div>
    ${visibleTasks.length ? `<footer class="legend">${visibleSprints.map(sprint=>`<span class="legend-item ${sprintClass(sprint.id,calendar)}"><i class="dot"></i>${escapeHtml(sprint.title)} · ${sprint.tasks.length} ${sprint.tasks.length===1?'task':'tasks'}</span>`).join('')}</footer>` :
    '<div class="empty"><strong>No sprint tasks in this range</strong><p>Scheduled work will appear here. Unassigned work remains in the backlog.</p><button data-action="viewUnassigned">View unassigned tasks</button></div>'}
    </section>${renderSidebar(calendar,visibleTasks,state,options.description ?? '')}</div>
    ${calendar.warnings.length ? `<section class="warnings" role="alert"><h2>Tasks not plotted</h2><ul>${calendar.warnings.map(warning=>`<li>${escapeHtml(warning)}</li>`).join('')}</ul></section>` : ''}
    <details class="help"><summary>Scheduling help</summary><p>Tasks use explicit startDate and endDate; end dates are inclusive, including weekends.
    Only sprint-assigned tasks appear on the calendar; tasks without planned dates are not shown on the calendar.
    Choose a task to inspect its details. Use Refresh after changing workspace data. Adding a task to a sprint does not invent or change its dates.</p></details>
    </main><div class="preview" id="task-preview" hidden></div><p id="month-announcement" class="sr-only" role="status" aria-live="polite"></p>
    <script nonce="${nonce}">${CALENDAR_SCRIPT}</script></body></html>`;
}
