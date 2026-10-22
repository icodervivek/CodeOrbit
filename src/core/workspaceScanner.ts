import * as vscode from "vscode";

import { analyzeJavaScriptManifest } from "../analyzers/javascriptAnalyzer";
import { analyzeJavaManifest, analyzeSpringRoutes } from "../analyzers/javaAnalyzer";
import {
  analyzePythonManifest,
  analyzePythonRoutes,
} from "../analyzers/pythonAnalyzer";
import {
  analyzeExpressRoutes,
  analyzeNextRouteFile,
} from "../analyzers/routeAnalyzer";
import {
  AnalysisDiagnostic,
  PackageManifest,
  ProjectAnalysis,
  ScanLimits,
  WorkspaceAnalysis,
  WorkspaceFolderAnalysis,
} from "../models/workspaceAnalysis";
import { findOwningProjectRoot } from "./projectOwnership";

const EXCLUDE =
  "**/{node_modules,.git,dist,build,out,coverage,.next,.venv,venv,env,__pycache__,.tox,.nox,.mypy_cache,.pytest_cache,.ruff_cache,.gradle,target,site-packages}/**";
const SOURCE_GLOB = "**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,py,java}";
const CONFIG_GLOB =
  "**/{package.json,pyproject.toml,requirements*.txt,Pipfile,pom.xml,build.gradle,build.gradle.kts,tsconfig.json,jsconfig.json,vite.config.*,next.config.*,webpack.config.*,eslint.config.*,babel.config.*,.babelrc}";
const MANIFEST_GLOB =
  "**/{package.json,pyproject.toml,requirements*.txt,Pipfile,pom.xml,build.gradle,build.gradle.kts}";
const MAX_MANIFESTS = 200;
const MAX_SOURCE_FILES = 5000;
const MAX_CONFIG_FILES = 5000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_IO_CONCURRENCY = 8;
const SOURCE_CANDIDATES = new Set([
  "index.js",
  "index.jsx",
  "index.ts",
  "index.tsx",
  "main.js",
  "main.jsx",
  "main.ts",
  "main.tsx",
  "server.js",
  "server.ts",
  "app.js",
  "app.ts",
  "main.py",
  "app.py",
  "manage.py",
  "wsgi.py",
  "asgi.py",
]);

interface CandidateFiles {
  files: vscode.Uri[];
  truncated: boolean;
}

export async function readSourceText(
  uri: vscode.Uri,
  knownSize?: number,
): Promise<string> {
  const size = knownSize ?? (await vscode.workspace.fs.stat(uri)).size;
  if (size > MAX_FILE_BYTES) {
    throw new Error(
      `File exceeds the ${MAX_FILE_BYTES}-byte analysis limit.`,
    );
  }
  const bytes = await vscode.workspace.fs.readFile(uri);
  return new TextDecoder().decode(bytes);
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) {
          return;
        }
        results[index] = await mapper(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function isRecord(value: unknown): value is PackageManifest {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectId(uri: vscode.Uri): string {
  return uri.toString(true);
}

function relativePath(root: vscode.Uri, uri: vscode.Uri): string {
  const prefix = root.path.replace(/\/+$/, "");
  return uri.path.slice(prefix.length).replace(/^\/+/, "");
}

function makeDiagnostic(
  code: string,
  message: string,
  severity: AnalysisDiagnostic["severity"],
  uri?: vscode.Uri,
): AnalysisDiagnostic {
  return { code, message, severity, uri };
}

async function findCandidates(
  folder: vscode.WorkspaceFolder,
  pattern: string,
  maximum: number,
): Promise<CandidateFiles> {
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, pattern),
    EXCLUDE,
    maximum + 1,
  );
  return {
    files: files.slice(0, maximum),
    truncated: files.length > maximum,
  };
}

async function discoverCandidates(
  folder: vscode.WorkspaceFolder,
  pattern: string,
  maximum: number,
  category: string,
  diagnostics: AnalysisDiagnostic[],
): Promise<CandidateFiles> {
  try {
    return await findCandidates(folder, pattern, maximum);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    diagnostics.push(
      makeDiagnostic(
        "workspace-discovery-failed",
        `Could not enumerate ${category}: ${detail}`,
        "warning",
        folder.uri,
      ),
    );
    return { files: [], truncated: false };
  }
}

