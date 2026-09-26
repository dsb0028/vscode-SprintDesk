import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { TeamMember, AgentConfig, Task } from '../data/types';
import { getDataService } from '../data/DataService';
import { getWorkspaceRoot } from '../services/fileService';

export interface AgentRunResult {
  success: boolean;
  branch: string;
  commitHash?: string;
  prUrl?: string;
  output?: string;
  error?: string;
}

const GITHUB_PR_URL_REGEX = /https:\/\/github\.com\/[\w\-]+\/[\w\-]+\/pull\/(\d+)/;

async function execCommand(command: string, cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec(command, { cwd }, (err: Error | null, stdout: string, stderr: string) => {
      resolve({ stdout, stderr, code: err ? 1 : 0 });
    });
  });
}

export async function getTasksAssignedToAgent(agent: TeamMember): Promise<Task[]> {
  const wsRoot = getWorkspaceRoot();
  if (!wsRoot) return [];

  const dataService = getDataService(wsRoot);
  const tasks = dataService.loadTasks();
  
  return tasks.filter(t => t.assignee === agent.name);
}

export async function pickTaskForAgent(agent: TeamMember): Promise<Task | undefined> {
  const tasks = await getTasksAssignedToAgent(agent);
  
  if (tasks.length === 0) {
    vscode.window.showWarningMessage(`No tasks assigned to ${agent.name}`);
    return undefined;
  }

  const items = tasks.map(t => ({
    label: `${t.code}: ${t.title}`,
    description: `Status: ${t.status}`,
    detail: t.path,
    task: t
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a task for the agent to work on'
  });

  return selected?.task;
}

function sanitizeBranchName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function buildAgentCommand(config: AgentConfig, taskPath: string, taskDescription: string): { command: string; args: string[] } {
  const taskDir = taskPath && taskPath !== 'undefined' ? path.dirname(taskPath) : process.cwd();
  const taskFile = path.basename(taskPath);

  switch (config.tool) {
    case 'opencode': {
      const fullPrompt = `Task: ${taskDescription}`;
      return { command: 'opencode', args: ['-c', '--prompt', fullPrompt, taskDir] };
    }
    case 'ollama': {
      const model = config.model || 'llama3';
      const prompt = `Task: ${taskDescription}\n\nWork on this task in directory: ${taskDir}`;
      return { command: 'ollama', args: ['run', model, prompt] };
    }
    case 'claude-code': {
      const taskArg = `--task="${taskPath}"`;
      return { command: 'claude', args: ['code', taskArg] };
    }
    case 'custom': {
      const cmd = (config.command || '')
        .replace(/\{task_path\}/g, taskPath || '')
        .replace(/\{task_dir\}/g, taskDir)
        .replace(/\{task_file\}/g, taskFile)
        .replace(/\{description\}/g, taskDescription);
      const parts = cmd.split(' ');
      return { command: parts[0], args: parts.slice(1) };
    }
    default:
      return { command: '', args: [] };
  }
}

async function getCurrentBranch(): Promise<string> {
  const wsRoot = getWorkspaceRoot();
  if (!wsRoot) return '';
  
  try {
    const { execSync } = require('child_process');
    return execSync('git branch --show-current', { cwd: wsRoot, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

async function checkoutBranch(branchName: string): Promise<boolean> {
  const wsRoot = getWorkspaceRoot();
  if (!wsRoot) return false;

  const { stdout } = await execCommand(`git checkout -b ${branchName}`, wsRoot);
  return stdout.includes(branchName) || stdout.includes('Switched to new branch');
}

async function commitChanges(message: string): Promise<string | undefined> {
  const wsRoot = getWorkspaceRoot();
  if (!wsRoot) return undefined;

  try {
    await execCommand('git add -A', wsRoot);
    const { stdout } = await execCommand(`git commit -m "${message}"`, wsRoot);
    
    const hashResult = await execCommand('git rev-parse HEAD', wsRoot);
    return hashResult.stdout.trim();
  } catch {
    return undefined;
  }
}

async function createPullRequest(title: string, body?: string): Promise<string | undefined> {
  const wsRoot = getWorkspaceRoot();
  if (!wsRoot) return undefined;

  try {
    const { stdout } = await execCommand(
      `git push -u origin ${await getCurrentBranch()}`,
      wsRoot
    );

    const { execSync } = require('child_process');
    const prCmd = `gh pr create --title "${title}" ${body ? `--body "${body}"` : ''} --fill`;
    const prOutput = execSync(prCmd, { cwd: wsRoot, encoding: 'utf8' }).trim();
    
    return prOutput || `PR created for branch ${await getCurrentBranch()}`;
  } catch {
    try {
      const branch = await getCurrentBranch();
      return `Branch pushed: ${branch}. Create PR manually.`;
    } catch {
      return undefined;
    }
  }
}

export async function runAgent(agent: TeamMember, task: Task): Promise<AgentRunResult> {
  const wsRoot = getWorkspaceRoot();
  if (!wsRoot) {
    return { success: false, branch: '', error: 'No workspace found' };
  }

  if (!agent.agentConfig) {
    return { success: false, branch: '', error: 'Agent not configured' };
  }

  const branchName = `agent/${sanitizeBranchName(agent.name)}/${task.code}`;
  const commitMessage = `Agent ${agent.name}: ${task.title}`;

  try {
    vscode.window.showInformationMessage(`Starting agent ${agent.name} on task ${task.code}...`);

    const currentBranch = await getCurrentBranch();
    await checkoutBranch(branchName);

    const taskDescription = task.title;
    const { command, args } = buildAgentCommand(agent.agentConfig, task.path || '', taskDescription);

    if (!command) {
      return { success: false, branch: branchName, error: 'Invalid agent configuration' };
    }

    const terminal = vscode.window.createTerminal({
      name: `Agent: ${agent.name}`,
      cwd: wsRoot
    });
    terminal.show();
    terminal.sendText([command, ...args].join(' '));

    vscode.window.showInformationMessage('Agent started in terminal. Check the terminal for progress.');

    const commitHash = await commitChanges(commitMessage);
    const prUrl = await createPullRequest(commitMessage, `Task: ${task.code}\nAssignee: ${agent.name}`);

    vscode.window.showInformationMessage(`Agent ${agent.name} completed! PR: ${prUrl}`);

    return {
      success: true,
      branch: branchName,
      commitHash,
      prUrl,
      output: 'Agent started in terminal'
    };
  } catch (error: any) {
    return {
      success: false,
      branch: branchName,
      error: error.message
    };
  }
}

export async function runAgentInteractive(agent: TeamMember): Promise<AgentRunResult | undefined> {
  const task = await pickTaskForAgent(agent);
  
  if (!task) {
    return undefined;
  }

  const proceed = await vscode.window.showInformationMessage(
    `Run agent ${agent.name} on task ${task.code}: ${task.title}?`,
    { modal: true },
    'Run',
    'Cancel'
  );

  if (proceed !== 'Run') {
    return undefined;
  }

  return runAgent(agent, task);
}