import { getStores } from '../../data/stores';
import { Run } from '../../data/types';
import { Handler, HandlerResult, res, getDs, findTask, resolveAgent, recordAudit } from './helpers';

async function handle_sprintdesk_runsCreate(args: any): Promise<HandlerResult> {
  const ds = getDs();
  if (!ds) return res('No workspace found', true);

  const task = findTask(ds, args.taskId);
  if (!task) return res(`Task not found: ${args.taskId}`, true);

  const agent = resolveAgent(args.agentId) || (task.agent ? resolveAgent(task.agent) : undefined);
  if (!agent) {
    return res(
      `No agent assigned to task ${task.code}. Assign an agent first via sprintdesk_tasksAssign.`,
      true
    );
  }

  if (agent.status === 'offline') {
    return res(`Agent ${agent.name} is offline and cannot take work`, true);
  }

  const now = new Date().toISOString();
  const run: Run = {
    id: `run_${Date.now()}`,
    taskId: task.id,
    agentId: agent.id,
    status: 'queued',
    attempts: (task.attempts || 0) + 1,
    createdAt: now,
    updatedAt: now
  };

  getStores().runs.add(run);

  const updates: any = { runId: run.id, attempts: run.attempts, agent: agent.id };
  ds.updateTask(task.id, updates);

  recordAudit({
    actor: 'mcp',
    action: 'run.create',
    targetType: 'task',
    targetId: task.id,
    details: { runId: run.id, agentId: agent.id, agentName: agent.name, taskCode: task.code }
  });

  return res(JSON.stringify(run, null, 2));
}

async function handle_sprintdesk_runsList(args: any): Promise<HandlerResult> {
  const runs = getStores().runs.loadAll();

  if (args.taskId) {
    return res(JSON.stringify(runs.filter(r => r.taskId === args.taskId).slice(0, args.limit), null, 2));
  }

  if (args.status) {
    return res(JSON.stringify(runs.filter(r => r.status === args.status).slice(0, args.limit), null, 2));
  }

  return res(JSON.stringify(runs.slice(0, args.limit), null, 2));
}

async function handle_sprintdesk_runsGet(args: any): Promise<HandlerResult> {
  const run = getStores().runs.getById(args.runId);
  if (!run) return res(`Run not found: ${args.runId}`, true);
  return res(JSON.stringify(run, null, 2));
}

export const RUN_HANDLERS: Record<string, Handler> = {
  sprintdesk_runsCreate: handle_sprintdesk_runsCreate,
  sprintdesk_runsList: handle_sprintdesk_runsList,
  sprintdesk_runsGet: handle_sprintdesk_runsGet,
};