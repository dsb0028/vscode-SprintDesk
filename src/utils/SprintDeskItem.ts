import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { updateEpicHeaderLine, updateEpicSection } from '../utils/taskTemplate';
import { readFileSyncSafe, fileExists } from '../services/fileService';

type ItemType = 'task' | 'epic' | 'backlog' | 'sprint';

export class SprintDeskItem {
  private filePath: string;
  private itemType: ItemType;
  private content: string;
  private metadata: any;

  // Constants and regex patterns
  private static readonly COMMON_EMOJI = {
    GOAL: '🎯',
    HOT: '🔥',
    PROJECT: "📂",
    FILE: "📄",
    CALENDAR: "📅",
    LAST_UPDATE: "🗓",
    TOTAL_TASKS: "🛠",
    PROGRESS: "📊",
    SUMMARY: "📝",
    TYPE: "🏷️",
    ASSIGNEE: "👤",
    FOLDER: "📁",
    OPEN_FILE: "📂",
    CHECKMARK: "✔️",
    OVERVIEW: "🗂️",
    DESCRIPTION: "📜",
    ACCEPTANCE_CRITERIA: "✅",
    CHECKLIST: "📝",
    NOTES: "🧠",
    SPRINT: "🏃",
    SPRINT_LIST: "📆",
    SPRINT_SECTION: "⏱️",
    RELATED_SPRINTS: "🔗",
    BACKLOG: "📒",
    BACKLOG_LIST: "📋",
    BACKLOGS_SECTION: "📋",
    RELATED_BACKLOGS: "🔗",
    EPIC: "🚩",
    EPIC_LIST: "🧱",
    EPICS_SECTION: "🧱",
    RELATED_EPICS: "🔗",
    TASK: "📌",
    TASK_LIST: "📋",
    TASKS_SECTION: "🛠️",
    RELATED_TASKS: "🔗",
    PRIORITY: "⚡",
  };

  private static readonly REGEX_PATTERNS = {
    TASKS_SECTION: /^## 🛠️ Tasks\n([\s\S]*?)(?=\n## |\n---|$)/,
    EPIC_SECTION: /^## 🚩 Epic\n([\s\S]*?)(?=\n## |\n---|$)/,
    BACKLOG_SECTION: /^## 📋 Backlogs\n([\s\S]*?)(?=\n## |\n---|$)/,
    SPRINT_SECTION: /^## ⏱️ Sprints\n([\s\S]*?)(?=\n## |\n---|$)/,
    TASK_TABLE_HEADER: /\| # \| Task \| Status \| Priority \| File \|\n\|:--\|:-----\|:------:\|:--------:\|:-----\|/,
    TABLE_ROW_TEMPLATE: (id: string, title: string, path: string, status: string, priority: string) => 
      `| ${id} | [${title}](${path}) | ${status} | ${priority} | \`${id}\` |`
  };

  constructor(filePath: string) {
    this.filePath = filePath;
    this.itemType = this.detectItemType();
    
    // Handle case where file doesn't exist yet
    if (fileExists(filePath)) {
      this.content = readFileSyncSafe(filePath);
      this.metadata = this.parseMetadata();
    } else {
      this.content = '';
      this.metadata = {};
    }
  }

  private detectItemType(): ItemType {
    const normalizedPath = this.filePath.toLowerCase();
    if (normalizedPath.includes('/tasks/') || normalizedPath.includes('\\tasks\\')) return 'task';
    if (normalizedPath.includes('/epics/') || normalizedPath.includes('\\epics\\')) return 'epic';
    if (normalizedPath.includes('/backlogs/') || normalizedPath.includes('\\backlogs\\')) return 'backlog';
    if (normalizedPath.includes('/sprints/') || normalizedPath.includes('\\sprints\\')) return 'sprint';
    throw new Error(`Cannot determine item type for path: ${this.filePath}`);
  }

  private parseMetadata(): any {
    try {
      const parsed = matter(this.content);
      return parsed.data || {};
    } catch (error) {
      console.error('Error parsing metadata with gray-matter:', error);
      return {};
    }
  }

