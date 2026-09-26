import { getStores } from '../../data/stores';
import { EventRecord } from '../../data/types';
import { Handler, HandlerResult, res } from './helpers';

async function handle_sprintdesk_eventsPublish(args: any): Promise<HandlerResult> {
  const type = args.type;
  const source = args.source;

  if (!type || !source) {
    return res('type and source are required', true);
  }

  const event: EventRecord = {
    id: `evt_${Date.now()}`,
    type,
    source,
    payload: args.payload || {},
    timestamp: new Date().toISOString()
  };

  getStores().events.add(event);
  return res(JSON.stringify(event, null, 2));
}

async function handle_sprintdesk_eventsList(args: any): Promise<HandlerResult> {
  const events = getStores().events.latest(args.limit || 100)
    .filter(e => (!args.type || e.type === args.type) && (!args.source || e.source === args.source));

  return res(JSON.stringify(events, null, 2));
}

export const EVENT_HANDLERS: Record<string, Handler> = {
  sprintdesk_eventsPublish: handle_sprintdesk_eventsPublish,
  sprintdesk_eventsList: handle_sprintdesk_eventsList,
};