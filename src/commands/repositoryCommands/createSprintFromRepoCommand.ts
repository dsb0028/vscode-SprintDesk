import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PROJECT_CONSTANTS } from '../../utils/constant';
import { SprintDeskItem } from '../../utils/SprintDeskItem';
import { promptInput } from '../../utils/helpers';

type Deps = {
  repositoriesTreeView?: any;
  tasksProvider?: any;
  epicsProvider?: any;
  sprintsProvider?: any;
  backlogsProvider?: any;
};

export function registerCreateSprintFromRepoCommand(context: vscode.ExtensionContext, deps: Deps) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.createSprintFromRepo', async (item: any) => {
      if (!item) {
        vscode.window.showErrorMessage('No repository selected');
        return;
      }

      const repoPath = item.fullPath || item.resourceUri?.fsPath;
      if (!repoPath) {
        vscode.window.showErrorMessage('Repository path not found');
        return;
      }

      try {
        // Get sprint dates
        const startDate = await vscode.window.showInputBox({
          prompt: 'Enter start date (DD-MM)',
          placeHolder: 'e.g., 11-08'
        });
        if (!startDate) return;

        const endDate = await vscode.window.showInputBox({
          prompt: 'Enter end date (DD-MM)',
          placeHolder: 'e.g., 25-08'
        });
        if (!endDate) return;

        // Get year
        const year = await vscode.window.showInputBox({
          prompt: 'Enter year (YYYY)',
          placeHolder: 'e.g., 2025'
        });
        if (!year) return;

        // Create SprintDesk directory structure
        const sprintDeskDir = path.join(repoPath, PROJECT_CONSTANTS.SPRINTDESK_DIR);
        const sprintsDir = path.join(sprintDeskDir, PROJECT_CONSTANTS.SPRINTS_DIR);
        
        if (!fs.existsSync(sprintsDir)) {
          fs.mkdirSync(sprintsDir, { recursive: true });
        }

        // Generate sprint filename
        const [startDay, startMonth] = startDate.split('-');
        const [endDay, endMonth] = endDate.split('-');
        const sprintFileName = `${PROJECT_CONSTANTS.FILE_PREFIX.SPRINT}${startDay}-${startMonth}_${endDay}-${endMonth}_${year}${PROJECT_CONSTANTS.MD_FILE_EXTENSION}`;
        const sprintPath = path.join(sprintsDir, sprintFileName);

        // Generate sprint content
        const shortStart = `${startDay}${startMonth}${year.slice(-2)}`;
        const shortEnd = `${endDay}${endMonth}${year.slice(-2)}`;
        const sprintContent = `# 📅 Sprint : ${shortStart} ➜ ${shortEnd}
- **🗓️ Last update:** ${new Date().toISOString()}
- **🛠️ Total Tasks:** 0
- **📊 Progress:** ✅ [0/0] 🟩100%
- **📝 Summary:** 

## 📋 Tasks

> Tasks will be linked here automatically
`;

        // Use SprintDeskItem to create sprint
        const sprintItem = new SprintDeskItem(sprintPath);
        sprintItem.update(sprintContent, {
          title: `Sprint : ${shortStart} ➜ ${shortEnd}`,
          startDate: `${startDay}${startMonth}${year}`,
          endDate: `${endDay}${endMonth}${year}`,
          totalTasks: 0,
          completedTasks: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        sprintItem.create();

        // Refresh sprints provider
        deps.sprintsProvider?.refresh?.();

        vscode.window.showInformationMessage(`Sprint "${shortStart} ➜ ${shortEnd}" created successfully!`);

      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create sprint: ${error}`);
      }
    })
  );
}

