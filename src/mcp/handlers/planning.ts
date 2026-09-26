import * as epicService from '../../services/epicService';
import * as sprintService from '../../services/sprintService';
import * as backlogService from '../../services/backlogService';
import { getStores } from '../../data/stores';
import {
  Handler,
  HandlerResult,
  res,
  getWs,
  getDs,
  findTask,
  findEpic,
  findSprint,
  findBacklog
} from './helpers';

async function handle_sprintdesk_createEpic(args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);

  try {
    const result = await epicService.createNewEpic({
      title: args.title,
      category: args.category || 'MISC',
      priority: args.priority || 'medium'
    });

    return res(JSON.stringify(result, null, 2));
  } catch (e: any) {
    return res(`Error: ${e.message}`, true);
  }
}

async function handle_sprintdesk_getEpic(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const epic = findEpic(ds, args.epicId);

  if (!epic) return res(`Epic not found: ${args.epicId}`, true);
  return res(JSON.stringify(epic, null, 2));
}

async function handle_sprintdesk_updateEpic(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const epic = findEpic(ds, args.epicId);
  if (!epic) return res(`Epic not found: ${args.epicId}`, true);

  const updates: any = {};
  if (args.title) updates.title = args.title;
  if (args.status) updates.status = args.status;
  if (args.priority) updates.priority = args.priority;
  if (args.category) updates.category = args.category;

  if (Object.keys(updates).length === 0) {
    return res('No updates provided', true);
  }

  ds.updateEpic(epic.id, updates);
  const updatedEpic = ds.getEpic(epic.id);
  if (updatedEpic) ds.saveEpicMd(updatedEpic);

  return res(JSON.stringify(updatedEpic, null, 2));
}

async function handle_sprintdesk_deleteEpic(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const epic = findEpic(ds, args.epicId);
  if (!epic) return res(`Epic not found: ${args.epicId}`, true);

  ds.deleteEpic(epic.id);

  return res(`Epic deleted: ${epic.code}`);
}

async function handle_sprintdesk_listEpics(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  let epics = ds.loadEpics();

  if (args.status) {
    epics = epics.filter(e => e.status === args.status);
  }

  return res(JSON.stringify(epics, null, 2));
}

async function handle_sprintdesk_getTasksByEpic(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const epic = findEpic(ds, args.epicId);
  if (!epic) return res(`Epic not found: ${args.epicId}`, true);

  const tasks = ds.loadTasks().filter(t => epic.tasks.includes(t.id));

  return res(JSON.stringify(tasks, null, 2));
}

async function handle_sprintdesk_addTaskToEpic(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const task = findTask(ds, args.taskId);
  if (!task) return res(`Task not found: ${args.taskId}`, true);

  const epic = findEpic(ds, args.epicId);
  if (!epic) return res(`Epic not found: ${args.epicId}`, true);

  epicService.addTaskToEpicById(epic.id, task.id);

  return res(`Task ${task.code} added to epic ${epic.code}`);
}

async function handle_sprintdesk_createSprint(args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);

  try {
    const dateParts = args.startDate.split('-');
    const d1 = dateParts[2];
    const mo1 = dateParts[1];
    const d2 = args.endDate.split('-')[2];
    const mo2 = args.endDate.split('-')[1];
    const yy = dateParts[0].slice(-2);
    const yyyy = dateParts[0];

    const name = `${args.name}_${mo1}-${d1}-${yyyy}_${mo2}-${d2}-${yy}`;
    const result = sprintService.createSprint({ d1, mo1, d2, mo2, yy, yyyy, title: args.name });

    return res(`Sprint created: ${result}`);
  } catch (e: any) {
    return res(`Error: ${e.message}`, true);
  }
}

async function handle_sprintdesk_getSprint(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const sprint = findSprint(ds, args.sprintId);

  if (!sprint) return res(`Sprint not found: ${args.sprintId}`, true);
  return res(JSON.stringify(sprint, null, 2));
}

