import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { DataService } from '../data/DataService';
import { Sprint, Task } from '../data/types';
import { buildSprintCalendar } from './sprintCalendar';
import { renderSprintCalendarHtml } from './sprintCalendarHtml';
import './sprintCalendarLayout.test';
import { runSprintCalendarCommandTests } from './sprintCalendarCommand.test';

const septemberView = { today: '2026-09-25', state: { month: '2026-09', expandedWeeks: [], focusId: null } };

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

  const html = renderSprintCalendarHtml(calendar, 'test-nonce', septemberView);
  assert.match(html, /tasks without planned dates are not shown on the calendar/);
  assert.match(html, /Document Calendar/);
  assert.equal(calendar.tasks.length, 0);
  assert.doesNotMatch(html, /class="segment task-bar/);
  assert.match(html, /Not scheduled on calendar \(undated or invalid dates\)/);

  const singleDay: Task = { ...task, startDate: '2026-09-25', endDate: '2026-09-25' };
  const scheduled = buildSprintCalendar([], [singleDay]);
  assert.equal(scheduled.startDate, '2026-09-25');
  assert.equal(scheduled.endDate, '2026-09-25');
  assert.deepEqual(scheduled.tasks[0], {
    id: task.id, code: task.code, title: task.title, status: task.status,
    priority: task.priority, path: task.path, startDate: '2026-09-25', endDate: '2026-09-25',
  });
  const singleHtml = renderSprintCalendarHtml(scheduled, 'test-nonce', septemberView);
  assert.match(singleHtml, /class="segment task-bar col-5 span-1"/);
  assert.match(singleHtml, /class="task-code">SPD-1<\/strong> Document Calendar/);
  assert.match(singleHtml, /class="task-status">waiting<\/span>/);
  assert.equal((singleHtml.match(/<time datetime=/g) ?? []).length, 42);
  assert.match(singleHtml, /datetime="2026-08-31"/);
  assert.match(singleHtml, /datetime="2026-10-11"/);
  assert.match(singleHtml, /aria-current="date"/);
  assert.equal((singleHtml.match(/class="lane task-lane"/g) ?? []).length, 6);
  assert.equal((singleHtml.match(/class="lane sprint-lane"/g) ?? []).length, 0);
  const sparseHtml = renderSprintCalendarHtml(
    buildSprintCalendar([sprint], [singleDay]), 'test-nonce', septemberView,
  );
  assert.equal((sparseHtml.match(/class="lane task-lane"/g) ?? []).length, 6);
  assert.equal((sparseHtml.match(/class="lane sprint-lane"/g) ?? []).length, 6);

  const multiDay = { ...task, startDate: '2026-09-25', endDate: '2026-10-06' };
  const multiHtml = renderSprintCalendarHtml(buildSprintCalendar([], [multiDay]), 'test-nonce', septemberView);
  assert.match(multiHtml, /class="segment task-bar col-5 span-3"/);
  assert.match(multiHtml, /class="segment task-bar col-1 span-7"/);
  assert.match(multiHtml, /class="segment task-bar col-1 span-2"/);
  assert.equal((multiHtml.match(/class="segment task-bar/g) ?? []).length, 3);
  assert.equal((multiHtml.match(/Continued from previous week/g) ?? []).length, 4);
  assert.equal((multiHtml.match(/Continues next week/g) ?? []).length, 4);
  assert.match(multiHtml, /Sep 25, 2026 – Oct 6, 2026/);
  assert.doesNotMatch(multiHtml, /style="/);
  assert.match(multiHtml, /style-src 'nonce-test-nonce'/);

  const overlappingTasks = buildSprintCalendar([sprint, { ...sprint, id: 'second-sprint' }], [
    multiDay, { ...singleDay, id: 'task-2', code: 'SPD-2' },
    { ...multiDay, id: 'task-3', code: 'SPD-3' },
  ]);
  assert.equal(overlappingTasks.tasks.length, 3);
  const overlapHtml = renderSprintCalendarHtml(overlappingTasks, 'test-nonce', septemberView);
  assert.equal((overlapHtml.match(/class="segment task-bar/g) ?? []).length, 7);
  assert.equal((overlapHtml.match(/class="segment sprint-bar/g) ?? []).length, 6);

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
    const rangeCalendar = buildSprintCalendar([], [{ ...task, ...dates }]);
    const rangeHtml = renderSprintCalendarHtml(rangeCalendar, 'test-nonce', {
      today: rangeCalendar.startDate!, state: {
        month: rangeCalendar.startDate!.slice(0, 7), expandedWeeks: [], focusId: null,
      },
    });
    assert.ok(rangeHtml.includes(`class="segment task-bar col-${dates.column} span-${dates.span}"`));
    assert.doesNotMatch(rangeHtml, /class="continuation"/);
  }

  const malicious = '<script>alert("unsafe")</script>';
  const escapedHtml = renderSprintCalendarHtml(buildSprintCalendar(
    [{ ...sprint, title: malicious }],
    [{ ...singleDay, title: malicious, code: malicious }],
  ), 'test-nonce', septemberView);
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
  const emptyHtml = renderSprintCalendarHtml(empty, 'test-nonce', septemberView);
  assert.match(emptyHtml, /No scheduled sprints or tasks in this month view/);
  assert.equal((emptyHtml.match(/<time datetime=/g) ?? []).length, 42);
  assert.match(emptyHtml, /script-src 'nonce-test-nonce'/);
  assert.match(emptyHtml, /<script nonce="test-nonce">/);
  assert.doesNotMatch(emptyHtml, /onclick=|https?:\/\//);
  assert.doesNotThrow(() => new Script(emptyHtml.match(/<script nonce="test-nonce">([\s\S]+)<\/script>/)![1]));
  assert.throws(() => renderSprintCalendarHtml(empty, 'bad"nonce'), /Invalid calendar nonce/);

  const crowded = buildSprintCalendar(Array.from({ length: 4 }, (_, index) => ({
    ...sprint, id: `sprint-${index}`,
  })), Array.from({ length: 6 }, (_, index) => ({
    ...singleDay, id: `task-${index}`, code: `SPD-${index}`,
  })));
  const collapsedHtml = renderSprintCalendarHtml(crowded, 'test-nonce', septemberView);
  assert.match(collapsedHtml, /2 more sprints · 3 more tasks/);
  assert.match(collapsedHtml, /aria-expanded="false"/);
  assert.equal((collapsedHtml.match(/class="segment task-bar/g) ?? []).length, 3);
  const expandedHtml = renderSprintCalendarHtml(crowded, 'test-nonce', {
    ...septemberView, state: { ...septemberView.state, expandedWeeks: ['2026-09-21'], focusId: 'week-2026-09-21-toggle' },
  });
  assert.equal((expandedHtml.match(/class="segment task-bar/g) ?? []).length, 6);
  assert.match(expandedHtml, /aria-expanded="true"/);
  assert.match(expandedHtml, /Collapse week/);
  assert.match(expandedHtml, /data-focus="week-2026-09-21-toggle"/);
  assert.match(expandedHtml, /tabindex="0"[^>]+aria-label="SPD-0: Document Calendar; waiting; high; Sep 25, 2026 – Sep 25, 2026/s);

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
void runSprintCalendarCommandTests().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
