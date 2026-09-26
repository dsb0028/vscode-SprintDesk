import { TASK_HANDLERS } from './tasks';
import { AGENT_HANDLERS } from './agents';
import { RUN_HANDLERS } from './runs';
import { EVENT_HANDLERS } from './events';
import { HISTORY_HANDLERS } from './history';
import { AUDIT_HANDLERS } from './audit';
import { PLANNING_HANDLERS } from './planning';
import { Handler, HandlerResult, res } from './helpers';

export const HANDLERS: Record<string, Handler> = {
  ...TASK_HANDLERS,
  ...AGENT_HANDLERS,
  ...RUN_HANDLERS,
  ...EVENT_HANDLERS,
  ...HISTORY_HANDLERS,
  ...AUDIT_HANDLERS,
  ...PLANNING_HANDLERS
};

export async function handleToolCall(toolName: string, args: any): Promise<HandlerResult> {
  const handler = HANDLERS[toolName];
  if (!handler) {
    return res(`Unknown tool: ${toolName}`, true);
  }
  return handler(args);
}