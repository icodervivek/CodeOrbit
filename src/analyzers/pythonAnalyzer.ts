import * as vscode from "vscode";
import {
  AnalysisDiagnostic,
  DependencyInfo,
  RouteFinding,
  SourceEvidence,
  TechnologyFinding,
} from "../models/workspaceAnalysis";

export interface PythonDetection {
  projectName?: string;
  dependencies: DependencyInfo[];
  findings: TechnologyFinding[];
  diagnostics: AnalysisDiagnostic[];
}

function dependency(
  name: string,
  value: string,
  category: DependencyInfo["category"],
  manifestUri: vscode.Uri,
): DependencyInfo {
  const evidence: SourceEvidence = { uri: manifestUri, kind: "manifest" };
  return { name, declaredVersion: value, category, manifestUri, evidence };
}

function parseRequirement(
  value: string,
  category: DependencyInfo["category"],
  manifestUri: vscode.Uri,
): DependencyInfo | undefined {
  const line = value.split(";", 1)[0].trim();
  const match = /^([A-Za-z0-9][A-Za-z0-9_.-]*)(?:\[.*?\])?\s*(.*)$/.exec(line);
  if (!match) {
    return undefined;
  }
  return dependency(match[1], match[2].trim() || "*", category, manifestUri);
}

function parsePyProject(
  text: string,
  manifestUri: vscode.Uri,
): { name?: string; dependencies: DependencyInfo[] } {
  const dependencies: DependencyInfo[] = [];
  let section = "";
  let arrayKey: string | undefined;
  let arrayCategory: DependencyInfo["category"] = "production";
  let arrayBuffer = "";
  let name: string | undefined;

  const flushArray = () => {
    if (!arrayKey) {
      return;
    }
    const category = arrayCategory;
    for (const item of arrayBuffer.matchAll(/["']([^"']+)["']/g)) {
      const parsed = parseRequirement(item[1], category, manifestUri);
      if (parsed) {
        dependencies.push(parsed);
      }
    }
    arrayKey = undefined;
    arrayBuffer = "";
  };

  for (const line of text.split(/\r?\n/)) {
    if (arrayKey) {
      arrayBuffer += ` ${line}`;
      if (line.includes("]")) {
        flushArray();
      }
      continue;
    }

    const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].toLowerCase();
      continue;
    }
    if (section === "project") {
      const projectName = /^\s*name\s*=\s*["']([^"']+)["']/.exec(line);
      if (projectName) {
        name = projectName[1];
      }
    }

    const arrayStart = /^\s*([A-Za-z0-9_-]+)\s*=\s*\[(.*)$/.exec(line);
    if (arrayStart &&
      (section === "project" && arrayStart[1] === "dependencies" ||
        section === "project.optional-dependencies")) {
      arrayKey = arrayStart[1];
      arrayCategory = section === "project.optional-dependencies"
        ? "optional"
        : "production";
      arrayBuffer = arrayStart[2];
      if (arrayBuffer.includes("]")) {
        flushArray();
      }
      continue;
    }

    const poetryDependency = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*(?:#.*)?$/.exec(line);
    if (
      poetryDependency &&
      (section === "tool.poetry.dependencies" ||
        section.startsWith("tool.poetry.group.") && section.endsWith(".dependencies"))
    ) {
      const isDev = section.startsWith("tool.poetry.group.");
      if (poetryDependency[1].toLowerCase() !== "python") {
        const valueMatch = /^(?:["']([^"']+)["']|(\{.*\}))/.exec(poetryDependency[2]);
        if (valueMatch) {
          dependencies.push(dependency(
            poetryDependency[1],
            valueMatch[1] ?? valueMatch[2],
            isDev ? "development" : "production",
            manifestUri,
          ));
        }
      }
    }
  }
  flushArray();
  return { name, dependencies };
}

