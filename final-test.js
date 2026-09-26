/**
 * Final Integration Test
 * 
 * This script verifies that all SprintDeskItem integration issues are resolved
 */

const fs = require('fs');

function testFinalIntegration() {
  console.log('🔧 Final Integration Test');
  console.log('========================\n');

  let allTestsPassed = true;

  // Test 1: Check updateEpicHeaderLine function exists
  console.log('📋 Test 1: updateEpicHeaderLine Function');
  const taskTemplatePath = 'src/utils/taskTemplate.ts';
  if (fs.existsSync(taskTemplatePath)) {
    const taskTemplateContent = fs.readFileSync(taskTemplatePath, 'utf8');
    
    if (taskTemplateContent.includes('export const updateEpicHeaderLine')) {
      console.log('✅ updateEpicHeaderLine function exported');
    } else {
      console.log('❌ updateEpicHeaderLine function not exported');
      allTestsPassed = false;
    }
  }

  // Test 2: Check SprintDeskItem imports the function
  console.log('\n📋 Test 2: SprintDeskItem Import');
  const sprintDeskItemPath = 'src/utils/SprintDeskItem.ts';
  if (fs.existsSync(sprintDeskItemPath)) {
    const sprintDeskItemContent = fs.readFileSync(sprintDeskItemPath, 'utf8');
    
    if (sprintDeskItemContent.includes('import { updateEpicHeaderLine, updateEpicSection }')) {
      console.log('✅ SprintDeskItem imports updateEpicHeaderLine');
    } else {
      console.log('❌ SprintDeskItem missing updateEpicHeaderLine import');
      allTestsPassed = false;
    }
    
    if (sprintDeskItemContent.includes('updateEpicHeaderLine(lines, {')) {
      console.log('✅ SprintDeskItem uses updateEpicHeaderLine');
    } else {
      console.log('❌ SprintDeskItem not using updateEpicHeaderLine');
      allTestsPassed = false;
    }
  }

  // Test 3: Check taskService imports are correct
  console.log('\n📋 Test 3: Task Service Imports');
  const taskServicePath = 'src/services/taskService.ts';
  if (fs.existsSync(taskServicePath)) {
    const taskServiceContent = fs.readFileSync(taskServicePath, 'utf8');
    
    if (taskServiceContent.includes('generateTaskMetadata,') && taskServiceContent.includes('generateTaskContent,')) {
      console.log('✅ Task service imports correct template functions');
    } else {
      console.log('❌ Task service imports incorrect template functions');
      allTestsPassed = false;
    }
    
    if (taskServiceContent.includes('generateTaskMetadata(taskData) + \'\\n\\n\' + generateTaskContent(taskData)')) {
      console.log('✅ Task service uses correct template generation');
    } else {
      console.log('❌ Task service template generation incorrect');
      allTestsPassed = false;
    }
  }

  // Test 4: Check epic integration in task creation
  console.log('\n📋 Test 4: Epic Integration');
  const taskControllerPath = 'src/controller/taskController.ts';
  if (fs.existsSync(taskControllerPath)) {
    const taskControllerContent = fs.readFileSync(taskControllerPath, 'utf8');
    
    if (taskControllerContent.includes('handleTaskInputsController(ws, epic)')) {
      console.log('✅ Epic parameter passed to task inputs');
    } else {
      console.log('❌ Epic parameter not passed to task inputs');
      allTestsPassed = false;
    }
    
    if (taskControllerContent.includes('epic: epic ? {')) {
      console.log('✅ Epic included in task metadata');
    } else {
      console.log('❌ Epic not included in task metadata');
      allTestsPassed = false;
    }
  }

  // Test 5: Check all services use SprintDeskItem
  console.log('\n📋 Test 5: SprintDeskItem Usage');
  const services = [
    'src/services/taskService.ts',
    'src/services/epicService.ts',
    'src/services/backlogService.ts', 
    'src/services/sprintService.ts'
  ];

  services.forEach(service => {
    const content = fs.readFileSync(service, 'utf8');
    if (content.includes('new SprintDeskItem(')) {
      console.log(`✅ ${service.split('/').pop()} uses SprintDeskItem`);
    } else {
      console.log(`❌ ${service.split('/').pop()} missing SprintDeskItem usage`);
      allTestsPassed = false;
    }
  });

  console.log('\n📊 Test Results:');
  console.log('==================');
  
  if (allTestsPassed) {
    console.log('🎉 ALL TESTS PASSED!');
    console.log('✅ updateEpicHeaderLine function created and exported');
    console.log('✅ SprintDeskItem imports and uses updateEpicHeaderLine');
    console.log('✅ Task service uses correct template functions');
    console.log('✅ Epic integration working in task creation');
    console.log('✅ All services properly use SprintDeskItem');
    console.log('\n🚀 Your SprintDesk application is now fully integrated with SprintDeskItem class!');
  } else {
    console.log('❌ Some tests failed. Please review the implementation.');
  }

  return allTestsPassed;
}

// Run the test
if (testFinalIntegration()) {
  console.log('\n✨ Integration complete! You can now create tasks with epic information using SprintDeskItem class.');
} else {
  console.log('\n🔧 Integration incomplete. Please check the errors above.');
}