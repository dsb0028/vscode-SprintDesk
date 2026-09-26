import { PROJECT_CONSTANTS, TASK_CONSTANTS, UI_CONSTANTS } from './constant';
import { generateEpicName } from './epicTemplate';

export function generateTaskId(title: string): string {
  const slug = title.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_]/g, '').toLowerCase();
  return `tsk_${slug}`;
}
export function generateEpicId(title: string): string {
  const slug = title.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_]/g, '').toLowerCase();
  return `epic_${slug}`;
}
export function getTaskName(title: string): string {
  const taskSlug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  // Avoid depending on workspace/server state in webview utilities — use stable prefix
  return `${PROJECT_CONSTANTS.FILE_PREFIX.TASK}${taskSlug}`;
}
export function generateTaskFile(title: string, epicTitle?: string): string {
  return `${getTaskName(title)}.md`;
}
export const generateTaskMetadata = (metadata: SprintDesk.TaskMetadata): string => {
  const now = new Date().toISOString();

  return `---
_id: ${metadata._id}
title: ${metadata.title.toLowerCase().replace(/\s+/g, '-')}
type: ${metadata.type || 'feature'}
category: ${metadata.category || 'uncategorized'}
component: ${metadata.component || 'general'}
duration: ${metadata.duration || '0d'}
priority: ${metadata.priority || 'medium'}
status: ${metadata.status || 'waiting'}
assignee: ${metadata.assignee || 'unassigned'}
created_at: ${now}
updated_at: ${now}
objective: ${metadata.objective || 'Add task objective here...'}
path: ${metadata.path}
sprints: 
backlogs: 
related_tasks: 
tags: 
---`
};
export const generateTaskContent = (metadata: SprintDesk.TaskMetadata): string => {
  const now = new Date().toISOString();
  return `
# 🧩 Task: ${metadata.title}
${metadata.epic?.title ? `📘 Epic: \`${metadata.epic.title}\`` : ''}


## 🗂️ Overview
| Field | Value |
|:--|:--|
| 🧠 **Type** | ${metadata.type || 'Feature'} |
| 🧩 **Category** | ${metadata.category || 'Uncategorized'} |
| ⚙️ **Component** | ${metadata.component || 'General'} |
| ⏱️ **Duration** | ${metadata.duration || '0d'} |
| 🚦 **Priority** | ${metadata.priority || '🟡 Medium'} |
| 📊 **Status** | ${metadata.status || '⏳ Not Started'} |
| 👤 **Assignee** | ${metadata.assignee || 'Unassigned'} |
| 🕓 **Created At** | ${now} |
| 🔄 **Updated At** | ${now} |
| 🎯 **Objective** | ${metadata.objective || 'Add task objective here...'} |
${metadata.epic?.title ? `| 📘 **Epic** | ${metadata.epic.title} |` : ''}


## 🧱 Description
Add task description here...


## ✅ Acceptance Criteria
- [ ] Criterion 1


## 📋 Checklist
- [ ] Task 1

## 🧠 Notes
> Add implementation notes here...
${metadata.epic?.title ? `
## 🚩 Epic
- [${metadata.epic.title}](${metadata.epic.path || '../' + PROJECT_CONSTANTS.EPICS_DIR + '/' + generateEpicName(metadata.epic.title)})
` : ''}

## ⏱️ Sprints
> Sprints will be linked here automatically

## 📋 Backlogs
> Backlogs will be linked here automatically

## 🔗 Related Tasks
> Related tasks will be linked here automatically
 `;
};
// Update epic line after task header
export const updateEpicHeaderLine = (ls: string[], epicMeta: SprintDesk.EpicMetadata): string[] => {
  const taskHeaderIdx = ls.findIndex(l => l.trim().startsWith('# 🧩 Task'));
  if (taskHeaderIdx === -1) return [`📘 Epic: \`${epicMeta.title}\``, ...ls];

  const afterTask = taskHeaderIdx + 1;
  return ls.map((line, i) =>
    i === afterTask && line.trim().startsWith('📘 Epic:')
      ? `📘 Epic: \`${epicMeta.title}\``
      : i === afterTask && !line.trim().startsWith('📘 Epic:')
        ? [line, `📘 Epic: \`${epicMeta.title}\``]
        : line
  ).flat();
};

// Update epic section
export const updateEpicSection = (
  ls: string[], 
  epicMeta: SprintDesk.EpicMetadata
): string[] => {
  const sectionHeader = TASK_CONSTANTS.EPIC_SECTION; // "## 🗂 Epics"
  const tableHeader = TASK_CONSTANTS.EPIC_TABLE_HEADER; // "| # | Epic | Status | Priority | File |"
  const tableRows = TASK_CONSTANTS.EPIC_TABLE_ROW(epicMeta); // rows from metadata

  const secIdx = ls.findIndex(l => l.trim() === sectionHeader);

  if (secIdx === -1) {
    // If no Epic section exists, append section + header + rows
    return [...ls, sectionHeader, tableHeader, tableRows];
  }

  // Replace existing Epic section with updated table
  const before = ls.slice(0, secIdx); // lines before Epic section
  const after = ls.slice(secIdx + 1); // lines after the header (optional: could trim old table)
  
  // Here we can optionally remove old rows until next section, for simplicity we just replace
  return [...before, sectionHeader, tableHeader, tableRows];
};

// Generate complete task template (metadata + content)
export function generateTaskTemplate(metadata: SprintDesk.TaskMetadata): string {
  return generateTaskMetadata(metadata) + '\n\n' + generateTaskContent(metadata);
}

/* 
 * Old code for reference:
 */
export function parseTaskMetadataFromFilename(filename: string): { taskName: string; epicName?: string } {
  const taskPrefix = PROJECT_CONSTANTS.FILE_PREFIX.TASK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const epicPrefix = PROJECT_CONSTANTS.FILE_PREFIX.EPIC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${taskPrefix}(.+?)(?:_${epicPrefix}(.+?))?\.md$`);
  const match = filename.match(pattern);
  if (!match) throw new Error('Invalid task filename format');

  return {
    taskName: match[1].replace(/-/g, ' '),
    epicName: match[2]?.replace(/-/g, ' ')
  };
}
