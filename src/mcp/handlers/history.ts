import * as historyService from '../../services/history/historyService';
import { Handler, HandlerResult, res, getWs } from './helpers';

async function handle_sprintdesk_getHistory(args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);

  const itemId = args.itemId;
  const itemType = args.itemType;
  const limit = args.limit || 50;

  if (itemId && itemType) {
    const history = historyService.getHistoryForItem(itemId, itemType, limit);
    return res(JSON.stringify(history, null, 2));
  }

  const allHistory = historyService.getAllHistory(limit);
  return res(JSON.stringify(allHistory, null, 2));
}

async function handle_sprintdesk_trackChange(args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);

  try {
    const entry = historyService.trackChange(
      args.itemId,
      args.itemType,
      args.action,
      args.field,
      args.oldValue,
      args.newValue
    );
    return res(JSON.stringify(entry, null, 2));
  } catch (e: any) {
    return res(`Error: ${e.message}`, true);
  }
}

export const HISTORY_HANDLERS: Record<string, Handler> = {
  sprintdesk_getHistory: handle_sprintdesk_getHistory,
  sprintdesk_trackChange: handle_sprintdesk_trackChange,
};