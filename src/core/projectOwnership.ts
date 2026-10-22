import * as vscode from "vscode";

function isWithinRoot(file: vscode.Uri, root: vscode.Uri): boolean {
  if (file.scheme !== root.scheme || file.authority !== root.authority) {
    return false;
  }

  const rootPath = root.path.replace(/\/+$/, "") || "/";
  const filePath = file.path;

  return filePath === rootPath ||
    filePath.startsWith(rootPath === "/" ? rootPath : `${rootPath}/`);
}

export function findOwningProjectRoot(
  file: vscode.Uri,
  projectRoots: readonly vscode.Uri[],
): vscode.Uri | undefined {
  return projectRoots
    .filter((root) => isWithinRoot(file, root))
    .sort((a, b) => b.path.length - a.path.length)[0];
}
