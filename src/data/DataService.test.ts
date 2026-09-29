import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFileSystem, setHost } from '../host';
import { NodeFileSystem } from '../host/NodeFileSystem';
import { IHost } from '../host/IHost';
import { DataService } from './DataService';
import { Task } from './types';

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

function createTask(): Task {
  return {
    id: 'task-1',
    number: 1,
    code: 'SPD-1',
    name: '[SPD-1]_preserve-task-content',
    title: 'Preserve task content',
    type: 'bug',
    status: 'waiting',
    priority: 'medium',
    epic: null,
    backlog: 'bugs',
    sprint: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function taskHeadings(markdown: string): string[] {
  const headings: string[] = [];
  let fencedCodeDelimiter: string | undefined;

  for (const line of markdown.split('\n')) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const delimiter = fenceMatch[1][0];
      fencedCodeDelimiter = fencedCodeDelimiter === delimiter ? undefined : delimiter;
      continue;
    }
    if (!fencedCodeDelimiter && /^# 🧩 Task:|^## (?:📋 Description|✅ Acceptance Criteria|📝 Notes)$/.test(line)) {
      headings.push(line);
    }
  }

  return headings;
}

function assertCanonicalHeadings(markdown: string): void {
  assert.deepEqual(taskHeadings(markdown), [
    '# 🧩 Task: Preserve task content',
    '## 📋 Description',
    '## ✅ Acceptance Criteria',
    '## 📝 Notes',
  ]);
}

async function runDataServiceTests(): Promise<void> {
  const workspace = join(process.cwd(), 'out', '.data-service-test-workspace');
  const tasksDirectory = join(workspace, '.SprintDesk', 'Tasks');
  const task = createTask();

  try {
    rmSync(workspace, { recursive: true, force: true });
    mkdirSync(tasksDirectory, { recursive: true });
    setHost(createHost(workspace));
    setFileSystem(new NodeFileSystem());

    const service = new DataService(workspace);
    const taskPath = join(tasksDirectory, service.getTaskFilename(task));

    service.saveTaskMd(task);
    const generated = readFileSync(taskPath, 'utf8');
    assertCanonicalHeadings(generated);

    const completeTask = [
      '# 🧩 Task: Preserve task content',
      '',
      '## 📋 Description',
      'A user-authored description.',
      '',
      '## ✅ Acceptance Criteria',
      '- [ ] Keep this criterion.',
      '',
      '## 📝 Notes',
      'Keep this note exactly.',
      '',
    ].join('\n');
    writeFileSync(taskPath, completeTask);
    service.saveTaskMd(task);
    assert.equal(readFileSync(taskPath, 'utf8'), completeTask);

    const incompleteCases = [
      {
        name: 'missing beginning header',
        markdown: [
          '# 🧩 Task: Preserve task content',
          '',
          '## ✅ Acceptance Criteria',
          '- [ ] Existing acceptance criterion.',
          '',
          '## 📝 Notes',
          'Existing note.',
          '',
        ].join('\n'),
        preservedText: ['- [ ] Existing acceptance criterion.', 'Existing note.'],
      },
      {
        name: 'missing middle header',
        markdown: [
          '# 🧩 Task: Preserve task content',
          '',
          '## 📋 Description',
          'Existing description.',
          '',
          '## 📝 Notes',
          'Existing note.',
          '',
        ].join('\n'),
        preservedText: ['Existing description.', 'Existing note.'],
      },
      {
        name: 'missing ending header',
        markdown: [
          '# 🧩 Task: Preserve task content',
          '',
          '## 📋 Description',
          'Existing description.',
          '',
          '## ✅ Acceptance Criteria',
          '- [ ] Existing acceptance criterion.',
          '',
        ].join('\n'),
        preservedText: ['Existing description.', '- [ ] Existing acceptance criterion.'],
      },
      {
        name: 'multiple missing headers',
        markdown: [
          '# 🧩 Task: Preserve task content',
          '',
          '## ✅ Acceptance Criteria',
          '- [ ] Existing acceptance criterion.',
          '',
        ].join('\n'),
        preservedText: ['- [ ] Existing acceptance criterion.'],
      },
    ];

    for (const testCase of incompleteCases) {
      writeFileSync(taskPath, testCase.markdown);
      service.saveTaskMd(task);
      const completed = readFileSync(taskPath, 'utf8');
      assertCanonicalHeadings(completed);
      for (const preservedText of testCase.preservedText) {
        assert.ok(completed.includes(preservedText), testCase.name);
      }

      service.saveTaskMd(task);
      assert.equal(readFileSync(taskPath, 'utf8'), completed, `${testCase.name} is idempotent`);
    }

    const emptyFields = [
      '# 🧩 Task: Preserve task content',
      '',
      '## 📋 Description',
      '',
      '## ✅ Acceptance Criteria',
      '',
      '## 📝 Notes',
      '',
    ].join('\n');
    writeFileSync(taskPath, emptyFields);
    service.saveTaskMd(task);
    assert.equal(readFileSync(taskPath, 'utf8'), emptyFields);

    const incidentalMentions = [
      '# 🧩 Task: Preserve task content',
      '',
      '## 📋 Description',
      'Example heading: ## ✅ Acceptance Criteria',
      '> ## 📝 Notes',
      '```md',
      '## ✅ Acceptance Criteria',
      '## 📝 Notes',
      '```',
      '',
    ].join('\n');
    writeFileSync(taskPath, incidentalMentions);
    service.saveTaskMd(task);
    const completedIncidentalMentions = readFileSync(taskPath, 'utf8');
    assertCanonicalHeadings(completedIncidentalMentions);
    assert.ok(completedIncidentalMentions.includes('Example heading: ## ✅ Acceptance Criteria'));
    assert.ok(completedIncidentalMentions.includes('> ## 📝 Notes'));

    const noTemplate = 'User-authored preface with no task metadata headings.\n';
    writeFileSync(taskPath, noTemplate);
    service.saveTaskMd(task);
    const initialized = readFileSync(taskPath, 'utf8');
    assertCanonicalHeadings(initialized);
    assert.ok(initialized.includes(noTemplate));
    service.saveTaskMd(task);
    assert.equal(readFileSync(taskPath, 'utf8'), initialized);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

runDataServiceTests()
  .then(() => console.log('DataService tests passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
