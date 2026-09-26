import * as vscode from 'vscode';
import { Employee, EmployeeTeam } from '../../data/types';
import * as workforceService from '../../services/workforce/workforceService';

export class WorkforceItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    public readonly employee?: Employee,
    public readonly team?: EmployeeTeam
  ) {
    super(label, collapsibleState);
    this.contextValue = contextValue;

    if (employee) {
      if (employee.role === 'agent') {
        this.iconPath = new vscode.ThemeIcon('robot');
      } else {
        this.iconPath = employee.status === 'busy'
          ? new vscode.ThemeIcon('sync~spin')
          : new vscode.ThemeIcon('account');
      }
      this.description = this.employeeDescription(employee);
      this.tooltip = this.employeeTooltip(employee);
    }
  }

  private employeeDescription(employee: Employee): string {
    const parts: string[] = [];
    parts.push(employee.role === 'agent' ? 'agent' : 'human');
    if (employee.status && employee.status !== 'idle') parts.push(employee.status);
    if (employee.capabilities && employee.capabilities.length > 0) {
      parts.push(`[${employee.capabilities.join(', ')}]`);
    }
    return parts.join(' · ');
  }

  private employeeTooltip(employee: Employee): string {
    const lines = [
      `${employee.name} (${employee.role})`,
      `Status: ${employee.status || 'idle'}`
    ];
    if (employee.gitAuthor) lines.push(`Git author: ${employee.gitAuthor}`);
    if (employee.capabilities && employee.capabilities.length > 0) {
      lines.push(`Skills: ${employee.capabilities.join(', ')}`);
    }
    if (employee.description) lines.push(employee.description);
    return lines.join('\n');
  }
}

export class WorkforceTreeDataProvider implements vscode.TreeDataProvider<WorkforceItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<WorkforceItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: WorkforceItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: WorkforceItem): Thenable<WorkforceItem[]> {
    if (!element) {
      return Promise.resolve(this.buildTeamRows());
    }

    if (element.contextValue === 'workforceTeam') {
      return Promise.resolve(this.buildMemberRows(element.team));
    }

    if (element.contextValue === 'workforceUnassigned') {
      return Promise.resolve(this.buildMemberRows());
    }

    return Promise.resolve([]);
  }

  private buildTeamRows(): WorkforceItem[] {
    const items: WorkforceItem[] = [];

    for (const resolved of workforceService.getTeamsWithMembers()) {
      const label = resolved.lead
        ? `${resolved.name} (${resolved.members.length}) · ${resolved.lead.name}`
        : `${resolved.name} (${resolved.members.length})`;
      items.push(new WorkforceItem(
        label,
        vscode.TreeItemCollapsibleState.Expanded,
        'workforceTeam',
        undefined,
        resolved
      ));
    }

    const { unassigned } = workforceService.getWorkforce();
    if (unassigned.length > 0) {
      items.push(new WorkforceItem(
        `Unassigned (${unassigned.length})`,
        vscode.TreeItemCollapsibleState.Collapsed,
        'workforceUnassigned'
      ));
    }

    return items;
  }

  private buildMemberRows(team?: EmployeeTeam): WorkforceItem[] {
    if (!team) {
      return workforceService.getWorkforce().unassigned.map(
        e => new WorkforceItem(e.name, vscode.TreeItemCollapsibleState.None, e.role === 'agent' ? 'employeeAgent' : 'employee', e)
      );
    }

    return team.memberIds.map(id => {
      const employee = workforceService.getWorkforce().employees.find(e => e.id === id);
      if (!employee) return null;
      return new WorkforceItem(
        employee.name,
        vscode.TreeItemCollapsibleState.None,
        employee.role === 'agent' ? 'employeeAgent' : 'employee',
        employee
      );
    }).filter((x): x is WorkforceItem => x !== null);
  }
}

export const workforceTreeDataProvider = new WorkforceTreeDataProvider();