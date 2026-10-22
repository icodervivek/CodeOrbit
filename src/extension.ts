
import * as vscode from "vscode";

import { scanWorkspace } from "./core/workspaceScanner";
import { WorkspaceTreeProvider } from "./providers/workspaceTreeProvider";
import { DashboardViewProvider } from "./dashboard";
import { findOwningProjectRoot } from "./core/projectOwnership";
import { watchWorkspaceForChanges } from "./core/analysisWatchers";
import { WorkspaceAnalysis } from "./models/workspaceAnalysis";

export function activate(context: vscode.ExtensionContext) {
  const treeProvider = new WorkspaceTreeProvider();

  let latestAnalysis: WorkspaceAnalysis | undefined;
  let analysisStale = false;
  let analysisCancelled = false;
  let analysisGeneration = 0;
  let workspaceWatchers: vscode.Disposable | undefined;
  const dashboardProvider = new DashboardViewProvider(
    () => ({
      analysis: latestAnalysis,
      stale: analysisStale,
      cancelled: analysisCancelled,
      hasWorkspace: Boolean(vscode.workspace.workspaceFolders?.length),
    }),
    () => analyze(),
  );

  function clearWatchers(): void {
    workspaceWatchers?.dispose();
    workspaceWatchers = undefined;
  }

  function markStale(): void {
    if (!latestAnalysis || analysisStale) {
      return;
    }
    analysisStale = true;
    treeProvider.refresh(latestAnalysis, true);
    dashboardProvider.refresh();
  }

  function watchWorkspace(folders: readonly vscode.WorkspaceFolder[]): void {
    clearWatchers();
    workspaceWatchers = watchWorkspaceForChanges(folders, markStale);
  }

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "codeOrbit.workspace",
      treeProvider
    ),
    vscode.window.registerWebviewViewProvider(
      "codeOrbit.dashboard",
      dashboardProvider,
    ),
    dashboardProvider,
  );

  async function analyze(): Promise<WorkspaceAnalysis | undefined> {
    const requestGeneration = ++analysisGeneration;
    const folders = vscode.workspace.workspaceFolders;

    if (!folders?.length) {
      vscode.window.showWarningMessage(
        "CodeOrbit: Open a workspace folder first."
      );
      return undefined;
    }
    analysisCancelled = false;
    dashboardProvider.refresh();

    try {
      const analysis = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "CodeOrbit is analyzing your workspace...",
          cancellable: true,
        },
        (progress, token) => scanWorkspace(folders, token, progress)
      );

      if (analysis.status === "cancelled") {
        analysisCancelled = true;
        dashboardProvider.refresh();
        vscode.window.showWarningMessage(
          "CodeOrbit analysis was cancelled. The last completed analysis is unchanged."
        );
        return latestAnalysis;
      }

      if (requestGeneration !== analysisGeneration) {
        return latestAnalysis;
      }
      const currentFolders = vscode.workspace.workspaceFolders ?? [];
      const sameWorkspace = folders.length === currentFolders.length &&
        folders.every((folder, index) =>
          folder.uri.toString() === currentFolders[index].uri.toString(),
        );
      if (!sameWorkspace) {
        vscode.window.showWarningMessage(
          "CodeOrbit analysis was discarded because the workspace folders changed. Analyze again to refresh."
        );
        return latestAnalysis;
      }

      latestAnalysis = analysis;
      analysisStale = false;
      analysisCancelled = false;
      treeProvider.refresh(analysis);
      dashboardProvider.refresh();
      watchWorkspace(folders);

      vscode.window.showInformationMessage(
        `CodeOrbit: Analyzed ${analysis.workspaceFolders.length} workspace folders ` +
        `with ${analysis.diagnostics.length} diagnostics.`
      );

      return analysis;
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : String(error);

      vscode.window.showErrorMessage(
        `CodeOrbit analysis failed: ${message}`
      );

      return undefined;
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "codeOrbit.analyze",
      analyze
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codeOrbit.refresh", analyze)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "codeOrbit.openDashboard",
      async () => {
        await vscode.commands.executeCommand("workbench.view.extension.codeOrbit");
        if (!latestAnalysis && vscode.workspace.workspaceFolders?.length) {
          await analyze();
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "codeOrbit.openFile",
      async (uri: vscode.Uri) => {
        if (!(uri instanceof vscode.Uri)) {
          vscode.window.showWarningMessage(
            "CodeOrbit: The selected finding has no valid file location."
          );
          return;
        }

        try {
          await vscode.workspace.fs.stat(uri);
        } catch {
          vscode.window.showWarningMessage(
            "CodeOrbit: This finding points to a file that no longer exists. Reanalyze the workspace."
          );
          return;
        }

        try {
          const document = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(document, {
            preview: true,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(
            `CodeOrbit could not open the finding: ${message}`
          );
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles((event) => {
      if (!latestAnalysis) {
        return;
      }
      const roots = latestAnalysis.workspaceFolders.map((folder) => folder.uri);
      if (event.files.some((file) =>
        findOwningProjectRoot(file.oldUri, roots) ||
        findOwningProjectRoot(file.newUri, roots),
      )) {
        markStale();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      analysisGeneration += 1;
      clearWatchers();
      latestAnalysis = undefined;
      analysisStale = false;
      analysisCancelled = false;
      treeProvider.refresh();
      dashboardProvider.refresh();
    }),
  );

  context.subscriptions.push(new vscode.Disposable(clearWatchers));
}

export function deactivate() {}