function makeProject(rootUri: vscode.Uri, folder: vscode.WorkspaceFolder): ProjectAnalysis {
  return {
    id: projectId(rootUri),
    name: rootUri.toString() === folder.uri.toString()
      ? folder.name
      : relativePath(folder.uri, rootUri),
    rootUri,
    manifestUris: [],
    findings: [],
    dependencies: [],
    entryPoints: [],
    routes: [],
    routeAnalysis: "unsupported",
    diagnostics: [],
  };
}

async function readManifest(
  uri: vscode.Uri,
): Promise<{ manifest?: PackageManifest; diagnostic?: AnalysisDiagnostic }> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_FILE_BYTES) {
      return {
        diagnostic: makeDiagnostic(
          "file-size-limit",
          `Manifest exceeds the ${MAX_FILE_BYTES}-byte analysis limit.`,
          "warning",
          uri,
        ),
      };
    }

    const bytes = await vscode.workspace.fs.readFile(uri);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(parsed)) {
      return {
        diagnostic: makeDiagnostic(
          "invalid-manifest",
          "Package manifest must be a JSON object.",
          "warning",
          uri,
        ),
      };
    }

    return { manifest: parsed };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      diagnostic: makeDiagnostic(
        "manifest-read-failed",
        `Could not read or parse manifest: ${detail}`,
        "warning",
        uri,
      ),
    };
  }
}

