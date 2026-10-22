import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { ProjectAnalysis, WorkspaceAnalysis } from "./models/workspaceAnalysis";

export interface DashboardState {
  analysis?: WorkspaceAnalysis;
  stale: boolean;
  cancelled: boolean;
  hasWorkspace: boolean;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function renderList(values: string[]): string {
  if (values.length === 0) {
    return "<li>None found</li>";
  }
  const visible = values.slice(0, 30);
  const remainder = values.length - visible.length;
  return visible.map((value) => `<li>${escapeHtml(value)}</li>`).join("") +
    (remainder > 0 ? `<li>${remainder} more not shown</li>` : "");
}

function projectMarkup(project: ProjectAnalysis): string {
  const findings = project.findings.map(
    (finding) => `${finding.category}: ${finding.name} — ${finding.evidence.kind}`,
  );
  const dependencies = project.dependencies.map(
    (dependency) =>
      `${dependency.name} (${dependency.declaredVersion}) [${dependency.category}]`,
  );
  const entries = project.entryPoints.map(
    (entry) =>
      `${vscode.workspace.asRelativePath(entry.uri)} (${entry.kind})`,
  );
  const routes = project.routes.map(
    (route) =>
      `${route.methods.length ? `${route.methods.join(", ")} ` : ""}${route.path} (${route.framework})`,
  );
  const diagnostics = project.diagnostics.map(
    (diagnostic) => `${diagnostic.severity}: ${diagnostic.message}`,
  );

  return `
    <details class="project">
      <summary>
        <strong>${escapeHtml(project.name)}</strong>
        <span class="muted">${escapeHtml(vscode.workspace.asRelativePath(project.rootUri))}</span>
        <span class="muted">${project.findings.length} technologies · ${dependencies.length} dependencies · ${entries.length} entry points · ${routes.length} routes</span>
      </summary>
      <h3>Technologies</h3><ul>${renderList(findings)}</ul>
      <h3>Dependencies (${dependencies.length})</h3><ul>${renderList(dependencies)}</ul>
      <h3>Entry points</h3><ul>${renderList(entries)}</ul>
      <h3>Routes (${routes.length}) · Coverage: ${escapeHtml(project.routeAnalysis)}</h3><ul>${renderList(routes)}</ul>
      <h3>Diagnostics (${diagnostics.length})</h3><ul>${renderList(diagnostics)}</ul>
    </details>`;
}

export function renderDashboardHtml(
  state: DashboardState,
  nonce = randomBytes(16).toString("base64"),
): string {
  const { analysis, stale, cancelled, hasWorkspace } = state;
  const projects = analysis?.workspaceFolders.flatMap((folder) => folder.projects) ?? [];
  const dependencies = projects.reduce(
    (count, project) => count + project.dependencies.length,
    0,
  );
  const entryPoints = projects.reduce(
    (count, project) => count + project.entryPoints.length,
    0,
  );
  const routes = projects.reduce(
    (count, project) => count + project.routes.length,
    0,
  );
  const diagnostics = analysis?.diagnostics ?? [];
  const technologies = [...new Set(
    projects.flatMap((project) => project.findings.map((finding) => finding.name)),
  )].sort();
  const truncationText = analysis?.truncated.length
    ? analysis.truncated.map((item) => `${item.category} (limit ${item.maximum})`).join(", ")
    : "None";
  const status = analysis
    ? `${analysis.status}${stale ? " · stale" : ""}${cancelled ? " · last attempt cancelled" : ""}`
    : cancelled
      ? "No completed analysis · last attempt cancelled"
      : "Not analyzed";
  const notice = !hasWorkspace
    ? "Open a workspace folder to analyze its projects."
    : cancelled
      ? analysis
        ? "The latest analysis attempt was cancelled. Showing the last completed results."
        : "Analysis was cancelled before results were available. Try again when ready."
      : stale
        ? "Workspace files changed since this analysis. Refresh to update these results."
        : analysis?.status === "partial"
          ? "Analysis is partial. Some findings may be missing; review diagnostics and scan limits."
          : !analysis
            ? "Analyze this workspace to discover projects, technologies, entry points, and routes."
            : "Results reflect the latest completed workspace analysis.";
  const actionLabel = analysis ? "Refresh analysis" : "Analyze workspace";

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>CodeOrbit</title>
      <style>
        body {
          font-family: var(--vscode-font-family);
          color: var(--vscode-foreground);
          background: var(--vscode-sideBar-background);
          padding: 12px;
          overflow-wrap: anywhere;
        }
        h1 { font-size: 1.4em; margin-top: 4px; }
        h2 { font-size: 1.1em; }
        h3 { font-size: 1em; margin-bottom: 4px; }
        .muted { color: var(--vscode-descriptionForeground); }
        .notice {
          border-left: 3px solid var(--vscode-focusBorder);
          padding: 8px;
          background: var(--vscode-editor-background);
        }
        .stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
        .stat, .project {
          padding: 8px;
          border: 1px solid var(--vscode-panel-border);
          margin: 8px 0;
        }
        .stat strong { display: block; font-size: 1.3em; }
        .project summary { cursor: pointer; }
        .project summary span { display: block; margin-top: 4px; }
        button {
          width: 100%;
          padding: 6px;
          color: var(--vscode-button-foreground);
          background: var(--vscode-button-background);
          border: none;
          cursor: pointer;
        }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button:disabled { opacity: 0.6; cursor: default; }
        ul { padding-left: 18px; }
        li { margin: 5px 0; }
      </style>
    </head>
    <body>
      <h1>CodeOrbit</h1>
      <p class="muted">Local static workspace analysis · ${escapeHtml(status)}</p>
      <p class="notice">${escapeHtml(notice)}</p>
      <button id="analyze" type="button" ${hasWorkspace ? "" : "disabled"}>${actionLabel}</button>
      ${analysis ? `
        <section>
          <h2>${escapeHtml(analysis.workspaceName)}</h2>
          <div class="stats">
            <div class="stat"><strong>${analysis.workspaceFolders.length}</strong>Workspace folders</div>
            <div class="stat"><strong>${projects.length}</strong>Projects</div>
            <div class="stat"><strong>${dependencies}</strong>Dependencies</div>
            <div class="stat"><strong>${entryPoints}</strong>Entry points</div>
            <div class="stat"><strong>${routes}</strong>Static routes</div>
            <div class="stat"><strong>${diagnostics.length}</strong>Diagnostics</div>
          </div>
          <h2>Technologies</h2>
          <ul>${renderList(technologies)}</ul>
          <p class="muted">Scan limits reached: ${escapeHtml(truncationText)}</p>
          ${analysis.workspaceFolders.map((folder) => `
            <h2>Workspace: ${escapeHtml(folder.name)}</h2>
            ${folder.projects.map(projectMarkup).join("")}
            ${folder.diagnostics.length
              ? `<p>Workspace diagnostics: ${escapeHtml(folder.diagnostics.map((item) => item.message).join("; "))}</p>`
              : ""}
          `).join("")}
          <p class="muted">Last analyzed: ${new Date(analysis.analyzedAt).toLocaleString()}</p>
        </section>
      ` : ""}
      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        document.getElementById("analyze").addEventListener("click", () => {
          vscode.postMessage({ command: "analyze" });
        });
      </script>
    </body>
    </html>`;
}

export async function handleDashboardMessage(
  message: unknown,
  onAnalyze: () => Promise<unknown> | unknown,
): Promise<boolean> {
  if (
    !message ||
    typeof message !== "object" ||
    !("command" in message) ||
    message.command !== "analyze"
  ) {
    return false;
  }
  await onAnalyze();
  return true;
}

export class DashboardViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private readonly viewSubscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly getState: () => DashboardState,
    private readonly onAnalyze: () => Promise<unknown> | unknown,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.disposeViewSubscriptions();
    this.view = view;
    view.webview.options = { enableScripts: true };
    this.viewSubscriptions.push(
      view.webview.onDidReceiveMessage((message: unknown) =>
        handleDashboardMessage(message, this.onAnalyze),
      ),
      view.onDidDispose(() => {
        this.disposeViewSubscriptions();
        this.view = undefined;
      }),
    );
    this.refresh();
  }

  refresh(): void {
    if (this.view) {
      this.view.webview.html = renderDashboardHtml(this.getState());
    }
  }

  dispose(): void {
    this.disposeViewSubscriptions();
    this.view = undefined;
  }

  private disposeViewSubscriptions(): void {
    while (this.viewSubscriptions.length > 0) {
      this.viewSubscriptions.pop()?.dispose();
    }
  }
}
