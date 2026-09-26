import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PROJECT_CONSTANTS } from '../../utils/constant';
import { SprintDeskItem } from '../../utils/SprintDeskItem';
import { generateEpicId } from '../../utils/taskTemplate';
import { generateEpicMetadata, generateEpicContent } from '../../utils/epicTemplate';
import { promptInput } from '../../utils/helpers';

type Deps = {
  repositoriesTreeView?: any;
  tasksProvider?: any;
  epicsProvider?: any;
  sprintsProvider?: any;
  backlogsProvider?: any;
};

export function registerCreateEpicFromRepoCommand(context: vscode.ExtensionContext, deps: Deps) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.createEpicFromRepo', async (item: any) => {
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
        // Get epic title
        const epicTitle = await promptInput('Enter epic title', 'New Epic');
        if (!epicTitle) return;

        // Get category
        const category = await promptInput('Enter epic category (e.g., SEO, FE, BE)', 'MISC');
        const epicCategory = category || 'MISC';

        // Get priority
        const priorityOptions = [
          { label: 'High', value: 'high' },
          { label: 'Medium', value: 'medium' },
          { label: 'Low', value: 'low' }
        ];
        const selectedPriority = await vscode.window.showQuickPick(priorityOptions, {
          placeHolder: 'Select priority'
        });
        if (!selectedPriority) return;

        // Get description
        const description = await vscode.window.showInputBox({
          prompt: 'Enter epic description (optional)',
          placeHolder: 'Epic description...'
        });

        // Create SprintDesk directory structure
        const sprintDeskDir = path.join(repoPath, PROJECT_CONSTANTS.SPRINTDESK_DIR);
        const epicsDir = path.join(sprintDeskDir, PROJECT_CONSTANTS.EPICS_DIR);
        
        if (!fs.existsSync(epicsDir)) {
          fs.mkdirSync(epicsDir, { recursive: true });
        }

        // Get epic number from DataService
        const { getDataService } = require('../../data/DataService');
        const dataService = getDataService(repoPath);
        const epicNumber = dataService.generateNextNumber('epic');
        const epicCode = dataService.generateCode('epic', epicNumber);
        const titleSlug = dataService.slugifyTitle(epicTitle);

        // Generate epic metadata
        const epicId = generateEpicId(epicTitle);
        const epicFileName = `[${epicCode}]_${epicCategory}_${titleSlug}${PROJECT_CONSTANTS.MD_FILE_EXTENSION}`;
        const epicPath = path.join(epicsDir, epicFileName);

        const epicData = {
          _id: Date.now(), // Use timestamp as number ID
          title: epicTitle,
          category: epicCategory,
          description: description || '',
          priority: selectedPriority.value as SprintDesk.Priority,
          status: 'planned' as SprintDesk.EpicStatus,
          totalTasks: 0,
          completedTasks: 0,
          path: epicPath,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        // Use SprintDeskItem to create epic
        const epicItem = new SprintDeskItem(epicPath);
        const epicContent = generateEpicMetadata(epicData) + '\n\n' + generateEpicContent(epicData);
        epicItem.update(epicContent, epicData);
        epicItem.create();

        // Refresh epics provider
        deps.epicsProvider?.refresh?.();

        vscode.window.showInformationMessage(`Epic "${epicTitle}" created successfully!`);

      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create epic: ${error}`);
      }
    })
  );
}