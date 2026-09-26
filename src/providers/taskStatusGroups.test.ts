import assert from 'node:assert/strict';
import { Task } from '../data/types';
import { groupTasksByStatus } from './taskStatusGroups';

function createTask(number: number, status: Task['status'], title = `Task ${number}`): Task {
  return {
    id: `task-${number}`,
    number,
    code: `SPD-${number}`,
    name: `SPD-${number}`,
    title,
    type: 'feature',
    status,
    priority: 'medium',
    epic: null,
    backlog: 'features',
    sprint: null,
    createdAt: '2026-09-26T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:00.000Z',
  };
}

const sourceTasks = [
  createTask(20, 'waiting'),
  createTask(10, 'in-progress'),
  createTask(30, 'blocked'),
  createTask(15, 'in-progress'),
  createTask(40, 'done'),
];
const groups = groupTasksByStatus(sourceTasks);

assert.deepEqual(groups.map(group => group.status), [
  'in-progress',
  'blocked',
  'waiting',
  'done',
]);
assert.deepEqual(groups.map(group => [group.label, group.defaultExpanded]), [
  ['In Progress', true],
  ['Blocked', true],
  ['Waiting', false],
  ['Done', false],
]);
assert.deepEqual(groups[0].tasks.map(task => task.number), [10, 15]);
assert.deepEqual(sourceTasks.map(task => task.number), [20, 10, 30, 15, 40]);
assert.deepEqual(groupTasksByStatus([]), []);
