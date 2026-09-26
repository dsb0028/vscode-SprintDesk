import * as vscode from 'vscode';
import { WorkforceTreeDataProvider, WorkforceItem } from '../../providers/workforce/WorkforceTreeDataProvider';
import * as workforceService from '../../services/workforce/workforceService';

export function registerWorkforceCommands(context: vscode.ExtensionContext, provider: WorkforceTreeDataProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.viewWorkforce', () => {
      provider.refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.syncWorkforceFromTeam', async () => {
      const added = workforceService.syncWorkforceFromTeam();
      provider.refresh();
      vscode.window.showInformationMessage(added > 0
        ? `Workforce synced: ${added} employee(s) added from team`
        : 'Workforce up to date (no new employees from team)');
    }),

    vscode.commands.registerCommand('sprintdesk.addEmployee', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Enter employee name' });
      if (!name) return;

      const rolePick = await vscode.window.showQuickPick(
        [
          { label: 'Human', description: 'A person on the team', value: 'human' as const },
          { label: 'Agent', description: 'An AI worker', value: 'agent' as const }
        ],
        { placeHolder: 'Select role' }
      );
      if (!rolePick) return;

      const skills = await vscode.window.showInputBox({
        prompt: 'Skills / capabilities (comma separated, optional)'
      });

      const workforce = workforceService.getWorkforce();
      const teamPick = await vscode.window.showQuickPick(
        [
          { label: 'Unassigned', value: undefined as string | undefined },
          ...workforce.teams.map(t => ({ label: t.name, value: t.id }))
        ],
        { placeHolder: 'Assign to team (optional)' }
      );

      const employee = workforceService.addEmployee({
        name,
        role: rolePick.value,
        capabilities: skills ? skills.split(',').map(s => s.trim()).filter(Boolean) : [],
        teamId: teamPick?.value
      });

      provider.refresh();
      vscode.window.showInformationMessage(`Employee ${employee.name} added`);
    }),

    vscode.commands.registerCommand('sprintdesk.createTeam', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Enter team name' });
      if (!name) return;

      const description = await vscode.window.showInputBox({ prompt: 'Team description (optional)' });
      workforceService.createTeam({ name, description: description || undefined });

      provider.refresh();
      vscode.window.showInformationMessage(`Team ${name} created`);
    }),

    vscode.commands.registerCommand('sprintdesk.assignToTeam', async (item: WorkforceItem) => {
      const allEmployees = workforceService.getWorkforce().employees;
      let employee = item?.employee;
      const source = item?.employee
        ? `Assigned to ${item.team?.name || 'Unassigned'}`
        : undefined;

      if (!employee) {
        const flatItems = allEmployees.map(e => ({
          label: e.name,
          description: `${e.role} · ${e.status || 'idle'}`,
          employee: e
        }));
        const picked = await vscode.window.showQuickPick(flatItems, { placeHolder: 'Select employee to assign' });
        if (!picked) return;
        employee = picked.employee;
      }

      if (!employee) return;
      const targetEmployee = employee;

      const teams = workforceService.getWorkforce().teams;
      const current = teams.find(t => t.memberIds.includes(targetEmployee.id));
      const target = await vscode.window.showQuickPick([
        { label: 'Unassign', description: current ? `Leave ${current.name}` : 'Currently unassigned', value: undefined as string | undefined },
        ...teams.map(t => ({ label: t.name, description: current?.id === t.id ? 'Current team' : undefined, value: t.id }))
      ], { placeHolder: source || 'Select target team' });

      if (target === undefined && current) {
        workforceService.removeFromTeam(targetEmployee.id);
      } else if (target?.value) {
        if (current?.id === target.value) return;
        workforceService.assignToTeam(targetEmployee.id, target.value);
      } else {
        return;
      }

      provider.refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.setTeamLead', async (item: WorkforceItem) => {
      if (!item?.team) return;

      const team = item.team;
      const memberPick = await vscode.window.showQuickPick(
        team.memberIds.map(id => {
          const e = workforceService.getWorkforce().employees.find(emp => emp.id === id);
          return { label: e?.name || id, description: team.leadId === id ? 'Current lead' : undefined, value: id };
        }),
        { placeHolder: `Set lead for ${team.name}` }
      );
      if (!memberPick) return;

      workforceService.setTeamLead(team.id, memberPick.value);
      provider.refresh();
      vscode.window.showInformationMessage(`Lead updated for ${team.name}`);
    }),

    vscode.commands.registerCommand('sprintdesk.setEmployeeStatus', async (item: WorkforceItem) => {
      const employees = workforceService.getWorkforce().employees;
      const employee = item?.employee || (await (async () => {
        const flatItems = employees.map(e => ({
          label: e.name,
          description: `${e.role} · ${e.status || 'idle'}`,
          employee: e
        }));
        const picked = await vscode.window.showQuickPick(flatItems, { placeHolder: 'Select employee' });
        return picked?.employee;
      })());
      if (!employee) return;

      const status = await vscode.window.showQuickPick(
        [
          { label: 'Idle', value: 'idle' as const },
          { label: 'Busy', value: 'busy' as const },
          { label: 'Offline', value: 'offline' as const }
        ],
        { placeHolder: `Set availability for ${employee.name} (current: ${employee.status || 'idle'})` }
      );
      if (!status) return;

      workforceService.setEmployeeStatus(employee.id, status.value);
      provider.refresh();
    }),

    vscode.commands.registerCommand('sprintdesk.removeEmployee', async (item: WorkforceItem) => {
      const employees = workforceService.getWorkforce().employees;
      const employee = item?.employee || (await (async () => {
        const flatItems = employees.map(e => ({
          label: e.name,
          description: `${e.role} · ${e.status || 'idle'}`,
          employee: e
        }));
        const picked = await vscode.window.showQuickPick(flatItems, { placeHolder: 'Select employee to remove' });
        return picked?.employee;
      })());
      if (!employee) return;

      const confirm = await vscode.window.showWarningMessage(
        `Remove employee "${employee.name}" from the workforce?`,
        { modal: true },
        'Remove'
      );
      if (confirm !== 'Remove') return;

      workforceService.removeEmployee(employee.id);
      provider.refresh();
      vscode.window.showInformationMessage(`Employee ${employee.name} removed from workforce`);
    })
  );
}