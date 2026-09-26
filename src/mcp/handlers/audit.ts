import { getStores } from '../../data/stores';
import { Handler, HandlerResult, res } from './helpers';

async function handle_sprintdesk_auditList(args: any): Promise<HandlerResult> {
  let entries = getStores().audit.loadAll();

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