async function handle_sprintdesk_updateSprint(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const sprint = findSprint(ds, args.sprintId);
  if (!sprint) return res(`Sprint not found: ${args.sprintId}`, true);

  const updates: any = {};
  if (args.name) updates.name = args.name;
  if (args.startDate) updates.startDate = args.startDate;
  if (args.endDate) updates.endDate = args.endDate;
  if (args.status) updates.status = args.status;

  if (Object.keys(updates).length === 0) {
    return res('No updates provided', true);
  }

  ds.updateSprint(sprint.id, updates);
  const updatedSprint = ds.getSprint(sprint.id);
  if (updatedSprint) ds.saveSprintMd(updatedSprint);

  return res(JSON.stringify(updatedSprint, null, 2));
}

async function handle_sprintdesk_deleteSprint(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const sprint = findSprint(ds, args.sprintId);
  if (!sprint) return res(`Sprint not found: ${args.sprintId}`, true);

  ds.deleteSprint(sprint.id);

  return res(`Sprint deleted: ${sprint.name}`);
}

async function handle_sprintdesk_listSprints(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  let sprints = ds.loadSprints();

  if (args.status) {
    sprints = sprints.filter(s => s.status === args.status);
  }

  return res(JSON.stringify(sprints, null, 2));
}

async function handle_sprintdesk_getTasksBySprint(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const sprint = findSprint(ds, args.sprintId);
  if (!sprint) return res(`Sprint not found: ${args.sprintId}`, true);

  const tasks = ds.loadTasks().filter(t => sprint.tasks.includes(t.id));

  return res(JSON.stringify(tasks, null, 2));
}

async function handle_sprintdesk_addTaskToSprint(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const task = findTask(ds, args.taskId);
  if (!task) return res(`Task not found: ${args.taskId}`, true);

  const sprint = findSprint(ds, args.sprintId);
  if (!sprint) return res(`Sprint not found: ${args.sprintId}`, true);

  sprintService.addTaskToSprintById(sprint.id, task.id);

  return res(`Task ${task.code} added to sprint ${sprint.name}`);
}

async function handle_sprintdesk_createBacklog(args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);

  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const backlog = {
    id: `backlog_${Date.now()}`,
    title: args.name,
    name: args.name,
    description: args.description || '',
    tasks: [] as string[],
    color: '#3b82f6'
  };

  ds.saveBacklogMd(backlog);

  return res(`Backlog created: ${backlog.name}`);
}

async function handle_sprintdesk_getBacklog(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const backlog = findBacklog(ds, args.backlogId);

  if (!backlog) return res(`Backlog not found: ${args.backlogId}`, true);
  return res(JSON.stringify(backlog, null, 2));
}

async function handle_sprintdesk_listBacklogs(_args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const backlogs = ds.loadBacklogs();

  return res(JSON.stringify(backlogs, null, 2));
}

async function handle_sprintdesk_addTaskToBacklog(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const task = findTask(ds, args.taskId);
  if (!task) return res(`Task not found: ${args.taskId}`, true);

  const backlog = findBacklog(ds, args.backlogId);
  if (!backlog) return res(`Backlog not found: ${args.backlogId}`, true);

  backlogService.addTaskToBacklogById(backlog.id, task.id);

  return res(`Task ${task.code} added to backlog ${backlog.name}`);
}

async function handle_sprintdesk_moveTaskToEpic(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const task = findTask(ds, args.taskId);
  if (!task) return res(`Task not found: ${args.taskId}`, true);

  const epic = findEpic(ds, args.epicId);
  if (!epic) return res(`Epic not found: ${args.epicId}`, true);

  const oldEpicId = task.epic;
  if (oldEpicId) {
    const oldEpic = ds.loadEpics().find(e => e.name === oldEpicId || e.id === oldEpicId);
    if (oldEpic) epicService.removeTaskFromEpicById(oldEpic.id, task.id);
  }

  epicService.addTaskToEpicById(epic.id, task.id);

  const updatedTask = ds.getTask(task.id);

  return res(`Task ${updatedTask?.code} moved to epic ${epic.code}`);
}

