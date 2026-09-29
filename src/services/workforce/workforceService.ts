import * as crypto from 'crypto';
import {
  getStores,
  ReviewerRecord,
  REVIEWER_DISPLAY_NAME_MAX_LENGTH,
  REVIEWER_ID_MAX_LENGTH,
  normalizeReviewerDisplayName,
  normalizeReviewerId
} from '../../data/stores';
import { Employee, EmployeeTeam } from '../../data/types';
import * as teamService from '../team/teamService';

export interface Workforce {
  teams: EmployeeTeam[];
  employees: Employee[];
  unassigned: Employee[];
}

export interface ResolvedEmployeeTeam extends EmployeeTeam {
  members: Employee[];
  lead?: Employee;
}

export function getWorkforce(): Workforce {
  const stores = getStores();
  const teams = stores.teams.loadAll();
  const employees = stores.employees.loadAll();
  const memberIds = new Set(teams.flatMap(t => t.memberIds));

  return {
    teams,
    employees,
    unassigned: employees.filter(e => !memberIds.has(e.id))
  };
}

export function getTeamsWithMembers(): ResolvedEmployeeTeam[] {
  const { teams, employees } = getWorkforce();
  return teams.map(t => ({
    ...t,
    members: employees.filter(e => t.memberIds.includes(e.id)),
    lead: employees.find(e => e.id === t.leadId)
  }));
}

export function createTeam(input: { name: string; description?: string; leadId?: string }): EmployeeTeam {
  const stores = getStores();
  const now = new Date().toISOString();
  const team: EmployeeTeam = {
    id: `team_${Date.now()}`,
    name: input.name.trim(),
    description: input.description,
    memberIds: input.leadId ? [input.leadId] : [],
    leadId: input.leadId,
    createdAt: now,
    updatedAt: now
  };
  stores.teams.add(team);
  return team;
}

export function addEmployee(input: {
  name: string;
  role: 'agent' | 'human';
  capabilities?: string[];
  status?: 'idle' | 'busy' | 'offline';
  gitAuthor?: string;
  description?: string;
  teamId?: string;
}): Employee {
  const stores = getStores();
  const now = new Date().toISOString();
  const employee: Employee = {
    id: `emp_${Date.now()}`,
    name: input.name.trim(),
    role: input.role,
    capabilities: input.capabilities || [],
    status: input.status || 'idle',
    gitAuthor: input.gitAuthor,
    description: input.description,
    createdAt: now,
    updatedAt: now
  };
  stores.employees.add(employee);

  if (input.teamId) {
    assignToTeam(employee.id, input.teamId);
  }

  return employee;
}

/** Lists every registered human reviewer from the reviewer registry. */
export function listHumanReviewers(): ReviewerRecord[] {
  return getStores().reviewers.list();
}

/** Resolves a registered human reviewer by normalized id or exact display name. */
export function findHumanReviewer(idOrDisplayName?: string): ReviewerRecord | undefined {
  return getStores().reviewers.find(idOrDisplayName);
}

/**
 * Registers a human reviewer in the reviewer registry.
 *
 * The reviewer registry is authoritative for reviewer identity and human
 * verification, and is maintained independently of the workforce employee
 * registry. Being a human employee never confers reviewer authority.
 *
 * A companion employee record is added only when no employee already owns the
 * reviewer id, so existing workforce views list the reviewer. An existing
 * employee is reused untouched and is never repurposed, renamed, or removed.
 * Errors never disclose reviewer ids or display names.
 */
export function registerHumanReviewer(input: {
  reviewerId: string;
  name: string;
}): Employee {
  const reviewerId = normalizeReviewerId(input.reviewerId);
  const name = normalizeReviewerDisplayName(input.name);
  if (!reviewerId || reviewerId.length > REVIEWER_ID_MAX_LENGTH) {
    throw new Error(`reviewerId must be between 1 and ${REVIEWER_ID_MAX_LENGTH} characters`);
  }
  if (!name || name.length > REVIEWER_DISPLAY_NAME_MAX_LENGTH) {
    throw new Error(`name must be between 1 and ${REVIEWER_DISPLAY_NAME_MAX_LENGTH} characters`);
  }

  const stores = getStores();
  const conflictingEmployee = stores.employees.getById(reviewerId);
  if (conflictingEmployee && conflictingEmployee.role !== 'human') {
    throw new Error('Reviewer ID is already in use by a non-human employee');
  }
  const agents = teamService.getAgents();
  if (agents.some(agent => agent.id === reviewerId)) {
    throw new Error('Reviewer ID is already in use by an agent');
  }
  if (agents.some(agent => agent.name.trim() === name)) {
    throw new Error('Reviewer name is already in use by an agent');
  }

  // Duplicate reviewer ids and names are rejected inside the registry lock.
  const reviewer = stores.reviewers.register({ reviewerId, displayName: name });
  return conflictingEmployee || addReviewerEmployee(reviewer);
}

function addReviewerEmployee(reviewer: ReviewerRecord): Employee {
  const now = new Date().toISOString();
  const employee: Employee = {
    id: reviewer.id,
    name: reviewer.displayName,
    role: 'human',
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  };
  getStores().employees.add(employee);
  return employee;
}

