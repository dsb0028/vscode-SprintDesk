import { YAMLStore } from './BaseStore';
import { AuditEntry } from '../types';

export class AuditStore extends YAMLStore<AuditEntry> {
  constructor(workspaceRoot?: string) {
    super('data', 'audit.yml', 'entries', workspaceRoot);
  }

  findByActor(actor: string): AuditEntry[] {
    return this.loadAll().filter(e => e.actor === actor);
  }

  findByTarget(targetType: string, targetId?: string): AuditEntry[] {
    return this.loadAll().filter(
      e => e.targetType === targetType && (targetId === undefined || e.targetId === targetId)
    );
  }

  latest(limit: number): AuditEntry[] {
    return this.loadAll()
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, limit);
  }
}