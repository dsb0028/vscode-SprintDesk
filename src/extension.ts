import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

// webview
import { getWebviewContent } from "./webview/getWebviewContent";
// commands
import {
  registerAddSprintCommand,
  registerAddExistingTasksToSprintCommand,
  registerShowSprintCalendarCommand,
  registerOpenSprintFileCommand,
  registerAddBacklogCommand,
  registerAddTaskToBacklogCommand,
  registerAddExistingTasksToBacklogCommand,
  registerAddEpicCommand,
  registerAddTaskToEpicCommand,
  registerAddQuicklyCommand,
  registerStartFeatureFromTaskCommand,
  registerCreateTaskFromRepoCommand,
  registerCreateEpicFromRepoCommand,
  registerCreateSprintFromRepoCommand,
  registerCreateBacklogFromRepoCommand,
  registerOpenWebviewCommand,
  registerViewTasksCommand,
  registerViewTaskPreviewCommand,
  registerEditTaskRawCommand,
  registerViewEpicsCommand,
  registerViewBacklogsCommand,
  addMultipleTasksCommand,
  registerAddTaskCommand
} from './commands';
import { registerViewProjectStructureCommand } from "./commands/viewProjectStructure";
import { registerViewProjectsCommand } from "./commands/viewProjects";
import { registerRefreshCommand } from './commands/refreshCommand';
import { registerScanProjectStructureCommand } from './commands/scanProjectStructureCommand';
import {
  registerOpenSettingsCommand
} from './commands';
// Provider
import { SprintsTreeDataProvider } from './providers/SprintsTreeDataProvider';
import { TasksTreeDataProvider } from './providers/TasksTreeDataProvider';
import { BacklogsTreeDataProvider } from './providers/BacklogsTreeDataProvider';
import { EpicsTreeDataProvider } from './providers/EpicsTreeDataProvider';
import { RepositoriesTreeDataProvider } from './providers/RepositoriesTreeDataProvider';
import { TeamTreeDataProvider, teamTreeDataProvider } from './providers/team/TeamTreeDataProvider';
import { HistoryTreeDataProvider, historyTreeDataProvider } from './providers/history/HistoryTreeDataProvider';
import { workforceTreeDataProvider } from './providers/workforce/WorkforceTreeDataProvider';
// Services
import { createSprintInteractive, addExistingTasksToSprint, startFeatureFromTask } from './commands/interactive/sprintInteractive';
import { createEpicInteractive } from './commands/interactive/epicInteractive';
import { addTaskToBacklogInteractive, addExistingTasksToBacklog, createBacklogInteractive } from './commands/interactive/backlogInteractive';
import * as teamService from './services/team/teamService';
import { registerWorkforceCommands } from './commands/workforce/workforceCommands';
// Tasks - import and create wrapper for API compatibility
import { createTask as createTaskService } from "./services/taskService";
// Host boundary
import { setHost, setFileSystem } from './host';
import { VSCodeHost } from './host/VSCodeHost';
import { NodeFileSystem } from './host/NodeFileSystem';

const createTask = async (repoPath?: string): Promise<void> => {
  const ws = repoPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: 'Task title',
    placeHolder: 'Enter task title...'
  });
  if (!title) return;

  const type = await vscode.window.showQuickPick(['feature', 'bug', 'chore', 'doc', 'test'], {
    placeHolder: 'Select task type'
  });
  if (!type) return;

  const priority = await vscode.window.showQuickPick(['high', 'medium', 'low'], {
    placeHolder: 'Select priority'
  });
  if (!priority) return;

  const backlog = await vscode.window.showInputBox({
    prompt: 'Backlog name',
    placeHolder: 'features',
    value: 'features'
  });

  // Get existing epics for selection
  const { getDataService } = require('./data/DataService');
  const dataService = getDataService(ws);
  const epics = dataService.loadEpics();

  let epicSelection: string | undefined;
  if (epics.length > 0) {
    const epicOptions = [{ label: '(None)', value: null }, ...epics.map((e: any) => ({
      label: `[${e.code}] ${e.title}`,
      value: e.id
    }))];

    const selectedEpic = await vscode.window.showQuickPick(epicOptions, {
      placeHolder: 'Select epic (optional)'
    });
    epicSelection = selectedEpic?.value ?? null;
  }

  await createTaskService(ws, {
    title,
    type,
    status: 'waiting',
    priority,
    backlog: backlog || 'features',
    epic: epicSelection
  });

  vscode.window.showInformationMessage(`Task "${title}" created.`);
};

