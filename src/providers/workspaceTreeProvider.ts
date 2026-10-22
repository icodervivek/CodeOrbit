import * as vscode from "vscode";
import {
  AnalysisDiagnostic,
  DependencyInfo,
  EntryPointFinding,
  ProjectAnalysis,
  RouteFinding,
  WorkspaceAnalysis,
  WorkspaceFolderAnalysis,
} from "../models/workspaceAnalysis";

class TreeNode {
  constructor(
    public readonly label: string,
    public readonly children: TreeNode[] = [],
    public readonly uri?: vscode.Uri,
    public readonly icon?: string,
    public readonly description?: string,
  ) {}
}

export class WorkspaceTreeProvider
  implements vscode.TreeDataProvider<TreeNode> {
  private readonly changed =
    new vscode.EventEmitter<TreeNode | undefined | void>();

  readonly onDidChangeTreeData = this.changed.event;

  private analysis?: WorkspaceAnalysis;
  private stale = false;

  refresh(analysis?: WorkspaceAnalysis, stale = false): void {
    this.analysis = analysis;
    this.stale = stale;
    this.changed.fire();
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.children.length
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    item.description = node.description;

    if (node.icon) {
      item.iconPath = new vscode.ThemeIcon(node.icon);
    }

    if (node.uri) {
      item.command = {
        command: "codeOrbit.openFile",
        title: "Open File",
        arguments: [node.uri],
      };
      item.tooltip = node.uri.toString();
      item.resourceUri = node.uri;
    }

    return item;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (node) {
      return node.children;
    }
    if (!this.analysis) {
      return [new TreeNode("Run CodeOrbit: Analyze Workspace", [], undefined, "play")];
    }

    const folders = this.analysis.workspaceFolders.map((folder) =>
      this.folderNode(folder),
    );
    const status = new TreeNode(
      `Analysis: ${this.analysis.status}${this.stale ? " (stale)" : ""}`,
      [],
      undefined,
      this.analysis.status === "complete" && !this.stale ? "check" : "warning",
      this.analysis.truncated.length
        ? `Truncated: ${this.analysis.truncated.map((item) => item.category).join(", ")}`
        : undefined,
    );
    return [
      status,
      ...folders,
    ];
  }

  private folderNode(folder: WorkspaceFolderAnalysis): TreeNode {
    const projects = folder.projects.map((project) => this.projectNode(project));
    const diagnostics = folder.diagnostics.map((diagnostic) =>
      this.diagnosticNode(diagnostic),
    );
    return new TreeNode(
      folder.name,
      [
        ...projects,
        ...(diagnostics.length
          ? [new TreeNode(`Diagnostics (${diagnostics.length})`, diagnostics, undefined, "warning")]
          : []),
      ],
      undefined,
      "root-folder",
    );
  }

  private projectNode(project: ProjectAnalysis): TreeNode {
    const findings = project.findings.map((finding) =>
      new TreeNode(
        `${finding.category}: ${finding.name}`,
        [],
        finding.evidence.uri,
        finding.category === "language" ? "code" : "layers",
        finding.evidence.kind,
      ),
    );
    const dependencies = project.dependencies.map((dependency) =>
      this.dependencyNode(dependency),
    );
    const entries = project.entryPoints.map((entry) =>
      this.entryPointNode(entry),
    );
    const routes = project.routes.map((route) => this.routeNode(route));
    const diagnostics = project.diagnostics.map((diagnostic) =>
      this.diagnosticNode(diagnostic),
    );
    const groups = [
      this.groupNode("Technologies", findings, "layers"),
      this.groupNode("Dependencies", dependencies, "package"),
      this.groupNode("Entry points", entries, "play"),
      new TreeNode(
        `Routes (${routes.length})`,
        routes.length
          ? routes
          : [new TreeNode(
            project.routeAnalysis === "unsupported"
              ? "No supported route framework identified"
              : "No supported routes found",
          )],
        undefined,
        "symbol-method",
        `Coverage: ${project.routeAnalysis}`,
      ),
      this.groupNode("Diagnostics", diagnostics, "warning"),
    ].filter((group) => group !== undefined);

    return new TreeNode(
      project.name,
      groups,
      undefined,
      "package",
      `${project.dependencies.length} dependencies, ${project.routes.length} routes`,
    );
  }

  private groupNode(
    label: string,
    children: TreeNode[],
    icon: string,
  ): TreeNode | undefined {
    return children.length
      ? new TreeNode(`${label} (${children.length})`, children, undefined, icon)
      : undefined;
  }

  private dependencyNode(dependency: DependencyInfo): TreeNode {
    return new TreeNode(
      `${dependency.name} (${dependency.declaredVersion})`,
      [],
      dependency.manifestUri,
      "package",
      dependency.category,
    );
  }

  private entryPointNode(entry: EntryPointFinding): TreeNode {
    return new TreeNode(
      vscode.workspace.asRelativePath(entry.uri),
      [],
      entry.uri,
      entry.kind === "declared" ? "play" : "file-code",
      `${entry.kind} entry point`,
    );
  }

  private routeNode(route: RouteFinding): TreeNode {
    return new TreeNode(
      `${route.methods.length ? `${route.methods.join(", ")} ` : ""}${route.path}`,
      [],
      route.uri,
      "symbol-method",
      `${route.framework} · ${route.evidence.kind}`,
    );
  }

  private diagnosticNode(diagnostic: AnalysisDiagnostic): TreeNode {
    return new TreeNode(
      `${diagnostic.code}: ${diagnostic.message}`,
      [],
      diagnostic.uri,
      diagnostic.severity === "error" ? "error" : "warning",
      diagnostic.uri ? vscode.workspace.asRelativePath(diagnostic.uri) : undefined,
    );
  }
}
