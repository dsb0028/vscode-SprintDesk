import { Sprint, Task } from '../data/types';

export interface CalendarTask {
  id: string;
  code: string;
  title: string;
  status: Task['status'];
  priority: Task['priority'];
  path?: string;
  sprintId: string | null;
  backlog?: string;
  epic?: string | null;
  assignee?: string;
  startDate?: string;
  endDate?: string;
}

export interface ScheduledTask extends CalendarTask {
  startDate: string;
  endDate: string;
}

export interface CalendarSprint {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  tasks: CalendarTask[];
  color: string;
}

export interface SprintCalendar {
  startDate: string | null;
  endDate: string | null;
  sprints: CalendarSprint[];
  tasks: ScheduledTask[];
  warnings: string[];
  backlogTasks: CalendarTask[];
}

export const SPRINT_COLORS = ['#55c2ae', '#6d9ff4', '#c598e9', '#e7a35a'];

function toIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dmyMatch = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  const match = isoMatch ?? dmyMatch;
  if (!match) {
    return null;
  }

  const year = Number(isoMatch ? match[1] : match[3]);
  const month = Number(isoMatch ? match[2] : match[2]);
  const day = Number(isoMatch ? match[3] : match[1]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function toCalendarTask(task: Task): CalendarTask {
  return {
    id: task.id,
    code: task.code,
    title: task.title,
    status: task.status,
    priority: task.priority,
    path: task.path,
    sprintId: task.sprint,
    backlog: task.backlog,
    epic: task.epic,
    assignee: task.assignee,
    startDate: toIsoDate(task.startDate) ?? undefined,
    endDate: toIsoDate(task.endDate) ?? undefined,
  };
}

export function buildSprintCalendar(sprints: Sprint[], tasks: Task[]): SprintCalendar {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const calendarSprints: CalendarSprint[] = [];
  const scheduledTasks: ScheduledTask[] = [];
  const warnings: string[] = [];

  for (const task of tasksById.values()) {
    if (!task.startDate && !task.endDate) {
      continue;
    }
    const startDate = toIsoDate(task.startDate);
    const endDate = toIsoDate(task.endDate);
    if (!startDate || !endDate || startDate > endDate) {
      warnings.push(`${task.code}: provide valid startDate and endDate, with endDate on or after startDate.`);
      continue;
    }
    scheduledTasks.push({ ...toCalendarTask(task), startDate, endDate });
  }
  scheduledTasks.sort((left, right) => (
    left.startDate.localeCompare(right.startDate)
    || left.code.localeCompare(right.code)
  ));

  for (const [index, sprint] of sprints.entries()) {
    const parsedStartDate = toIsoDate(sprint.startDate);
    const parsedEndDate = toIsoDate(sprint.endDate);
    if (!parsedStartDate || !parsedEndDate) {
      continue;
    }

    const [startDate, endDate] = parsedStartDate <= parsedEndDate
      ? [parsedStartDate, parsedEndDate]
      : [parsedEndDate, parsedStartDate];
    const sprintTasks = [...tasksById.values()]
      .filter(task => task.sprint === sprint.id || task.sprint === sprint.name)
      .map(toCalendarTask);
    for (const member of sprintTasks) {
      member.sprintId = sprint.id;
      const scheduled = scheduledTasks.find(task => task.id === member.id);
      if (scheduled) { scheduled.sprintId = sprint.id; }
    }

    calendarSprints.push({
      id: sprint.id,
      title: sprint.title,
      startDate,
      endDate,
      tasks: sprintTasks,
      color: /^#[0-9a-fA-F]{6}$/.test(sprint.color ?? '') ? sprint.color! : SPRINT_COLORS[index % SPRINT_COLORS.length],
    });
  }

  calendarSprints.sort((left, right) => (
    left.startDate.localeCompare(right.startDate)
    || left.title.localeCompare(right.title)
  ));
  const ranges = [...calendarSprints, ...scheduledTasks];
  const startDate = ranges.reduce<string | null>(
    (earliest, range) => !earliest || range.startDate < earliest ? range.startDate : earliest,
    null,
  );
  const endDate = ranges.reduce<string | null>(
    (latestEndDate, sprint) => (
      !latestEndDate || sprint.endDate > latestEndDate
        ? sprint.endDate
        : latestEndDate
    ),
    null,
  );

  return {
    startDate,
    endDate,
    sprints: calendarSprints,
    tasks: scheduledTasks,
    warnings,
    backlogTasks: tasks.filter(task => task.sprint === null).map(toCalendarTask),
  };
}
