import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { buildSprintCalendar } from '../../calendar/sprintCalendar';
import { renderSprintCalendarHtml } from '../../calendar/sprintCalendarHtml';
import { initialCalendarState, localCalendarDate, updateCalendarState } from '../../calendar/sprintCalendarState';
import { calendarDescription, calendarTaskPath } from '../../calendar/sprintCalendarDetails';
import { getDataService } from '../../data/DataService';

export function registerShowSprintCalendarCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.commands.registerCommand('sprintdesk.showSprintCalendar', async (item?: { filePath?: string }) => {
    const workspaceRoot = (item?.filePath
      ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(item.filePath))?.uri.fsPath : undefined)
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }
    const dataService = getDataService(workspaceRoot);
    let calendar = buildSprintCalendar(dataService.loadSprints(), dataService.loadTasks());
    const panel = vscode.window.createWebviewPanel('sprintdesk-sprint-calendar', 'Sprint Calendar',
      vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
    let state = initialCalendarState(localCalendarDate());
    let description = '';
    let disposed = false;
    const render = () => {
      if (!disposed) {panel.webview.html = renderSprintCalendarHtml(calendar, randomBytes(16).toString('base64'),
        {state, today:localCalendarDate(), description});}
    };
    const refresh = () => {
      calendar = buildSprintCalendar(dataService.loadSprints(), dataService.loadTasks());
      if (!calendar.sprints.some(sprint => sprint.tasks.some(task => task.id === state.selectedTaskId))) {
        state = {...state, selectedTaskId:null};
        description = '';
      }
    };
    const describe = async () => {
      const id = state.selectedTaskId;
      const task = id ? dataService.getTask(id) : undefined;
      if (!task) { description = ''; return; }
      const path = calendarTaskPath(dataService.getTasksDir(), dataService.getTaskFilename(task), task.path);
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      if (state.selectedTaskId === id) {description = calendarDescription(document.getText());}
    };
    const messages = panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (disposed || !message || typeof message !== 'object' || Array.isArray(message)) {return;}
      const data = message as Record<string, unknown>;
      const keys = Object.keys(data);
      if (typeof data.action !== 'string' || !keys.includes('action')) {return;}
      const shape = (...fields: string[]) => keys.length === fields.length + 1
        && fields.every(field => keys.includes(field) && typeof data[field] === 'string');
      try {
        if (data.action === 'selectTask' && shape('taskId')) {
          refresh();
          const task = calendar.sprints.flatMap(sprint => sprint.tasks).find(task => task.id === data.taskId);
          if (!task) {throw new Error('Task is no longer assigned to a sprint. Refresh the calendar.');}
          state = {...state, selectedTaskId:task.id, selectedSprintId:task.sprintId, focusId:'tasks'};
          description = '';
          render();
          await describe();
          render();
          return;
        }
        if (data.action === 'clearSelection' && shape()) {
          const task = calendar.tasks.find(task => task.id === state.selectedTaskId);
          state = {...state, selectedTaskId:null, focusId:task ? `task-${encodeURIComponent(task.id)}-${task.startDate}` : 'tasks'};
          description = '';
          render();
          return;
        }
        if (data.action === 'openTask' && shape('taskId')) {
          const task = dataService.getTask(String(data.taskId));
          if (!task) {throw new Error('Task not found. Refresh the calendar.');}
          const path = calendarTaskPath(dataService.getTasksDir(), dataService.getTaskFilename(task), task.path);
          await vscode.commands.executeCommand('sprintdesk.editTaskRaw', path);
          return;
        }
        if (data.action === 'viewUnassigned' && shape()) {
          const tasks = dataService.loadTasks().filter(task => task.sprint === null);
          const selected = await vscode.window.showQuickPick(tasks.map(task => ({
            label:task.code, description:task.title, task,
          })), {title:'Unassigned tasks', placeHolder:'Choose a backlog task to open'});
          if (selected) {
            const path = calendarTaskPath(dataService.getTasksDir(), dataService.getTaskFilename(selected.task), selected.task.path);
            await vscode.commands.executeCommand('sprintdesk.editTaskRaw', path);
          }
          return;
        }
        if (data.action === 'refresh' && shape()) {
          refresh();
          await describe();
          state = {...state, focusId:'refresh'};
          render();
          return;
        }
        if (['setSprintColor','deleteSprint','assignTask','removeTask'].includes(data.action)) {
          const fields = data.action === 'setSprintColor' ? ['sprintId','color']
            : data.action === 'deleteSprint' ? ['sprintId'] : ['sprintId','taskId'];
          if (!shape(...fields)) {return;}
          const sprint = dataService.getSprint(String(data.sprintId));
          if (!sprint) {throw new Error('Sprint no longer exists. Refresh the calendar.');}
          if (data.action === 'setSprintColor') {
            if (!/^#[0-9a-fA-F]{6}$/.test(String(data.color))) {throw new Error('Invalid sprint color.');}
            dataService.updateSprint(sprint.id, {color:String(data.color)});
            state = {...state, focusId:`ribbon-${calendar.sprints.findIndex(item => item.id === sprint.id)}`};
          } else {
            const tasks = dataService.loadTasks();
            const sprints = dataService.loadSprints();
            const task = tasks.find(task => task.id === data.taskId);
            if (data.action !== 'deleteSprint' && !task) {throw new Error('Task no longer exists. Refresh the calendar.');}
            const adding = data.action === 'assignTask';
            if (task && (adding ? task.sprint !== null : task.sprint !== sprint.id && task.sprint !== sprint.name)) {
              throw new Error('Task sprint membership changed. Refresh the calendar before trying again.');
            }
            const ids = data.action === 'deleteSprint'
              ? tasks.filter(task => task.sprint === sprint.id || task.sprint === sprint.name).map(task => task.id) : [task!.id];
            const nextTasks = tasks.map(task => ids.includes(task.id)
              ? {...task, sprint:adding?sprint.id:null, updatedAt:new Date().toISOString()} : task);
            const nextSprints = data.action === 'deleteSprint' ? sprints.filter(item => item.id !== sprint.id)
              : sprints.map(item => item.id === sprint.id ? {...item,
                tasks:adding ? [...new Set([...item.tasks,task!.id])] : item.tasks.filter(id => id !== task!.id),
              } : item);
            try {
              dataService.saveTasks(nextTasks);
              dataService.saveSprints(nextSprints);
            } catch (error) {
              const rollbackErrors: string[] = [];
              try {dataService.saveTasks(tasks);} catch (rollback) {rollbackErrors.push(String(rollback));}
              try {dataService.saveSprints(sprints);} catch (rollback) {rollbackErrors.push(String(rollback));}
              if (rollbackErrors.length) {
                throw new Error(`${String(error)}; rollback failed: ${rollbackErrors.join('; ')}. Check workspace task and sprint data before retrying.`);
              }
              throw error;
            }
            state = {...state, selectedSprintId:data.action==='deleteSprint'?null:sprint.id, focusId:'tasks'};
          }
          refresh();
          render();
          await vscode.commands.executeCommand('sprintdesk.refresh');
          return;
        }
        const next = updateCalendarState(state, message, localCalendarDate());
        if (next) {
          state = next;
          refresh();
          description = '';
          render();
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (data.action === 'selectTask' || data.action === 'refresh') {description = `Unable to read task description: ${detail}`;}
        vscode.window.showErrorMessage(`Calendar: ${detail}`);
        refresh();
        render();
      }
    });
    const disposal = panel.onDidDispose(() => {
      disposed = true;
      messages.dispose();
      disposal.dispose();
    });
    context.subscriptions.push(panel);
    render();
  }));
}
