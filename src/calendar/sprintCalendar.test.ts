import assert from 'node:assert/strict';
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
  assert.match(html, /Tasks apply to the entire sprint/);
  assert.match(html, /Document Calendar/);
  assert.doesNotMatch(renderSprintCalendarHtml(
    buildSprintCalendar([{ ...sprint, title: '<script>' }], [task]),
    'test-nonce',
  ), /<script><\/script>/);
}

runSprintCalendarTests();
