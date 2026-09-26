import * as vscode from 'vscode';
import { createEpic } from '../../services/epicService';

export async function createEpicInteractive() {
  const epicName = await vscode.window.showInputBox({ prompt: 'Epic title' });
  if (!epicName) return;

  const category = await vscode.window.showInputBox({
    prompt: 'Epic category (e.g., SEO, FE, BE)',
    placeHolder: 'MISC'
  });
  const epicCategory = category || 'MISC';

  createEpic(epicName, epicCategory);
  vscode.window.showInformationMessage('Epic created.');
}