  public updateMetadata(newMetadata: any): void {
    try {
      const updatedMetadata = { ...this.metadata, ...newMetadata };
      const parsed = matter(this.content);
      const newContent = matter.stringify(parsed.content, updatedMetadata);
      this.content = newContent;
      this.metadata = updatedMetadata;
    } catch (error) {
      console.error('Error updating metadata:', error);
      throw new Error(`Failed to update metadata: ${error}`);
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, this.content, 'utf8');
    } catch (error) {
      console.error('Error saving file:', error);
      throw new Error(`Failed to save file: ${this.filePath}`);
    }
  }

  // CRUD Operations
  public create(): void {
    if (!fileExists(this.filePath)) {
      // For new files, ensure we have basic metadata
      if (!this.metadata || Object.keys(this.metadata).length === 0) {
        this.metadata = {
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      }
      this.save();
    } else {
      throw new Error(`File already exists: ${this.filePath}`);
    }
  }

  public read(): string {
    return this.content;
  }

  public update(newContent?: string, newMetadata?: any): void {
    if (newContent !== undefined) {
      this.content = newContent;
    }
    if (newMetadata !== undefined) {
      this.updateMetadata(newMetadata);
    }
    this.save();
  }

  public delete(): void {
    if (fileExists(this.filePath)) {
      fs.unlinkSync(this.filePath);
    } else {
      throw new Error(`File not found: ${this.filePath}`);
    }
  }

  // Property Updates
  public updateStatus(status: string): void {
    this.updateMetadata({
      status,
      updated_at: new Date().toISOString()
    });
    this.save();
  }

  public updatePriority(priority: string): void {
    this.updateMetadata({
      priority,
      updated_at: new Date().toISOString()
    });
    this.save();
  }

  public updateAssignee(assignee: string): void {
    this.updateMetadata({
      assignee,
      updated_at: new Date().toISOString()
    });
    this.save();
  }

  // Relationship Management - Proper Bidirectional Updates
  public addEpic(epicPath: string): void {
    if (!fileExists(epicPath)) {
      throw new Error(`Epic file not found: ${epicPath}`);
    }

    const epicContent = readFileSyncSafe(epicPath);
    const epicMetadata = this.parseEpicMetadata(epicContent);
    
    if (!epicMetadata || Object.keys(epicMetadata).length === 0) {
      throw new Error(`Invalid epic file format: ${epicPath}`);
    }
    const epicTitle = epicMetadata.title || path.basename(epicPath, '.md');

    // Update current item metadata
    this.updateMetadata({
      epic: epicTitle,
      updated_at: new Date().toISOString()
    });

    // Update current item content sections
    const lines = this.content.split('\n');
    
    // Update epic header line
    const updatedLines = updateEpicHeaderLine(lines, {
      _id: epicMetadata._id || '',
      title: epicTitle,
      path: epicPath
    } as SprintDesk.EpicMetadata);

    // Update epic section
    const finalLines = updateEpicSection(updatedLines, {
      _id: epicMetadata._id || '',
      title: epicTitle,
      path: epicPath,
      status: epicMetadata.status || 'planned',
      priority: epicMetadata.priority || 'medium'
    } as SprintDesk.EpicMetadata);

    this.content = finalLines.join('\n');
    this.save();

    // Update epic file to include this item
    this.updateEpicWithTask(epicPath, epicMetadata);
  }

  public removeEpic(epicPath: string): void {
    if (!fileExists(epicPath)) {
      throw new Error(`Epic file not found: ${epicPath}`);
    }

    const epicMetadata = this.parseEpicMetadata(readFileSyncSafe(epicPath));
    const epicTitle = epicMetadata.title || path.basename(epicPath, '.md');

    // Remove epic from current item metadata
    const updatedMetadata = { ...this.metadata };
    delete updatedMetadata.epic;
    this.updateMetadata({
      ...updatedMetadata,
      updated_at: new Date().toISOString()
    });

    // Remove epic section from current item content
    const lines = this.content.split('\n');
    const epicSectionMatch = lines.join('\n').match(SprintDeskItem.REGEX_PATTERNS.EPIC_SECTION);
    
    if (epicSectionMatch) {
      const epicSectionIndex = lines.findIndex(line => line.trim().startsWith('## 🚩 Epic'));
      const nextSectionIndex = lines.findIndex((line, index) => 
        index > epicSectionIndex && line.trim().startsWith('## ')
      );

      let filteredLines: string[];
      if (epicSectionIndex !== -1 && nextSectionIndex !== -1) {
        filteredLines = [
          ...lines.slice(0, epicSectionIndex),
          ...lines.slice(nextSectionIndex)
        ];
      } else if (epicSectionIndex !== -1) {
        filteredLines = lines.slice(0, epicSectionIndex);
      } else {
        filteredLines = lines;
      }

      this.content = filteredLines.join('\n');
    }

    this.save();

    // Remove this item from epic file
    this.removeItemFromEpic(epicPath, this.filePath);
  }

  public addBacklog(backlogPath: string): void {
    if (!fileExists(backlogPath)) {
      throw new Error(`Backlog file not found: ${backlogPath}`);
    }

    const backlogMetadata = this.parseBacklogMetadata(readFileSyncSafe(backlogPath));
    const backlogTitle = backlogMetadata.title || path.basename(backlogPath, '.md');

    // Update current item metadata
    this.updateMetadata({
      backlog: backlogTitle,
      updated_at: new Date().toISOString()
    });

    // Update content sections
    this.updateBacklogSection(backlogTitle, backlogPath);
    this.save();

    // Update backlog file to include this item
    this.updateBacklogWithItem(backlogPath);
  }

  public removeBacklog(backlogPath: string): void {
    if (!fileExists(backlogPath)) {
      throw new Error(`Backlog file not found: ${backlogPath}`);
    }

    const backlogMetadata = this.parseBacklogMetadata(readFileSyncSafe(backlogPath));
    const backlogTitle = backlogMetadata.title || path.basename(backlogPath, '.md');

    // Remove backlog from current item metadata
    const updatedMetadata = { ...this.metadata };
    delete updatedMetadata.backlog;
    this.updateMetadata({
      ...updatedMetadata,
      updated_at: new Date().toISOString()
    });

    // Remove backlog section from current item content
    const lines = this.content.split('\n');
    const backlogSectionMatch = lines.join('\n').match(SprintDeskItem.REGEX_PATTERNS.BACKLOG_SECTION);
    
    if (backlogSectionMatch) {
      const backlogSectionIndex = lines.findIndex(line => line.trim().startsWith('## 📋 Backlogs'));
      const nextSectionIndex = lines.findIndex((line, index) => 
        index > backlogSectionIndex && line.trim().startsWith('## ')
      );

      let filteredLines: string[];
      if (backlogSectionIndex !== -1 && nextSectionIndex !== -1) {
        filteredLines = [
          ...lines.slice(0, backlogSectionIndex),
          ...lines.slice(nextSectionIndex)
        ];
      } else if (backlogSectionIndex !== -1) {
        filteredLines = lines.slice(0, backlogSectionIndex);
      } else {
        filteredLines = lines;
      }

      this.content = filteredLines.join('\n');
    }

    this.save();

    // Remove this item from backlog file
    this.removeItemFromBacklog(backlogPath, this.filePath);
  }

  public addSprint(sprintPath: string): void {
    if (!fileExists(sprintPath)) {
      throw new Error(`Sprint file not found: ${sprintPath}`);
    }

    const sprintMetadata = this.parseSprintMetadata(readFileSyncSafe(sprintPath));
    const sprintTitle = sprintMetadata.title || path.basename(sprintPath, '.md');

    // Update current item metadata
    this.updateMetadata({
      sprint: sprintTitle,
      updated_at: new Date().toISOString()
    });

    // Update content sections
    this.updateSprintSection(sprintTitle, sprintPath);
    this.save();

    // Update sprint file to include this item
    this.updateSprintWithItem(sprintPath);
  }

  public removeSprint(sprintPath: string): void {
    if (!fileExists(sprintPath)) {
      throw new Error(`Sprint file not found: ${sprintPath}`);
    }

    const sprintMetadata = this.parseSprintMetadata(readFileSyncSafe(sprintPath));
    const sprintTitle = sprintMetadata.title || path.basename(sprintPath, '.md');

    // Remove sprint from current item metadata
    const updatedMetadata = { ...this.metadata };
    delete updatedMetadata.sprint;
    this.updateMetadata({
      ...updatedMetadata,
      updated_at: new Date().toISOString()
    });

    // Remove sprint section from current item content
    const lines = this.content.split('\n');
    const sprintSectionMatch = lines.join('\n').match(SprintDeskItem.REGEX_PATTERNS.SPRINT_SECTION);
    
    if (sprintSectionMatch) {
      const sprintSectionIndex = lines.findIndex(line => line.trim().startsWith('## ⏱️ Sprints'));
      const nextSectionIndex = lines.findIndex((line, index) => 
        index > sprintSectionIndex && line.trim().startsWith('## ')
      );

      let filteredLines: string[];
      if (sprintSectionIndex !== -1 && nextSectionIndex !== -1) {
        filteredLines = [
          ...lines.slice(0, sprintSectionIndex),
          ...lines.slice(nextSectionIndex)
        ];
      } else if (sprintSectionIndex !== -1) {
        filteredLines = lines.slice(0, sprintSectionIndex);
      } else {
        filteredLines = lines;
      }

      this.content = filteredLines.join('\n');
    }

    this.save();

    // Remove this item from sprint file
    this.removeItemFromSprint(sprintPath, this.filePath);
  }

  public addTask(taskPath: string): void {
    if (!fileExists(taskPath)) {
      throw new Error(`Task file not found: ${taskPath}`);
    }

    const taskMetadata = this.parseTaskMetadata(readFileSyncSafe(taskPath));
    const taskTitle = taskMetadata.title || path.basename(taskPath, '.md');

    // Update current item metadata
    this.updateMetadata({
      task: taskTitle,
      updated_at: new Date().toISOString()
    });

    // Update content sections
    this.updateTaskSection(taskTitle, taskPath);
    this.save();

    // Update task file to reference this item
    this.updateTaskWithItem(taskPath, taskMetadata);
  }

  public removeTask(taskPath: string): void {
    if (!fileExists(taskPath)) {
      throw new Error(`Task file not found: ${taskPath}`);
    }

    const taskMetadata = this.parseTaskMetadata(readFileSyncSafe(taskPath));
    const taskTitle = taskMetadata.title || path.basename(taskPath, '.md');

    // Remove task from current item metadata
    const updatedMetadata = { ...this.metadata };
    delete updatedMetadata.task;
    this.updateMetadata({
      ...updatedMetadata,
      updated_at: new Date().toISOString()
    });

    // Remove task section from current item content
    const lines = this.content.split('\n');
    const taskSectionMatch = lines.join('\n').match(SprintDeskItem.REGEX_PATTERNS.TASKS_SECTION);
    
    if (taskSectionMatch) {
      const taskSectionIndex = lines.findIndex(line => line.trim().startsWith('## 🛠️ Tasks'));
      const nextSectionIndex = lines.findIndex((line, index) => 
        index > taskSectionIndex && line.trim().startsWith('## ')
      );

      let filteredLines: string[];
      if (taskSectionIndex !== -1 && nextSectionIndex !== -1) {
        filteredLines = [
          ...lines.slice(0, taskSectionIndex),
          ...lines.slice(nextSectionIndex)
        ];
      } else if (taskSectionIndex !== -1) {
        filteredLines = lines.slice(0, taskSectionIndex);
      } else {
        filteredLines = lines;
      }

      this.content = filteredLines.join('\n');
    }

    this.save();

    // Remove this item from task file
    this.removeItemFromTask(taskPath, this.filePath);
  }

  // Getters
  public getMetadata(): any {
    return { ...this.metadata };
  }

  public getContent(): string {
    return this.content;
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public getItemType(): ItemType {
    return this.itemType;
  }

  // Helper methods for bidirectional updates
  private parseEpicMetadata(epicContent: string): any {
    try {
      const parsed = matter(epicContent);
      return parsed.data || {};
    } catch (error) {
      console.error('Error parsing epic metadata:', error);
      return {};
    }
  }

  private parseBacklogMetadata(backlogContent: string): any {
    try {
      const parsed = matter(backlogContent);
      return parsed.data || {};
    } catch (error) {
      console.error('Error parsing backlog metadata:', error);
      return {};
    }
  }

  private parseSprintMetadata(sprintContent: string): any {
    try {
      const parsed = matter(sprintContent);
      return parsed.data || {};
    } catch (error) {
      console.error('Error parsing sprint metadata:', error);
      return {};
    }
  }

  private parseTaskMetadata(taskContent: string): any {
    try {
      const parsed = matter(taskContent);
      return parsed.data || {};
    } catch (error) {
      console.error('Error parsing task metadata:', error);
      return {};
    }
  }

  private updateBacklogSection(backlogTitle: string, backlogPath: string): void {
    const lines = this.content.split('\n');
    const backlogSection = `## ${SprintDeskItem.COMMON_EMOJI.BACKLOG} Backlogs`;
    const backlogSectionIndex = lines.findIndex(line => line.trim() === backlogSection);
    
    if (backlogSectionIndex === -1) {
      // Add backlog section at the end
      lines.push(`\n${backlogSection}\n- [${backlogTitle}](${backlogPath})`);
    } else {
      // Update existing backlog section
      const afterSection = backlogSectionIndex + 1;
      if (afterSection < lines.length && !lines[afterSection].includes(backlogTitle)) {
        lines.splice(afterSection, 0, `- [${backlogTitle}](${backlogPath})`);
      }
    }
    
    this.content = lines.join('\n');
  }

  private updateSprintSection(sprintTitle: string, sprintPath: string): void {
    const lines = this.content.split('\n');
    const sprintSection = `## ${SprintDeskItem.COMMON_EMOJI.SPRINT} Sprints`;
    const sprintSectionIndex = lines.findIndex(line => line.trim() === sprintSection);
    
    if (sprintSectionIndex === -1) {
      // Add sprint section at the end
      lines.push(`\n${sprintSection}\n- [${sprintTitle}](${sprintPath})`);
    } else {
      // Update existing sprint section
      const afterSection = sprintSectionIndex + 1;
      if (afterSection < lines.length && !lines[afterSection].includes(sprintTitle)) {
        lines.splice(afterSection, 0, `- [${sprintTitle}](${sprintPath})`);
      }
    }
    
    this.content = lines.join('\n');
  }

  private updateTaskSection(taskTitle: string, taskPath: string): void {
    const lines = this.content.split('\n');
    const taskSection = `## ${SprintDeskItem.COMMON_EMOJI.TASK} Tasks`;
    const taskSectionIndex = lines.findIndex(line => line.trim() === taskSection);
    
    if (taskSectionIndex === -1) {
      // Add task section at the end
      lines.push(`\n${taskSection}\n- [${taskTitle}](${taskPath})`);
    } else {
      // Update existing task section
      const afterSection = taskSectionIndex + 1;
      if (afterSection < lines.length && !lines[afterSection].includes(taskTitle)) {
        lines.splice(afterSection, 0, `- [${taskTitle}](${taskPath})`);
      }
    }
    
    this.content = lines.join('\n');
  }

  private updateEpicWithTask(epicPath: string, epicMetadata: any): void {
    let epicContent = readFileSyncSafe(epicPath);
    const itemTitle = this.metadata.title || path.basename(this.filePath, '.md');
    
    // Find or create Tasks section in epic
    const tasksSectionMatch = epicContent.match(SprintDeskItem.REGEX_PATTERNS.EPIC_SECTION);
    
    if (tasksSectionMatch) {
      const tasksSection = tasksSectionMatch[1];
      
      if (SprintDeskItem.REGEX_PATTERNS.TASK_TABLE_HEADER.test(tasksSection)) {
        // Add item to existing table
        const newItemRow = SprintDeskItem.REGEX_PATTERNS.TABLE_ROW_TEMPLATE(
          this.metadata._id || '',
          itemTitle,
          this.filePath,
          this.metadata.status || 'waiting',
          this.metadata.priority || 'medium'
        );
        const updatedTasksSection = tasksSection.replace(
          SprintDeskItem.REGEX_PATTERNS.TASK_TABLE_HEADER,
          SprintDeskItem.REGEX_PATTERNS.TASK_TABLE_HEADER + '\n' + newItemRow
        );
        
        epicContent = epicContent.replace(SprintDeskItem.REGEX_PATTERNS.EPIC_SECTION, `## 🧱 Tasks\n${updatedTasksSection}`);
      }
    } else {
      // Add Tasks section at the end
      epicContent += `\n\n## 🧱 Tasks\n\n| # | Task | Status | Priority | File |\n|:--|:-----|:------:|:--------:|:-----|\n| ${this.metadata._id || ''} | [${itemTitle}](${this.filePath}) | ${this.metadata.status || 'waiting'} | ${this.metadata.priority || 'medium'} | \`${this.metadata._id || ''}\` |`;
    }

    // Update epic metadata
    const parsed = matter(epicContent);
    const currentTotalTasks = parseInt(epicMetadata.totalTasks || '0');
    const updatedEpicMetadata = {
      ...epicMetadata,
      totalTasks: currentTotalTasks + 1,
      updated_at: new Date().toISOString()
    };
    
    const newEpicContent = matter.stringify(parsed.content, updatedEpicMetadata);
    fs.writeFileSync(epicPath, newEpicContent, 'utf8');
  }

  private removeItemFromEpic(epicPath: string, itemPath: string): void {
    let epicContent = readFileSyncSafe(epicPath);
    const itemTitle = this.metadata.title || path.basename(itemPath, '.md');
    
    // Find Tasks section in epic
    const tasksSectionMatch = epicContent.match(SprintDeskItem.REGEX_PATTERNS.EPIC_SECTION);
    
    if (tasksSectionMatch) {
      const tasksSection = tasksSectionMatch[1];
      // Remove item from table
      const lines = tasksSection.split('\n');
      const filteredLines = lines.filter(line => 
        !line.includes(`[${itemTitle}](${itemPath})`)
      );
      const updatedTasksSection = filteredLines.join('\n');
      
      epicContent = epicContent.replace(SprintDeskItem.REGEX_PATTERNS.EPIC_SECTION, `## 🧱 Tasks\n${updatedTasksSection}`);
    }

    // Update epic metadata
    const parsed = matter(epicContent);
    const epicMetadata = parsed.data || {};
    const currentTotalTasks = parseInt(epicMetadata.totalTasks || '0');
    const updatedEpicMetadata = {
      ...epicMetadata,
      totalTasks: Math.max(0, currentTotalTasks - 1),
      updated_at: new Date().toISOString()
    };
    
    const newEpicContent = matter.stringify(parsed.content, updatedEpicMetadata);
    fs.writeFileSync(epicPath, newEpicContent, 'utf8');
  }

  private updateBacklogWithItem(backlogPath: string): void {
    let backlogContent = readFileSyncSafe(backlogPath);
    const itemTitle = this.metadata.title || path.basename(this.filePath, '.md');
    
    // Find or create Tasks section in backlog
    const tasksSectionMatch = backlogContent.match(SprintDeskItem.REGEX_PATTERNS.TASKS_SECTION);
    
    if (tasksSectionMatch) {
      const tasksSection = tasksSectionMatch[1];
      
      if (SprintDeskItem.REGEX_PATTERNS.TASK_TABLE_HEADER.test(tasksSection)) {
        // Add item to existing table
        const newItemRow = SprintDeskItem.REGEX_PATTERNS.TABLE_ROW_TEMPLATE(
          this.metadata._id || '',
          itemTitle,
          this.filePath,
          this.metadata.status || 'waiting',
          this.metadata.priority || 'medium'
        );
        const updatedTasksSection = tasksSection.replace(
          SprintDeskItem.REGEX_PATTERNS.TASK_TABLE_HEADER,
          SprintDeskItem.REGEX_PATTERNS.TASK_TABLE_HEADER + '\n' + newItemRow
        );
        
        backlogContent = backlogContent.replace(SprintDeskItem.REGEX_PATTERNS.TASKS_SECTION, `## 🧱 Tasks\n${updatedTasksSection}`);
      }
    } else {
      // Add Tasks section at the end
      backlogContent += `\n\n## 🧱 Tasks\n\n| # | Task | Status | Priority | File |\n|:--|:-----|:------:|:--------:|:-----|\n| ${this.metadata._id || ''} | [${itemTitle}](${this.filePath}) | ${this.metadata.status || 'waiting'} | ${this.metadata.priority || 'medium'} | \`${this.metadata._id || ''}\` |`;
    }

    fs.writeFileSync(backlogPath, backlogContent, 'utf8');
  }

  private removeItemFromBacklog(backlogPath: string, itemPath: string): void {
    let backlogContent = readFileSyncSafe(backlogPath);
    const itemTitle = this.metadata.title || path.basename(itemPath, '.md');
    
    // Find Tasks section in backlog
    const tasksSectionMatch = backlogContent.match(SprintDeskItem.REGEX_PATTERNS.TASKS_SECTION);
    
    if (tasksSectionMatch) {
      const tasksSection = tasksSectionMatch[1];
      // Remove item from table
      const lines = tasksSection.split('\n');
      const filteredLines = lines.filter(line => 
        !line.includes(`[${itemTitle}](${itemPath})`)
      );
      const updatedTasksSection = filteredLines.join('\n');
      
      backlogContent = backlogContent.replace(SprintDeskItem.REGEX_PATTERNS.TASKS_SECTION, `## 🧱 Tasks\n${updatedTasksSection}`);
    }

    fs.writeFileSync(backlogPath, backlogContent, 'utf8');
  }

  private updateSprintWithItem(sprintPath: string): void {
    let sprintContent = readFileSyncSafe(sprintPath);
    const itemTitle = this.metadata.title || path.basename(this.filePath, '.md');
    
    // Find or create Tasks section in sprint
    const tasksSectionMatch = sprintContent.match(SprintDeskItem.REGEX_PATTERNS.TASKS_SECTION);
    
    if (tasksSectionMatch) {
      const tasksSection = tasksSectionMatch[1];
      
      if (SprintDeskItem.REGEX_PATTERNS.TASK_TABLE_HEADER.test(tasksSection)) {
        // Add item to existing table
        const newItemRow = SprintDeskItem.REGEX_PATTERNS.TABLE_ROW_TEMPLATE(
          this.metadata._id || '',
          itemTitle,
          this.filePath,
          this.metadata.status || 'waiting',
          this.metadata.priority || 'medium'
        );
        const updatedTasksSection = tasksSection.replace(
          SprintDeskItem.REGEX_PATTERNS.TASK_TABLE_HEADER,
          SprintDeskItem.REGEX_PATTERNS.TASK_TABLE_HEADER + '\n' + newItemRow
        );
        
        sprintContent = sprintContent.replace(SprintDeskItem.REGEX_PATTERNS.TASKS_SECTION, `## 🧱 Tasks\n${updatedTasksSection}`);
      }
    } else {
      // Add Tasks section at the end
      sprintContent += `\n\n## 🧱 Tasks\n\n| # | Task | Status | Priority | File |\n|:--|:-----|:------:|:--------:|:-----|\n| ${this.metadata._id || ''} | [${itemTitle}](${this.filePath}) | ${this.metadata.status || 'waiting'} | ${this.metadata.priority || 'medium'} | \`${this.metadata._id || ''}\` |`;
    }

    fs.writeFileSync(sprintPath, sprintContent, 'utf8');
  }

  private removeItemFromSprint(sprintPath: string, itemPath: string): void {
    let sprintContent = readFileSyncSafe(sprintPath);
    const itemTitle = this.metadata.title || path.basename(itemPath, '.md');
    
    // Find Tasks section in sprint
    const tasksSectionMatch = sprintContent.match(SprintDeskItem.REGEX_PATTERNS.TASKS_SECTION);
    
    if (tasksSectionMatch) {
      const tasksSection = tasksSectionMatch[1];
      // Remove item from table
      const lines = tasksSection.split('\n');
      const filteredLines = lines.filter(line => 
        !line.includes(`[${itemTitle}](${itemPath})`)
      );
      const updatedTasksSection = filteredLines.join('\n');
      
      sprintContent = sprintContent.replace(SprintDeskItem.REGEX_PATTERNS.TASKS_SECTION, `## 🧱 Tasks\n${updatedTasksSection}`);
    }

    fs.writeFileSync(sprintPath, sprintContent, 'utf8');
  }

  private updateTaskWithItem(taskPath: string, taskMetadata: any): void {
    let taskContent = readFileSyncSafe(taskPath);
    const itemTitle = this.metadata.title || path.basename(this.filePath, '.md');
    
    // Find appropriate section based on current item type
    let sectionRegex: RegExp;
    let sectionTitle: string;

    switch (this.itemType) {
      case 'epic':
        sectionRegex = SprintDeskItem.REGEX_PATTERNS.EPIC_SECTION;
        sectionTitle = '## 🚩 Epic';
        break;
      case 'backlog':
        sectionRegex = SprintDeskItem.REGEX_PATTERNS.BACKLOG_SECTION;
        sectionTitle = '## 📋 Backlogs';
        break;
      case 'sprint':
        sectionRegex = SprintDeskItem.REGEX_PATTERNS.SPRINT_SECTION;
        sectionTitle = '## ⏱️ Sprints';
        break;
      default:
        return; // Don't update task if current item is also a Task
    }

    const sectionMatch = taskContent.match(sectionRegex);
    
    if (sectionMatch) {
      const section = sectionMatch[1];
      if (!section.includes(itemTitle)) {
        const updatedSection = section + `\n- [${itemTitle}](${this.filePath})`;
        taskContent = taskContent.replace(sectionRegex, `${sectionTitle}\n${updatedSection}`);
      }
    } else {
      // Add section at the end
      taskContent += `\n\n${sectionTitle}\n- [${itemTitle}](${this.filePath})`;
    }

    fs.writeFileSync(taskPath, taskContent, 'utf8');
  }

  private removeItemFromTask(taskPath: string, itemPath: string): void {
    let taskContent = readFileSyncSafe(taskPath);
    const itemTitle = this.metadata.title || path.basename(itemPath, '.md');
    
    // Find appropriate section based on current item type
    let sectionRegex: RegExp;

    switch (this.itemType) {
      case 'epic':
        sectionRegex = SprintDeskItem.REGEX_PATTERNS.EPIC_SECTION;
        break;
      case 'backlog':
        sectionRegex = SprintDeskItem.REGEX_PATTERNS.BACKLOG_SECTION;
        break;
      case 'sprint':
        sectionRegex = SprintDeskItem.REGEX_PATTERNS.SPRINT_SECTION;
        break;
      default:
        return; // Don't update task if current item is also a Task
    }

    const sectionMatch = taskContent.match(sectionRegex);
    
    if (sectionMatch) {
      const section = sectionMatch[1];
      // Remove item from section
      const lines = section.split('\n');
      const filteredLines = lines.filter(line => 
        !line.includes(`[${itemTitle}](${itemPath})`)
      );
      const updatedSection = filteredLines.join('\n');
      
      taskContent = taskContent.replace(sectionRegex, sectionMatch[1] + updatedSection);
    }

    fs.writeFileSync(taskPath, taskContent, 'utf8');
  }
}