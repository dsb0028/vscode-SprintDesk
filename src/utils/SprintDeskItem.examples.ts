/**
 * SprintDeskItem Usage Examples
 * 
 * This file demonstrates how to use the SprintDeskItem class
 * for managing tasks, epics, backlogs, and sprints with full CRUD operations.
 */

import { SprintDeskItem } from './SprintDeskItem';

// Example usage:

// 1. Initialize with a task file
const task = new SprintDeskItem('/path/to/.SprintDesk/Tasks/[Task]_my-feature.md');

// 2. CRUD Operations
task.create();                    // Create new file
const content = task.read();       // Read current content
task.update();                    // Update with current changes
task.delete();                    // Delete the file

// 3. Relationship Management (Bidirectional)
task.addEpic('/path/to/.SprintDesk/Epics/[Epic]_user-authentication.md');
task.addBacklog('/path/to/.SprintDesk/Backlogs/[Backlog]_Features.md');
task.addSprint('/path/to/.SprintDesk/Sprints/[Sprint]_01-01_07-01_2025.md');

// 4. Remove Relationships (also bidirectional)
task.removeEpic('/path/to/.SprintDesk/Epics/[Epic]_user-authentication.md');
task.removeBacklog('/path/to/.SprintDesk/Backlogs/[Backlog]_Features.md');
task.removeSprint('/path/to/.SprintDesk/Sprints/[Sprint]_01-01_07-01_2025.md');

// 5. Update Properties
task.updateStatus('in-progress');
task.updatePriority('high');
task.updateAssignee('John Doe');

// 6. Get Information
const metadata = task.getMetadata();
const itemType = task.getItemType();
const filePath = task.getFilePath();

// 7. Similar usage for other item types:
const epic = new SprintDeskItem('/path/to/.SprintDesk/Epics/[Epic]_user-authentication.md');
const backlog = new SprintDeskItem('/path/to/.SprintDesk/Backlogs/[Backlog]_Features.md');
const sprint = new SprintDeskItem('/path/to/.SprintDesk/Sprints/[Sprint]_01-01_07-01_2025.md');

// 8. All relationship methods work bidirectionally:
epic.addTask('/path/to/.SprintDesk/Tasks/[Task]_login-form.md');      // Updates both epic and task
epic.removeTask('/path/to/.SprintDesk/Tasks/[Task]_login-form.md');    // Removes from both files

backlog.addTask('/path/to/.SprintDesk/Tasks/[Task]_user-profile.md');    // Updates both backlog and task
backlog.removeTask('/path/to/.SprintDesk/Tasks/[Task]_user-profile.md');  // Removes from both files

sprint.addTask('/path/to/.SprintDesk/Tasks/[Task]_api-integration.md');    // Updates both sprint and task
sprint.removeTask('/path/to/.SprintDesk/Tasks/[Task]_api-integration.md');  // Removes from both files

// 9. Advanced CRUD with metadata updates:
task.update(
  '# Updated Content\n\nNew description here...',
  {
    status: 'completed',
    priority: 'low',
    assignee: 'Jane Doe',
    custom_field: 'custom value'
  }
);

export { SprintDeskItem };