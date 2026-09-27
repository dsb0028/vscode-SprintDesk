import { isAbsolute, relative, resolve } from 'path';

/** Calendar actions may open task Markdown, never a path supplied by a webview. */
export function calendarTaskPath(root: string, filename: string, storedPath?: string): string {
  const path = resolve(root, storedPath || filename);
  const within = relative(resolve(root), path);
  if (within === '..' || within.startsWith('../') || isAbsolute(within) || !path.endsWith('.md')) {
    throw new Error('Task Markdown path must stay inside the workspace Tasks directory.');
  }
  return path;
}

/** Use the task's authored description; do not substitute generated sample text. */
export function calendarDescription(markdown: string): string {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const description = body.split(/^##[ \t]+/m).find(section => /^[^\r\n]*Description[^\r\n]*\r?\n/i.test(section));
  return (description ? description.replace(/^[^\r\n]*\r?\n/, '') : body.replace(/^# .*\r?\n/, '')).trim();
}
