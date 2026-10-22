import * as vscode from "vscode";
import {
  AnalysisDiagnostic,
  DependencyInfo,
  RouteFinding,
  SourceEvidence,
  TechnologyFinding,
} from "../models/workspaceAnalysis";

export interface JavaDetection {
  projectName?: string;
  dependencies: DependencyInfo[];
  findings: TechnologyFinding[];
  diagnostics: AnalysisDiagnostic[];
}

function addDependency(
  dependencies: DependencyInfo[],
  name: string,
  version: string,
  category: DependencyInfo["category"],
  manifestUri: vscode.Uri,
): void {
  const evidence: SourceEvidence = { uri: manifestUri, kind: "manifest" };
  dependencies.push({
    name,
    declaredVersion: version || "(managed)",
    category,
    manifestUri,
    evidence,
  });
}

function parseMaven(
  text: string,
  manifestUri: vscode.Uri,
): { name?: string; dependencies: DependencyInfo[] } {
  const dependencies: DependencyInfo[] = [];
  const rootXml = text.replace(/<parent\b[^>]*>[\s\S]*?<\/parent>/gi, "");
  const projectArtifact = /<artifactId>\s*([^<]+)\s*<\/artifactId>/i.exec(rootXml)?.[1]?.trim();
  for (const match of text.matchAll(/<dependency\b[^>]*>([\s\S]*?)<\/dependency>/gi)) {
    const block = match[1];
    const artifact = /<artifactId>\s*([^<]+)\s*<\/artifactId>/i.exec(block)?.[1]?.trim();
    if (!artifact) {
      continue;
    }
    const version = /<version>\s*([^<]+)\s*<\/version>/i.exec(block)?.[1]?.trim() ?? "";
    const scope = /<scope>\s*([^<]+)\s*<\/scope>/i.exec(block)?.[1]?.trim().toLowerCase();
    const category = scope === "test"
      ? "test"
      : scope === "provided"
        ? "provided"
        : scope === "runtime"
          ? "runtime"
          : "compile";
    addDependency(dependencies, artifact, version, category, manifestUri);
  }
  return { name: projectArtifact, dependencies };
}

function parseGradle(
  text: string,
  manifestUri: vscode.Uri,
): DependencyInfo[] {
  const dependencies: DependencyInfo[] = [];
  const declaration = /\b(implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|testCompileOnly|providedCompile)\s*(?:\(\s*)?["']([^:"']+):([^:"']+):([^"']+)["']/g;
  for (const match of text.matchAll(declaration)) {
    const configuration = match[1];
    const category = configuration.toLowerCase().startsWith("test")
      ? "test"
      : configuration.toLowerCase().includes("provided") ||
          configuration.toLowerCase().includes("compileonly")
        ? "provided"
        : configuration.toLowerCase().includes("runtime")
          ? "runtime"
          : "compile";
    addDependency(
      dependencies,
      `${match[2]}:${match[3]}`,
      match[4],
      category,
      manifestUri,
    );
  }
  return dependencies;
}

function isSpringBoot(name: string): boolean {
  return name.toLowerCase().startsWith("spring-boot-starter");
}

export function analyzeJavaManifest(
  text: string,
  manifestUri: vscode.Uri,
  sourceFiles: readonly vscode.Uri[],
): JavaDetection {
  const filename = manifestUri.path.split("/").at(-1)?.toLowerCase() ?? "";
  const maven = filename === "pom.xml";
  const parsed = maven
    ? parseMaven(text, manifestUri)
    : { dependencies: parseGradle(text, manifestUri) };
  const springSource = sourceFiles.find((uri) => uri.path.toLowerCase().endsWith(".java"));
  const findings: TechnologyFinding[] = [];
  if (springSource) {
    findings.push({
      name: "Java",
      category: "language",
      evidence: { uri: springSource, kind: "convention" },
    });
  }
  if (parsed.dependencies.some((item) => isSpringBoot(item.name)) || text.includes("spring-boot")) {
    const dependency = parsed.dependencies.find((item) => isSpringBoot(item.name));
    findings.push({
      name: "Spring Boot",
      category: "framework",
      evidence: dependency?.evidence ?? { uri: manifestUri, kind: "manifest" },
    });
  } else if (springSource) {
    findings.push({
      name: "Spring Boot",
      category: "framework",
      evidence: { uri: springSource, kind: "syntax" },
    });
  }
  return {
    projectName: parsed.name,
    dependencies: parsed.dependencies,
    findings,
    diagnostics: [],
  };
}

function annotationPath(annotation: string): string | undefined {
  const argument = annotation.slice(annotation.indexOf("(") + 1, -1).trim();
  if (!argument) {
    return "";
  }
  const match = /(?:path|value)\s*=\s*(?:\{[^}]*?["']([^"']+)["'][^}]*\}|["']([^"']+)["'])|^["']([^"']+)["']/.exec(argument);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function mappingMethods(annotation: string, name: string): string[] {
  const method = name.replace("Mapping", "").toUpperCase();
  if (method !== "REQUEST") {
    return method ? [method] : [];
  }
  const methods = [...annotation.matchAll(/RequestMethod\.([A-Z]+)/g)]
    .map((match) => match[1])
    .filter((item) => ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"].includes(item));
  return [...new Set(methods)].sort();
}

function normalizePath(path: string): string {
  const segments = path.split("/").filter(Boolean)
    .map((segment) => segment.replace(/\{([^}]+)\}/g, ":$1"));
  return `/${segments.join("/")}`;
}

export function analyzeSpringRoutes(
  text: string,
  uri: vscode.Uri,
): { routes: RouteFinding[]; diagnostics: AnalysisDiagnostic[] } {
  const routes: RouteFinding[] = [];
  const diagnostics: AnalysisDiagnostic[] = [];
  const classMappingRegex = /@RequestMapping\s*(?:\(([\s\S]*?)\))?\s*(?:@[A-Za-z][\w.]*\s*(?:\([^)]*\)\s*)?)*\s*(?:public\s+)?(?:abstract\s+)?class\s+\w+/g;
  const classPrefixes: { index: number; prefix: string }[] = [];
  for (const match of text.matchAll(classMappingRegex)) {
    const mapping = `RequestMapping(${match[1] ?? ""})`;
    classPrefixes.push({ index: match.index ?? 0, prefix: annotationPath(mapping) ?? "" });
  }

  const annotationRegex = /@(Get|Post|Put|Patch|Delete|Request)Mapping\s*(?:\(([\s\S]*?)\))?/g;
  for (const match of text.matchAll(annotationRegex)) {
    const name = `${match[1]}Mapping`;
    const annotation = `${name}(${match[2] ?? ""})`;
    const path = annotationPath(annotation);
    const index = match.index ?? 0;
    if (classPrefixes.some((item) => item.index === index)) {
      continue;
    }
    const line = text.slice(0, index).split(/\r?\n/).length;
    const prefix = [...classPrefixes].reverse().find((item) => item.index < index)?.prefix ?? "";
    if (path === undefined) {
      diagnostics.push({
        code: "spring-dynamic-route-path",
        message: "Spring mapping path is not a static string and was not resolved.",
        severity: "warning",
        uri,
        line,
      });
      continue;
    }
    routes.push({
      framework: "Spring Boot",
      path: normalizePath(`${prefix}/${path}`),
      methods: mappingMethods(annotation, name),
      uri,
      evidence: { uri, kind: "syntax", line },
    });
  }
  return { routes, diagnostics };
}
