/**
 * SprintDeskItem Test
 * 
 * Simple test to verify the SprintDeskItem class works correctly
 */

import { SprintDeskItem } from './SprintDeskItem';

// Test function to verify class functionality
export function testSprintDeskItem() {
  console.log('Testing SprintDeskItem class...');
  
  try {
    // Test with a mock file path (would need actual file for full test)
    const taskPath = '/path/to/.SprintDesk/Tasks/[Task]_test-feature.md';
    const task = new SprintDeskItem(taskPath);
    
    console.log('✅ SprintDeskItem created successfully');
    console.log('Item type:', task.getItemType());
    console.log('File path:', task.getFilePath());
    
    // Test metadata operations
    task.updateStatus('in-progress');
    task.updatePriority('high');
    task.updateAssignee('Test User');
    
    console.log('✅ Metadata operations completed');
    
    return true;
  } catch (error) {
    console.error('❌ Test failed:', error);
    return false;
  }
}

// Export for use in other files
export { SprintDeskItem };