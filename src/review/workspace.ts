interface WorkspacePath {
  path: string;
  fsPath: string;
}

export function resolveReviewWorkspace(request: string, folders: WorkspacePath[]): string {
  let matches: WorkspacePath[];
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(request)) {
    const uri = new URL(request);
    if (!['file:', 'vscode-remote:'].includes(uri.protocol) || uri.search || uri.hash
      || (uri.protocol === 'file:' && uri.host)
      || (uri.protocol === 'vscode-remote:' && !uri.host)) {
      throw new Error('Unsupported or ambiguous review workspace URI');
    }
    const remotePath = decodeURIComponent(uri.pathname);
    matches = folders.filter(folder => folder.path === remotePath);
  } else {
    matches = folders.filter(folder => folder.fsPath === request);
  }
  if (matches.length !== 1) {
    throw new Error(`Review workspace is not one exact open workspace folder. Requested=${JSON.stringify(request)}; openFolders=${JSON.stringify(folders)}; platform=${process.platform}`);
  }
  return matches[0].fsPath;
}
