import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import * as workforceService from '../services/workforce/workforceService';
import { setFileSystem, setHost } from '../host';
import { NodeFileSystem } from '../host/NodeFileSystem';
import { IHost } from '../host/IHost';
import { handleRequest } from './core';

function createHost(workspaceRoot: string, config: Record<string, unknown> = {}): IHost {
  return {
    getWorkspaceRoot: () => workspaceRoot,
    getConfig: <T>(key: string, defaultValue?: T) => (config[key] === undefined ? defaultValue : config[key]) as T,
    showMessage: () => undefined,
    getGitUser: async () => undefined,
    execSync: () => ({ stdout: '', stderr: '' }),
    exec: async () => ({ stdout: '', stderr: '' }),
  };
}

function getRefreshSnapshot(response: any): Record<string, unknown> {
  return JSON.parse(response.result.content[0].text) as Record<string, unknown>;
}

function assertSingleTaskTemplateHeaders(markdown: string): void {
  const headingCounts = [
    /^# 🧩 Task:/gm,
    /^## 📋 Description$/gm,
    /^## ✅ Acceptance Criteria$/gm,
    /^## 📝 Notes$/gm,
  ].map(pattern => markdown.match(pattern)?.length ?? 0);
  assert.deepEqual(headingCounts, [1, 1, 1, 1]);
}

