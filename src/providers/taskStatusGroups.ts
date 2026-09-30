import { Task, TaskStatus } from '../data/types';

export interface TaskStatusGroup {
  status: TaskStatus;
  label: string;
  defaultExpanded: boolean;
  tasks: Task[];
}

interface StatusDefinition {
  status: TaskStatus;
  label: string;
  defaultExpanded: boolean;
}

const STATUS_DEFINITIONS: readonly StatusDefinition[] = [
  { status: 'in-progress', label: 'In Progress', defaultExpanded: true },
  { status: 'under-review', label: 'Under Review', defaultExpanded: true },
  { status: 'needs-modification', label: 'Needs Modification', defaultExpanded: true },
  { status: 'blocked', label: 'Blocked', defaultExpanded: true },
  { status: 'waiting', label: 'Waiting', defaultExpanded: false },
  { status: 'done', label: 'Done', defaultExpanded: false },
  { status: 'cancelled', label: 'Cancelled', defaultExpanded: false },
];

function compareTasks(left: Task, right: Task): number {
  return left.number - right.number || left.title.localeCompare(right.title);
}

export function groupTasksByStatus(tasks: readonly Task[]): TaskStatusGroup[] {
  return STATUS_DEFINITIONS.map(definition => ({
    ...definition,
    tasks: tasks
      .filter(task => task.status === definition.status)
      .sort(compareTasks),
  })).filter(group => group.tasks.length > 0);
}
