import { getStores } from '../../data/stores';
import { Handler, HandlerResult, res, getDs } from './helpers';

async function handle_sprintdesk_auditList(args: any): Promise<HandlerResult> {
  let entries = getStores().audit.loadAll();
  const approvals = getDs()?.getReviewAudit() ?? [];
  entries = entries.concat(approvals.map(receipt => ({
    id: receipt.payload.operationId,
    actor: receipt.payload.reviewerId,
    action: receipt.payload.intent === 'complete' ? 'approve' : 'review',
    targetType: 'task',
    targetId: receipt.payload.taskId,
    timestamp: receipt.payload.timestamp,
    details: { receipt, projection: 'Check against the independent local approval ledger' },
  })));

  if (args.actor) {
    entries = entries.filter(e => e.actor === args.actor);
  }
  if (args.targetType) {
    entries = entries.filter(e => e.targetType === args.targetType && (!args.targetId || e.targetId === args.targetId));
  }

  entries = entries
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    .slice(0, args.limit || 100);

  return res(JSON.stringify(entries, null, 2));
}

export const AUDIT_HANDLERS: Record<string, Handler> = {
  sprintdesk_auditList: handle_sprintdesk_auditList,
};