// existing tasks dir helper moved to services/fileService

const SIDEBAR_VIEW_IDS = [
  "sprintdesk-sprints",
  "sprintdesk-backlogs",
  "sprintdesk-epics",
  "sprintdesk-tasks"
];

class SprintDeskSidebarProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext, private readonly viewId: string) { }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        this.context.extensionUri
      ]
    };
    webviewView.webview.html = getWebviewContent(this.context, webviewView.webview);
    if (this.viewId === 'sprintdesk-epics') {
      setTimeout(() => {
        webviewView.webview.postMessage({ type: 'showEpicsTree' });
      }, 500);
    }
  }
}

export async function activate(context: vscode.ExtensionContext) {
  // Initialize host boundary (VSCode host + synchronous file system)
  setHost(new VSCodeHost());
  setFileSystem(new NodeFileSystem());

  // Register existing commands (delegated to `src/commands`)
  registerOpenWebviewCommand(context);
  registerViewTasksCommand(context);
  registerViewTaskPreviewCommand(context);
  registerEditTaskRawCommand(context);
  registerViewBacklogsCommand(context);
  addMultipleTasksCommand(context);
  registerAddQuicklyCommand(context);
  registerViewProjectsCommand(context);
  registerViewProjectStructureCommand(context);
  registerViewEpicsCommand(context);

  // Register WebviewViewProviders for non-tree views
  const treeViewIds = ['sprintdesk-repositories', 'sprintdesk-epics', 'sprintdesk-tasks', 'sprintdesk-sprints', 'sprintdesk-backlogs'];
  const webviewIds = SIDEBAR_VIEW_IDS.filter(id => !treeViewIds.includes(id));

  for (const viewId of webviewIds) {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        viewId,
        new SprintDeskSidebarProvider(context, viewId)
      )
    );
  }

  // Tree providers
  const sprintsProvider = new SprintsTreeDataProvider();
  const backlogsProvider = new BacklogsTreeDataProvider();
  const repositoriesProvider = new RepositoriesTreeDataProvider();

const tasksProvider = new TasksTreeDataProvider();
  const epicsProvider = new EpicsTreeDataProvider();

  const teamProvider = teamTreeDataProvider;
  const historyProvider = historyTreeDataProvider;
  const workforceProvider = workforceTreeDataProvider;

  // Create and register sprints tree view with drag and drop support
  const sprintsTreeView = vscode.window.createTreeView('sprintdesk-sprints', {
    treeDataProvider: sprintsProvider,
    dragAndDropController: sprintsProvider
  });
  context.subscriptions.push(sprintsTreeView);

  const backlogsTreeView = vscode.window.createTreeView('sprintdesk-backlogs', {
    treeDataProvider: backlogsProvider,
    dragAndDropController: backlogsProvider
  });
  context.subscriptions.push(backlogsTreeView);

  const epicsTreeView = vscode.window.createTreeView('sprintdesk-epics', {
    treeDataProvider: epicsProvider,
    dragAndDropController: epicsProvider
  });
  context.subscriptions.push(epicsTreeView);

  const tasksTreeView = vscode.window.createTreeView('sprintdesk-tasks', {
    treeDataProvider: tasksProvider,
    dragAndDropController: tasksProvider
  });
  context.subscriptions.push(tasksTreeView);

