import assert from 'node:assert/strict';
import { SprintCalendar } from './sprintCalendar';
import { buildMonthLayout } from './sprintCalendarLayout';
import { initialCalendarState, localCalendarDate, updateCalendarState } from './sprintCalendarState';

const empty: SprintCalendar = { startDate: null, endDate: null, sprints: [], tasks: [], warnings: [], backlogTasks: [] };
const september = buildMonthLayout(empty, '2026-09', '2026-09-25');
assert.equal(september.weeks.length, 6);
assert.equal(september.weeks[0].days[0].date, '2026-08-31');
assert.equal(september.weeks[5].days[6].date, '2026-10-11');
assert.equal(september.weeks.flatMap(week => week.days).filter(day => day.isToday).length, 1);
assert.equal(september.weeks.flatMap(week => week.days).filter(day => day.inMonth).length, 30);
assert.equal(buildMonthLayout(empty, '2028-02', '2028-02-29').weeks.flatMap(week => week.days)
  .filter(day => day.inMonth).length, 29);
assert.equal(buildMonthLayout(empty, '2027-01', '2027-01-01').weeks[0].id, '2026-12-28');
assert.equal(buildMonthLayout(empty, '2026-02', '2026-02-01').weeks[0].id, '2026-01-26');
assert.equal(buildMonthLayout(empty, '2026-06', '2026-06-01').weeks[0].id, '2026-06-01');
assert.throws(() => buildMonthLayout(empty, '2026-13', '2026-09-25'), RangeError);
assert.equal(localCalendarDate(new Date(2026, 8, 25, 23, 59)), '2026-09-25');

const tasks = Array.from({ length: 5 }, (_, index) => ({
  id: `task-${index}`, code: `SPD-${index}`, title: `Task ${index}`, status: 'waiting' as const,
  priority: 'medium' as const, sprintId: null, startDate: '2026-09-25', endDate: '2026-10-06',
}));
const crowded = { ...empty, tasks, sprints: tasks.slice(0, 4).map((item, index) => ({ ...item, tasks: [], color: `#00000${index}` })) };
const layout = buildMonthLayout(crowded, '2026-09', '2026-09-25');
const week = layout.weeks[3];
assert.deepEqual(week.tasks.map(segment => [segment.column, segment.span, segment.lane]), [
  [5, 3, 0], [5, 3, 1], [5, 3, 2], [5, 3, 3], [5, 3, 4],
]);
assert.equal(week.hiddenTasks, 2);
assert.equal(week.hiddenSprints, 2);
assert.ok(week.tasks.every(segment => !segment.continuesBefore && segment.continuesAfter));
assert.deepEqual(layout.weeks[4].tasks.map(segment => segment.lane), [0, 1, 2, 3, 4]);
assert.ok(layout.weeks[4].tasks.every(segment => segment.column === 1 && segment.span === 7));
assert.ok(layout.weeks[5].tasks.every(segment => segment.span === 2 && !segment.continuesAfter));
assert.deepEqual(buildMonthLayout({ ...crowded, tasks: [...tasks].reverse(),
  sprints: [...crowded.sprints].reverse() }, '2026-09', '2026-09-25'), layout);

const adjacent = buildMonthLayout({ ...empty, tasks: [
  { ...tasks[0], startDate: '2026-09-21', endDate: '2026-09-22' },
  { ...tasks[1], startDate: '2026-09-23', endDate: '2026-09-23' },
  { ...tasks[2], startDate: '2026-09-22', endDate: '2026-09-23' },
] }, '2026-09', '2026-09-25').weeks[3].tasks;
assert.deepEqual(adjacent.map(segment => segment.lane), [0, 1, 0]);
const continuing = buildMonthLayout({ ...empty, tasks: [
  { ...tasks[0], startDate: '2026-09-21', endDate: '2026-09-25' },
  { ...tasks[1], startDate: '2026-09-22', endDate: '2026-10-04' },
  { ...tasks[2], startDate: '2026-09-28', endDate: '2026-09-29' },
] }, '2026-09', '2026-09-25');
assert.deepEqual(continuing.weeks[3].tasks.map(segment => segment.lane), [0, 1]);
assert.deepEqual(continuing.weeks[4].tasks.map(segment => segment.lane), [1, 0]);
const snapshot = JSON.stringify(crowded);
buildMonthLayout(crowded, '2026-10', '2026-10-01');
assert.equal(JSON.stringify(crowded), snapshot);
for (const current of layout.weeks) {
  for (const left of current.tasks) {
    for (const right of current.tasks) {
      if (left !== right && left.lane === right.lane) {
        assert.ok(left.column + left.span <= right.column || right.column + right.span <= left.column);
      }
    }
  }
}

const initial = initialCalendarState('2026-09-25');
assert.deepEqual(initial, { month: '2026-09', expandedWeeks: [], focusId: null, selectedSprintId: null });
const expanded = updateCalendarState(initial, { action: 'toggle', week: '2026-09-21' }, '2026-09-25');
assert.deepEqual(expanded?.expandedWeeks, ['2026-09-21']);
assert.equal(expanded?.focusId, 'week-2026-09-21-toggle');
assert.deepEqual(updateCalendarState(expanded!, { action: 'toggle', week: '2026-09-21' }, '2026-09-25')
  ?.expandedWeeks, []);
assert.equal(updateCalendarState(initialCalendarState('2026-12-31'), { action: 'next' }, '2026-12-31')
  ?.month, '2027-01');
assert.equal(updateCalendarState(initialCalendarState('2027-01-01'), { action: 'previous' }, '2027-01-01')
  ?.month, '2026-12');
assert.deepEqual(updateCalendarState(expanded!, { action: 'next' }, '2026-09-25')
  ?.expandedWeeks, []);
assert.equal(updateCalendarState(expanded!, { action: 'today' }, '2027-02-01')?.month, '2027-02');
for (const invalid of [null, [], 'next', {}, { action: 'delete' }, { action: 'next', path: '/x' },
  { action: 'toggle', week: '2026-09-22' }, { action: 'toggle', week: '2027-01-04' },
  { action: 'toggle', week: 1 }, { action: 'next', week: '2026-09-21' },
  { action: { toString: () => 'next' } }, { action: 'toggle', week: '2026-09-21', path: '/x' },
  Object.assign(Object.create({ action: 'next' }), { path: '/x' })]) {
  assert.equal(updateCalendarState(initial, invalid, '2026-09-25'), null);
}
assert.equal(updateCalendarState(initialCalendarState('1000-01-01'), { action: 'previous' }, '1000-01-01'), null);
assert.equal(updateCalendarState(initialCalendarState('9999-12-01'), { action: 'next' }, '9999-12-01'), null);
