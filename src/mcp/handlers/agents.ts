import * as teamService from '../../services/team/teamService';
import { getStores } from '../../data/stores';
import { Handler, HandlerResult, res, getWs, getDs } from './helpers';

async function handle_sprintdesk_listTeam(_args: any): Promise<HandlerResult> {
  const members = teamService.loadTeamMembers();
  return res(JSON.stringify(members, null, 2));
}

async function handle_sprintdesk_syncTeamFromGit(_args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);

  try {
    const members = await teamService.syncTeamFromGit();
    return res(`Team synced: ${members.length} members found`);
  } catch (e: any) {
    return res(`Error: ${e.message}`, true);
  }
}

async function handle_sprintdesk_addTeamMember(args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);

  try {
    const member = teamService.addTeamMember({
      name: args.name,
      email: args.email,
      role: args.role || 'developer',
      avatar: args.avatar,
      agentConfig: args.agentConfig
    });
    return res(JSON.stringify(member, null, 2));
  } catch (e: any) {
    return res(`Error: ${e.message}`, true);
  }
}

async function handle_sprintdesk_removeTeamMember(args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);

  const removed = teamService.removeTeamMember(args.id || args.email);
  if (removed) {
    return res('Team member removed');
  }
  return res('Team member not found', true);
}

async function handle_sprintdesk_runAgent(args: any): Promise<HandlerResult> {
  const ws = getWs();
  if (!ws) return res('No workspace found', true);

  const agentId = args.agentId;
  const taskCode = args.taskCode;

  if (!agentId || !taskCode) {
    return res('agentId and taskCode required', true);
  }

  try {
    const { runAgent } = require('../../services/agentRunner');
    const ds = getDs();
    if (!ds) return res('No workspace found', true);

    const task = ds.getTask(taskCode) || ds.loadTasks().find(t => t.code === taskCode);
    if (!task) {
      return res(`Task ${taskCode} not found`, true);
    }

    const agent = teamService.getAgent(agentId);
    if (!agent) {
      return res(`Agent ${agentId} not found`, true);
    }

    const result = await runAgent(agent, task);
    return res(JSON.stringify(result, null, 2));
  } catch (e: any) {
    return res(`Error: ${e.message}`, true);
  }
}

async function handle_sprintdesk_agentsList(_args: any): Promise<HandlerResult> {
  const agents: any[] = [];

  const teamAgents = teamService.getAgents();
  teamAgents.forEach(a => {
    agents.push({
      id: a.id,
      name: a.name,
      role: a.role,
      source: 'team',
      agentConfig: a.agentConfig
    });
  });

  const employees = getStores().employees.findByRole('agent');
  employees.forEach(e => {
    if (!agents.some(a => a.id === e.id)) {
      agents.push({
        id: e.id,
        name: e.name,
        role: e.role,
        source: 'workforce',
        status: e.status,
        capabilities: e.capabilities
      });
    }
  });

  return res(JSON.stringify(agents, null, 2));
}

async function handle_sprintdesk_agentsGet(args: any): Promise<HandlerResult> {
  const agentId = args.agentId;
  if (!agentId) return res('agentId required', true);

  const teamAgent = teamService.getAgent(agentId);
  if (teamAgent) {
    return res(JSON.stringify({ ...teamAgent, source: 'team' }, null, 2));
  }

  const employee = getStores().employees.getById(agentId);
  if (employee) {
    return res(JSON.stringify({ ...employee, source: 'workforce' }, null, 2));
  }

  return res(`Agent not found: ${agentId}`, true);
}

export const AGENT_HANDLERS: Record<string, Handler> = {
  sprintdesk_listTeam: handle_sprintdesk_listTeam,
  sprintdesk_syncTeamFromGit: handle_sprintdesk_syncTeamFromGit,
  sprintdesk_addTeamMember: handle_sprintdesk_addTeamMember,
  sprintdesk_removeTeamMember: handle_sprintdesk_removeTeamMember,
  sprintdesk_runAgent: handle_sprintdesk_runAgent,
  sprintdesk_agentsList: handle_sprintdesk_agentsList,
  sprintdesk_agentsGet: handle_sprintdesk_agentsGet,
};