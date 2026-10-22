import * as vscode from "vscode";

import {
  AnalysisDiagnostic,
  DependencyInfo,
  EntryPointFinding,
  PackageManifest,
  SourceEvidence,
  TechnologyFinding,
} from "../models/workspaceAnalysis";

export interface JavaScriptDetection {
  dependencies: DependencyInfo[];
  findings: TechnologyFinding[];
  entryPoints: EntryPointFinding[];
  diagnostics: AnalysisDiagnostic[];
}

const dependencySections = [
  ["dependencies", "production"],
  ["devDependencies", "development"],
  ["optionalDependencies", "optional"],
  ["peerDependencies", "peer"],
] as const;

const entryPointFields = ["main", "module", "browser", "bin"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectExportTargets(value: unknown, output: Set<string>): void {
  if (typeof value === "string") {
    if (value.startsWith("./")) {
      output.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectExportTargets(item, output);
    }
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      collectExportTargets(item, output);
    }
  }
}

export function analyzeJavaScriptManifest(
  manifest: PackageManifest,
  manifestUri: vscode.Uri,
  projectFiles: readonly vscode.Uri[],
  configFiles: readonly vscode.Uri[],
): JavaScriptDetection {
  const dependencies: DependencyInfo[] = [];
  const diagnostics: AnalysisDiagnostic[] = [];

  for (const [section, category] of dependencySections) {
    const values = manifest[section];
    if (values === undefined) {
      continue;
    }

    if (!isRecord(values)) {
      diagnostics.push({
        code: "invalid-dependency-section",
        message: `${section} must be an object of package names and declared version expressions.`,
        severity: "warning",
        uri: manifestUri,
      });
      continue;
    }

    for (const [name, value] of Object.entries(values)) {
      if (typeof value !== "string") {
        diagnostics.push({
          code: "invalid-dependency-declaration",
          message: `Dependency "${name}" in ${section} has a non-string declaration.`,
          severity: "warning",
          uri: manifestUri,
        });
        continue;
      }

      const evidence: SourceEvidence = {
        uri: manifestUri,
        kind: "manifest",
      };
      dependencies.push({
        name,
        declaredVersion: value,
        category,
        manifestUri,
        evidence,
      });
    }
  }

  const findings: TechnologyFinding[] = [];
  const addFinding = (
    name: string,
    category: TechnologyFinding["category"],
    evidence: SourceEvidence,
  ) => {
    findings.push({ name, category, evidence });
  };

  const sourceFiles = projectFiles.filter((file) =>
    /\.(?:[cm]?[jt]sx?)$/i.test(file.path),
  );
  const hasJavaScript = sourceFiles.some((file) =>
    /\.(?:jsx?|mjs|cjs)$/i.test(file.path),
  );
  const hasTypeScript = sourceFiles.some((file) =>
    /\.(?:tsx?|mts|cts)$/i.test(file.path),
  );

  if (hasJavaScript) {
    const evidenceFile = sourceFiles.find((file) =>
      /\.(?:jsx?|mjs|cjs)$/i.test(file.path),
    );
    if (evidenceFile) {
      addFinding("JavaScript", "language", {
        uri: evidenceFile,
        kind: "convention",
      });
    }
  }

  if (hasTypeScript) {
    const evidenceFile = sourceFiles.find((file) =>
      /\.(?:tsx?|mts|cts)$/i.test(file.path),
    );
    if (evidenceFile) {
      addFinding("TypeScript", "language", {
        uri: evidenceFile,
        kind: "convention",
      });
    }
  }

  const configByName = new Map(
    configFiles.map((file) => [file.path.split("/").pop()?.toLowerCase(), file]),
  );
  const addDependencyFinding = (packageName: string, displayName: string) => {
    const dependency = dependencies.find((item) => item.name === packageName);
    if (dependency) {
      addFinding(displayName, "framework", dependency.evidence);
    }
  };
  const addConfigFinding = (configName: string, displayName: string) => {
    const config = configByName.get(configName);
    if (config) {
      addFinding(displayName, "framework", { uri: config, kind: "config" });
    }
  };

  addDependencyFinding("react", "React");
  addDependencyFinding("next", "Next.js");
  addConfigFinding("next.config.js", "Next.js");
  addConfigFinding("next.config.cjs", "Next.js");
  addConfigFinding("next.config.mjs", "Next.js");
  addConfigFinding("next.config.ts", "Next.js");
  addConfigFinding("next.config.mts", "Next.js");
  addDependencyFinding("vite", "Vite");
  addConfigFinding("vite.config.js", "Vite");
  addConfigFinding("vite.config.mjs", "Vite");
  addConfigFinding("vite.config.ts", "Vite");
  addConfigFinding("vite.config.mts", "Vite");
  addDependencyFinding("express", "Express");
  addDependencyFinding("react-native", "React Native");
  addDependencyFinding("electron", "Electron");
  addDependencyFinding("typescript", "TypeScript tooling");

  const entryPoints: EntryPointFinding[] = [];
  const entryTargets = new Set<string>();
  for (const field of entryPointFields) {
    const value = manifest[field];
    const targets = typeof value === "string"
      ? [value]
      : field === "bin" && isRecord(value)
        ? Object.values(value).filter((target): target is string =>
          typeof target === "string",
        )
        : [];
    for (const target of targets) {
      entryTargets.add(target);
    }
  }
  collectExportTargets(manifest.exports, entryTargets);
  for (const target of entryTargets) {
    entryPoints.push({
      uri: vscode.Uri.joinPath(manifestUri, "..", target),
      kind: "declared",
      evidence: { uri: manifestUri, kind: "manifest" },
    });
  }

  return {
    dependencies,
    findings: findings.filter((finding, index, all) =>
      all.findIndex((other) =>
        other.name === finding.name &&
        other.category === finding.category &&
        other.evidence.uri.toString() === finding.evidence.uri.toString(),
      ) === index,
    ),
    entryPoints,
    diagnostics,
  };
}
