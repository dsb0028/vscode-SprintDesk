import { monthDays } from './sprintCalendarLayout';

export interface CalendarViewState {
  month: string;
  expandedWeeks: string[];
  focusId: string | null;
  selectedSprintId?: string | null;
  selectedTaskId?: string | null;
}

export function localCalendarDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function initialCalendarState(today: string): CalendarViewState {
  return { month: today.slice(0, 7), expandedWeeks: [], focusId: null, selectedSprintId: null };
}

/** Reject unknown fields as well as unknown actions: the webview has no write protocol. */
export function updateCalendarState(
  state: CalendarViewState, message: unknown, today: string,
): CalendarViewState | null {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return null;
  }
  const data = message as Record<string, unknown>;
  const keys = Object.keys(data);
  if (!keys.includes('action') || typeof data.action !== 'string') {
    return null;
  }
  if (data.action === 'toggle') {
    if (keys.length !== 2 || !keys.includes('week') || typeof data.week !== 'string'
      || !monthDays(state.month).filter((_, index) => index % 7 === 0).includes(data.week)) {
      return null;
    }
    const week = data.week;
    return { ...state, focusId: `week-${week}-toggle`,
      expandedWeeks: state.expandedWeeks.includes(week)
        ? state.expandedWeeks.filter(id => id !== week) : [...state.expandedWeeks, week] };
  }
  if (keys.length !== 1 || !['previous', 'next', 'today'].includes(data.action)) {
    return null;
  }
  let month = today.slice(0, 7);
  if (data.action !== 'today') {
    const date = new Date(`${state.month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + (data.action === 'next' ? 1 : -1));
    if (date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) {
      return null;
    }
    month = date.toISOString().slice(0, 7);
  }
  return { month, expandedWeeks: [], focusId: `nav-${data.action}`,
    selectedSprintId: state.selectedSprintId, selectedTaskId: null };
}
