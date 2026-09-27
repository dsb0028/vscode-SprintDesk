import { CalendarSprint, ScheduledTask, SprintCalendar } from './sprintCalendar';
import { buildMonthLayout, CalendarSegment, CalendarWeek, SPRINT_LANES, TASK_LANES } from './sprintCalendarLayout';
import { CalendarViewState, initialCalendarState, localCalendarDate } from './sprintCalendarState';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00Z`));
}

const SPRINT_PALETTE = ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6', '#84cc16'];

function sprintClass(sprintId: string | null, sprints: CalendarSprint[]): string {
  const index = sprints.findIndex(sprint => sprint.id === sprintId);
  return index < 0 ? '' : `sprint-color-${index}`;
}

function sprintColorIndex(sprintId: string | null, sprints: CalendarSprint[]): string {
  const index = sprints.findIndex(sprint => sprint.id === sprintId);
  return index < 0 ? '' : ` data-sprint-color="${index}"`;
}

function renderSidebar(calendar: SprintCalendar, selectedSprintId: string | null | undefined): string {
  const sprint = calendar.sprints.find(item => item.id === selectedSprintId) ?? calendar.sprints[0];
  if (!sprint) {
    return '<aside class="sprint-sidebar"><h2>Sprint tasks</h2><p class="muted">No sprints are available.</p></aside>';
  }
  const colorClass = sprintClass(sprint.id, calendar.sprints);
  const members = sprint.tasks.map(task => `<li class="sidebar-task ${colorClass}">
    <button data-action="openTask" data-task-id="${escapeHtml(task.id)}">${escapeHtml(task.code)} · ${escapeHtml(task.title)}</button>
  </li>`).join('');
  const available = calendar.backlogTasks.map(task => `<button class="picker-option ${colorClass}" data-action="assignTask"
      data-sprint-id="${escapeHtml(sprint.id)}" data-task-id="${escapeHtml(task.id)}">${escapeHtml(task.code)} · ${escapeHtml(task.title)}</button>`).join('');
  return `<aside class="sprint-sidebar ${colorClass}" aria-label="Sprint task sidebar">
    <div class="sidebar-heading"><div><h2>${escapeHtml(sprint.title)}</h2>
      <p>${formatDate(sprint.startDate)} – ${formatDate(sprint.endDate)}</p></div></div>
    <ul class="sidebar-tasks">${members || '<li class="muted">No tasks are assigned to this sprint.</li>'}</ul>
    <button class="add-task" data-action="toggleTaskPicker" aria-expanded="false" aria-controls="task-picker">Add a task</button>
    <div id="task-picker" class="task-picker" hidden>
      <div class="picker-members">${sprint.tasks.map(task => `<div class="picker-member ${colorClass}">
        <button data-action="openTask" data-task-id="${escapeHtml(task.id)}">${escapeHtml(task.code)} · ${escapeHtml(task.title)}</button>
        <button class="task-remove" data-action="removeTask" data-sprint-id="${escapeHtml(sprint.id)}"
          data-task-id="${escapeHtml(task.id)}" aria-label="Remove ${escapeHtml(task.title)} from sprint">×</button>
      </div>`).join('')}</div>
      <div class="picker-available">${available || '<p class="muted">No backlog tasks available.</p>'}</div>
    </div>
  </aside>`;
}

function renderSegment(
  segment: CalendarSegment<CalendarSprint | ScheduledTask>, kind: 'sprint' | 'task', week: string, index: number,
  calendar: SprintCalendar,
): string {
  const item = segment.item;
  const task = 'code' in item ? item : null;
  const label = task ? `${task.code}: ${task.title}; ${task.status}; ${task.priority}` : item.title;
  const before = segment.continuesBefore ? 'Continued from previous week. ' : '';
  const after = segment.continuesAfter ? ' Continues next week.' : '';
  const detail = `${label}; ${formatDate(item.startDate)} – ${formatDate(item.endDate)}. ${before}${after}`;
  const id = `${kind}-${week}-${index}`;
  const sprint = 'code' in item ? calendar.sprints.find(candidate => candidate.id === item.sprintId) : item;
  const colorAttribute = sprint ? sprintColorIndex(sprint.id, calendar.sprints) : '';
  const picker = !task && sprint ? `<div class="ribbon-actions" aria-label="Sprint controls">
    <div class="color-picker" aria-label="Choose ${escapeHtml(sprint.title)} color">${SPRINT_PALETTE.map(color => `<button
      class="color-swatch${color === sprint.color ? ' selected' : ''}" data-action="setSprintColor"
      data-sprint-id="${escapeHtml(sprint.id)}" data-color="${color}" aria-label="Set sprint color to ${color}"></button>`).join('')}</div>
    <button class="delete-sprint" data-action="deleteSprint" data-sprint-id="${escapeHtml(sprint.id)}"
      aria-label="Delete ${escapeHtml(sprint.title)}">×</button></div>` : '';
  return `<div class="segment ${kind}-bar col-${segment.column} span-${segment.span}"${colorAttribute} tabindex="0"
      ${task ? `role="button" data-action="openTask" data-task-id="${escapeHtml(task.id)}"` : `role="button" data-action="selectSprint" data-sprint-id="${escapeHtml(item.id)}"`}
      id="${id}" aria-label="${escapeHtml(detail)}" data-detail="${escapeHtml(detail)}">
    ${segment.continuesBefore ? '<span class="continuation" aria-hidden="true">‹</span>' : ''}
    <span class="bar-title">${task ? `<strong class="task-code">${escapeHtml(task.code)}</strong> ` : ''}${escapeHtml(item.title)}</span>
    ${task ? `<span class="task-status">${escapeHtml(task.status)}</span>` : ''}
    ${segment.continuesAfter ? '<span class="continuation" aria-hidden="true">›</span>' : ''}
    ${picker}
  </div>`;
}

function renderLanes<T extends CalendarSprint | ScheduledTask>(
  segments: CalendarSegment<T>[], kind: 'sprint' | 'task', week: CalendarWeek,
  expanded: boolean, collapsedCount: number, calendar: SprintCalendar,
): string {
  const count = expanded ? Math.max(collapsedCount, ...segments.map(segment => segment.lane + 1)) : collapsedCount;
  return `<div class="${kind}-lanes">${Array.from({ length: count }, (_, lane) => (
    `<div class="lane ${kind}-lane">${segments.map((segment, index) => segment.lane === lane
      ? renderSegment(segment, kind, week.id, index, calendar) : '').join('')}</div>`
  )).join('')}</div>`;
}

function renderWeek(
  week: CalendarWeek, state: CalendarViewState, sprintLanes: number, taskLanes: number, calendar: SprintCalendar,
): string {
  const expanded = state.expandedWeeks.includes(week.id);
  const hidden = [
    week.hiddenSprints ? `${week.hiddenSprints} more ${week.hiddenSprints === 1 ? 'sprint' : 'sprints'}` : '',
    week.hiddenTasks ? `${week.hiddenTasks} more ${week.hiddenTasks === 1 ? 'task' : 'tasks'}` : '',
  ].filter(Boolean).join(' · ');
  return `<section class="calendar-week" aria-label="Week of ${formatDate(week.id)}">
    <div class="day-columns" aria-hidden="true">${week.days.map((_, index) => `<div class="${index > 4 ? 'weekend' : ''}"></div>`).join('')}</div>
    <div class="date-row">${week.days.map(day => `<div class="day${day.inMonth ? '' : ' adjacent'}${day.isToday ? ' today' : ''}">
      <time datetime="${day.date}" ${day.isToday ? 'aria-current="date"' : ''} aria-label="${formatDate(day.date)}${day.isToday ? ', today' : ''}">${Number(day.date.slice(-2))}</time>
    </div>`).join('')}</div>
    <div id="week-${week.id}-lanes">${renderLanes(week.sprints, 'sprint', week, expanded, sprintLanes, calendar)}${renderLanes(week.tasks, 'task', week, expanded, taskLanes, calendar)}</div>
    <div class="week-controls">${hidden ? `<button id="week-${week.id}-toggle" data-action="toggle" data-week="${week.id}"
      aria-expanded="${expanded}" aria-controls="week-${week.id}-lanes"
      aria-label="${expanded ? 'Collapse' : `Show ${hidden}`} for week of ${formatDate(week.id)}">${expanded ? 'Collapse week' : hidden}</button>` : ''}</div>
  </section>`;
}

export interface CalendarRenderOptions {
  state?: CalendarViewState;
  today?: string;
}

/** Pure HTML entry point; pass explicit state/today for deterministic previews. */
export function renderSprintCalendarHtml(
  calendar: SprintCalendar, nonce: string, options: CalendarRenderOptions = {},
): string {
  if (!/^[A-Za-z0-9+/_=-]+$/.test(nonce)) {
    throw new Error('Invalid calendar nonce.');
  }
  const today = options.today ?? localCalendarDate();
  const state = options.state ?? initialCalendarState(today);
  const layout = buildMonthLayout(calendar, state.month, today);
  const sprintLanes = Math.min(SPRINT_LANES, layout.weeks.reduce((count, week) => (
    week.sprints.reduce((lanes, segment) => Math.max(lanes, segment.lane + 1), count)
  ), 0));
  const taskLanes = Math.min(TASK_LANES, layout.weeks.reduce((count, week) => (
    week.tasks.reduce((lanes, segment) => Math.max(lanes, segment.lane + 1), count)
  ), 0));
  const monthLabel = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${state.month}-01T00:00:00Z`));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>${monthLabel} · Sprint Calendar</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; }
    body {
      --calendar-foreground: var(--vscode-editor-foreground, #24292f);
      --calendar-background: var(--vscode-editor-background, #ffffff);
      --calendar-muted: var(--vscode-descriptionForeground, #57606a);
      --calendar-border: var(--vscode-contrastBorder, var(--vscode-panel-border, #d0d7de));
      --calendar-fill: var(--vscode-editor-inactiveSelectionBackground, #eaeef2);
      --calendar-focus: var(--vscode-focusBorder, #0969da);
      --calendar-link: var(--vscode-textLink-foreground, #0969da);
      color: var(--calendar-foreground); background: var(--calendar-background); font-family: var(--vscode-font-family, sans-serif); font-size: var(--vscode-font-size, 13px); margin: 0; padding: 16px;
    }
    main { max-width: 1600px; margin: auto; min-width: 0; }
    .calendar-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 320px); gap: 16px; align-items: start; }
    h1 { font-size: 1.5em; font-weight: 600; margin: 0; }
    h2, h3 { font-size: 1em; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
    nav { display: flex; gap: 6px; }
    button { font: inherit; color: var(--vscode-button-secondaryForeground, var(--calendar-foreground)); background: var(--vscode-button-secondaryBackground, var(--calendar-fill)); border: 1px solid var(--vscode-contrastBorder, transparent); border-radius: 3px; padding: 4px 9px; cursor: pointer; }
    button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground, #d8dee4)); }
    :focus-visible { outline: 2px solid var(--calendar-focus); outline-offset: 2px; }
    .calendar-scroll { max-width: 100%; overflow-x: auto; border: 1px solid var(--calendar-border); border-radius: 4px; }
    .calendar-grid { min-width: 700px; }
    .weekdays, .date-row, .lane, .day-columns { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
    .weekdays { padding: 8px 0; text-align: center; font-size: .85em; color: var(--calendar-muted); }
    .calendar-week { position: relative; min-height: 104px; border-top: 1px solid var(--calendar-border); }
    .day-columns { position: absolute; inset: 0; pointer-events: none; }
    .day-columns > div + div { border-left: 1px solid var(--calendar-border); }
    .weekend { background: var(--calendar-fill); opacity: .25; }
    .date-row, .sprint-lanes, .task-lanes, .week-controls { position: relative; }
    .day { min-width: 0; height: 28px; padding: 3px 6px; font-size: .85em; }
    time { display: inline-flex; min-width: 22px; height: 22px; align-items: center; justify-content: center; border-radius: 50%; }
    .adjacent { color: var(--calendar-muted); }
    .today time { background: var(--vscode-button-background, #0969da); color: var(--vscode-button-foreground, #ffffff); font-weight: 700; outline: 1px solid var(--calendar-focus); }
    .lane { gap: 0; align-items: center; }
    .sprint-lane { height: 20px; }
    .task-lane { height: 27px; }
    .task-lanes { padding-top: 3px; }
    .segment { display: flex; align-items: center; gap: 4px; min-width: 0; height: 23px; margin: 0 3px; padding: 2px 5px; border: 1px solid var(--calendar-border); border-radius: 3px; cursor: default; }
    .sprint-bar { height: 17px; border-radius: 2px; border-left-width: 3px; color: var(--calendar-foreground); background: var(--calendar-background); font-size: .78em; cursor: pointer; }
    .task-bar { background: var(--calendar-fill); border-left: 3px solid var(--calendar-link); font-size: .85em; cursor: pointer; }
    .sprint-bar[data-sprint-color], .task-bar[data-sprint-color] { border-left-color: var(--sprint-color); }
    .ribbon-actions { display: none; position: absolute; right: 2px; align-items: center; gap: 3px; background: var(--calendar-background); }
    .sprint-bar:hover .ribbon-actions, .sprint-bar:focus-within .ribbon-actions { display: flex; }
    .color-picker { display: flex; gap: 2px; }
    .color-swatch { width: 13px; height: 13px; min-width: 13px; padding: 0; border-radius: 50%; background: var(--swatch); }
    ${SPRINT_PALETTE.map(color => `.color-swatch[data-color="${color}"] { background: ${color}; }`).join('\n')}
    ${calendar.sprints.map((sprint, index) => `.sprint-color-${index}, [data-sprint-color="${index}"] { --sprint-color: ${sprint.color}; }`).join('\n')}
    .color-swatch.selected { outline: 2px solid #fff; outline-offset: 1px; }
    .delete-sprint { display: none; min-width: 18px; height: 18px; padding: 0; color: var(--vscode-errorForeground, #b42318); background: var(--calendar-background); }
    .sprint-bar:hover .delete-sprint, .sprint-bar:focus-within .delete-sprint { display: block; }
    .bar-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; }
    .task-status { font-size: .85em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40%; color: var(--calendar-muted); }
    .continuation { flex: none; }
    .week-controls { min-height: 28px; padding: 2px 5px; }
    .week-controls button { padding: 2px 6px; font-size: .8em; background: transparent; color: var(--calendar-link); }
    .detail-box { margin: 12px 0; border: 1px solid var(--calendar-border); padding: 9px 12px; min-height: 52px; overflow-wrap: anywhere; }
    .sprint-sidebar { position: sticky; top: 12px; border: 1px solid var(--calendar-border); border-left: 4px solid var(--sprint-color, var(--calendar-link)); padding: 10px; }
    .sidebar-heading h2, .sidebar-heading p { margin: 0 0 4px; }
    .sidebar-tasks { list-style: none; padding: 0; margin: 10px 0; }
    .sidebar-task { border-left: 3px solid var(--sprint-color); margin: 5px 0; }
    .sidebar-task button, .picker-member > button:first-child, .picker-option { width: 100%; text-align: left; background: transparent; border: 0; padding: 5px; color: var(--calendar-foreground); }
    .task-picker { margin-top: 8px; border-top: 1px solid var(--calendar-border); padding-top: 7px; }
    .picker-member { position: relative; border-left: 3px solid var(--sprint-color); margin: 4px 0; padding-right: 22px; }
    .task-remove { position: absolute; right: 2px; bottom: 2px; min-width: 18px; height: 18px; padding: 0; color: var(--vscode-errorForeground, #b42318); }
    .picker-option { display: block; border-left: 3px solid var(--sprint-color); margin: 4px 0; }
    .calendar-legend { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 10px; }
    .legend-item { border-left: 4px solid var(--sprint-color); padding-left: 5px; }
    .detail-box p { margin: 3px 0 0; }
    #item-popover { position: fixed; z-index: 5; left: 16px; right: 16px; bottom: 12px; margin: auto; max-width: 850px; padding: 10px 12px; border: 1px solid var(--calendar-focus); background: var(--vscode-editorHoverWidget-background, var(--calendar-background)); color: var(--vscode-editorHoverWidget-foreground, var(--calendar-foreground)); box-shadow: 0 2px 8px var(--vscode-widget-shadow, #0003); overflow-wrap: anywhere; pointer-events: none; }
    details { margin-top: 12px; }
    summary { cursor: pointer; padding: 5px 0; }
    .muted, .sprint-card li span { color: var(--calendar-muted); }
    .sprint-card { border-top: 1px solid var(--calendar-border); padding: 4px 0; overflow-wrap: anywhere; }
    .sprint-card li { margin: 6px 0; }
    .sprint-card li span { display: block; font-size: .9em; }
    .warnings { border: 1px solid var(--vscode-editorWarning-foreground, #9a6700); padding: 8px 12px; margin: 12px 0; overflow-wrap: anywhere; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
    @media (max-width: 760px) { body { padding: 10px; } h1 { font-size: 1.25em; } .toolbar { gap: 8px; } .calendar-layout { grid-template-columns: 1fr; } .sprint-sidebar { position: static; } }
    @media (forced-colors: active) { .segment, button, .calendar-scroll, .today time { border: 1px solid CanvasText; } }
    ${Array.from({ length: 7 }, (_, index) => `.col-${index + 1} { grid-column-start: ${index + 1}; } .span-${index + 1} { grid-column-end: span ${index + 1}; }`).join('\n')}
  </style>
</head>
<body data-focus="${escapeHtml(state.focusId ?? '')}" data-month="${state.month}">
<main>
  <header class="toolbar"><h1 id="month-heading">${monthLabel}</h1>
    <nav aria-label="Calendar month">
      <button id="nav-previous" data-action="previous" aria-label="Previous month">‹ Previous</button>
      <button id="nav-today" data-action="today">Today</button>
      <button id="nav-next" data-action="next" aria-label="Next month">Next ›</button>
    </nav>
  </header>
  <p id="month-announcement" class="sr-only" role="status" aria-live="polite"></p>
  <div class="calendar-layout">
    <section>
      <div class="calendar-legend" aria-label="Sprint colors">${calendar.sprints.map(sprint => `<span class="legend-item ${sprintClass(sprint.id, calendar.sprints)}">${escapeHtml(sprint.title)}</span>`).join('')}</div>
      <div class="calendar-scroll" id="calendar-scroll" role="region" aria-labelledby="month-heading" aria-label="Month calendar, horizontally scrollable" tabindex="0">
        <div class="calendar-grid">
          <div class="weekdays">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => `<strong>${day}</strong>`).join('')}</div>
          ${layout.weeks.map(week => renderWeek(week, state, sprintLanes, taskLanes, calendar)).join('')}
        </div>
      </div>
    </section>
    ${renderSidebar(calendar, state.selectedSprintId)}
  </div>
  <section class="detail-box" aria-label="Item details"><strong>Item details</strong>
    <p id="item-details" class="muted">Focus or hover a task or sprint to read its full details. Click a task or press Enter or Space to open its Markdown file.</p>
  </section>
  <div id="item-popover" hidden aria-hidden="true"></div>
  ${calendar.warnings.length ? `<section class="warnings" role="alert"><h2>Tasks not plotted</h2><ul>${calendar.warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></section>` : ''}
  ${!layout.weeks.some(week => week.tasks.length || week.sprints.length) ? '<p class="muted">No scheduled sprints or tasks in this month view.</p>' : ''}
  <details id="calendar-help"><summary>Scheduling help</summary>
    <p>Tasks use explicit startDate and endDate; end dates are inclusive, including weekends.
      Sprint membership does not schedule tasks: tasks without planned dates are not shown on the calendar.
      Scheduled tasks outside sprint ranges or without a sprint still appear. Select a sprint ribbon to manage its task list,
      and use the week controls to reveal hidden items.</p>
  </details>
</main>
<script nonce="${nonce}">
(() => {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  const scroll = document.getElementById('calendar-scroll');
  const popover = document.getElementById('item-popover');
  const details = document.getElementById('item-details');
  let locked = false;
  function remember() {
    vscode.setState({ month: document.body.dataset.month, focus: document.activeElement?.id,
      x: scroll.scrollLeft, y: window.scrollY,
      help: document.getElementById('calendar-help').open });
  }
  function show(element) {
    if (!element?.dataset.detail) { return; }
    details.textContent = element.dataset.detail;
    popover.textContent = element.dataset.detail;
    popover.hidden = false;
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button || locked) { return; }
    remember();
    if (button.dataset.action === 'toggleTaskPicker') {
      const picker = document.getElementById('task-picker');
      const open = picker.hidden;
      picker.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      return;
    }
    if (button.dataset.action === 'openTask') {
      vscode.postMessage({ action: 'openTask', taskId: button.dataset.taskId });
      return;
    }
    locked = true;
    const message = { action: button.dataset.action };
    if (message.action === 'toggle') { message.week = button.dataset.week; }
    if (message.action === 'selectSprint' || message.action === 'deleteSprint') { message.sprintId = button.dataset.sprintId; }
    if (message.action === 'setSprintColor') { message.sprintId = button.dataset.sprintId; message.color = button.dataset.color; }
    if (message.action === 'assignTask' || message.action === 'removeTask') { message.sprintId = button.dataset.sprintId; message.taskId = button.dataset.taskId; }
    vscode.postMessage(message);
  });
  document.addEventListener('focusin', event => { show(event.target); remember(); });
  document.addEventListener('focusout', () => { popover.hidden = true; });
  document.querySelectorAll('.segment').forEach(element => {
    element.addEventListener('mouseenter', () => show(element));
    element.addEventListener('mouseleave', () => {
      popover.hidden = true;
      if (document.activeElement?.matches('.segment')) { show(document.activeElement); }
    });
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { popover.hidden = true; }
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-action="openTask"]')) {
      event.preventDefault();
      event.target.click();
    }
  });
  document.querySelectorAll('details').forEach(element => element.addEventListener('toggle', remember));
  scroll.addEventListener('scroll', remember, { passive: true });
  window.addEventListener('scroll', remember, { passive: true });
  document.getElementById('calendar-help').open = Boolean(saved.help);
  requestAnimationFrame(() => {
    const sameMonth = saved.month === document.body.dataset.month;
    const focus = document.getElementById(document.body.dataset.focus || (sameMonth ? saved.focus : '') || '');
    focus?.focus({ preventScroll: true });
    scroll.scrollLeft = Number(saved.x) || 0;
    window.scrollTo(0, sameMonth ? Number(saved.y) || 0 : 0);
    document.getElementById('month-announcement').textContent = document.getElementById('month-heading').textContent;
  });
})();
</script>
</body>
</html>`;
}
