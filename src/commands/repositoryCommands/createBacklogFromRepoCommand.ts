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

export function registerCreateBacklogFromRepoCommand(context: vscode.ExtensionContext, deps: Deps) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.createBacklogFromRepo', async (item: any) => {
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
        // Get backlog title
        const backlogTitle = await promptInput('Enter backlog title', 'New Backlog');
        if (!backlogTitle) return;

        // Get backlog type
        const typeOptions = [
          { label: 'Features', value: 'features' },
          { label: 'Bugs', value: 'bugs' },
          { label: 'Improvements', value: 'improvements' },
          { label: 'Documentation', value: 'documentation' },
          { label: 'Technical', value: 'technical' },
          { label: 'Tests', value: 'tests' }
        ];
        const selectedType = await vscode.window.showQuickPick(typeOptions, {
          placeHolder: 'Select backlog type'
        });
        if (!selectedType) return;

        // Create SprintDesk directory structure
        const sprintDeskDir = path.join(repoPath, PROJECT_CONSTANTS.SPRINTDESK_DIR);
        const backlogsDir = path.join(sprintDeskDir, PROJECT_CONSTANTS.BACKLOGS_DIR);
        
        if (!fs.existsSync(backlogsDir)) {
          fs.mkdirSync(backlogsDir, { recursive: true });
        }

        // Generate backlog filename
        const backlogFileName = `${PROJECT_CONSTANTS.FILE_PREFIX.BACKLOG}${selectedType.value}-${backlogTitle.toLowerCase().replace(/\s+/g, '-')}${PROJECT_CONSTANTS.MD_FILE_EXTENSION}`;
        const backlogPath = path.join(backlogsDir, backlogFileName);

        // Generate backlog content
        const backlogContent = `# 📋 Backlog: ${backlogTitle}

## 📝 Description
Add backlog description here...

## 📋 Items

> Items will be linked here automatically
`;

        // Use SprintDeskItem to create backlog
        const backlogItem = new SprintDeskItem(backlogPath);
        backlogItem.update(backlogContent, {
          title: backlogTitle,
          type: selectedType.value,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        backlogItem.create();

        // Refresh backlogs provider
        deps.backlogsProvider?.refresh?.();

        vscode.window.showInformationMessage(`Backlog "${backlogTitle}" created successfully!`);

      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create backlog: ${error}`);
      }
    })
  );
}