function parsePipfile(
  text: string,
  manifestUri: vscode.Uri,
): DependencyInfo[] {
  const dependencies: DependencyInfo[] = [];
  let sectionName = "";
  for (const line of text.split(/\r?\n/)) {
    const sectionMatch = /^\s*\[([^\]]+)\]/.exec(line)?.[1]?.toLowerCase();
    if (sectionMatch !== undefined) {
      sectionName = sectionMatch;
      continue;
    }
    const category = sectionName === "dev-packages" ? "development" : "production";
    if (sectionName !== "packages" && sectionName !== "dev-packages") {
      continue;
    }
    const declaration = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*(?:#.*)?$/.exec(line);
    if (!declaration) {
      continue;
    }
    const value = declaration[2].replace(/^["']|["']$/g, "");
    dependencies.push(dependency(
      declaration[1],
      value || "*",
      category,
      manifestUri,
    ));
  }
  return dependencies;
}

function frameworkFindings(
  dependencies: DependencyInfo[],
  sourceFiles: readonly vscode.Uri[],
  manifestUri: vscode.Uri,
): TechnologyFinding[] {
  const findings: TechnologyFinding[] = [];
  const add = (name: string, evidence: SourceEvidence) => {
    findings.push({ name, category: "framework", evidence });
  };
  const fastApi = dependencies.find((item) => item.name.toLowerCase() === "fastapi");
  if (fastApi) {
    add("FastAPI", fastApi.evidence);
  }
  const flask = dependencies.find((item) => item.name.toLowerCase() === "flask");
  if (flask) {
    add("Flask", flask.evidence);
  }
  const django = dependencies.find((item) => item.name.toLowerCase() === "django");
  if (django) {
    add("Django", django.evidence);
  }
  const pythonFile = sourceFiles.find((uri) => uri.path.toLowerCase().endsWith(".py"));
  if (pythonFile) {
    findings.push({
      name: "Python",
      category: "language",
      evidence: { uri: pythonFile, kind: "convention" },
    });
  } else if (manifestUri.path.toLowerCase().endsWith(".py")) {
    findings.push({
      name: "Python",
      category: "language",
      evidence: { uri: manifestUri, kind: "manifest" },
    });
  }
  return findings;
}

export function analyzePythonManifest(
  text: string,
  manifestUri: vscode.Uri,
  sourceFiles: readonly vscode.Uri[],
): PythonDetection {
  const diagnostics: AnalysisDiagnostic[] = [];
  let projectName: string | undefined;
  let dependencies: DependencyInfo[] = [];
  const filename = manifestUri.path.split("/").at(-1)?.toLowerCase() ?? "";

  if (filename === "pyproject.toml") {
    const result = parsePyProject(text, manifestUri);
    projectName = result.name;
    dependencies = result.dependencies;
  } else if (filename === "pipfile") {
    dependencies = parsePipfile(text, manifestUri);
  } else if (filename.startsWith("requirements") && filename.endsWith(".txt")) {
    const category = /(?:dev|test)/.test(filename)
      ? "development"
      : "production";
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      if (trimmed.startsWith("-")) {
        if (/^-(?:r|e)\b|^--requirement\b/i.test(trimmed)) {
          diagnostics.push({
            code: "python-requirement-include-unresolved",
            message: `Requirements-file include or editable source was not followed: ${trimmed}`,
            severity: "info",
            uri: manifestUri,
          });
        }
        continue;
      }
      const item = parseRequirement(trimmed, category, manifestUri);
      if (item) {
        dependencies.push(item);
      } else {
        diagnostics.push({
          code: "python-requirement-unsupported",
          message: `Requirement declaration could not be interpreted statically: ${trimmed}`,
          severity: "info",
          uri: manifestUri,
        });
      }
    }
  }

  return {
    projectName,
    dependencies,
    findings: frameworkFindings(dependencies, sourceFiles, manifestUri),
    diagnostics,
  };
}

export interface PythonRouteAnalysis {
  routes: RouteFinding[];
  diagnostics: AnalysisDiagnostic[];
}

const pythonMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

function routeFinding(
  framework: string,
  path: string,
  methods: string[],
  uri: vscode.Uri,
  line: number,
): RouteFinding {
  return {
    framework,
    path: path.startsWith("/") ? path : `/${path}`,
    methods,
    uri,
    evidence: { uri, kind: "syntax", line },
  };
}

export function analyzePythonRoutes(
  text: string,
  uri: vscode.Uri,
  framework: "FastAPI" | "Flask" | "Django",
): PythonRouteAnalysis {
  const routes: RouteFinding[] = [];
  const diagnostics: AnalysisDiagnostic[] = [];
  const importedFramework =
    framework === "FastAPI"
      ? /\b(?:from\s+fastapi\b|import\s+fastapi\b)/.test(text)
      : framework === "Flask"
        ? /\b(?:from\s+flask\b|import\s+flask\b)/.test(text)
        : /\b(?:from\s+django\.urls\b|import\s+django\.urls\b)/.test(text) &&
          /\burlpatterns\b/.test(text);
  if (!importedFramework) {
    return { routes, diagnostics };
  }
  const lines = text.split(/\r?\n/);

  if (framework === "Django") {
    lines.forEach((line, index) => {
      const match = /\b(?:path|re_path)\s*\(\s*([rubfRUBF]*)(["'])(.*?)\2/.exec(line);
      if (match) {
        routes.push(routeFinding(
          "Django",
          match[3],
          [],
          uri,
          index + 1,
        ));
      }
      if (/\binclude\s*\(/.test(line)) {
        diagnostics.push({
          code: "django-include-unresolved",
          message: "Django include() URL composition is not expanded; the effective route prefix may be incomplete.",
          severity: "warning",
          uri,
          line: index + 1,
        });
      }
    });
    return { routes, diagnostics };
  }

  lines.forEach((line, index) => {
    if (
      framework === "FastAPI" && /\binclude_router\s*\(/.test(line) ||
      framework === "Flask" && /\bregister_blueprint\s*\(/.test(line)
    ) {
      diagnostics.push({
        code: `${framework.toLowerCase()}-router-composition-unresolved`,
        message: `${framework} router or blueprint prefixes are not composed into effective route paths.`,
        severity: "warning",
        uri,
        line: index + 1,
      });
    }
  });

  lines.forEach((line, index) => {
    const decorator = /^\s*@[\w.]+\.(route|api_route|get|post|put|patch|delete|options|head)\s*\((.*)$/.exec(line);
    if (!decorator) {
      return;
    }
    const pathMatch = /(?:^|,\s*)(?:(?:path|rule)\s*=\s*)?(["'])(.*?)\1/.exec(decorator[2]);
    if (!pathMatch) {
      diagnostics.push({
        code: `${framework.toLowerCase()}-dynamic-route-path`,
        message: `${framework} route path is not a static string and was not resolved.`,
        severity: "warning",
        uri,
        line: index + 1,
      });
      return;
    }
    const method = decorator[1] === "get" || decorator[1] === "route"
      ? "GET"
      : decorator[1].toUpperCase();
    const methodsMatch = /methods\s*=\s*\[([^\]]*)\]/.exec(decorator[2]);
    const methods = methodsMatch
      ? [...methodsMatch[1].matchAll(/["']([A-Za-z]+)["']/g)]
        .map((match) => match[1].toUpperCase())
        .filter((value) => pythonMethods.includes(value))
      : decorator[1] === "route" || decorator[1] === "api_route"
        ? ["GET"]
        : [method];
    routes.push(routeFinding(framework, pathMatch[2], methods, uri, index + 1));
  });
  return { routes, diagnostics };
}
