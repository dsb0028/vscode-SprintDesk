import { YAMLStore } from './BaseStore';
import { EmployeeTeam } from '../types';

export class EmployeeTeamStore extends YAMLStore<EmployeeTeam> {
  constructor(workspaceRoot?: string) {
    super('workforce', 'teams.yml', 'teams', workspaceRoot);
  }

  findByName(name: string): EmployeeTeam | undefined {
    return this.loadAll().find(t => t.name === name);
  }

  findByMember(memberId: string): EmployeeTeam | undefined {
    return this.loadAll().find(t => t.memberIds.includes(memberId));
  }
}