async function handle_sprintdesk_moveTaskToSprint(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const task = findTask(ds, args.taskId);
  if (!task) return res(`Task not found: ${args.taskId}`, true);

  const sprint = findSprint(ds, args.sprintId);
  if (!sprint) return res(`Sprint not found: ${args.sprintId}`, true);

  const oldSprintId = task.sprint;
  if (oldSprintId) {
    sprintService.removeTaskFromSprintById(oldSprintId, task.id);
  }

  sprintService.addTaskToSprintById(sprint.id, task.id);

  return res(`Task ${task.code} moved to sprint ${sprint.name}`);
}

async function handle_sprintdesk_moveTaskToBacklog(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const task = findTask(ds, args.taskId);
  if (!task) return res(`Task not found: ${args.taskId}`, true);

  const backlog = findBacklog(ds, args.backlogId);
  if (!backlog) return res(`Backlog not found: ${args.backlogId}`, true);

  const oldBacklogId = task.backlog;
  if (oldBacklogId) {
    backlogService.removeTaskFromBacklogById(oldBacklogId, task.id);
  }

  backlogService.addTaskToBacklogById(backlog.id, task.id);

  return res(`Task ${task.code} moved to backlog ${backlog.name}`);
}

async function handle_sprintdesk_projectContext(_args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const tasks = ds.loadTasks();
  const taskStatusCounts: Record<string, number> = {};
  tasks.forEach(t => {
    taskStatusCounts[t.status] = (taskStatusCounts[t.status] || 0) + 1;
  });

  const stores = getStores();
  const config = ds.loadConfig();

  const context = {
    workspace: getWs(),
    projectPrefix: config.projectPrefix,
    counts: {
      tasks: tasks.length,
      epics: ds.loadEpics().length,
      sprints: ds.loadSprints().length,
      backlogs: ds.loadBacklogs().length,
      runs: stores.runs.count(),
      events: stores.events.count(),
      employees: stores.employees.count()
    },
    tasksByStatus: taskStatusCounts,
    activeRuns: stores.runs.findByStatus('running').length,
    latestEvents: stores.events.latest(10).map(e => ({ id: e.id, type: e.type, source: e.source, timestamp: e.timestamp })),
    hasOpenTasks: tasks.some(t => t.status === 'in-progress')
  };

  return res(JSON.stringify(context, null, 2));
}

export const PLANNING_HANDLERS: Record<string, Handler> = {
  sprintdesk_createEpic: handle_sprintdesk_createEpic,
  sprintdesk_getEpic: handle_sprintdesk_getEpic,
  sprintdesk_updateEpic: handle_sprintdesk_updateEpic,
  sprintdesk_deleteEpic: handle_sprintdesk_deleteEpic,
  sprintdesk_listEpics: handle_sprintdesk_listEpics,
  sprintdesk_getTasksByEpic: handle_sprintdesk_getTasksByEpic,
  sprintdesk_addTaskToEpic: handle_sprintdesk_addTaskToEpic,
  sprintdesk_createSprint: handle_sprintdesk_createSprint,
  sprintdesk_getSprint: handle_sprintdesk_getSprint,
  sprintdesk_updateSprint: handle_sprintdesk_updateSprint,
  sprintdesk_deleteSprint: handle_sprintdesk_deleteSprint,
  sprintdesk_listSprints: handle_sprintdesk_listSprints,
  sprintdesk_getTasksBySprint: handle_sprintdesk_getTasksBySprint,
  sprintdesk_addTaskToSprint: handle_sprintdesk_addTaskToSprint,
  sprintdesk_createBacklog: handle_sprintdesk_createBacklog,
  sprintdesk_getBacklog: handle_sprintdesk_getBacklog,
  sprintdesk_listBacklogs: handle_sprintdesk_listBacklogs,
  sprintdesk_addTaskToBacklog: handle_sprintdesk_addTaskToBacklog,
  sprintdesk_moveTaskToEpic: handle_sprintdesk_moveTaskToEpic,
  sprintdesk_moveTaskToSprint: handle_sprintdesk_moveTaskToSprint,
  sprintdesk_moveTaskToBacklog: handle_sprintdesk_moveTaskToBacklog,
  sprintdesk_projectContext: handle_sprintdesk_projectContext,
};