const repositoriesTreeView = vscode.window.createTreeView('sprintdesk-repositories', {
    treeDataProvider: repositoriesProvider
  });
  context.subscriptions.push(repositoriesTreeView);

  const teamTreeView = vscode.window.createTreeView('sprintdesk-team', {
    treeDataProvider: teamProvider
  });
  context.subscriptions.push(teamTreeView);

  const workforceTreeView = vscode.window.createTreeView('sprintdesk-workforce', {
    treeDataProvider: workforceProvider
  });
  context.subscriptions.push(workforceTreeView);

  const historyTreeView = vscode.window.createTreeView('sprintdesk-history', {
    treeDataProvider: historyProvider
  });
  context.subscriptions.push(historyTreeView);

  // Register delegated commands (one file per command)
  registerAddTaskCommand(context, { repositoriesTreeView, createTask, tasksProvider, sprintsProvider });
  registerScanProjectStructureCommand(context);
  registerAddSprintCommand(context, { createSprintInteractive });
  registerAddEpicCommand(context, { createEpicInteractive, epicsProvider });
  registerAddExistingTasksToSprintCommand(context, { addExistingTasksToSprint });
  registerAddBacklogCommand(context, { createBacklogInteractive });
  registerAddTaskToBacklogCommand(context, { addTaskToBacklogInteractive });
  registerAddExistingTasksToBacklogCommand(context, { addExistingTasksToBacklog });
  registerAddTaskToEpicCommand(context, { epicsProvider, tasksProvider });

  // Register repository commands
  registerCreateTaskFromRepoCommand(context, { repositoriesTreeView, tasksProvider, sprintsProvider, epicsProvider, backlogsProvider });
  registerCreateEpicFromRepoCommand(context, { repositoriesTreeView, epicsProvider, tasksProvider, sprintsProvider, backlogsProvider });
  registerCreateSprintFromRepoCommand(context, { repositoriesTreeView, sprintsProvider, tasksProvider, epicsProvider, backlogsProvider });
  registerCreateBacklogFromRepoCommand(context, { repositoriesTreeView, backlogsProvider, tasksProvider, sprintsProvider, epicsProvider });
registerRefreshCommand(context, { sprintsProvider, backlogsProvider, repositoriesProvider, tasksProvider, epicsProvider, teamProvider, historyProvider, workforceProvider });
  registerStartFeatureFromTaskCommand(context, { startFeatureFromTask });
  registerOpenSprintFileCommand(context);
  registerShowSprintCalendarCommand(context);

  // Team and History commands
  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.viewTeam', async () => {
      teamProvider.refresh();
    }),
    vscode.commands.registerCommand('sprintdesk.syncTeamFromGit', async () => {
      const { syncTeamFromGit } = require('./services/team/teamService');
      const members = await syncTeamFromGit();
      vscode.window.showInformationMessage(`Team synced: ${members.length} members`);
      teamProvider.refresh();
    }),
    vscode.commands.registerCommand('sprintdesk.viewHistory', async () => {
      historyProvider.refresh();
    }),
    vscode.commands.registerCommand('sprintdesk.getItemHistory', async () => {
      const itemId = await vscode.window.showInputBox({ prompt: 'Enter item ID' });
      const itemType = await vscode.window.showQuickPick(['task', 'epic', 'sprint', 'backlog'], { placeHolder: 'Select item type' });
      if (itemId && itemType) {
        const { getHistoryForItem } = require('./services/history/historyService');
        const history = getHistoryForItem(itemId, itemType);
        vscode.window.showInformationMessage(`Found ${history.internal.length} internal and ${history.git.length} git entries`);
      }
    }),
