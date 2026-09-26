import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataService } from '../data/DataService';
import { Sprint, Task } from '../data/types';
import { buildSprintCalendar } from './sprintCalendar';
import { renderSprintCalendarHtml } from './sprintCalendarHtml';

const task: Task = {
  id: 'task-1',
  number: 1,
  code: 'SPD-1',
  name: 'document-calendar',
  title: 'Document Calendar',
  type: 'doc',
  status: 'waiting',
  priority: 'high',
  epic: null,
  backlog: 'TECHNICAL',
  sprint: 'sprint-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const sprint: Sprint = {
  id: 'sprint-1',
  number: 1,
  title: 'Calendar Sprint',
  name: 'calendar-sprint',
  startDate: '25-09-2026',
  endDate: '09-10-2026',
  status: 'planned',
  tasks: ['task-1', 'missing-task'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function runSprintCalendarTests(): void {
  const calendar = buildSprintCalendar([sprint], [task]);
  assert.deepEqual(calendar.startDate, '2026-09-25');
  assert.deepEqual(calendar.endDate, '2026-10-09');
  assert.deepEqual(calendar.sprints[0].tasks.map(({ id }) => id), ['task-1']);

  const reversedRange = buildSprintCalendar([{ ...sprint, startDate: '2026-10-09', endDate: '2026-09-25' }], [task]);
  assert.equal(reversedRange.sprints[0].startDate, '2026-09-25');
  assert.equal(reversedRange.sprints[0].endDate, '2026-10-09');

  const overlappingRanges = buildSprintCalendar([
    { ...sprint, id: 'sprint-long', title: 'Long Sprint', endDate: '2026-10-20' },
    { ...sprint, id: 'sprint-short', title: 'Short Sprint', startDate: '2026-10-01', endDate: '2026-10-05' },
  ], [task]);
  assert.equal(overlappingRanges.endDate, '2026-10-20');

  const invalidRange = buildSprintCalendar([{ ...sprint, startDate: 'not-a-date' }], [task]);
  assert.equal(invalidRange.sprints.length, 0);

  const html = renderSprintCalendarHtml(calendar, 'test-nonce');
  assert.match(html, /tasks without planned dates are not shown on the calendar/);
  assert.match(html, /Document Calendar/);
  assert.equal(calendar.tasks.length, 0);
  assert.doesNotMatch(html, /<article class="task-card/);

  const singleDay: Task = { ...task, startDate: '2026-09-25', endDate: '2026-09-25' };
  const scheduled = buildSprintCalendar([], [singleDay]);
  assert.equal(scheduled.startDate, '2026-09-25');
  assert.equal(scheduled.endDate, '2026-09-25');
  assert.deepEqual(scheduled.tasks[0], {
    id: task.id, code: task.code, title: task.title, status: task.status,
    priority: task.priority, path: task.path, startDate: '2026-09-25', endDate: '2026-09-25',
  });
  const singleHtml = renderSprintCalendarHtml(scheduled, 'test-nonce');
  assert.match(singleHtml, /<time datetime="2026-09-25">[^<]+<\/time><article class="task-card"/);
  assert.match(singleHtml, /class="task-code">SPD-1<\/span> Document Calendar/);
  assert.match(singleHtml, /class="task-status">waiting<\/span>/);
  assert.doesNotMatch(singleHtml, /class="task-card task-bar/);
  assert.equal((singleHtml.match(/<div class="day">/g) ?? []).length, 7);
  assert.match(singleHtml, /datetime="2026-09-21"/);
  assert.match(singleHtml, /datetime="2026-09-27"/);

  const multiDay = { ...task, startDate: '2026-09-25', endDate: '2026-10-06' };
  const multiHtml = renderSprintCalendarHtml(buildSprintCalendar([], [multiDay]), 'test-nonce');
  assert.match(multiHtml, /class="task-card task-bar col-5 span-3"/);
  assert.match(multiHtml, /class="task-card task-bar col-1 span-7"/);
  assert.match(multiHtml, /class="task-card task-bar col-1 span-2"/);
  assert.equal((multiHtml.match(/<article class="task-card task-bar/g) ?? []).length, 3);
  assert.equal((multiHtml.match(/Continued from previous week/g) ?? []).length, 2);
  assert.equal((multiHtml.match(/Continues next week/g) ?? []).length, 2);
  assert.match(multiHtml, /Sep 25, 2026 – Oct 6, 2026/);
  assert.doesNotMatch(multiHtml, /style="/);
  assert.match(multiHtml, /style-src 'nonce-test-nonce'/);

  const overlappingTasks = buildSprintCalendar([sprint, { ...sprint, id: 'second-sprint' }], [
    multiDay, { ...singleDay, id: 'task-2', code: 'SPD-2' },
    { ...multiDay, id: 'task-3', code: 'SPD-3' },
  ]);
  assert.equal(overlappingTasks.tasks.length, 3);
  const overlapHtml = renderSprintCalendarHtml(overlappingTasks, 'test-nonce');
  assert.equal((overlapHtml.match(/<article class="task-card/g) ?? []).length, 7);

  const outsideSprint = buildSprintCalendar([sprint], [
    { ...multiDay, sprint: null, startDate: '2026-09-01', endDate: '2026-11-01' },
  ]);
  assert.equal(outsideSprint.startDate, '2026-09-01');
  assert.equal(outsideSprint.endDate, '2026-11-01');

  for (const dates of [
    { startDate: '2026-02-29', endDate: '2026-03-01' },
    { startDate: 'invalid', endDate: '2026-09-25' },
    { startDate: '2026-09-26', endDate: '2026-09-25' },
    { startDate: '2026-09-25' },
    { endDate: '2026-09-25' },
  ]) {
    const invalidTask = buildSprintCalendar([], [{ ...task, ...dates }]);
    assert.equal(invalidTask.tasks.length, 0);
    assert.equal(invalidTask.startDate, null);
    assert.equal(invalidTask.warnings.length, 1);
    assert.match(renderSprintCalendarHtml(invalidTask, 'test-nonce'), /role="alert"/);
  }

  for (const dates of [
    { startDate: '28-02-2028', endDate: '01-03-2028', column: 1, span: 3 },
    { startDate: '2026-12-31', endDate: '2027-01-01', column: 4, span: 2 },
    { startDate: '2026-09-21', endDate: '2026-09-27', column: 1, span: 7 },
  ]) {
    const rangeHtml = renderSprintCalendarHtml(buildSprintCalendar([], [{ ...task, ...dates }]), 'test-nonce');
    assert.ok(rangeHtml.includes(`class="task-card task-bar col-${dates.column} span-${dates.span}"`));
    assert.doesNotMatch(rangeHtml, /class="continuation"/);
  }

  const malicious = '<script>alert("unsafe")</script>';
  const escapedHtml = renderSprintCalendarHtml(buildSprintCalendar(
    [{ ...sprint, title: malicious }],
    [{ ...singleDay, title: malicious, code: malicious }],
  ), 'test-nonce');
  assert.doesNotMatch(escapedHtml, /<script>/);
  assert.match(escapedHtml, /&lt;script&gt;alert\(&quot;unsafe&quot;\)&lt;\/script&gt;/);
  const warningHtml = renderSprintCalendarHtml(buildSprintCalendar([], [
    { ...task, code: malicious, startDate: 'invalid' },
  ]), 'test-nonce');
  assert.doesNotMatch(warningHtml, /<script>/);

  const empty = buildSprintCalendar([], [task]);
  assert.equal(empty.startDate, null);
  assert.equal(empty.endDate, null);
  assert.deepEqual(empty.warnings, []);
  assert.match(renderSprintCalendarHtml(empty, 'test-nonce'), /No sprints or tasks with valid date ranges/);

  const workspace = mkdtempSync(join(tmpdir(), 'sprintdesk-calendar-test-'));
  try {
    const service = new DataService(workspace);
    service.saveTasks([singleDay]);
    service.updateTask(singleDay.id, { endDate: multiDay.endDate });
    const reloaded = new DataService(workspace).loadTasks();
    const persisted = buildSprintCalendar([], reloaded);
    assert.equal(persisted.tasks[0].startDate, singleDay.startDate);
    assert.equal(persisted.tasks[0].endDate, multiDay.endDate);
  } finally {
    rmSync(workspace, { recursive: true });
  }
}

runSprintCalendarTests();
