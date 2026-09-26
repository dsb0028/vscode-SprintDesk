import { Sprint, Task } from '../data/types';

export interface CalendarTask {
  id: string;
  code: string;
  title: string;
  status: Task['status'];
  priority: Task['priority'];
  path?: string;
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
}

export interface SprintCalendar {
  startDate: string | null;
  endDate: string | null;
  sprints: CalendarSprint[];
  tasks: ScheduledTask[];
  warnings: string[];
}

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

  for (const sprint of sprints) {
    const parsedStartDate = toIsoDate(sprint.startDate);
    const parsedEndDate = toIsoDate(sprint.endDate);
    if (!parsedStartDate || !parsedEndDate) {
      continue;
    }

    const [startDate, endDate] = parsedStartDate <= parsedEndDate
      ? [parsedStartDate, parsedEndDate]
      : [parsedEndDate, parsedStartDate];
    const sprintTasks = sprint.tasks
      .map((taskId) => tasksById.get(taskId))
      .filter((task): task is Task => task !== undefined)
      .map(toCalendarTask);

    calendarSprints.push({
      id: sprint.id,
      title: sprint.title,
      startDate,
      endDate,
      tasks: sprintTasks,
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
  };
}
