import * as ts from "typescript";
import * as vscode from "vscode";

import {
  AnalysisDiagnostic,
  RouteFinding,
  SourceEvidence,
} from "../models/workspaceAnalysis";

export interface RouteAnalysis {
  routes: RouteFinding[];
  diagnostics: AnalysisDiagnostic[];
}

const EXPRESS_METHODS = new Map([
  ["get", "GET"],
  ["post", "POST"],
  ["put", "PUT"],
  ["patch", "PATCH"],
  ["delete", "DELETE"],
  ["options", "OPTIONS"],
  ["head", "HEAD"],
]);

function makeSourceFile(uri: vscode.Uri, text: string): ts.SourceFile {
  const extension = uri.path.split(".").pop()?.toLowerCase();
  const scriptKind = extension === "tsx"
    ? ts.ScriptKind.TSX
    : extension === "jsx"
      ? ts.ScriptKind.JSX
      : extension === "js" || extension === "mjs" || extension === "cjs"
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  return ts.createSourceFile(
    uri.path,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
}

function diagnostic(
  code: string,
  message: string,
  uri: vscode.Uri,
  line?: number,
): AnalysisDiagnostic {
  return { code, message, severity: "warning", uri, ...(line === undefined ? {} : { line }) };
}

function staticString(node: ts.Expression | undefined): string | undefined {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
    return node.text;
  }
  return undefined;
}

function sourceEvidence(
  source: ts.SourceFile,
  node: ts.Node,
  uri: vscode.Uri,
): SourceEvidence {
  const location = source.getLineAndCharacterOfPosition(node.getStart(source));
  return {
    uri,
    kind: "syntax",
    line: location.line + 1,
    character: location.character + 1,
  };
}

function propertyName(expression: ts.Expression): string | undefined {
  return ts.isPropertyAccessExpression(expression)
    ? expression.name.text.toLowerCase()
    : undefined;
}

function receiverName(expression: ts.Expression): string | undefined {
  if (!ts.isPropertyAccessExpression(expression)) {
    return undefined;
  }
  return ts.isIdentifier(expression.expression)
    ? expression.expression.text
    : undefined;
}

function isRouterReceiver(
  name: string,
  knownRouters: ReadonlySet<string>,
): boolean {
  return knownRouters.has(name) ||
    /^app$/i.test(name) ||
    /router$/i.test(name);
}

function expressRouterNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)) {
      const callee = node.initializer.expression;
      const isExpressFactory = ts.isIdentifier(callee) &&
        (callee.text === "express" || callee.text === "Router");
      const isExpressRouter = ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "Router";
      if (isExpressFactory || isExpressRouter) {
        names.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

export function analyzeExpressRoutes(
  text: string,
  uri: vscode.Uri,
): RouteAnalysis {
  const source = makeSourceFile(uri, text);
  const routers = expressRouterNames(source);
  const routes: RouteFinding[] = [];
  const diagnostics: AnalysisDiagnostic[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const method = propertyName(node.expression);
      const httpMethod = method ? EXPRESS_METHODS.get(method) : undefined;
      const receiver = receiverName(node.expression);
      const args = node.arguments;

      if (method === "use" && receiver &&
        isRouterReceiver(receiver, routers) && args.length >= 2) {
        const mountPath = staticString(args[0]);
        const target = args[1];
        if (mountPath !== undefined && ts.isIdentifier(target) && routers.has(target.text)) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          diagnostics.push(diagnostic(
            "express-router-mount-unresolved",
            `Mounted router "${target.text}" at "${mountPath}" was not expanded into effective route paths.`,
            uri,
            line,
          ));
        }
      } else if (httpMethod && receiver && isRouterReceiver(receiver, routers)) {
        const routePath = staticString(args[0]);
        if (routePath === undefined) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          diagnostics.push(diagnostic(
            "express-dynamic-route-path",
            "Express route path is not a static string and was not resolved.",
            uri,
            line,
          ));
        } else {
          routes.push({
            framework: "Express",
            path: routePath,
            methods: [httpMethod],
            uri,
            evidence: sourceEvidence(source, node, uri),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return {
    routes: deduplicateRoutes(routes),
    diagnostics,
  };
}

function routeSegment(segment: string): string | undefined {
  if (segment.startsWith("@") || /^\([^/]+\)$/.test(segment)) {
    return undefined;
  }
  return segment;
}

function nextRoutePath(
  relative: string[],
  router: "app" | "pages",
): string {
  const segments = relative
    .filter((segment) => segment.length > 0)
    .map((segment, index, all) =>
      router === "pages" && index === all.length - 1
        ? segment.replace(/\.(?:js|jsx|ts|tsx)$/i, "")
        : segment,
    )
    .map(routeSegment)
    .filter((segment): segment is string => segment !== undefined);
  if (router === "app") {
    segments.pop();
    return `/${segments.join("/")}`;
  }
  if (segments.at(-1) === "index") {
    segments.pop();
  }
  return `/${segments.join("/")}`;
}

function exportedNextMethods(source: ts.SourceFile): string[] {
  const methods = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) &&
      statement.name &&
      hasExportModifier(statement)) {
      const method = statement.name.text.toUpperCase();
      if (EXPRESS_METHODS.has(method.toLowerCase())) {
        methods.add(method);
      }
    }
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          const method = declaration.name.text.toUpperCase();
          if (EXPRESS_METHODS.has(method.toLowerCase())) {
            methods.add(method);
          }
        }
      }
    }
    if (ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        const method = element.name.text.toUpperCase();
        if (EXPRESS_METHODS.has(method.toLowerCase())) {
          methods.add(method);
        }
      }
    }
  }
  return [...methods].sort();
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((modifier) =>
      modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) ?? false);
}

