import * as vscode from "vscode";

const WATCH_PATTERNS = [
  "**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,py,java}",
  "**/{package.json,pyproject.toml,requirements*.txt,Pipfile,pom.xml,build.gradle,build.gradle.kts,tsconfig.json,jsconfig.json,vite.config.*,next.config.*,webpack.config.*,eslint.config.*,babel.config.*,.babelrc}",
];

export function watchWorkspaceForChanges(
  folders: readonly vscode.WorkspaceFolder[],
  onStale: () => void,
): vscode.Disposable {
  const disposables: vscode.Disposable[] = [];
  for (const folder of folders) {
    for (const pattern of WATCH_PATTERNS) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, pattern),
      );
      disposables.push(
        watcher,
        watcher.onDidCreate(onStale),
        watcher.onDidChange(onStale),
        watcher.onDidDelete(onStale),
      );
    }
  }

  return vscode.Disposable.from(...disposables);
}
