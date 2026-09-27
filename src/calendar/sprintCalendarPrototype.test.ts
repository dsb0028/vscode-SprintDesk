import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { Task, Sprint } from '../data/types';
import { buildSprintCalendar } from './sprintCalendar';
import { renderSprintCalendarHtml } from './sprintCalendarHtml';

const task: Task = {
  id: 'real-task', code: 'WORK-42', number: 42, title: 'A workspace task',
  name: 'workspace-task', type: 'feature', status: 'under-review', priority: 'high',
  sprint: 'real-sprint', backlog: 'Engineering', epic: null, assignee: 'Reviewer',
  startDate: '2025-04-02', endDate: '2025-04-04', createdAt: '', updatedAt: '',
};
const sprint: Sprint = {
  id: 'real-sprint', number: 1, name: 'workspace-sprint', title: 'Workspace sprint',
  startDate: '2025-04-01', endDate: '2025-04-18', status: 'planned',
  tasks: [task.id], color: '#55c2ae', createdAt: '', updatedAt: '',
};
const options = { today: '2025-04-10', state: { month: '2025-04', expandedWeeks: [], focusId: null } };
const calendar = buildSprintCalendar([sprint], [task]);
const html = renderSprintCalendarHtml(calendar, 'prototype-test', options);
assert.match(html, /class="app"/);
assert.match(html, /class="ribbons"/);
assert.ok(html.indexOf('class="ribbons"') < html.indexOf('class="weekdays"'));
assert.match(html, /data-action="selectTask" data-task-id="real-task"/);
assert.match(html, /class="task-trigger"/);
assert.doesNotMatch(html, /Item details|Show details|sidebar-tasks/);
assert.match(html, /WORK-42/);
assert.match(html, /under-review/);
assert.doesNotMatch(html, /SPD-100|Platform hardening|Release readiness/);
assert.equal((html.match(/<time datetime=/g) ?? []).length, 35);
assert.equal((html.match(/class="card /g) ?? []).length, 3);
assert.match(html, /data-date="2025-04-02"/);
assert.doesNotMatch(html, /onclick=|style="/);
assert.doesNotThrow(() => new Script(html.match(/<script nonce="prototype-test">([\s\S]+)<\/script>/)![1]));

const selectedOptions = {
  ...options, state: { ...options.state, selectedTaskId: task.id },
};
const selected = renderSprintCalendarHtml(calendar, 'prototype-test', selectedOptions);
assert.match(selected, /class="details"/);
assert.match(selected, /Reviewer/);
assert.match(selected, /Engineering/);
assert.match(selected, /data-action="openTask"/);

const unassigned = buildSprintCalendar([sprint], [{ ...task, sprint: null }]);
const empty = renderSprintCalendarHtml(unassigned, 'prototype-test', options);
assert.match(empty, /No sprint tasks in this range/);
assert.match(empty, /Add a task/);
assert.doesNotMatch(empty, /class="card |class="legend-item/);
const other = renderSprintCalendarHtml(buildSprintCalendar([sprint], [
  { ...task, id: 'different', code: 'NEW-7', title: 'Changed actual title', status: 'blocked' },
]), 'prototype-test', options);
assert.match(other, /Changed actual title/);
assert.match(other, /blocked/);
assert.doesNotMatch(other, /WORK-42|A workspace task/);

const undated = renderSprintCalendarHtml(buildSprintCalendar([sprint], [
  { ...task, startDate: undefined, endDate: undefined },
]), 'prototype-test', options);
assert.doesNotMatch(undated, /class="card /);
assert.match(undated, /class="task-choice" data-action="selectTask" data-task-id="real-task"/);
assert.match(undated, /Not scheduled/);
for (const [color,foreground] of [['#000000','#ffffff'],['#ffffff','#162130'],['#808080','#000000']]) {
  const colored = renderSprintCalendarHtml(buildSprintCalendar([{...sprint,color}],[task]),'prototype-test',options);
  assert.ok(colored.includes(`--sprint:${color};--sprint-fg:${foreground}`));
}