export function updateEmployee(
  employeeId: string,
  updates: Partial<Pick<Employee, 'name' | 'role' | 'capabilities' | 'status' | 'gitAuthor' | 'description'>>
): Employee | undefined {
  const stores = getStores();
  const existing = stores.employees.getById(employeeId);
  if (!existing) return undefined;

  stores.employees.update(employeeId, { ...updates, updatedAt: new Date().toISOString() });
  return stores.employees.getById(employeeId);
}

export function setEmployeeStatus(
  employeeId: string,
  status: 'idle' | 'busy' | 'offline'
): Employee | undefined {
  return updateEmployee(employeeId, { status });
}

export function removeEmployee(employeeId: string): boolean {
  const stores = getStores();
  const existing = stores.employees.getById(employeeId);
  if (!existing) return false;

  stores.employees.delete(employeeId);

  for (const team of stores.teams.loadAll()) {
    if (team.memberIds.includes(employeeId) || team.leadId === employeeId) {
      const updates: Partial<EmployeeTeam> = {
        memberIds: team.memberIds.filter(id => id !== employeeId),
        updatedAt: new Date().toISOString()
      };
      if (team.leadId === employeeId) updates.leadId = undefined;
      stores.teams.update(team.id, updates);
    }
  }

  return true;
}

export function assignToTeam(employeeId: string, teamId: string): void {
  const stores = getStores();
  const employee = stores.employees.getById(employeeId);
  if (!employee) throw new Error(`Employee not found: ${employeeId}`);

  const target = stores.teams.getById(teamId);
  if (!target) throw new Error(`Team not found: ${teamId}`);

  for (const team of stores.teams.loadAll()) {
    if (team.memberIds.includes(employeeId)) {
      const updates: Partial<EmployeeTeam> = {
        memberIds: team.memberIds.filter(id => id !== employeeId),
        updatedAt: new Date().toISOString()
      };
      if (team.leadId === employeeId) updates.leadId = undefined;
      stores.teams.update(team.id, updates);
    }
  }

  if (!target.memberIds.includes(employeeId)) {
    stores.teams.update(target.id, {
      memberIds: [...target.memberIds, employeeId],
      updatedAt: new Date().toISOString()
    });
  }
}

export function removeFromTeam(employeeId: string): void {
  const stores = getStores();
  for (const team of stores.teams.loadAll()) {
    if (team.memberIds.includes(employeeId) || team.leadId === employeeId) {
      const updates: Partial<EmployeeTeam> = {
        memberIds: team.memberIds.filter(id => id !== employeeId),
        updatedAt: new Date().toISOString()
      };
      if (team.leadId === employeeId) updates.leadId = undefined;
      stores.teams.update(team.id, updates);
    }
  }
}

export function setTeamLead(teamId: string, employeeId: string): EmployeeTeam | undefined {
  const stores = getStores();
  const team = stores.teams.getById(teamId);
  if (!team) throw new Error(`Team not found: ${teamId}`);

  if (employeeId && !team.memberIds.includes(employeeId)) {
    throw new Error('Lead must already be a team member');
  }

  stores.teams.update(teamId, {
    leadId: employeeId || undefined,
    updatedAt: new Date().toISOString()
  });
  return stores.teams.getById(teamId);
}

export function deleteTeam(teamId: string): boolean {
  const stores = getStores();
  if (!stores.teams.getById(teamId)) return false;
  stores.teams.delete(teamId);
  return true;
}

export function syncWorkforceFromTeam(): number {
  const stores = getStores();
  const existing = stores.employees.loadAll();
  const matchBy = (key: 'name' | 'gitAuthor') =>
    new Set(existing.map(e => e[key]).filter(Boolean));

  const memberNames = matchBy('name');
  const memberGits = matchBy('gitAuthor');

  let added = 0;
  const now = new Date().toISOString();

  for (const member of teamService.loadTeamMembers()) {
    const nameMatch = memberNames.has(member.name);
    const gitMatch = member.gitAuthor ? memberGits.has(member.gitAuthor) : false;
    if (nameMatch || gitMatch) continue;

    const employee: Employee = {
      id: `emp_${Date.now()}_${added}`,
      name: member.name,
      role: member.role === 'agent' ? 'agent' : 'human',
      status: 'idle',
      gitAuthor: member.gitAuthor || member.name,
      description: member.role === 'agent'
        ? `Agent (${member.agentConfig?.tool || 'tool not configured'})`
        : 'Team member',
      createdAt: now,
      updatedAt: now
    };
    stores.employees.add(employee);
    matchBy('name').add(member.name);
    if (member.gitAuthor) matchBy('gitAuthor').add(member.gitAuthor);
    added++;
  }

  return added;
}

export function getWorkforceSummary(): {
  employees: number;
  agents: number;
  humans: number;
  teams: number;
  unassigned: number;
  busy: number;
} {
  const { employees, unassigned, teams } = getWorkforce();
  return {
    employees: employees.length,
    agents: employees.filter(e => e.role === 'agent').length,
    humans: employees.filter(e => e.role === 'human').length,
    teams: teams.length,
    unassigned: unassigned.length,
    busy: employees.filter(e => e.status === 'busy').length
  };
}