vscode.commands.registerCommand('sprintdesk.runAgent', async (item: any) => {
      if (item?.member?.role === 'agent') {
        const { runAgentInteractive } = require('./services/agentRunner');
        await runAgentInteractive(item.member);
      } else {
        const agents = teamService.getAgents();
        if (agents.length > 0) {
          const selected = await vscode.window.showQuickPick(
            agents.map(a => ({ label: a.name, member: a })),
            { placeHolder: 'Select an agent to run' }
          );
          if (selected?.member) {
            const { runAgentInteractive } = require('./services/agentRunner');
            await runAgentInteractive(selected.member);
          }
        } else {
          vscode.window.showWarningMessage('No agents found. Add an agent first.');
        }
      }
    }),
    vscode.commands.registerCommand('sprintdesk.addAgent', async () => {
      const { addTeamMember } = require('./services/team/teamService');
      
      const name = await vscode.window.showInputBox({ prompt: 'Enter agent name (e.g., opencode, ollama)' });
      if (!name) return;

      const tool = await vscode.window.showQuickPick(
        ['opencode', 'ollama', 'claude-code', 'custom'],
        { placeHolder: 'Select agent tool' }
      );
      if (!tool) return;

      let agentConfig: any = { tool };
      
      if (tool === 'ollama') {
        const model = await vscode.window.showInputBox({ prompt: 'Enter model name (e.g., llama3, codellama)' });
        if (model) agentConfig.model = model;
      }
      
      if (tool === 'custom') {
        const command = await vscode.window.showInputBox({ 
          prompt: 'Enter custom command (use {task_path}, {task_dir}, {description} as placeholders)'
        });
        if (command) agentConfig.command = command;
      }

      try {
        const member = addTeamMember({
          name,
          email: `${name}@agent.local`,
          role: 'agent',
          agentConfig
        });
        teamProvider.refresh();
        vscode.window.showInformationMessage(`Agent ${name} added successfully!`);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to add agent: ${e.message}`);
      }
    })
  );

  // Workforce commands
  registerWorkforceCommands(context, workforceProvider);

// Settings commands
  registerOpenSettingsCommand(context);

  // MCP server - auto-start on extension load
  const { createMcpHttpTransport } = require('./mcp/httpServer');
  let mcpServer: any = null;

  const startMcpServer = () => {
    if (mcpServer) return;
    mcpServer = createMcpHttpTransport({
      onListen: (port: number) => {
        console.log(`🚀 MCP server running on port ${port}`);
        vscode.window.showInformationMessage(`🚀 MCP server running on port ${port}`);
      }
    });
  };
  
  // Start MCP server automatically
  startMcpServer();

  // Register MCP server definition for VS Code native MCP integration
  const didChangeEmitter = new vscode.EventEmitter<void>();
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider('sprintdesk-mcp', {
      onDidChangeMcpServerDefinitions: didChangeEmitter.event,
      provideMcpServerDefinitions: async () => {
        const serverDef = new vscode.McpHttpServerDefinition(
          'SprintDesk MCP',
          vscode.Uri.parse('http://localhost:3847/mcp'),
          {},
          '1.0.0'
        );
        return [serverDef];
      },
      resolveMcpServerDefinition: async (server) => {
        return server;
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sprintdesk.startMcp', async () => {
      if (mcpServer) {
        vscode.window.showInformationMessage('MCP server already running on port 3847');
        return;
      }
      startMcpServer();
    })
  );

  // When user selects a repository in the repositories tree, switch the Tasks provider to read from that repo
  repositoriesTreeView.onDidChangeSelection(e => {
    try {
      const sel = (e.selection && e.selection[0]) as any;
      // Try to read our repo path from the selection -- either 'fullPath' (our custom item) or resourceUri
      let selectedPath = sel?.fullPath ?? sel?.resourceUri?.fsPath;
      let repoPath: string | undefined = undefined;
      if (selectedPath) {
        const path = require('path');
        // If the selected path is a repo node or category, it already points to the repo root
        if (sel?.nodeType === 'repo' || sel?.nodeType === 'category') {
          repoPath = sel.fullPath || sel.resourceUri?.fsPath;
        } else {
          // File node selected: try to locate the repository root by trimming at the .SprintDesk segment
          const parts = String(selectedPath).split(path.sep);
          const sdIndex = parts.indexOf('.SprintDesk');
          if (sdIndex > 0) {
            repoPath = parts.slice(0, sdIndex).join(path.sep);
          } else {
            // fallback: assume parent 3 levels up (repo/.SprintDesk/<category>/file.md)
            repoPath = path.resolve(selectedPath, '..', '..', '..');
          }
        }
      }

      // If a repository is selected, set override; if selection is empty, clear override
      if (repoPath) {
        // Persist override to fileService so services also pick it up
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fileService = require('./services/fileService');
        fileService.setWorkspaceRootOverride(repoPath);

        // Update all providers that support setWorkspaceRoot
        try { (tasksProvider as any).setWorkspaceRoot(repoPath); } catch { }
        try { (backlogsProvider as any).setWorkspaceRoot(repoPath); } catch { }
        try { (epicsProvider as any).setWorkspaceRoot(repoPath); } catch { }
        try { (sprintsProvider as any).setWorkspaceRoot(repoPath); } catch { }
      } else {
        const fileService = require('./services/fileService');
        fileService.setWorkspaceRootOverride(undefined);
        try { (tasksProvider as any).setWorkspaceRoot(undefined); } catch { }
        try { (backlogsProvider as any).setWorkspaceRoot(undefined); } catch { }
        try { (epicsProvider as any).setWorkspaceRoot(undefined); } catch { }
        try { (sprintsProvider as any).setWorkspaceRoot(undefined); } catch { }
      }
    } catch (err) {
      console.error('Failed to switch tasks provider workspace root on repo selection', err);
    }
  });

  // === Ensure .SprintDesk folder structure on activation ===
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }

    const ws = workspaceFolders[0].uri.fsPath;
    const sdPath = path.join(ws, '.SprintDesk');

    // Ensure all directories exist
    const dirs = ['data', 'Tasks', 'Backlogs', 'Epics', 'Sprints', 'mcp'];
    for (const dir of dirs) {
      const fullPath = path.join(sdPath, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }

    // Ensure data files exist
    const dataFiles = ['tasks.yml', 'backlogs.yml', 'epics.yml', 'sprints.yml'];
    for (const file of dataFiles) {
      const dataPath = path.join(sdPath, 'data', file);
      if (!fs.existsSync(dataPath)) {
        const key = file.replace('.yml', '');
        fs.writeFileSync(dataPath, `${key}: []`, 'utf8');
      }
    }

// Ensure MCP files exist
    const mcpManifestPath = path.join(sdPath, 'mcp', 'manifest.json');
    const mcpManifest = {
      name: 'sprintdesk-mcp',
      version: '1.1.0',
      description: 'MCP server for SprintDesk task management - exposes CRUD, query, workflow, run, and workforce operations for AI agents',
      author: 'SprintDesk',
      repository: 'https://github.com/khmmamed/vscode-SprintDesk',
      homepage: 'https://github.com/khmmamed/vscode-SprintDesk',
      capabilities: { tools: true, resources: false },
      connection: {
        http: { url: 'http://localhost:3847/mcp', methods: ['POST'] },
        stdio: { command: 'npm run mcp', cwd: '<workspace-root>' }
      },
      tools: {
        task: ['sprintdesk_createTask', 'sprintdesk_getTask', 'sprintdesk_updateTask', 'sprintdesk_deleteTask', 'sprintdesk_listTasks', 'sprintdesk_searchTasks'],
        workflow: ['sprintdesk_tasksClaim', 'sprintdesk_tasksComplete', 'sprintdesk_tasksAssign', 'sprintdesk_tasksUnassign'],
        epic: ['sprintdesk_createEpic', 'sprintdesk_getEpic', 'sprintdesk_updateEpic', 'sprintdesk_deleteEpic', 'sprintdesk_listEpics', 'sprintdesk_getTasksByEpic', 'sprintdesk_addTaskToEpic'],
        sprint: ['sprintdesk_createSprint', 'sprintdesk_getSprint', 'sprintdesk_updateSprint', 'sprintdesk_deleteSprint', 'sprintdesk_listSprints', 'sprintdesk_getTasksBySprint', 'sprintdesk_addTaskToSprint'],
        backlog: ['sprintdesk_createBacklog', 'sprintdesk_getBacklog', 'sprintdesk_listBacklogs', 'sprintdesk_addTaskToBacklog'],
        move: ['sprintdesk_moveTaskToEpic', 'sprintdesk_moveTaskToSprint', 'sprintdesk_moveTaskToBacklog'],
        team: ['sprintdesk_listTeam', 'sprintdesk_syncTeamFromGit', 'sprintdesk_addTeamMember', 'sprintdesk_removeTeamMember', 'sprintdesk_runAgent'],
        workforce: ['sprintdesk_agentsList', 'sprintdesk_agentsGet'],
        run: ['sprintdesk_runsCreate', 'sprintdesk_runsList', 'sprintdesk_runsGet'],
        event: ['sprintdesk_eventsPublish', 'sprintdesk_eventsList'],
        audit: ['sprintdesk_auditList'],
        context: ['sprintdesk_projectContext'],
        history: ['sprintdesk_getHistory', 'sprintdesk_trackChange']
      },
      usage: {
        http_curl: "curl -X POST http://localhost:3847/mcp -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}'",
        http_call: "curl -X POST http://localhost:3847/mcp -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"sprintdesk_listTasks\",\"arguments\":{}}}'",
        stdio: 'cd <workspace> && npm run mcp'
      }
    };
    fs.writeFileSync(mcpManifestPath, JSON.stringify(mcpManifest, null, 2), 'utf8');

    const mcpReadmePath = path.join(sdPath, 'mcp', 'README.md');
    if (!fs.existsSync(mcpReadmePath)) {
      const readme = `# SprintDesk MCP Server

Local MCP server for integrating SprintDesk with AI agents like Copilot, Claude, etc.

## Available Tools

### Task Tools
- sprintdesk_createTask, sprintdesk_getTask, sprintdesk_updateTask, sprintdesk_deleteTask
- sprintdesk_listTasks, sprintdesk_searchTasks

### Epic Tools  
- sprintdesk_createEpic, sprintdesk_getEpic, sprintdesk_updateEpic, sprintdesk_deleteEpic
- sprintdesk_listEpics, sprintdesk_getTasksByEpic, sprintdesk_addTaskToEpic

### Sprint Tools
- sprintdesk_createSprint, sprintdesk_getSprint, sprintdesk_updateSprint, sprintdesk_deleteSprint
- sprintdesk_listSprints, sprintdesk_getTasksBySprint, sprintdesk_addTaskToSprint

### Backlog Tools
- sprintdesk_createBacklog, sprintdesk_getBacklog, sprintdesk_listBacklogs, sprintdesk_addTaskToBacklog

### Move Tools
- sprintdesk_moveTaskToEpic, sprintdesk_moveTaskToSprint, sprintdesk_moveTaskToBacklog

### Workflow Tools
- sprintdesk_tasksClaim, sprintdesk_tasksComplete, sprintdesk_tasksAssign, sprintdesk_tasksUnassign

### Workforce Tools
- sprintdesk_agentsList, sprintdesk_agentsGet, sprintdesk_runAgent

### Run Tools
- sprintdesk_runsCreate, sprintdesk_runsList, sprintdesk_runsGet

### Event & Audit Tools
- sprintdesk_eventsPublish, sprintdesk_eventsList, sprintdesk_auditList

### Context Tools
- sprintdesk_projectContext

## Usage

AI agents can discover and use these tools through the MCP protocol when this extension is active.
`;
      fs.writeFileSync(mcpReadmePath, readme, 'utf8');
    }

    vscode.window.showInformationMessage("📦 SprintDesk ready!");
  } catch (err) {
    console.error('Failed to create SprintDesk folder structure:', err);
  }
}

export function deactivate() { }