async function runMcpCoreTests(): Promise<void> {
  const workspace = join(process.cwd(), 'out', '.sprintdesk-mcp-test-workspace');
  const dataDirectory = join(workspace, '.SprintDesk', 'data');
  const workforceDirectory = join(workspace, '.SprintDesk', 'workforce');
  const tasksDirectory = join(workspace, '.SprintDesk', 'Tasks');
  const tasksPath = join(dataDirectory, 'tasks.yml');
  const backlogsPath = join(dataDirectory, 'backlogs.yml');
  const reviewersPath = join(dataDirectory, 'reviewers.yml');

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
    writeFileSync(
      join(dataDirectory, 'sprints.yml'),
      `sprints:
  - id: sprint-1
    number: 1
    title: Sprint 1
    name: sprint-1
    startDate: '2026-01-01'
    endDate: '2026-01-14'
    status: planned
    tasks: []
    createdAt: '2026-01-01T00:00:00.000Z'
    updatedAt: '2026-01-01T00:00:00.000Z'
`,
    );
    mkdirSync(tasksDirectory, { recursive: true });
    writeFileSync(
      join(tasksDirectory, '[SPD-1]_document-module.md'),
      `# 🧩 Task: Document module

## 📋 Description
Keep this description.

## ✅ Acceptance Criteria
- [ ] Verify the first criterion.
- Verify the second criterion
  across a wrapped line.

## 📝 Notes
Keep this note.
`,
    );
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
    assert.ok(toolNames.includes('sprintdesk_registerHumanReviewer'));
    assert.ok(toolNames.includes('sprintdesk_listHumanReviewers'));
    const updateTaskTool = toolsResponse.result.tools.find((tool: { name: string }) => tool.name === 'sprintdesk_updateTask');
    assert.ok(updateTaskTool.inputSchema.properties.status.enum.includes('under-review'));
    assert.ok(updateTaskTool.inputSchema.properties.humanVerification);

    const unauthorizedRegistration = await handleRequest({
      jsonrpc: '2.0',
      id: 16,
      method: 'tools/call',
      params: {
        name: 'sprintdesk_registerHumanReviewer',
        arguments: { reviewerId: 'reviewer-2', name: 'Second Reviewer' },
      },
    });
    assert.equal(unauthorizedRegistration.result.isError, true);
    assert.match(unauthorizedRegistration.result.content[0].text, /disabled/);

    setHost(createHost(workspace, { reviewerRegistrationEnabled: true }));
    const registrationResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 17,
      method: 'tools/call',
      params: {
        name: 'sprintdesk_registerHumanReviewer',
        arguments: { reviewerId: ' reviewer-2 ', name: ' Second Reviewer ' },
      },
    });
    const registeredReviewer = JSON.parse(registrationResponse.result.content[0].text);
    assert.equal(registeredReviewer.id, 'reviewer-2');
    assert.equal(registeredReviewer.name, 'Second Reviewer');
    assert.match(readFileSync(join(workforceDirectory, 'employees.yml'), 'utf8'), /id: reviewer-2/);
    // The registry is the shared persistence boundary and migrates the legacy human record once.
    assert.deepEqual(load(readFileSync(reviewersPath, 'utf8')), {
      reviewers: [{ id: 'reviewer-2', displayName: 'Second Reviewer' }],
    });
    // The pre-existing human employee is left untouched and gains no reviewer authority.
    assert.match(readFileSync(join(workforceDirectory, 'employees.yml'), 'utf8'), /id: reviewer-1/);
    assert.equal(workforceService.findHumanReviewer('reviewer-1'), undefined);

    const duplicateRegistration = await handleRequest({
      jsonrpc: '2.0',
      id: 18,
      method: 'tools/call',
      params: {
        name: 'sprintdesk_registerHumanReviewer',
        arguments: { reviewerId: 'reviewer-2', name: 'Second Reviewer' },
      },
    });
    assert.equal(duplicateRegistration.result.isError, true);
    assert.match(duplicateRegistration.result.content[0].text, /already registered/);

    const invalidRegistration = await handleRequest({
      jsonrpc: '2.0',
      id: 19,
      method: 'tools/call',
      params: {
        name: 'sprintdesk_registerHumanReviewer',
        arguments: { reviewerId: '', name: 'Invalid Reviewer' },
      },
    });
    assert.equal(invalidRegistration.result.isError, true);

    writeFileSync(reviewersPath, 'reviewers: []\n');
    const emptyListResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: { name: 'sprintdesk_listHumanReviewers', arguments: {} },
    });
    assert.equal(emptyListResponse.result.isError, undefined);
    assert.deepEqual(JSON.parse(emptyListResponse.result.content[0].text), []);
    writeFileSync(
      reviewersPath,
      `reviewers:
  - id: reviewer-2
    displayName: Second Reviewer
`,
    );

    const startedResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 38,
      method: 'tools/call',
      params: { name: 'sprintdesk_updateTask', arguments: { taskId: 'SPD-1', status: 'in-progress' } },
    });
    assert.equal(JSON.parse(startedResponse.result.content[0].text).status, 'in-progress');
    const submittedResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 39,
      method: 'tools/call',
      params: { name: 'sprintdesk_updateTask', arguments: { taskId: 'SPD-1', status: 'under-review' } },
    });
    const submittedTask = JSON.parse(submittedResponse.result.content[0].text);
    assert.equal(submittedTask.status, 'under-review');
    assert.equal(submittedTask.workStatus, undefined);
    assert.equal(submittedTask.review.criteria.length, 2);
    assert.equal(readFileSync(join(tasksDirectory, '[SPD-1]_document-module.md'), 'utf8').match(/### Review Handoff/g)?.length, 1);

    const completeResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'sprintdesk_tasksComplete', arguments: { taskId: 'SPD-1' } },
    });
    const underReviewTask = JSON.parse(completeResponse.result.content[0].text);
    assert.equal(underReviewTask.status, 'under-review');
    assert.equal(underReviewTask.workStatus, 'review');
    assert.equal(underReviewTask.review.summary, 'pending');
    assert.equal(underReviewTask.humanVerification, undefined);
    assert.deepEqual(underReviewTask.review.criteria.map((entry: { criterion: string }) => entry.criterion), [
      'Verify the first criterion.',
      'Verify the second criterion across a wrapped line.',
    ]);
    const taskOnePath = join(tasksDirectory, '[SPD-1]_document-module.md');
    const afterUnderReview = readFileSync(taskOnePath, 'utf8');
    assert.match(afterUnderReview, /### Review Handoff/);
    assert.match(afterUnderReview, /Verify the second criterion across a wrapped line\./);
    assert.equal(afterUnderReview.match(/### Review Handoff/g)?.length, 1);
    assertSingleTaskTemplateHeaders(afterUnderReview);
    assert.match(afterUnderReview, /Keep this description\./);
    assert.match(afterUnderReview, /Keep this note\./);

    const repeatedStatusResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: { name: 'sprintdesk_updateTask', arguments: { taskId: 'SPD-1', status: 'under-review' } },
    });
    const repeatedStatusTask = JSON.parse(repeatedStatusResponse.result.content[0].text);
    assert.equal(repeatedStatusTask.status, 'under-review');
    assert.equal(readFileSync(taskOnePath, 'utf8'), afterUnderReview);

    const rejectedReview = await handleRequest({
      jsonrpc: '2.0',
      id: 41,
      method: 'tools/call',
      params: {
        name: 'sprintdesk_updateTask',
        arguments: {
          taskId: 'SPD-1',
          review: {
            reviewerId: 'reviewer-404',
            criteria: [
              { criterion: 'Verify the first criterion.', result: 'met' },
              { criterion: 'Verify the second criterion across a wrapped line.', result: 'met' },
            ],
          },
        },
      },
    });
    assert.equal(rejectedReview.result.isError, true);
    const incompleteReview = await handleRequest({
      jsonrpc: '2.0',
      id: 46,
      method: 'tools/call',
      params: {
        name: 'sprintdesk_updateTask',
        arguments: {
          taskId: 'SPD-1',
          review: {
            reviewerId: 'reviewer-2',
            criteria: [{ criterion: 'Verify the first criterion.', result: 'met' }],
          },
        },
      },
    });
    assert.equal(incompleteReview.result.isError, true);
    const invalidResult = await handleRequest({
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/call',
      params: {
        name: 'sprintdesk_updateTask',
        arguments: {
          taskId: 'SPD-1',
          review: {
            reviewerId: 'reviewer-2',
            criteria: [
              { criterion: 'Verify the first criterion.', result: 'approved' },
              { criterion: 'Verify the second criterion across a wrapped line.', result: 'met' },
            ],
          },
        },
      },
    });
    assert.equal(invalidResult.result.isError, true);
    assert.equal(readFileSync(taskOnePath, 'utf8'), afterUnderReview);

    const reviewedResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 43,
      method: 'tools/call',
      params: {
        name: 'sprintdesk_updateTask',
        arguments: {
          taskId: 'SPD-1',
          review: {
            reviewerId: 'reviewer-2',
            criteria: [
              { criterion: 'Verify the first criterion.', result: 'met' },
              { criterion: 'Verify the second criterion across a wrapped line.', result: 'needs work' },
            ],
          },
        },
      },
    });
    assert.equal(reviewedResponse.result.isError, undefined);
    const reviewedTask = JSON.parse(reviewedResponse.result.content[0].text);
    assert.equal(reviewedTask.status, 'under-review');
    assert.equal(reviewedTask.review.summary, 'further work required');
    assert.equal(reviewedTask.review.reviewerId, 'reviewer-2');
    assert.match(reviewedTask.review.reviewedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    for (const entry of reviewedTask.review.criteria) {
      assert.equal(entry.reviewerId, 'reviewer-2');
      assert.match(entry.verifiedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    }
    const reviewReadback = await handleRequest({
      jsonrpc: '2.0', id: 44, method: 'tools/call',
      params: { name: 'sprintdesk_getTask', arguments: { taskId: 'SPD-1' } },
    });
    assert.deepEqual(JSON.parse(reviewReadback.result.content[0].text).review, reviewedTask.review);
    assert.match(readFileSync(taskOnePath, 'utf8'), /Summary: further work required/);
    assert.match(readFileSync(taskOnePath, 'utf8'), /Result: needs work/);

    const acceptedResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 45,
      method: 'tools/call',
      params: {
        name: 'sprintdesk_updateTask',
        arguments: {
          taskId: 'SPD-1',
          review: {
            reviewerId: 'reviewer-2',
            criteria: reviewedTask.review.criteria.map((entry: { criterion: string }) => ({
              criterion: entry.criterion, result: 'met',
            })),
          },
        },
      },
    });
    assert.equal(JSON.parse(acceptedResponse.result.content[0].text).review.summary, 'accepted');
    assert.equal(JSON.parse(acceptedResponse.result.content[0].text).status, 'under-review');
    const afterAccepted = readFileSync(taskOnePath, 'utf8');
    assert.equal(afterAccepted.match(/### Review Handoff/g)?.length, 1);

    const missingReviewResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'sprintdesk_updateTask', arguments: { taskId: 'SPD-1', status: 'done' } },
    });
    assert.equal(missingReviewResponse.result.isError, true);
    assert.match(missingReviewResponse.result.content[0].text, /human verification/);

    const registryBeforeUnknownReviewer = readFileSync(reviewersPath, 'utf8');
    const unknownReviewerResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: {
        name: 'sprintdesk_updateTask',
        arguments: { taskId: 'SPD-1', status: 'done', humanVerification: { reviewerId: 'reviewer-404' } },
      },
    });
    assert.equal(unknownReviewerResponse.result.isError, true);
    assert.match(unknownReviewerResponse.result.content[0].text, /human verification/);
    assert.equal(readFileSync(reviewersPath, 'utf8'), registryBeforeUnknownReviewer);
    assert.equal(JSON.parse(
      (await handleRequest({
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/call',
        params: { name: 'sprintdesk_getTask', arguments: { taskId: 'SPD-1' } },
      })).result.content[0].text,
    ).status, 'under-review');

    // A human employee that was never registered as a reviewer cannot verify a task.
    const employeeReviewerResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: {
        name: 'sprintdesk_updateTask',
        arguments: { taskId: 'SPD-1', status: 'done', humanVerification: { reviewerId: 'reviewer-1' } },
      },
    });
    assert.equal(employeeReviewerResponse.result.isError, true);
    assert.match(employeeReviewerResponse.result.content[0].text, /human verification/);
    assert.equal(readFileSync(reviewersPath, 'utf8'), registryBeforeUnknownReviewer);


    const doneResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'sprintdesk_updateTask',
        arguments: {
          taskId: 'SPD-1',
          status: 'done',
          humanVerification: { reviewerId: 'reviewer-2', notes: 'Reviewed and approved.' },
        },
      },
    });
    const doneTask = JSON.parse(doneResponse.result.content[0].text);
    assert.equal(doneTask.status, 'done');
    assert.equal(doneTask.workStatus, 'done');
    assert.deepEqual(doneTask.humanVerification, {
      reviewerId: 'reviewer-2',
      reviewerName: 'Second Reviewer',
      approvedAt: doneTask.humanVerification.approvedAt,
      notes: 'Reviewed and approved.',
    });
    const afterDone = readFileSync(taskOnePath, 'utf8');
    assert.equal(afterDone, afterAccepted);

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
      sprints: 1,
      backlogs: 1,
      runs: 0,
      events: 0,
      employees: 2,
      reviewers: 1,
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
      sprints: 1,
      backlogs: 1,
      runs: 0,
      events: 0,
      employees: 2,
      reviewers: 1,
    });
    assert.equal(refreshCalls, 1);

    writeFileSync(
      join(tasksDirectory, '[SPD-2]_document-package.md'),
      `# 🧩 Task: Document package

## ✅ Acceptance Criteria
- [ ] Keep this criterion.
`,
    );
    const addCompleteTaskToSprintResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'sprintdesk_addTaskToSprint', arguments: { sprintId: 'sprint-1', taskId: 'SPD-1' } },
    });
    assert.match(addCompleteTaskToSprintResponse.result.content[0].text, /added to sprint/);
    const afterFirstAssignment = readFileSync(taskOnePath, 'utf8');
    assert.equal(afterFirstAssignment, afterDone);

    const repeatAssignmentResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'sprintdesk_addTaskToSprint', arguments: { sprintId: 'sprint-1', taskId: 'SPD-1' } },
    });
    assert.match(repeatAssignmentResponse.result.content[0].text, /added to sprint/);
    assert.equal(readFileSync(taskOnePath, 'utf8'), afterFirstAssignment);

    const addIncompleteTaskToSprintResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'sprintdesk_addTaskToSprint', arguments: { sprintId: 'sprint-1', taskId: 'SPD-2' } },
    });
    assert.match(addIncompleteTaskToSprintResponse.result.content[0].text, /added to sprint/);
    const taskTwoPath = join(tasksDirectory, '[SPD-2]_document-package.md');
    const afterIncompleteAssignment = readFileSync(taskTwoPath, 'utf8');
    assertSingleTaskTemplateHeaders(afterIncompleteAssignment);
    assert.match(afterIncompleteAssignment, /- \[ \] Keep this criterion\./);

    const repeatIncompleteAssignmentResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'sprintdesk_addTaskToSprint', arguments: { sprintId: 'sprint-1', taskId: 'SPD-2' } },
    });
    assert.match(repeatIncompleteAssignmentResponse.result.content[0].text, /added to sprint/);
    assert.equal(readFileSync(taskTwoPath, 'utf8'), afterIncompleteAssignment);

    writeFileSync(
      tasksPath,
      `${readFileSync(tasksPath, 'utf8')}  - id: task-3
    number: 3
    code: SPD-3
    name: document-empty
    title: Document empty
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
    const taskThreePath = join(tasksDirectory, '[SPD-3]_document-empty.md');
    const emptyTaskTemplate = `# 🧩 Task: Document empty

## 📋 Description

## ✅ Acceptance Criteria

## 📝 Notes
`;
    writeFileSync(taskThreePath, emptyTaskTemplate);
    const emptyStatusResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: { name: 'sprintdesk_updateTask', arguments: { taskId: 'SPD-3', status: 'waiting' } },
    });
    const emptyStatusTask = JSON.parse(emptyStatusResponse.result.content[0].text);
    assert.equal(emptyStatusTask.status, 'waiting');
    assert.equal(readFileSync(taskThreePath, 'utf8'), emptyTaskTemplate);

    const repeatedEmptyStatusResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 15,
      method: 'tools/call',
      params: { name: 'sprintdesk_updateTask', arguments: { taskId: 'SPD-3', status: 'waiting' } },
    });
    const repeatedEmptyStatusTask = JSON.parse(repeatedEmptyStatusResponse.result.content[0].text);
    assert.equal(repeatedEmptyStatusTask.status, 'waiting');
    assert.equal(readFileSync(taskThreePath, 'utf8'), emptyTaskTemplate);

    // Registering that employee as a reviewer reuses its record without repurposing it.
    const employeesBeforePromotion = readFileSync(join(workforceDirectory, 'employees.yml'), 'utf8');
    const promotionResponse = await handleRequest({
      jsonrpc: '2.0',
      id: 23,
      method: 'tools/call',
      params: {
        name: 'sprintdesk_registerHumanReviewer',
        arguments: { reviewerId: 'reviewer-1', name: 'Human Reviewer' },
      },
    });
    const promotedReviewer = JSON.parse(promotionResponse.result.content[0].text);
    assert.equal(promotedReviewer.id, 'reviewer-1');
    assert.equal(promotedReviewer.name, 'Human Reviewer');
    assert.equal(readFileSync(join(workforceDirectory, 'employees.yml'), 'utf8'), employeesBeforePromotion);
    assert.deepEqual(load(readFileSync(reviewersPath, 'utf8')), {
      reviewers: [
        { id: 'reviewer-2', displayName: 'Second Reviewer' },
        { id: 'reviewer-1', displayName: 'Human Reviewer' },
      ],
    });
    assert.equal(workforceService.findHumanReviewer('reviewer-1')?.displayName, 'Human Reviewer');

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
