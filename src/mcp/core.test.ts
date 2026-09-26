import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFileSystem, setHost } from '../host';
import { NodeFileSystem } from '../host/NodeFileSystem';
import { IHost } from '../host/IHost';
import { handleRequest } from './core';

function createHost(workspaceRoot: string): IHost {
  return {
    getWorkspaceRoot: () => workspaceRoot,
    getConfig: <T>(_key: string, defaultValue?: T) => defaultValue as T,
    showMessage: () => undefined,
    getGitUser: async () => undefined,
    execSync: () => ({ stdout: '', stderr: '' }),
    exec: async () => ({ stdout: '', stderr: '' }),
  };
}

function getRefreshSnapshot(response: any): Record<string, unknown> {
  return JSON.parse(response.result.content[0].text) as Record<string, unknown>;
}

async function runMcpCoreTests(): Promise<void> {
  const workspace = join(process.cwd(), 'out', '.sprintdesk-mcp-test-workspace');
  const dataDirectory = join(workspace, '.SprintDesk', 'data');
  const workforceDirectory = join(workspace, '.SprintDesk', 'workforce');
  const tasksPath = join(dataDirectory, 'tasks.yml');
  const backlogsPath = join(dataDirectory, 'backlogs.yml');

  try {
    rmSync(workspace, { recursive: true, force: true });
    setHost(createHost(workspace));
    setFileSystem(new NodeFileSystem());
    mkdirSync(dataDirectory, { recursive: true });
    writeFileSync(
      tasksPath,
      `tasks:
  - id: task-1
    number: 1
    code: SPD-1
    name: document-module
    title: Document module
    type: doc
    status: waiting
    priority: high
    epic: null
    backlog: technical
    sprint: null
    createdAt: '2026-01-01T00:00:00.000Z'
    updatedAt: '2026-01-01T00:00:00.000Z'
`,
    );
    writeFileSync(
      backlogsPath,
      `backlogs:
  - id: technical
    title: TECHNICAL
    name: technical
    description: ''
    tasks:
      - task-1
    color: '#2563eb'
`,
    );
    writeFileSync(join(dataDirectory, 'epics.yml'), 'epics: []\n');
    writeFileSync(join(dataDirectory, 'sprints.yml'), 'sprints: []\n');
    mkdirSync(workforceDirectory, { recursive: true });
    writeFileSync(
      join(workforceDirectory, 'employees.yml'),
      `employees:
  - id: reviewer-1
    name: Human Reviewer
    role: human
    createdAt: '2026-01-01T00:00:00.000Z'
    updatedAt: '2026-01-01T00:00:00.000Z'
`,
    );

    const toolsResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    const toolNames = toolsResponse.result.tools.map((tool: { name: string }) => tool.name);
    assert.ok(toolNames.includes('sprintdesk_refresh'));
    const updateTaskTool = toolsResponse.result.tools.find((tool: { name: string }) => tool.name === 'sprintdesk_updateTask');
    assert.ok(updateTaskTool.inputSchema.properties.status.enum.includes('under-review'));
    assert.ok(updateTaskTool.inputSchema.properties.humanVerification);

    const completeResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'sprintdesk_tasksComplete', arguments: { taskId: 'SPD-1' } },
    });
    const underReviewTask = JSON.parse(completeResponse.result.content[0].text);
    assert.equal(underReviewTask.status, 'under-review');
    assert.equal(underReviewTask.workStatus, 'review');

    const missingReviewResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'sprintdesk_updateTask', arguments: { taskId: 'SPD-1', status: 'done' } },
    });
    assert.equal(missingReviewResponse.result.isError, true);
    assert.match(missingReviewResponse.result.content[0].text, /human verification/);

    const doneResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'sprintdesk_updateTask',
        arguments: {
          taskId: 'SPD-1',
          status: 'done',
          humanVerification: { reviewerId: 'reviewer-1', notes: 'Reviewed and approved.' },
        },
      },
    });
    const doneTask = JSON.parse(doneResponse.result.content[0].text);
    assert.equal(doneTask.status, 'done');
    assert.equal(doneTask.workStatus, 'done');
    assert.deepEqual(doneTask.humanVerification, {
      reviewerId: 'reviewer-1',
      reviewerName: 'Human Reviewer',
      approvedAt: doneTask.humanVerification.approvedAt,
      notes: 'Reviewed and approved.',
    });

    const beforeRefresh = readFileSync(tasksPath, 'utf8');
    let refreshCalls = 0;
    const httpResponse = await handleRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'sprintdesk_refresh', arguments: {} },
      },
      {
        refreshUi: async () => {
          refreshCalls += 1;
        },
      },
    );
    const httpSnapshot = getRefreshSnapshot(httpResponse);
    assert.equal(refreshCalls, 1);
    assert.equal(typeof httpSnapshot.refreshedAt, 'string');
    assert.deepEqual(httpSnapshot.counts, {
      tasks: 1,
      epics: 0,
      sprints: 0,
      backlogs: 1,
      runs: 0,
      events: 0,
      employees: 1,
    });
    assert.deepEqual(httpSnapshot.backlogTaskCounts, [
      { id: 'technical', title: 'TECHNICAL', taskCount: 1 },
    ]);
    assert.equal(readFileSync(tasksPath, 'utf8'), beforeRefresh);

    writeFileSync(
      tasksPath,
      `${beforeRefresh}  - id: task-2
    number: 2
    code: SPD-2
    name: document-package
    title: Document package
    type: doc
    status: waiting
    priority: high
    epic: null
    backlog: technical
    sprint: null
    createdAt: '2026-01-01T00:00:00.000Z'
    updatedAt: '2026-01-01T00:00:00.000Z'
`,
    );
    writeFileSync(
      backlogsPath,
      readFileSync(backlogsPath, 'utf8').replace(
        '      - task-1\n',
        '      - task-1\n      - task-2\n',
      ),
    );
    const stdioResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'sprintdesk_refresh', arguments: {} },
    });
    const stdioSnapshot = getRefreshSnapshot(stdioResponse);
    assert.equal(typeof stdioSnapshot.refreshedAt, 'string');
    assert.deepEqual(stdioSnapshot.counts, {
      tasks: 2,
      epics: 0,
      sprints: 0,
      backlogs: 1,
      runs: 0,
      events: 0,
      employees: 1,
    });
    assert.equal(refreshCalls, 1);

    const errorResult = await handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'sprintdesk_notRegistered', arguments: {} },
    });
    assert.equal(errorResult.result.isError, true);

    const failedUiRefresh = await handleRequest(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'sprintdesk_refresh', arguments: {} },
      },
      {
        refreshUi: async () => {
          throw new Error('UI refresh failed');
        },
      },
    );
    assert.equal(failedUiRefresh.error.message, 'UI refresh failed');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

runMcpCoreTests()
  .then(() => console.log('MCP core tests passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
