// src/commands/addMultipleTasksCommand.ts
import * as vscode from "vscode";
import { getWebviewContent } from "../../webview/getWebviewContent";
import * as epicService from '../../services/epicService';
import * as taskService from '../../services/taskService';
import { parseTaskMetadataFromFilename } from '../../utils/taskTemplate';
import { PROJECT_CONSTANTS, UI_CONSTANTS } from '../../utils/constant';
import * as path from 'path';

export function addMultipleTasksCommand(context: vscode.ExtensionContext) {
  const command = vscode.commands.registerCommand(
    "sprintdesk.addMultipleTasks",
    () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage("No workspace opened.");
        return;
      }

      const workspaceRoot = workspaceFolders[0].uri;
      const tasksDir = vscode.Uri.joinPath(workspaceRoot, ".SprintDesk", "tasks");
      const epicsDir = vscode.Uri.joinPath(workspaceRoot, ".SprintDesk", "Epics");

      const panel = vscode.window.createWebviewPanel(
        "sprintDeskAddMultipleTasks",
        "➕ Add SprintDesk Tasks",
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
      );

      const webview = panel.webview;
      const originalHtml = getWebviewContent(context, webview);

      const modifiedHtml = originalHtml.replace(
        "</body>",
        `<script>
          (function() {
            const url = new URL(window.location.toString());
            if (!url.searchParams.has('view')) {
              url.searchParams.set('view', 'addMultipleTasks');
              window.history.replaceState(null, '', url.toString());
            }
          })();
        </script>
        </body>`
      );

      panel.webview.html = modifiedHtml;

      panel.webview.onDidReceiveMessage(async (message) => {
          if (message.command === "validateTasks") {
            const tasks: string[] = message.payload.filter((t: string) => t.trim());

            if (tasks.length === 0) {
              vscode.window.showWarningMessage("No tasks to process.");
              return;
            }

            // Ensure directories exist
            for (const dir of [tasksDir, epicsDir]) {
              try {
                await vscode.workspace.fs.stat(dir);
              } catch {
                await vscode.workspace.fs.createDirectory(dir);
              }
            }

            // Group tasks by Epic
            const epicTasks: Record<string, string[]> = {};
            const createdTasks: string[] = [];
            const skippedTasks: string[] = [];

            // Step 1: Create tasks via TaskService
            for (const rawTask of tasks) {
              const taskLine = rawTask.trim();
              if (!taskLine) continue;

              const safeTaskName = taskLine.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
              const fileNameHint = safeTaskName.endsWith(".md") ? safeTaskName : `${safeTaskName}.md`;

              const { taskName, epicName } = parseTaskMetadataFromFilename(fileNameHint);

              try {
                // create the task using the task service
                const created = await taskService.createTask(workspaceRoot.fsPath, {
                  title: taskName,
                  epic: epicName || null
                });

                // derive filename from returned task.path if available
                const createdFileName = created.path ? path.basename(created.path) : fileNameHint;
                createdTasks.push(createdFileName);

                if (epicName) {
                  if (!epicTasks[epicName]) epicTasks[epicName] = [];
                  epicTasks[epicName].push(createdFileName);
                }
              } catch (error) {
                console.error('Error creating task via service:', error);
                skippedTasks.push(fileNameHint);
              }
            }

            // Step 2: Create or update Epic files
            const updatedEpics: string[] = [];
            const now = new Date().toISOString();

            for (const [epic, taskFiles] of Object.entries(epicTasks) as [string, string[]][]) {
              const epicFileName = `${PROJECT_CONSTANTS.FILE_PREFIX.EPIC}${epic}.md`;
              const epicFileUri = vscode.Uri.joinPath(epicsDir, epicFileName);

              // Generate content
              const taskLinks = taskFiles
                .map((taskFile) => {
                  const { taskName } = parseTaskMetadataFromFilename(taskFile);
                  return `- ${UI_CONSTANTS.EMOJI.COMMON.TASK} [${taskName}](../Tasks/${taskFile})`;
                })
                .join("\n");

              const content = `# 🚩 Epic : ${epic}
- **🗂 updated:** ${now}
- **📌 Tasks:** ${taskFiles.length} tasks
- **📘 Description:** 


## Tasks
${taskLinks}
`;

              // Ensure epic exists and add tasks via service
              try {
                epicService.createEpic(epic);
                for (const taskFile of taskFiles) {
                  epicService.addTaskToEpic(epic, taskFile);
                }
                updatedEpics.push(epicFileName);
              } catch (err) {
                console.error('Failed updating epic:', err);
              }
            }

            // Show result
            let msg = `✅ Created ${createdTasks.length} task(s). `;
            if (skippedTasks.length > 0) msg += `❌ Skipped ${skippedTasks.length}. `;
            if (updatedEpics.length > 0) msg += `📘 Updated ${updatedEpics.length} epic(s).`;
            vscode.window.showInformationMessage(msg);
          }
      });
    }
  );

  context.subscriptions.push(command);
}