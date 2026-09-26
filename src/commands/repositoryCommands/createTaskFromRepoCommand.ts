import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PROJECT_CONSTANTS } from '../../utils/constant';
import { SprintDeskItem } from '../../utils/SprintDeskItem';
import { generateTaskId, generateTaskMetadata, generateTaskContent } from '../../utils/taskTemplate';
import { promptInput } from '../../utils/helpers';

type Deps = {
  repositoriesTreeView?: any;
  tasksProvider?: any;
  epicsProvider?: any;
  sprintsProvider?: any;
  backlogsProvider?: any;
};

export function registerCreateTaskFromRepoCommand(context: vscode.ExtensionContext, deps: Deps) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.createTaskFromRepo', async (item: any) => {
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
        // Get task title
        const taskTitle = await promptInput('Enter task title', 'New Task');
        if (!taskTitle) return;

        // Get task type
        const typeOptions = [
          { label: 'Feature', value: 'feature' },
          { label: 'Bug', value: 'bug' },
          { label: 'Improvement', value: 'improvement' },
          { label: 'Documentation', value: 'documentation' },
          { label: 'Test', value: 'test' }
        ];
        const selectedType = await vscode.window.showQuickPick(typeOptions, {
          placeHolder: 'Select task type'
        });
        if (!selectedType) return;

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

        // Get category
        const category = await vscode.window.showInputBox({
          prompt: 'Enter category (optional)',
          placeHolder: 'e.g., frontend, backend'
        });

        // Get component
        const component = await vscode.window.showInputBox({
          prompt: 'Enter component (optional)',
          placeHolder: 'e.g., ui, api'
        });

        // Get assignee
        const assignee = await vscode.window.showInputBox({
          prompt: 'Enter assignee (optional)',
          placeHolder: 'e.g., John Doe'
        });

        // Create SprintDesk directory structure
        const sprintDeskDir = path.join(repoPath, PROJECT_CONSTANTS.SPRINTDESK_DIR);
        const tasksDir = path.join(sprintDeskDir, PROJECT_CONSTANTS.TASKS_DIR);
        
        if (!fs.existsSync(tasksDir)) {
          fs.mkdirSync(tasksDir, { recursive: true });
        }

        // Generate task metadata with unique ID
        const baseTaskId = generateTaskId(taskTitle);
        const uniqueId = Date.now(); // Use timestamp as unique number ID
        const taskFileName = `${PROJECT_CONSTANTS.FILE_PREFIX.TASK}${baseTaskId}${PROJECT_CONSTANTS.MD_FILE_EXTENSION}`;
        const taskPath = path.join(tasksDir, taskFileName);

        const taskData = {
          _id: Date.now(), // Use timestamp as number ID
          title: taskTitle,
          type: selectedType.value as SprintDesk.TaskType,
          priority: selectedPriority.value as SprintDesk.Priority,
          category: category || '',
          component: component || '',
          assignee: assignee || '',
          status: 'waiting' as SprintDesk.TaskStatus,
          path: taskPath,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        // Use SprintDeskItem to create task
        const taskItem = new SprintDeskItem(taskPath);
        const taskContent = generateTaskMetadata(taskData) + '\n\n' + generateTaskContent(taskData);
        taskItem.update(taskContent, taskData);
        taskItem.create();

        // Refresh tasks provider
        deps.tasksProvider?.refresh?.();

        vscode.window.showInformationMessage(`Task "${taskTitle}" created successfully!`);

      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create task: ${error}`);
      }
    })
  );
}