export function analyzeNextRouteFile(
  uri: vscode.Uri,
  projectRoot: vscode.Uri,
  text: string,
): RouteAnalysis {
  const relative = uri.path
    .slice(projectRoot.path.replace(/\/+$/, "").length)
    .replace(/^\/+/, "")
    .split("/");
  const normalized = relative.map((segment) => segment.toLowerCase());
  const appIndex = normalized.indexOf("app");
  const pagesIndex = normalized.indexOf("pages");
  let router: "app" | "pages" | undefined;
  let routeRelative: string[] = [];
  if (appIndex >= 0 && normalized[appIndex + 1] === "api" &&
    /^route\.(?:js|jsx|ts|tsx)$/.test(normalized.at(-1) ?? "")) {
    router = "app";
    routeRelative = relative.slice(appIndex + 1);
  } else if (pagesIndex >= 0 && normalized[pagesIndex + 1] === "api" &&
    /\.(?:js|jsx|ts|tsx)$/.test(normalized.at(-1) ?? "")) {
    router = "pages";
    routeRelative = relative.slice(pagesIndex + 1);
  }

  if (!router) {
    const isApiLocation =
      (normalized[appIndex] === "app" && normalized[appIndex + 1] === "api") ||
      (normalized[pagesIndex] === "pages" && normalized[pagesIndex + 1] === "api");
    const extension = normalized.at(-1)?.split(".").pop();
    return {
      routes: [],
      diagnostics: isApiLocation &&
        extension &&
        !["js", "jsx", "ts", "tsx"].includes(extension)
        ? [diagnostic(
          "next-route-extension-unsupported",
          `Next.js API route extension ".${extension}" is outside the supported static analysis set.`,
          uri,
        )]
        : [],
    };
  }

  const source = makeSourceFile(uri, text);
  const path = nextRoutePath(routeRelative, router);
  const methods = router === "app" ? exportedNextMethods(source) : [];
  return {
    routes: [{
      framework: "Next.js",
      path,
      methods,
      uri,
      evidence: sourceEvidence(source, source, uri),
    }],
    diagnostics: [],
  };
}

function deduplicateRoutes(routes: RouteFinding[]): RouteFinding[] {
  const unique = new Map<string, RouteFinding>();
  for (const route of routes) {
    const key = `${route.framework}:${route.uri.toString()}:${route.path}:${route.methods.join(",")}`;
    unique.set(key, route);
  }
  return [...unique.values()];
}
