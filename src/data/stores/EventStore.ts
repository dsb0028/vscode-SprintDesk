import { YAMLStore } from './BaseStore';
import { EventRecord } from '../types';

export class EventStore extends YAMLStore<EventRecord> {
  constructor(workspaceRoot?: string) {
    super('data', 'events.yml', 'events', workspaceRoot);
  }

  findByType(type: string): EventRecord[] {
    return this.loadAll().filter(e => e.type === type);
  }

  findBySource(source: string): EventRecord[] {
    return this.loadAll().filter(e => e.source === source);
  }

  latest(limit: number): EventRecord[] {
    return this.loadAll()
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, limit);
  }
}