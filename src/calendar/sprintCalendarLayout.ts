import { CalendarSprint, ScheduledTask, SprintCalendar } from './sprintCalendar';

export const SPRINT_LANES = 2;
export const TASK_LANES = 3;

export interface CalendarDay {
  date: string;
  inMonth: boolean;
  isToday: boolean;
}

export interface CalendarSegment<T> {
  item: T;
  column: number;
  span: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface CalendarWeek {
  id: string;
  days: CalendarDay[];
  sprints: CalendarSegment<CalendarSprint>[];
  tasks: CalendarSegment<ScheduledTask>[];
  hiddenSprints: number;
  hiddenTasks: number;
}

export interface MonthLayout {
  month: string;
  weeks: CalendarWeek[];
}

export function monthDays(month: string): string[] {
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new RangeError('Expected a calendar month in YYYY-MM format.');
  }
  const cursor = new Date(`${month}-01T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - (cursor.getUTCDay() + 6) % 7);
  return Array.from({ length: 42 }, () => {
    const day = cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    return day;
  });
}

function packSegments<T extends { id: string; startDate: string; endDate: string }>(
  items: T[], days: string[], previous: Map<string, number>,
): CalendarSegment<T>[] {
  const start = days[0];
  const end = days[6];
  const segments = items.filter(item => item.startDate <= end && item.endDate >= start)
    .sort((left, right) => left.startDate.localeCompare(right.startDate)
      || right.endDate.localeCompare(left.endDate) || left.id.localeCompare(right.id))
    .map(item => {
      const first = item.startDate < start ? 0 : days.indexOf(item.startDate);
      const last = item.endDate > end ? 6 : days.indexOf(item.endDate);
      return { item, column: first + 1, span: last - first + 1, lane: -1,
        continuesBefore: item.startDate < start, continuesAfter: item.endDate > end };
    });
  const lanes: CalendarSegment<T>[][] = [];
  // Reserve continuing lanes before newcomers can occupy them.
  const allocation = [...segments].sort((left, right) => (
    Number(right.continuesBefore && previous.has(right.item.id))
    - Number(left.continuesBefore && previous.has(left.item.id))
  ));
  for (const segment of allocation) {
    const available = (lane: number): boolean => !lanes[lane]?.some(other => (
      segment.column < other.column + other.span && other.column < segment.column + segment.span
    ));
    const preferred = segment.continuesBefore ? previous.get(segment.item.id) : undefined;
    let lane = preferred !== undefined && available(preferred) ? preferred : 0;
    while (!available(lane)) {
      lane++;
    }
    segment.lane = lane;
    (lanes[lane] ??= []).push(segment);
  }
  previous.clear();
  for (const segment of segments) {
    if (segment.continuesAfter) {
      previous.set(segment.item.id, segment.lane);
    }
  }
  return segments;
}

export function buildMonthLayout(calendar: SprintCalendar, month: string, today: string): MonthLayout {
  const days = monthDays(month);
  const sprintLanes = new Map<string, number>();
  const taskLanes = new Map<string, number>();
  const weeks: CalendarWeek[] = [];
  for (let offset = 0; offset < days.length; offset += 7) {
    const dates = days.slice(offset, offset + 7);
    const sprints = packSegments(calendar.sprints, dates, sprintLanes);
    const tasks = packSegments(calendar.tasks, dates, taskLanes);
    weeks.push({
      id: dates[0],
      days: dates.map(date => ({ date, inMonth: date.startsWith(month), isToday: date === today })),
      sprints, tasks,
      hiddenSprints: sprints.filter(segment => segment.lane >= SPRINT_LANES).length,
      hiddenTasks: tasks.filter(segment => segment.lane >= TASK_LANES).length,
    });
  }
  return { month, weeks };
}
