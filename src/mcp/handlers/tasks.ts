import * as taskService from '../../services/taskService';
import * as workforceService from '../../services/workforce/workforceService';
import { getStores } from '../../data/stores';
import { HumanVerification, ReviewResult, Task, TaskReview } from '../../data/types';
import { DataService } from '../../data/DataService';
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

  const updates: Partial<Task> = {};
  let humanVerification: HumanVerification | undefined;
  if (args.title) updates.title = args.title;
  if (args.status) {
    if (args.status === 'done') {
      humanVerification = getHumanVerification(args);
      if (!humanVerification) {
        return res(
          'Cannot set task status to done without human verification. Provide humanVerification.reviewerId for a registered human reviewer.',
          true,
        );
      }
      updates.humanVerification = humanVerification;
      updates.workStatus = 'done';
    }
    if (args.status === 'under-review') {
      const review = buildReviewHandoff(task, ds);
      updates.review = review;
    }
    updates.status = args.status;
  }
  if (args.priority) updates.priority = args.priority;
  if (args.type) updates.type = args.type;
  if (args.review !== undefined) {
    if (args.status) {
      return res('Review results cannot change the task status', true);
    }
    if (task.status !== 'under-review') {
      return res('Only under-review tasks accept review results', true);
    }
    const review = recordTaskReview(task, args.review);
    if (typeof review === 'string') {
      return res(review, true);
    }
    updates.review = review;
  }

  if (Object.keys(updates).length === 0) {
    return res('No updates provided', true);
  }

  ds.updateTask(task.id, updates);
  const updatedTask = ds.getTask(task.id);
  if (updatedTask) ds.saveTaskMd(updatedTask);
  if (humanVerification) {
    recordAudit({
      actor: humanVerification.reviewerId,
      action: 'approve',
      targetType: 'task',
      targetId: task.id,
      details: { taskCode: task.code, notes: humanVerification.notes },
    });
  }

  return res(JSON.stringify(updatedTask, null, 2));
}

function buildReviewHandoff(task: Task, ds: DataService): TaskReview {
  if (task.review?.criteria.length) {
    return task.review;
  }
  return {
    summary: 'pending',
    criteria: ds.getTaskAcceptanceCriteria(task).map(criterion => ({ criterion })),
  };
}

function recordTaskReview(task: Task, input: any): TaskReview | string {
  const reviewer = workforceService.findHumanReviewer(input?.reviewerId);
  if (!reviewer) {
    return 'Review requires a registered human reviewer';
  }
  const expected = task.review?.criteria;
  if (!expected?.length || !Array.isArray(input.criteria) || input.criteria.length !== expected.length) {
    return 'Review must provide a result for every acceptance criterion';
  }
  for (let index = 0; index < expected.length; index += 1) {
    const entry = input.criteria[index];
    if (!entry || entry.criterion !== expected[index].criterion
      || (entry.result !== 'met' && entry.result !== 'needs work')) {
      return 'Review must provide each acceptance criterion in order with result met or needs work';
    }
  }
  const reviewedAt = new Date().toISOString();
  return {
    summary: input.criteria.every((entry: { result: ReviewResult }) => entry.result === 'met')
      ? 'accepted' : 'further work required',
    reviewerId: reviewer.id,
    reviewedAt,
    criteria: expected.map((entry, index) => ({
      criterion: entry.criterion,
      result: input.criteria[index].result,
      reviewerId: reviewer.id,
      verifiedAt: reviewedAt,
    })),
  };
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

  ds.updateTask(task.id, {
    status: 'under-review',
    workStatus: 'review',
    review: buildReviewHandoff(task, ds),
  });

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

function getHumanVerification(args: any): HumanVerification | undefined {
  const reviewer = workforceService.findHumanReviewer(args.humanVerification?.reviewerId);
  if (!reviewer) {
    return undefined;
  }

  return {
    reviewerId: reviewer.id,
    reviewerName: reviewer.displayName,
    approvedAt: new Date().toISOString(),
    ...(args.humanVerification.notes ? { notes: args.humanVerification.notes } : {}),
  };
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