import * as vscode from "vscode";

export type EvidenceKind = "manifest" | "config" | "syntax" | "convention";

export interface SourceEvidence {
  uri: vscode.Uri;
  kind: EvidenceKind;
  line?: number;
  character?: number;
}

export interface DependencyInfo {
  name: string;
  declaredVersion: string;
  category:
    | "production"
    | "development"
    | "optional"
    | "peer"
    | "runtime"
    | "test"
    | "provided"
    | "compile";
  manifestUri: vscode.Uri;
  evidence: SourceEvidence;
}

export interface TechnologyFinding {
  name: string;
  category: "language" | "framework" | "tool";
  evidence: SourceEvidence;
}

export interface EntryPointFinding {
  uri: vscode.Uri;
  kind: "declared" | "candidate";
  evidence: SourceEvidence;
}

export interface RouteFinding {
  framework: string;
  path: string;
  methods: string[];
  uri: vscode.Uri;
  evidence: SourceEvidence;
}

export interface AnalysisDiagnostic {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  uri?: vscode.Uri;
  line?: number;
}

export interface ProjectAnalysis {
  id: string;
  name: string;
  rootUri: vscode.Uri;
  manifestUris: vscode.Uri[];
  findings: TechnologyFinding[];
  dependencies: DependencyInfo[];
  entryPoints: EntryPointFinding[];
  routes: RouteFinding[];
  routeAnalysis: "analyzed" | "unsupported" | "incomplete";
  diagnostics: AnalysisDiagnostic[];
}

export interface WorkspaceFolderAnalysis {
  name: string;
  uri: vscode.Uri;
  projects: ProjectAnalysis[];
  diagnostics: AnalysisDiagnostic[];
}

export interface ScanLimits {
  category: string;
  maximum: number;
}

export interface WorkspaceAnalysis {
  workspaceName: string;
  rootPath: string;
  workspaceFolders: WorkspaceFolderAnalysis[];
  status: "complete" | "partial" | "cancelled";
  truncated: ScanLimits[];
  diagnostics: AnalysisDiagnostic[];
  analyzedAt: number;
}

export interface PackageManifest {
  name?: string;
  main?: string;
  module?: string;
  browser?: string;
  bin?: string | Record<string, string>;
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}