async function scanFolder(
  folder: vscode.WorkspaceFolder,
  token: vscode.CancellationToken | undefined,
  workspaceTruncations: ScanLimits[],
  progress?: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<WorkspaceFolderAnalysis> {
  const folderDiagnostics: AnalysisDiagnostic[] = [];
  const projectsById = new Map<string, ProjectAnalysis>();
  const rootProject = makeProject(folder.uri, folder);
  projectsById.set(rootProject.id, rootProject);

  const addDiagnostic = (
    diagnostic: AnalysisDiagnostic,
    ownerRoot?: vscode.Uri,
  ) => {
    const owner = ownerRoot
      ? projectsById.get(projectId(ownerRoot))
      : undefined;
    if (owner) {
      owner.diagnostics.push(diagnostic);
    } else {
      folderDiagnostics.push(diagnostic);
    }
  };

  let manifests: CandidateFiles = { files: [], truncated: false };
  let sourceFiles: CandidateFiles = { files: [], truncated: false };
  let configFiles: CandidateFiles = { files: [], truncated: false };

  progress?.report({ message: `Discovering files in ${folder.name}...` });
  [manifests, sourceFiles, configFiles] = await Promise.all([
    discoverCandidates(
      folder,
      MANIFEST_GLOB,
      MAX_MANIFESTS,
      "manifest files",
      folderDiagnostics,
    ),
    discoverCandidates(
      folder,
      SOURCE_GLOB,
      MAX_SOURCE_FILES,
      "source files",
      folderDiagnostics,
    ),
    discoverCandidates(
      folder,
      CONFIG_GLOB,
      MAX_CONFIG_FILES,
      "configuration files",
      folderDiagnostics,
    ),
  ]);

  for (const [truncated, category, maximum] of [
    [manifests.truncated, "manifest files", MAX_MANIFESTS],
    [sourceFiles.truncated, "source files", MAX_SOURCE_FILES],
    [configFiles.truncated, "configuration files", MAX_CONFIG_FILES],
  ] as const) {
    if (truncated) {
      const limit = { category, maximum };
      workspaceTruncations.push(limit);
      folderDiagnostics.push(
        makeDiagnostic(
          "scan-count-limit",
          `Analysis stopped after ${maximum} ${category}; results may be incomplete.`,
          "warning",
          folder.uri,
        ),
      );
    }
  }

  for (const manifestUri of manifests.files) {
    const rootUri = vscode.Uri.joinPath(manifestUri, "..");
    const id = projectId(rootUri);
    let project = projectsById.get(id);
    if (!project) {
      project = makeProject(rootUri, folder);
      projectsById.set(id, project);
    }
    project.manifestUris.push(manifestUri);
  }

  const projectRoots = [...projectsById.values()].map((project) => project.rootUri);
  const filesByProject = new Map<string, vscode.Uri[]>();
  const configsByProject = new Map<string, vscode.Uri[]>();
  for (const file of sourceFiles.files) {
    const owner = findOwningProjectRoot(file, projectRoots) ?? folder.uri;
    const id = projectId(owner);
    const files = filesByProject.get(id) ?? [];
    files.push(file);
    filesByProject.set(id, files);
  }
  for (const file of configFiles.files) {
    const owner = findOwningProjectRoot(file, projectRoots) ?? folder.uri;
    const id = projectId(owner);
    const files = configsByProject.get(id) ?? [];
    files.push(file);
    configsByProject.set(id, files);
  }

  for (const project of projectsById.values()) {
    if (token?.isCancellationRequested) {
      folderDiagnostics.push(
        makeDiagnostic(
          "scan-cancelled",
          "Workspace analysis was cancelled before all projects were analyzed.",
          "info",
          folder.uri,
        ),
      );
      break;
    }

    progress?.report({ message: `Analyzing ${project.name}...` });
    const projectFiles = filesByProject.get(project.id) ?? [];
    const projectConfigs = configsByProject.get(project.id) ?? [];
    const fileDetection = analyzeJavaScriptManifest(
      {},
      project.rootUri,
      projectFiles,
      projectConfigs,
    );
    project.findings.push(...fileDetection.findings);
    const pythonBase = analyzePythonManifest("", project.rootUri, projectFiles);
    const javaBase = analyzeJavaManifest("", project.rootUri, projectFiles);
    project.findings.push(...pythonBase.findings, ...javaBase.findings);

    for (const manifestUri of project.manifestUris) {
      if (token?.isCancellationRequested) {
        break;
      }

      const manifestName = manifestUri.path.split("/").at(-1)?.toLowerCase() ?? "";
      if (manifestName !== "package.json") {
        try {
          const text = await readSourceText(manifestUri);
          if (
            manifestName === "pyproject.toml" ||
            manifestName === "pipfile" ||
            manifestName.startsWith("requirements") && manifestName.endsWith(".txt")
          ) {
            const result = analyzePythonManifest(text, manifestUri, projectFiles);
            project.dependencies.push(...result.dependencies);
            project.findings.push(...result.findings);
            project.diagnostics.push(...result.diagnostics);
            if (result.projectName) {
              project.name = result.projectName;
            }
          } else if (
            manifestName === "pom.xml" ||
            manifestName === "build.gradle" ||
            manifestName === "build.gradle.kts"
          ) {
            const result = analyzeJavaManifest(text, manifestUri, projectFiles);
            project.dependencies.push(...result.dependencies);
            project.findings.push(...result.findings);
            project.diagnostics.push(...result.diagnostics);
            if (result.projectName) {
              project.name = result.projectName;
            }
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          project.diagnostics.push(
            makeDiagnostic(
              "manifest-read-failed",
              `Could not read ecosystem manifest: ${detail}`,
              "warning",
              manifestUri,
            ),
          );
        }
        continue;
      }

      const result = await readManifest(manifestUri);
      if (!result.manifest) {
        const diagnostic = result.diagnostic ?? makeDiagnostic(
          "manifest-read-failed",
          "Could not read package manifest.",
          "warning",
          manifestUri,
        );
        project.diagnostics.push(diagnostic);
        continue;
      }

      if (typeof result.manifest.name === "string") {
        project.name = result.manifest.name;
      }

      const detection = analyzeJavaScriptManifest(
        result.manifest,
        manifestUri,
        projectFiles,
        projectConfigs,
      );
      project.dependencies.push(...detection.dependencies);
      project.findings.push(...detection.findings);
      project.entryPoints.push(...detection.entryPoints);
      project.diagnostics.push(...detection.diagnostics);

      for (const entryPoint of detection.entryPoints) {
        const owner = findOwningProjectRoot(entryPoint.uri, [folder.uri]);
        if (!owner) {
          project.entryPoints = project.entryPoints.filter(
            (entry) => entry !== entryPoint,
          );
          project.diagnostics.push(
            makeDiagnostic(
              "entry-point-outside-workspace",
              "Declared entry point is outside the workspace and was not followed.",
              "warning",
              manifestUri,
            ),
          );
          continue;
        }

        try {
          await vscode.workspace.fs.stat(entryPoint.uri);
        } catch {
          project.entryPoints = project.entryPoints.filter(
            (entry) => entry !== entryPoint,
          );
          project.diagnostics.push(
            makeDiagnostic(
              "entry-point-not-found",
              `Declared entry point "${relativePath(project.rootUri, entryPoint.uri)}" could not be found.`,
              "warning",
              manifestUri,
            ),
          );
        }
      }
    }

    const sourceSizes = new Map<string, number>();
    const sourceStatResults = await mapWithConcurrency(
      projectFiles,
      MAX_IO_CONCURRENCY,
      async (file) => {
        if (token?.isCancellationRequested) {
          return undefined;
        }
        try {
          const stat = await vscode.workspace.fs.stat(file);
          sourceSizes.set(file.toString(), stat.size);
          const name = file.path.split("/").pop()?.toLowerCase();
          if (
            stat.size <= MAX_FILE_BYTES &&
            name &&
            (SOURCE_CANDIDATES.has(name) ||
              /\.java$/i.test(file.path) && /Application\.java$/i.test(name))
          ) {
            project.entryPoints.push({
              uri: file,
              kind: "candidate",
              evidence: { uri: file, kind: "convention" },
            });
          }
          return stat.size > MAX_FILE_BYTES
            ? makeDiagnostic(
              "file-size-limit",
              `Source file exceeds the ${MAX_FILE_BYTES}-byte analysis limit.`,
              "warning",
              file,
            )
            : undefined;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          return makeDiagnostic(
            "source-stat-failed",
            `Could not inspect source file: ${detail}`,
            "warning",
            file,
          );
        }
      },
    );
    project.diagnostics.push(
      ...sourceStatResults.filter(
        (diagnostic): diagnostic is AnalysisDiagnostic => diagnostic !== undefined,
      ),
    );

    const hasExpress = project.findings.some(
      (finding) => finding.name === "Express",
    );
    const hasNext = project.findings.some(
      (finding) => finding.name === "Next.js",
    );
    const hasPythonFramework = ["FastAPI", "Flask", "Django"].some((name) =>
      project.findings.some((finding) => finding.name === name),
    );
    const hasSpringBoot = project.findings.some(
      (finding) => finding.name === "Spring Boot",
    );
    const hasPythonSources = projectFiles.some((file) => file.path.toLowerCase().endsWith(".py"));
    const hasJavaSources = projectFiles.some((file) => file.path.toLowerCase().endsWith(".java"));
    if (hasExpress || hasNext || hasPythonFramework || hasSpringBoot || hasPythonSources || hasJavaSources) {
      if (hasExpress || hasNext || hasPythonFramework || hasSpringBoot) {
        project.routeAnalysis = "analyzed";
      }
      const routeFiles = projectFiles.filter((file) => {
        const path = file.path.toLowerCase();
        return path.endsWith(".py") ||
          path.endsWith(".java") ||
          (hasExpress || hasNext) &&
            /\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$/.test(path);
      });
      const routeSources = await mapWithConcurrency(
        routeFiles,
        MAX_IO_CONCURRENCY,
        async (file) => {
          if (token?.isCancellationRequested) {
            return { file };
          }
          try {
            return {
              file,
              text: await readSourceText(file, sourceSizes.get(file.toString())),
            };
          } catch (error) {
            return { file, error };
          }
        },
      );
      for (const routeSource of routeSources) {
        if (token?.isCancellationRequested) {
          break;
        }
        const { file, text, error } = routeSource;
        if (error || text === undefined) {
          const detail = error instanceof Error ? error.message : String(error ?? "");
          if (!detail.includes("analysis limit")) {
            project.routeAnalysis = "incomplete";
            project.diagnostics.push(
              makeDiagnostic(
                "route-source-read-failed",
                `Could not analyze source for routes: ${detail}`,
                "warning",
                file,
              ),
            );
          }
          continue;
        }
        try {
          if (hasExpress) {
            const result = analyzeExpressRoutes(text, file);
            project.routes.push(...result.routes);
            project.diagnostics.push(...result.diagnostics);
            if (result.diagnostics.length > 0) {
              project.routeAnalysis = "incomplete";
            }
          }
          if (hasNext) {
            const result = analyzeNextRouteFile(file, project.rootUri, text);
            project.routes.push(...result.routes);
            project.diagnostics.push(...result.diagnostics);
            if (result.diagnostics.length > 0) {
              project.routeAnalysis = "incomplete";
            }
          }
          if (file.path.toLowerCase().endsWith(".py")) {
            const pythonFrameworks = [
              ["FastAPI", /\b(?:from\s+fastapi\b|import\s+fastapi\b)/],
              ["Flask", /\b(?:from\s+flask\b|import\s+flask\b)/],
              ["Django", /\b(?:from\s+django\.urls\b|import\s+django\.urls\b)/],
            ] as const;
            for (const [framework, pattern] of pythonFrameworks) {
              if (pattern.test(text) && !project.findings.some(
                (finding) => finding.name === framework,
              )) {
                project.findings.push({
                  name: framework,
                  category: "framework",
                  evidence: { uri: file, kind: "syntax" },
                });
                project.routeAnalysis = "analyzed";
              }
            }
            for (const framework of ["FastAPI", "Flask", "Django"] as const) {
              const result = analyzePythonRoutes(text, file, framework);
              project.routes.push(...result.routes);
              project.diagnostics.push(...result.diagnostics);
              if (result.diagnostics.length > 0) {
                project.routeAnalysis = "incomplete";
              } else if (result.routes.length > 0) {
                project.routeAnalysis = "analyzed";
              }
              if (result.routes.length > 0 && !project.findings.some(
                (finding) => finding.name === framework,
              )) {
                project.findings.push({
                  name: framework,
                  category: "framework",
                  evidence: { uri: file, kind: "syntax" },
                });
              }
            }
          }
          if (file.path.toLowerCase().endsWith(".java")) {
            if (
              /@SpringBootApplication\b/.test(text) &&
              !project.findings.some((finding) => finding.name === "Spring Boot")
            ) {
              project.findings.push({
                name: "Spring Boot",
                category: "framework",
                evidence: { uri: file, kind: "syntax" },
              });
              project.routeAnalysis = "analyzed";
            }
            if (hasSpringBoot || project.findings.some(
              (finding) => finding.name === "Spring Boot",
            )) {
              const result = analyzeSpringRoutes(text, file);
              project.routes.push(...result.routes);
              project.diagnostics.push(...result.diagnostics);
              if (result.diagnostics.length > 0) {
                project.routeAnalysis = "incomplete";
              } else if (result.routes.length > 0) {
                project.routeAnalysis = "analyzed";
              }
            }
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          project.routeAnalysis = "incomplete";
          if (!detail.includes("analysis limit")) {
            project.routeAnalysis = "incomplete";
            project.diagnostics.push(
              makeDiagnostic(
                "route-source-read-failed",
                `Could not analyze source for routes: ${detail}`,
                "warning",
                file,
              ),
            );
          }
        }
      }
    }

  }

  if (token?.isCancellationRequested) {
    folderDiagnostics.push(
      makeDiagnostic(
        "scan-cancelled",
        "Workspace analysis was cancelled; findings collected so far are partial.",
        "info",
        folder.uri,
      ),
    );
  }

  for (const project of projectsById.values()) {
    project.dependencies.sort((a, b) => a.name.localeCompare(b.name));
    project.findings = [...new Map(
      project.findings.map((finding) => [
        `${finding.name}:${finding.category}:${finding.evidence.uri.toString()}`,
        finding,
      ]),
    ).values()].sort((a, b) => a.name.localeCompare(b.name));
    project.entryPoints.sort((a, b) =>
      a.uri.toString().localeCompare(b.uri.toString()),
    );
  }

  return {
    name: folder.name,
    uri: folder.uri,
    projects: [...projectsById.values()],
    diagnostics: folderDiagnostics,
  };
}

export async function scanWorkspace(
  folders: readonly vscode.WorkspaceFolder[],
  token?: vscode.CancellationToken,
  progress?: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<WorkspaceAnalysis> {
  const truncated: ScanLimits[] = [];
  const workspaceFolders: WorkspaceFolderAnalysis[] = [];
  const diagnostics: AnalysisDiagnostic[] = [];

  for (const folder of folders) {
    if (token?.isCancellationRequested) {
      break;
    }
    const result = await scanFolder(folder, token, truncated, progress);
    workspaceFolders.push(result);
    for (const project of result.projects) {
      diagnostics.push(...project.diagnostics);
    }
    diagnostics.push(...result.diagnostics);
  }

  const cancelled = Boolean(token?.isCancellationRequested);
  const partial = cancelled ||
    truncated.length > 0 ||
    diagnostics.some((diagnostic) =>
      diagnostic.severity === "warning" || diagnostic.severity === "error",
    );

  return {
    workspaceName: folders.length === 1
      ? folders[0].name
      : `${folders.length} workspace folders`,
    rootPath: folders[0]?.uri.fsPath ?? "",
    workspaceFolders,
    status: cancelled ? "cancelled" : partial ? "partial" : "complete",
    truncated,
    diagnostics: [...new Map(
      diagnostics.map((diagnostic) => [
        `${diagnostic.code}:${diagnostic.uri?.toString() ?? ""}:${diagnostic.message}`,
        diagnostic,
      ]),
    ).values()],
    analyzedAt: Date.now(),
  };
}
