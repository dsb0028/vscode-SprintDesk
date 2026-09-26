import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as teamService from '../../services/team/teamService';
import { TeamMember } from '../../data/types';
import { PROJECT_CONSTANTS } from '../../utils/constant';

export class TeamTreeItem extends vscode.TreeItem {
  public readonly member: TeamMember;

  constructor(
    member: TeamMember,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(member.name, collapsibleState);
    this.member = member;
    this.contextValue = member.role === 'agent' ? 'agent' : 'teamMember';

    if (member.role === 'agent') {
      this.tooltip = `${member.name}\nTool: ${member.agentConfig?.tool || 'not configured'}`;
      if (member.agentConfig?.tool === 'ollama' && member.agentConfig?.model) {
        this.tooltip += ` (${member.agentConfig.model})`;
      }
      this.iconPath = new vscode.ThemeIcon('robot');
      this.description = 'Agent';
    } else {
      this.tooltip = `${member.name} <${member.email}>\nRole: ${member.role || 'developer'}`;
      this.iconPath = new vscode.ThemeIcon('account');
      
      if (member.role === 'lead') {
        this.description = 'Lead';
      } else if (member.role === 'reviewer') {
        this.description = 'Reviewer';
      }
    }
  }
}

export class TeamTreeDataProvider implements vscode.TreeDataProvider<TeamTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TeamTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private workspaceRoot: string | undefined;

  constructor() {
    this.refresh();
  }

  setWorkspaceRoot(root: string) {
    this.workspaceRoot = root;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TeamTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TeamTreeItem): Thenable<TeamTreeItem[]> {
    if (!this.workspaceRoot) {
      const wsFolders = vscode.workspace.workspaceFolders;
      this.workspaceRoot = wsFolders?.[0]?.uri.fsPath;
    }

    if (!this.workspaceRoot) {
      return Promise.resolve([]);
    }

    const members = teamService.loadTeamMembers();
    
    if (!element) {
      const items = this.groupByRole(members);
      return Promise.resolve(items);
    }

    return Promise.resolve([]);
  }

  private groupByRole(members: TeamMember[]): TeamTreeItem[] {
    const roleGroups: Record<string, TeamMember[]> = {
      lead: [],
      developer: [],
      reviewer: [],
      observer: [],
      agent: [],
      unassigned: []
    };

    for (const member of members) {
      const role = member.role || 'developer';
      if (!roleGroups[role]) {
        roleGroups[role] = [];
      }
      roleGroups[role].push(member);
    }

    const items: TeamTreeItem[] = [];
    
    for (const role of ['lead', 'developer', 'reviewer', 'observer', 'agent'] as const) {
      for (const member of roleGroups[role]) {
        items.push(new TeamTreeItem(member));
      }
    }

    return items;
  }

  getMembers(): TeamMember[] {
    return teamService.loadTeamMembers();
  }

  getAgents(): TeamMember[] {
    return teamService.getAgents();
  }
}

export const teamTreeDataProvider = new TeamTreeDataProvider();