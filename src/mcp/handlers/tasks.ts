import * as taskService from '../../services/taskService';
import { getStores } from '../../data/stores';
import { Handler, HandlerResult, res, getWs, getDs, findTask, resolveAgent, recordAudit } from './helpers';

async function handle_sprintdesk_tasksAssign(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const task = findTask(ds, args.taskId);
  if (!task) return res(`Task not found: ${args.taskId}`, true);

  const agent = resolveAgent(args.agentId);
  if (!agent) return res(`Agent not found: ${args.agentId}`, true);

  ds.updateTask(task.id, { agent: agent.id });
  const updatedTask = ds.getTask(task.id);
  if (updatedTask) ds.saveTaskMd(updatedTask);

  recordAudit({
    actor: 'mcp',
    action: 'assign',
    targetType: 'task',
    targetId: task.id,
    details: { agentId: agent.id, agentName: agent.name, source: agent.source, taskCode: task.code }
  });

  return res(JSON.stringify(updatedTask, null, 2));
}

async function handle_sprintdesk_tasksUnassign(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const task = findTask(ds, args.taskId);
  if (!task) return res(`Task not found: ${args.taskId}`, true);

  if (!task.agent) return res(`Task ${task.code} has no agent assigned`, true);

  const previousAgent = task.agent;
  ds.updateTask(task.id, { agent: undefined });
  const updatedTask = ds.getTask(task.id);
  if (updatedTask) ds.saveTaskMd(updatedTask);

  recordAudit({
    actor: 'mcp',
    action: 'unassign',
    targetType: 'task',
    targetId: task.id,
    details: { previousAgentId: previousAgent, taskCode: task.code }
  });

  return res(JSON.stringify(updatedTask, null, 2));
}

async function handle_sprintdesk_createTask(args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);

  try {
    const result = await taskService.createTask(ws, {
      title: args.title,
      type: args.type || 'feature',
      priority: args.priority || 'medium',
      epic: args.epicCode || null,
      backlog: args.backlogName
    });

    return res(JSON.stringify(result, null, 2));
  } catch (e: any) {
    return res(`Error: ${e.message}`, true);
  }
}

async function handle_sprintdesk_getTask(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const task = findTask(ds, args.taskId);

  if (!task) return res(`Task not found: ${args.taskId}`, true);
  return res(JSON.stringify(task, null, 2));
}

async function handle_sprintdesk_updateTask(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const task = findTask(ds, args.taskId);
  if (!task) return res(`Task not found: ${args.taskId}`, true);

  const updates: any = {};
  if (args.title) updates.title = args.title;
  if (args.status) updates.status = args.status;
  if (args.priority) updates.priority = args.priority;
  if (args.type) updates.type = args.type;

  if (Object.keys(updates).length === 0) {
    return res('No updates provided', true);
  }

  ds.updateTask(task.id, updates);
  const updatedTask = ds.getTask(task.id);
  if (updatedTask) ds.saveTaskMd(updatedTask);

  return res(JSON.stringify(updatedTask, null, 2));
}

async function handle_sprintdesk_deleteTask(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const task = findTask(ds, args.taskId);
  if (!task) return res(`Task not found: ${args.taskId}`, true);

  ds.deleteTask(task.id);

  return res(`Task deleted: ${task.code}`);
}

async function handle_sprintdesk_listTasks(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  let tasks = ds.loadTasks();

  if (args.status) {
    tasks = tasks.filter(t => t.status === args.status);
  }

  if (args.limit) {
    tasks = tasks.slice(0, args.limit);
  }

  return res(JSON.stringify(tasks, null, 2));
}

async function handle_sprintdesk_searchTasks(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const query = args.query.toLowerCase();
  const tasks = ds.loadTasks().filter(t =>
    t.title.toLowerCase().includes(query) ||
    t.code.toLowerCase().includes(query)
  );

  return res(JSON.stringify(tasks, null, 2));
}

async function handle_sprintdesk_tasksClaim(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const task = findTask(ds, args.taskId);
  if (!task) return res(`Task not found: ${args.taskId}`, true);

  const updates: any = { workStatus: 'claimed' };
  if (args.agentId) updates.agent = args.agentId;
  if (args.runId) updates.runId = args.runId;

  ds.updateTask(task.id, updates);

  if (args.runId) {
    const run = getStores().runs.getById(args.runId as string);
    if (run) {
      getStores().runs.update(run.id, { agentId: args.agentId || run.agentId });
    }
  }

  const updatedTask = ds.getTask(task.id);
  if (updatedTask) ds.saveTaskMd(updatedTask);

  return res(JSON.stringify(updatedTask, null, 2));
}

async function handle_sprintdesk_tasksComplete(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const task = findTask(ds, args.taskId);
  if (!task) return res(`Task not found: ${args.taskId}`, true);

  ds.updateTask(task.id, { workStatus: 'done' });

  if (args.runId) {
    getStores().runs.update(args.runId as string, {
      status: 'completed',
      result: args.result,
      finishedAt: new Date().toISOString()
    });
  }

  const updatedTask = ds.getTask(task.id);
  if (updatedTask) ds.saveTaskMd(updatedTask);

  return res(JSON.stringify(updatedTask, null, 2));
}

export const TASK_HANDLERS: Record<string, Handler> = {
  sprintdesk_createTask: handle_sprintdesk_createTask,
  sprintdesk_getTask: handle_sprintdesk_getTask,
  sprintdesk_updateTask: handle_sprintdesk_updateTask,
  sprintdesk_deleteTask: handle_sprintdesk_deleteTask,
  sprintdesk_listTasks: handle_sprintdesk_listTasks,
  sprintdesk_searchTasks: handle_sprintdesk_searchTasks,
  sprintdesk_tasksClaim: handle_sprintdesk_tasksClaim,
  sprintdesk_tasksComplete: handle_sprintdesk_tasksComplete,
  sprintdesk_tasksAssign: handle_sprintdesk_tasksAssign,
  sprintdesk_tasksUnassign: handle_sprintdesk_tasksUnassign,
};