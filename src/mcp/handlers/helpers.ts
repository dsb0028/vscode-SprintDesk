import * as fileService from '../../services/fileService';
import * as teamService from '../../services/team/teamService';
import { getStores } from '../../data/stores';
import { getDataService, DataService } from '../../data/DataService';
import { AuditEntry } from '../../data/types';

export interface HandlerResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export type Handler = (args: any) => HandlerResult | Promise<HandlerResult>;

export function res(text: string, isError = false): HandlerResult {
  return { content: [{ type: 'text', text }], isError };
}

export function getWs(): string | undefined {
  return fileService.getWorkspaceRoot();
}

export function getDs(): DataService | undefined {
  const ws = getWs();
  return ws ? getDataService(ws) : undefined;
}

export function findTask(ds: DataService, taskId: string) {
  return ds.getTask(taskId) || ds.loadTasks().find(t => t.code === taskId);
}

export function findEpic(ds: DataService, epicId: string) {
  return ds.getEpic(epicId) || ds.loadEpics().find(e => e.code === epicId);
}

export function findSprint(ds: DataService, sprintId: string) {
  return ds.getSprint(sprintId) || ds.loadSprints().find(s => s.number.toString() === sprintId);
}

export function findBacklog(ds: DataService, backlogId: string) {
  return ds.getBacklog(backlogId) || ds.loadBacklogs().find(b => b.name === backlogId || b.title === backlogId);
}

export interface ResolvedAgent {
  id: string;
  name: string;
  source: 'team' | 'workforce';
  role: 'agent' | 'human';
  status?: string;
}

export function resolveAgent(agentIdOrName?: string): ResolvedAgent | undefined {
  if (!agentIdOrName) return undefined;

  const workforceEmployee = getStores().employees
    .loadAll()
    .find(e => e.id === agentIdOrName || e.name === agentIdOrName);
  if (workforceEmployee) {
    return {
      id: workforceEmployee.id,
      name: workforceEmployee.name,
      source: 'workforce',
      role: workforceEmployee.role,
      status: workforceEmployee.status
    };
  }

  const teamMember = teamService.getAgents().find(a => a.id === agentIdOrName || a.name === agentIdOrName);
  if (teamMember) {
    return {
      id: teamMember.id,
      name: teamMember.name,
      source: 'team',
      role: 'agent',
      status: undefined
    };
  }

  return undefined;
}

export function recordAudit(entry: Partial<AuditEntry> & { actor: string; action: string; targetType: string }): AuditEntry {
  const auditEntry: AuditEntry = {
    id: `audit_${Date.now()}`,
    actor: entry.actor,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    details: entry.details,
    timestamp: new Date().toISOString()
  };
  getStores().audit.add(auditEntry);
  return auditEntry;
}