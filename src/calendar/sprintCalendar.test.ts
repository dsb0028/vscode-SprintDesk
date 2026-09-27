import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { DataService } from '../data/DataService';
import { Sprint, Task } from '../data/types';
import { buildSprintCalendar } from './sprintCalendar';
import { renderSprintCalendarHtml } from './sprintCalendarHtml';
import { calendarDescription, calendarTaskPath } from './sprintCalendarDetails';
import './sprintCalendarLayout.test';
import './sprintCalendarPrototype.test';
import { runSprintCalendarCommandTests } from './sprintCalendarCommand.test';

const view = { today: '2026-09-25', state: { month: '2026-09', expandedWeeks: [], focusId: null } };
const task: Task = {
  id: 'task-1', number: 1, code: 'SPD-1', name: 'document-calendar', title: 'Document Calendar',
  type: 'doc', status: 'waiting', priority: 'high', epic: null, backlog: 'TECHNICAL',
  sprint: 'sprint-1', createdAt: '', updatedAt: '',
};
const sprint: Sprint = {
  id: 'sprint-1', number: 1, title: 'Calendar Sprint', name: 'calendar-sprint',
  startDate: '25-09-2026', endDate: '09-10-2026', status: 'planned',
  tasks: ['task-1', 'missing-task'], createdAt: '', updatedAt: '',
};
const single = { ...task, startDate: '2026-09-25', endDate: '2026-09-25' };
const calendar = buildSprintCalendar([sprint], [task]);
assert.equal(calendar.startDate, '2026-09-25');
assert.equal(calendar.endDate, '2026-10-09');
assert.deepEqual(calendar.sprints[0].tasks.map(item => item.id), ['task-1']);
assert.equal(calendar.tasks.length, 0);
assert.match(renderSprintCalendarHtml(calendar, 'test-nonce', view), /No sprint tasks in this range/);
const reversed = buildSprintCalendar([{ ...sprint, startDate: '2026-10-09', endDate: '2026-09-25' }], [task]);
assert.equal(reversed.sprints[0].startDate, '2026-09-25');
assert.equal(reversed.sprints[0].endDate, '2026-10-09');
assert.equal(buildSprintCalendar([{ ...sprint, startDate: 'invalid' }], [task]).sprints.length, 0);
const overlap = buildSprintCalendar([sprint, { ...sprint, id: 'long', endDate: '2026-11-01' }], [single]);
assert.equal(overlap.endDate, '2026-11-01');
const scheduled = buildSprintCalendar([sprint], [single]);
assert.equal(scheduled.tasks[0].startDate, '2026-09-25');
assert.equal(scheduled.tasks[0].sprintId, sprint.id);
assert.equal(scheduled.tasks[0].backlog, 'TECHNICAL');
const html = renderSprintCalendarHtml(scheduled, 'test-nonce', view);
assert.equal((html.match(/class="card /g) ?? []).length, 1);
assert.equal((html.match(/<time datetime=/g) ?? []).length, 35);
assert.match(html, /aria-current="date"/);
assert.match(html, /class="legend-item sprint-0"/);

const multi = { ...single, endDate: '2026-10-06' };
const multiHtml = renderSprintCalendarHtml(buildSprintCalendar([sprint], [multi]), 'test-nonce', view);
assert.equal((multiHtml.match(/class="card /g) ?? []).length, 10);
assert.match(multiHtml, /Sep 25, 2026 – Oct 6, 2026/);
assert.match(multiHtml, /data-date="2026-10-04"/);
assert.doesNotMatch(multiHtml, /style="/);
assert.match(multiHtml, /style-src 'nonce-test-nonce'/);
for (const dates of [
  { startDate: '2026-02-29', endDate: '2026-03-01' },
  { startDate: 'invalid', endDate: '2026-09-25' },
  { startDate: '2026-09-26', endDate: '2026-09-25' },
  { startDate: '2026-09-25' }, { endDate: '2026-09-25' },
]) {
  const invalid = buildSprintCalendar([], [{ ...task, ...dates }]);
  assert.equal(invalid.tasks.length, 0);
  assert.equal(invalid.startDate, null);
  assert.equal(invalid.warnings.length, 1);
  assert.match(renderSprintCalendarHtml(invalid, 'test-nonce'), /role="alert"/);
}
for (const dates of [
  { startDate: '28-02-2028', endDate: '01-03-2028', start: '2028-02-28', end: '2028-03-01' },
  { startDate: '2026-12-31', endDate: '2027-01-01', start: '2026-12-31', end: '2027-01-01' },
]) {
  const result = buildSprintCalendar([], [{ ...task, ...dates }]);
  assert.equal(result.tasks[0].startDate, dates.start);
  assert.equal(result.tasks[0].endDate, dates.end);
}
const malicious = '<script>alert("unsafe")</script>';
const escaped = renderSprintCalendarHtml(buildSprintCalendar([{ ...sprint, title: malicious }],
  [{ ...single, title: malicious, code: malicious }]), 'test-nonce', { ...view, description: malicious });
assert.doesNotMatch(escaped, /<script>/);
assert.match(escaped, /&lt;script&gt;alert\(&quot;unsafe&quot;\)&lt;\/script&gt;/);
assert.doesNotThrow(() => new Script(html.match(/<script nonce="test-nonce">([\s\S]+)<\/script>/)![1]));
assert.throws(() => renderSprintCalendarHtml(scheduled, 'bad"nonce'), /Invalid calendar nonce/);
assert.doesNotMatch(html, /onclick=|https?:\/\//);
const crowded = buildSprintCalendar([sprint], Array.from({ length: 6 }, (_, index) => ({ ...single, id: `task-${index}` })));
const collapsed = renderSprintCalendarHtml(crowded, 'test-nonce', view);
assert.match(collapsed, /3 more tasks/);
assert.equal((collapsed.match(/class="card /g) ?? []).length, 3);
const expanded = renderSprintCalendarHtml(crowded, 'test-nonce', {
  ...view, state: { ...view.state, expandedWeeks: ['2026-09-21'], focusId: 'week-2026-09-21-toggle' },
});
assert.equal((expanded.match(/class="card /g) ?? []).length, 6);
assert.match(expanded, /Collapse week/);
const colored = renderSprintCalendarHtml(buildSprintCalendar([{ ...sprint, color: '#ec4899' }], [single]), 'test-nonce', view);
assert.match(colored, /--sprint:#ec4899/);
assert.match(colored, /swatch-ec4899 selected/);
assert.match(colored, /data-action="deleteSprint"/);
assert.match(colored, /data-action="removeTask"/);
const legacy = buildSprintCalendar([sprint], [{ ...single, sprint: sprint.name }]);
assert.equal(legacy.tasks[0].sprintId, sprint.id);
assert.equal(legacy.sprints[0].tasks.length, 1);
assert.equal(buildSprintCalendar([sprint], [{ ...single, sprint: null }]).sprints[0].tasks.length, 0);

assert.equal(calendarDescription('---\ntitle: Test\n---\n# Test\n## 📋 Description\nFirst line.\nSecond line.\n\n## Notes\nNo.'), 'First line.\nSecond line.');
assert.equal(calendarDescription('## Description\r\nActual text\r\n## Notes\r\nNo'), 'Actual text');
assert.equal(calendarDescription('## Description\n\n## Notes\nNo'), '');
assert.equal(calendarTaskPath('/workspace/Tasks', '[ABC]_task.md'), '/workspace/Tasks/[ABC]_task.md');
assert.throws(() => calendarTaskPath('/workspace/Tasks', '../../outside.md'), /inside/);
assert.throws(() => calendarTaskPath('/workspace/Tasks', 'a.md', '/secrets.md'), /inside/);
assert.throws(() => calendarTaskPath('/workspace/Tasks', 'script.js'), /inside/);

const workspace = mkdtempSync(join(tmpdir(), 'sprintdesk-calendar-test-'));
try {
  const service = new DataService(workspace);
  service.saveTasks([single]);
  service.updateTask(single.id, { endDate: multi.endDate });
  const persisted = buildSprintCalendar([], new DataService(workspace).loadTasks());
  assert.equal(persisted.tasks[0].startDate, single.startDate);
  assert.equal(persisted.tasks[0].endDate, multi.endDate);
  service.saveSprints([sprint, {...sprint,id:'another-sprint',name:'another-sprint',color:'#6d9ff4'}]);
  service.updateSprint(sprint.id,{color:'#c598e9'});
  const storedSprints = new DataService(workspace).loadSprints();
  assert.equal(storedSprints.find(item => item.id === sprint.id)?.color,'#c598e9');
  assert.equal(storedSprints.find(item => item.id === 'another-sprint')?.color,'#6d9ff4');
} finally {
  rmSync(workspace, { recursive: true });
}
void runSprintCalendarCommandTests().catch(error => { console.error(error); process.exitCode = 1; });
