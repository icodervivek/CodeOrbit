import * as assert from "assert";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { analyzeJavaScriptManifest } from "../analyzers/javascriptAnalyzer";
import { analyzeJavaManifest, analyzeSpringRoutes } from "../analyzers/javaAnalyzer";
import { analyzePythonManifest, analyzePythonRoutes } from "../analyzers/pythonAnalyzer";
import {
  analyzeExpressRoutes,
  analyzeNextRouteFile,
} from "../analyzers/routeAnalyzer";
import { handleDashboardMessage, renderDashboardHtml } from "../dashboard";
import { findOwningProjectRoot } from "../core/projectOwnership";
import { watchWorkspaceForChanges } from "../core/analysisWatchers";
import { scanWorkspace } from "../core/workspaceScanner";
import {
  PackageManifest,
  WorkspaceAnalysis,
} from "../models/workspaceAnalysis";
import { WorkspaceTreeProvider } from "../providers/workspaceTreeProvider";

async function addWorkspaceFolder(directory: string): Promise<vscode.WorkspaceFolder> {
  const uri = vscode.Uri.file(directory);
  const index = vscode.workspace.workspaceFolders?.length ?? 0;
  const changed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      reject(new Error("Timed out waiting for the fixture workspace folder."));
    }, 10000);
    const subscription = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      if (event.added.some((folder) => folder.uri.toString() === uri.toString())) {
        clearTimeout(timer);
        subscription.dispose();
        resolve();
      }
    });
  });

  assert.ok(vscode.workspace.updateWorkspaceFolders(index, 0, {
    uri,
    name: path.basename(directory),
  }));
  await changed;
  const folder = vscode.workspace.workspaceFolders?.find(
    (item) => item.uri.toString() === uri.toString(),
  );
  assert.ok(folder, "fixture folder should be in the workspace");
  return folder;
}

async function removeWorkspaceFolder(folder: vscode.WorkspaceFolder): Promise<void> {
  const index = vscode.workspace.workspaceFolders?.findIndex(
    (item) => item.uri.toString() === folder.uri.toString(),
  ) ?? -1;
  if (index < 0) {
    return;
  }
  const changed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      reject(new Error("Timed out waiting to remove the fixture workspace folder."));
    }, 10000);
    const subscription = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      if (event.removed.some((item) => item.uri.toString() === folder.uri.toString())) {
        clearTimeout(timer);
        subscription.dispose();
        resolve();
      }
    });
  });
  assert.ok(vscode.workspace.updateWorkspaceFolders(index, 1));
  await changed;
}

async function writeFixture(
  root: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  const file = path.join(root, relativePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
}

async function removeFixtureDirectory(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== "EBUSY" && code !== "EPERM") || attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
}

function sampleAnalysis(dependencyCount = 1): WorkspaceAnalysis {
  const root = vscode.Uri.file("C:\\repo");
  const manifest = vscode.Uri.file("C:\\repo\\package.json");
  const source = vscode.Uri.file("C:\\repo\\src\\api.ts");
  const project = {
    id: root.toString(),
    name: "<web & api>",
    rootUri: root,
    manifestUris: [manifest],
    findings: [{
      name: "Express",
      category: "framework" as const,
      evidence: { uri: manifest, kind: "manifest" as const },
    }],
    dependencies: Array.from({ length: dependencyCount }, (_, index) => ({
      name: `dependency-${index}`,
      declaredVersion: "^1",
      category: "production" as const,
      manifestUri: manifest,
      evidence: { uri: manifest, kind: "manifest" as const },
    })),
    entryPoints: [{
      uri: source,
      kind: "candidate" as const,
      evidence: { uri: source, kind: "convention" as const },
    }],
    routes: [{
      framework: "Express" as const,
      path: "/api/users",
      methods: ["GET"],
      uri: source,
      evidence: { uri: source, kind: "syntax" as const, line: 4 },
    }],
    routeAnalysis: "analyzed" as const,
    diagnostics: [{
      code: "sample-warning",
      message: "Sample partial analysis.",
      severity: "warning" as const,
      uri: manifest,
    }],
  };
  return {
    workspaceName: "repo",
    rootPath: root.fsPath,
    workspaceFolders: [{
      name: "repo",
      uri: root,
      projects: [project],
      diagnostics: [],
    }],
    status: "partial",
    truncated: [{ category: "source files", maximum: 5000 }],
    diagnostics: project.diagnostics,
    analyzedAt: 0,
  };
}

suite("Workspace model", () => {
  test("contributes one CodeOrbit results tree in the Activity Bar container", async () => {
    const manifest = JSON.parse(
      await fs.readFile(path.resolve(__dirname, "../../package.json"), "utf8"),
    ) as {
      contributes: {
        views: Record<string, { id: string }[]>;
        viewsContainers: { activitybar: { id: string; icon: string }[] };
      };
    };
    const contributedViews = Object.values(manifest.contributes.views)
      .flat()
      .filter((view) => view.id === "codeOrbit.workspace");

    assert.strictEqual(contributedViews.length, 1);
    assert.deepStrictEqual(
      manifest.contributes.views.codeOrbit.map((view) => view.id),
      ["codeOrbit.dashboard", "codeOrbit.workspace"],
    );
    assert.deepStrictEqual(
      manifest.contributes.viewsContainers.activitybar.map((container) => container.id),
      ["codeOrbit"],
    );
    const iconPath = manifest.contributes.viewsContainers.activitybar[0].icon;
    assert.strictEqual(iconPath, "resources/codeorbit.svg");
    const icon = await fs.readFile(
      path.resolve(__dirname, "../../", iconPath),
      "utf8",
    );
    assert.ok(icon.includes('width="24" height="24"'));
    assert.ok(icon.includes('stroke="currentColor"'));
    assert.ok(!icon.includes("<filter"));
  });

  test("assigns a file to the nearest package root", () => {
    const workspace = vscode.Uri.file("C:\\repo");
    const packageRoot = vscode.Uri.file("C:\\repo\\packages\\web");
    const nestedPackage = vscode.Uri.file(
      "C:\\repo\\packages\\web\\examples\\demo",
    );
    const file = vscode.Uri.file(
      "C:\\repo\\packages\\web\\examples\\demo\\src\\main.ts",
    );

    assert.strictEqual(
      findOwningProjectRoot(file, [workspace, packageRoot, nestedPackage])
        ?.toString(),
      nestedPackage.toString(),
    );
  });

  test("keeps same-named packages in separate workspace roots distinct", () => {
    const firstRoot = vscode.Uri.file("C:\\workspace-a\\packages\\shared");
    const secondRoot = vscode.Uri.file("C:\\workspace-b\\packages\\shared");

    assert.strictEqual(
      findOwningProjectRoot(
        vscode.Uri.file("C:\\workspace-a\\packages\\shared\\src\\index.ts"),
        [firstRoot, secondRoot],
      )?.toString(),
      firstRoot.toString(),
    );
    assert.strictEqual(
      findOwningProjectRoot(
        vscode.Uri.file("C:\\workspace-b\\packages\\shared\\src\\index.ts"),
        [firstRoot, secondRoot],
      )?.toString(),
      secondRoot.toString(),
    );
  });

  test("does not assign files outside a root or across URI authorities", () => {
    assert.strictEqual(
      findOwningProjectRoot(
        vscode.Uri.file("C:\\repository-other\\src\\index.ts"),
        [vscode.Uri.file("C:\\repository")],
      ),
      undefined,
    );

    assert.strictEqual(
      findOwningProjectRoot(
        vscode.Uri.parse("vscode-remote://host/workspace/src/index.ts"),
        [vscode.Uri.parse("vscode-remote://other/workspace")],
      ),
      undefined,
    );
  });

  test("keeps monorepo findings scoped and reports malformed and oversized manifests", async function () {
    this.timeout(30000);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeorbit-scan-"));
    let folder: vscode.WorkspaceFolder | undefined;
    try {
      await writeFixture(
        root,
        "package.json",
        JSON.stringify({
          name: "root-app",
          dependencies: { express: "workspace:*" },
        }),
      );
      await writeFixture(
        root,
        "src/main.ts",
        "export const app = true;",
      );
      await writeFixture(
        root,
        "src/server.ts",
        "const app = express();\napp.get('/health', handler);",
      );
      await writeFixture(
        root,
        "apps/web/package.json",
        JSON.stringify({
          name: "web-app",
          devDependencies: { express: "file:../express" },
        }),
      );
      await writeFixture(root, "apps/web/src/index.ts", "export {};");
      await writeFixture(root, "broken/package.json", "{ invalid");
      await writeFixture(
        root,
        "missing/package.json",
        JSON.stringify({ name: "missing-entry", main: "./dist/missing.js" }),
      );
      await writeFixture(
        root,
        "deep/escape/package.json",
        JSON.stringify({ name: "escape-entry", main: "../../../../outside.js" }),
      );
      await writeFixture(
        root,
        "large/package.json",
        JSON.stringify({ name: "large" }) + " ".repeat(1024 * 1024),
      );

      folder = await addWorkspaceFolder(root);
      const result = await scanWorkspace([folder]);
      const fixtureFolder = result.workspaceFolders[0];
      const rootProject = fixtureFolder.projects.find(
        (project) => project.name === "root-app",
      );
      const webProject = fixtureFolder.projects.find(
        (project) => project.name === "web-app",
      );

      assert.ok(rootProject);
      assert.ok(webProject);
      assert.ok(rootProject.dependencies.some(
        (dependency) =>
          dependency.name === "express" &&
          dependency.category === "production" &&
          dependency.declaredVersion === "workspace:*",
      ));
      assert.ok(webProject.dependencies.some(
        (dependency) =>
          dependency.name === "express" &&
          dependency.category === "development" &&
          dependency.declaredVersion === "file:../express",
      ));
      assert.ok(webProject.entryPoints.some((entry) => entry.kind === "candidate"));
      assert.deepStrictEqual(
        rootProject.routes.map((route) => [route.methods[0], route.path]),
        [["GET", "/health"]],
      );
      assert.strictEqual(rootProject.routeAnalysis, "analyzed");
      assert.ok(
        result.diagnostics.some((diagnostic) =>
          diagnostic.code === "manifest-read-failed" ||
          diagnostic.code === "file-size-limit" ||
          diagnostic.code === "entry-point-not-found" ||
          diagnostic.code === "entry-point-outside-workspace",
        ),
      );
      assert.strictEqual(result.status, "partial");
    } finally {
      if (folder) {
        await removeWorkspaceFolder(folder);
      }
      await removeFixtureDirectory(root);
    }
  });

  test("scans Python and Spring Boot projects with dependencies and static routes", async function () {
    this.timeout(30000);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeorbit-polyglot-"));
    let folder: vscode.WorkspaceFolder | undefined;
    try {
      await Promise.all([
        writeFixture(
          root,
          "python/pyproject.toml",
          [
            "[project]",
            'name = "python-api"',
            "dependencies = [",
            '  "fastapi>=0.110",',
            '  "Flask==3.0",',
            '  "django~=5.0",',
            "]",
          ].join("\n"),
        ),
        writeFixture(root, "python/requirements-dev.txt", "pytest>=8.0\n"),
        writeFixture(
          root,
          "python/main.py",
          [
            "from fastapi import FastAPI",
            "app = FastAPI()",
            '@app.get("/health")',
            "def health(): return {'ok': True}",
          ].join("\n"),
        ),
        writeFixture(
          root,
          "python/flask_app.py",
          [
            "from flask import Flask",
            "app = Flask(__name__)",
            '@app.route("/items", methods=["GET", "POST"])',
            "def items(): return 'ok'",
          ].join("\n"),
        ),
        writeFixture(
          root,
          "python/urls.py",
          [
            "from django.urls import path",
            "urlpatterns = [path('users/', view)]",
          ].join("\n"),
        ),
        writeFixture(
          root,
          "java/pom.xml",
          [
            "<project><artifactId>java-api</artifactId><dependencies>",
            "<dependency><groupId>org.springframework.boot</groupId>",
            "<artifactId>spring-boot-starter-web</artifactId></dependency>",
            "</dependencies></project>",
          ].join(""),
        ),
        writeFixture(
          root,
          "java/src/ApiApplication.java",
          "@SpringBootApplication class ApiApplication {}",
        ),
        writeFixture(
          root,
          "java/src/UserController.java",
          [
            "@RestController",
            '@RequestMapping("/api")',
            "class UserController {",
            '  @GetMapping("/users/{id}")',
            "  Object get() { return null; }",
            "}",
          ].join("\n"),
        ),
      ]);
      folder = await addWorkspaceFolder(root);
      const result = await scanWorkspace([folder]);
      const projects = result.workspaceFolders[0].projects;
      const python = projects.find((project) => project.name === "python-api");
      const java = projects.find((project) => project.name === "java-api");

      assert.ok(python);
      assert.ok(java);
      assert.ok(python.findings.some((finding) => finding.name === "Python"));
      for (const framework of ["FastAPI", "Flask", "Django"]) {
        assert.ok(python.findings.some((finding) => finding.name === framework), framework);
      }
      assert.ok(python.dependencies.some((item) => item.name === "pytest" && item.category === "development"));
      assert.ok(python.routes.some((route) => route.framework === "FastAPI" && route.path === "/health"));
      assert.ok(python.routes.some((route) => route.framework === "Flask" && route.methods.includes("POST")));
      assert.ok(python.routes.some((route) => route.framework === "Django" && route.path === "/users/"));

      assert.ok(java.findings.some((finding) => finding.name === "Java"));
      assert.ok(java.findings.some((finding) => finding.name === "Spring Boot"));
      assert.ok(java.dependencies.some((item) => item.name === "spring-boot-starter-web"));
      assert.ok(java.entryPoints.some((entry) => entry.uri.path.endsWith("ApiApplication.java")));
      assert.ok(java.routes.some((route) =>
        route.framework === "Spring Boot" &&
        route.path === "/api/users/:id" &&
        route.methods.includes("GET"),
      ));
    } finally {
      if (folder) {
        await removeWorkspaceFolder(folder);
      }
      await removeFixtureDirectory(root);
    }
  });

  test("skips Python virtual environments and Java build output during discovery", async function () {
    this.timeout(30000);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeorbit-generated-"));
    let folder: vscode.WorkspaceFolder | undefined;
    try {
      await Promise.all([
        writeFixture(
          root,
          "pyproject.toml",
          "[project]\nname = 'workspace-api'\ndependencies = ['fastapi>=0.1']",
        ),
        writeFixture(
          root,
          "app.py",
          'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/health")\ndef health(): pass',
        ),
        writeFixture(
          root,
          ".venv/lib/site-packages/ignored/pyproject.toml",
          "[project]\nname = 'ignored-venv'",
        ),
        writeFixture(
          root,
          ".venv/lib/site-packages/ignored/app.py",
          'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/should-not-appear")\ndef ignored(): pass',
        ),
        writeFixture(
          root,
          "target/generated/GeneratedController.java",
          '@RestController class GeneratedController { @GetMapping("/generated") Object route() { return null; } }',
        ),
      ]);
      folder = await addWorkspaceFolder(root);
      const result = await scanWorkspace([folder]);
      const projects = result.workspaceFolders[0].projects;

      assert.strictEqual(projects.length, 1);
      assert.strictEqual(projects[0].name, "workspace-api");
      assert.deepStrictEqual(
        projects[0].routes.map((route) => route.path),
        ["/health"],
      );
      assert.ok(projects[0].routes.every(
        (route) => !route.uri.path.includes(".venv") && !route.uri.path.includes("/target/"),
      ));
    } finally {
      if (folder) {
        await removeWorkspaceFolder(folder);
      }
      await removeFixtureDirectory(root);
    }
  });

  test("reports manifest count truncation", async function () {
    this.timeout(30000);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeorbit-limit-"));
    let folder: vscode.WorkspaceFolder | undefined;
    try {
      await Promise.all(Array.from({ length: 201 }, (_, index) =>
        writeFixture(
          root,
          `packages/p${index}/package.json`,
          JSON.stringify({ name: `p${index}` }),
        ),
      ));

      folder = await addWorkspaceFolder(root);
      const result = await scanWorkspace([folder]);

      assert.ok(result.truncated.some(
        (item) => item.category === "manifest files" && item.maximum === 200,
      ));
      assert.strictEqual(result.status, "partial");
      assert.ok(result.workspaceFolders[0].projects.length <= 201);
    } finally {
      if (folder) {
        await removeWorkspaceFolder(folder);
      }
      await removeFixtureDirectory(root);
    }
  });

  test("keeps same-named projects separate across workspace folders", async function () {
    this.timeout(30000);
    const firstRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeorbit-root-a-"));
    const secondRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeorbit-root-b-"));
    let firstFolder: vscode.WorkspaceFolder | undefined;
    let secondFolder: vscode.WorkspaceFolder | undefined;
    try {
      await Promise.all([
        writeFixture(firstRoot, "package.json", JSON.stringify({ name: "shared" })),
        writeFixture(secondRoot, "package.json", JSON.stringify({ name: "shared" })),
        writeFixture(firstRoot, "src/index.ts", "export const root = 'a';"),
        writeFixture(secondRoot, "src/index.ts", "export const root = 'b';"),
      ]);
      firstFolder = await addWorkspaceFolder(firstRoot);
      secondFolder = await addWorkspaceFolder(secondRoot);
      const result = await scanWorkspace([firstFolder, secondFolder]);

      assert.strictEqual(result.workspaceFolders.length, 2);
      const firstProject = result.workspaceFolders[0].projects.find(
        (project) => project.name === "shared",
      );
      const secondProject = result.workspaceFolders[1].projects.find(
        (project) => project.name === "shared",
      );
      assert.ok(firstProject);
      assert.ok(secondProject);
      assert.notStrictEqual(firstProject.id, secondProject.id);
      assert.notStrictEqual(firstProject.rootUri.toString(), secondProject.rootUri.toString());
    } finally {
      if (secondFolder) {
        await removeWorkspaceFolder(secondFolder);
      }
      if (firstFolder) {
        await removeWorkspaceFolder(firstFolder);
      }
      await Promise.all([
        removeFixtureDirectory(firstRoot),
        removeFixtureDirectory(secondRoot),
      ]);
    }
  });

  test("returns a cancelled state when cancellation precedes scanning", async () => {
    const source = new vscode.CancellationTokenSource();
    source.cancel();
    const result = await scanWorkspace([], source.token);
    source.dispose();

    assert.strictEqual(result.status, "cancelled");
    assert.deepStrictEqual(result.workspaceFolders, []);
  });

  test("reports cancellation requested while a scan is discovering files", async function () {
    this.timeout(30000);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeorbit-cancel-"));
    let folder: vscode.WorkspaceFolder | undefined;
    const source = new vscode.CancellationTokenSource();
    try {
      await writeFixture(root, "package.json", JSON.stringify({ name: "cancel" }));
      folder = await addWorkspaceFolder(root);
      const scan = scanWorkspace([folder], source.token);
      setTimeout(() => source.cancel(), 0);
      const result = await scan;

      assert.strictEqual(result.status, "cancelled");
    } finally {
      source.dispose();
      if (folder) {
        await removeWorkspaceFolder(folder);
      }
      await removeFixtureDirectory(root);
    }
  });

  test("preserves declared dependency expressions, categories, and evidence", () => {
    const manifestUri = vscode.Uri.file("C:\\repo\\package.json");
    const result = analyzeJavaScriptManifest(
      {
        dependencies: {
          workspacePackage: "workspace:*",
          localPackage: "file:../local",
          gitPackage: "git+https://example.invalid/team/pkg.git#main",
          aliasPackage: "npm:actual-package@^2",
        },
        devDependencies: { shared: "file:../shared" },
        optionalDependencies: { optionalFeature: "latest" },
        peerDependencies: { hostApi: "^4" },
      },
      manifestUri,
      [],
      [],
    );

    assert.deepStrictEqual(
      result.dependencies.map((dependency) => [
        dependency.name,
        dependency.declaredVersion,
        dependency.category,
        dependency.manifestUri.toString(),
        dependency.evidence.kind,
      ]),
      [
        ["workspacePackage", "workspace:*", "production", manifestUri.toString(), "manifest"],
        ["localPackage", "file:../local", "production", manifestUri.toString(), "manifest"],
        ["gitPackage", "git+https://example.invalid/team/pkg.git#main", "production", manifestUri.toString(), "manifest"],
        ["aliasPackage", "npm:actual-package@^2", "production", manifestUri.toString(), "manifest"],
        ["shared", "file:../shared", "development", manifestUri.toString(), "manifest"],
        ["optionalFeature", "latest", "optional", manifestUri.toString(), "manifest"],
        ["hostApi", "^4", "peer", manifestUri.toString(), "manifest"],
      ],
    );
  });

  test("reports malformed dependency sections without dropping other categories", () => {
    const manifestUri = vscode.Uri.file("C:\\repo\\package.json");
    const manifest = JSON.parse(JSON.stringify({
      dependencies: "not-an-object",
      devDependencies: { valid: "^1" },
    })) as PackageManifest;
    const result = analyzeJavaScriptManifest(manifest, manifestUri, [], []);

    assert.deepStrictEqual(
      result.dependencies.map((dependency) => dependency.name),
      ["valid"],
    );
    assert.ok(result.diagnostics.some(
      (diagnostic) => diagnostic.code === "invalid-dependency-section",
    ));
  });

  test("detects manifest/config findings and supported declared entry metadata", () => {
    const root = vscode.Uri.file("C:\\repo");
    const manifestUri = vscode.Uri.file("C:\\repo\\package.json");
    const source = vscode.Uri.file("C:\\repo\\src\\main.ts");
    const nextConfig = vscode.Uri.file("C:\\repo\\next.config.mts");
    const result = analyzeJavaScriptManifest(
      {
        name: "web",
        dependencies: { react: "^19", express: "^5" },
        main: "./dist/main.js",
        exports: {
          ".": {
            import: "./dist/index.mjs",
            require: "./dist/index.cjs",
          },
        },
      },
      manifestUri,
      [source],
      [nextConfig],
    );

    assert.ok(result.findings.some(
      (finding) =>
        finding.name === "TypeScript" &&
        finding.evidence.uri.toString() === source.toString(),
    ));
    assert.ok(result.findings.some(
      (finding) =>
        finding.name === "Next.js" &&
        finding.evidence.uri.toString() === nextConfig.toString(),
    ));
    assert.ok(result.findings.some(
      (finding) =>
        finding.name === "Express" &&
        finding.evidence.uri.toString() === manifestUri.toString(),
    ));
    assert.deepStrictEqual(
      result.entryPoints.map((entry) => entry.uri.toString()),
      [
        vscode.Uri.joinPath(manifestUri, "..", "./dist/main.js").toString(),
        vscode.Uri.joinPath(manifestUri, "..", "./dist/index.mjs").toString(),
        vscode.Uri.joinPath(manifestUri, "..", "./dist/index.cjs").toString(),
      ],
    );
    assert.strictEqual(findOwningProjectRoot(result.entryPoints[0].uri, [root])?.toString(), root.toString());
  });

  test("analyzes Python dependency manifests and framework declarations", () => {
    const root = vscode.Uri.file("C:\\repo\\python");
    const pyproject = vscode.Uri.file("C:\\repo\\python\\pyproject.toml");
    const source = vscode.Uri.file("C:\\repo\\python\\app.py");
    const result = analyzePythonManifest(
      [
        "[project]",
        'name = "sample-api"',
        "dependencies = [",
        '  "fastapi>=0.110",',
        '  "Flask==3.0",',
        "]",
        "[project.optional-dependencies]",
        'test = ["django~=5.0"]',
      ].join("\n"),
      pyproject,
      [source],
    );

    assert.strictEqual(result.projectName, "sample-api");
    assert.deepStrictEqual(result.dependencies.map((item) => [
      item.name,
      item.declaredVersion,
      item.category,
    ]), [
      ["fastapi", ">=0.110", "production"],
      ["Flask", "==3.0", "production"],
      ["django", "~=5.0", "optional"],
    ]);
    assert.ok(result.findings.some((finding) => finding.name === "Python"));
    assert.ok(result.findings.some((finding) => finding.name === "FastAPI"));
    assert.ok(result.findings.some((finding) => finding.name === "Flask"));
    assert.ok(result.findings.some((finding) => finding.name === "Django"));

    const requirements = analyzePythonManifest(
      "requests>=2.31\nuvicorn[standard]==0.29\n",
      vscode.Uri.file("C:\\repo\\python\\requirements.txt"),
      [source],
    );
    assert.deepStrictEqual(
      requirements.dependencies.map((item) => [item.name, item.declaredVersion]),
      [["requests", ">=2.31"], ["uvicorn", "==0.29"]],
    );
    const pipfile = analyzePythonManifest(
      [
        "[packages]",
        'django = ">=5"',
        "[dev-packages]",
        'pytest = ">=8"',
        "[requires]",
        'python_version = "3.12"',
      ].join("\n"),
      vscode.Uri.file("C:\\repo\\python\\Pipfile"),
      [source],
    );
    assert.deepStrictEqual(pipfile.dependencies.map((item) => [
      item.name,
      item.category,
    ]), [["django", "production"], ["pytest", "development"]]);
    assert.strictEqual(findOwningProjectRoot(source, [root])?.toString(), root.toString());
  });

  test("discovers static FastAPI, Flask, and Django route declarations", () => {
    const source = vscode.Uri.file("C:\\repo\\python\\routes.py");
    const fastApi = analyzePythonRoutes(
      [
        "from fastapi import FastAPI, APIRouter",
        "app = FastAPI()",
        '@app.get("/users/{user_id}")',
        "async def user(): pass",
        'app.include_router(router, prefix="/v1")',
      ].join("\n"),
      source,
      "FastAPI",
    );
    assert.deepStrictEqual(
      fastApi.routes.map((route) => [route.framework, route.path, route.methods]),
      [["FastAPI", "/users/{user_id}", ["GET"]]],
    );
    assert.ok(fastApi.diagnostics.some(
      (item) => item.code === "fastapi-router-composition-unresolved",
    ));

    const flask = analyzePythonRoutes(
      [
        "from flask import Flask",
        "app = Flask(__name__)",
        '@app.route("/items", methods=["GET", "POST"])',
        "def items(): pass",
      ].join("\n"),
      source,
      "Flask",
    );
    assert.deepStrictEqual(
      flask.routes.map((route) => [route.path, route.methods]),
      [["/items", ["GET", "POST"]]],
    );

    const django = analyzePythonRoutes(
      [
        "from django.urls import path, include",
        "urlpatterns = [",
        '    path("users/<int:user_id>/", view),',
        '    path("api/", include("api.urls")),',
        "]",
      ].join("\n"),
      vscode.Uri.file("C:\\repo\\python\\urls.py"),
      "Django",
    );
    assert.deepStrictEqual(
      django.routes.map((route) => route.path),
      ["/users/<int:user_id>/", "/api/"],
    );
    assert.ok(django.diagnostics.some(
      (item) => item.code === "django-include-unresolved",
    ));
  });

  test("analyzes Maven and Gradle dependencies and Spring Boot routes", () => {
    const pom = vscode.Uri.file("C:\\repo\\java\\pom.xml");
    const source = vscode.Uri.file("C:\\repo\\java\\src\\ApiApplication.java");
    const maven = analyzeJavaManifest(
      [
        "<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent>",
        "<artifactId>sample-service</artifactId><dependencies>",
        "<dependency><groupId>org.springframework.boot</groupId>",
        "<artifactId>spring-boot-starter-web</artifactId></dependency>",
        "<dependency><groupId>org.example</groupId><artifactId>sample-test</artifactId>",
        "<version>1.2</version><scope>test</scope></dependency>",
        "</dependencies></project>",
      ].join(""),
      pom,
      [source],
    );
    assert.strictEqual(maven.projectName, "sample-service");
    assert.deepStrictEqual(maven.dependencies.map((item) => [
      item.name,
      item.declaredVersion,
      item.category,
    ]), [
      ["spring-boot-starter-web", "(managed)", "compile"],
      ["sample-test", "1.2", "test"],
    ]);
    assert.ok(maven.findings.some((finding) => finding.name === "Java"));
    assert.ok(maven.findings.some((finding) => finding.name === "Spring Boot"));

    const gradle = analyzeJavaManifest(
      'dependencies { implementation("org.springframework.boot:spring-boot-starter-web:3.3.0"); testImplementation("org.test:check:1.0") }',
      vscode.Uri.file("C:\\repo\\java\\build.gradle.kts"),
      [source],
    );
    assert.deepStrictEqual(gradle.dependencies.map((item) => [
      item.name,
      item.declaredVersion,
      item.category,
    ]), [
      ["org.springframework.boot:spring-boot-starter-web", "3.3.0", "compile"],
      ["org.test:check", "1.0", "test"],
    ]);

    const routes = analyzeSpringRoutes(
      [
        "@RestController",
        '@RequestMapping("/api")',
        "public class UserController {",
        '  @GetMapping("/{id}")',
        "  public Object get() { return null; }",
        '  @RequestMapping(path="/users", method=RequestMethod.POST)',
        "  public Object create() { return null; }",
        "}",
      ].join("\n"),
      source,
    );
    assert.deepStrictEqual(
      routes.routes.map((route) => [route.path, route.methods]),
      [["/api/:id", ["GET"]], ["/api/users", ["POST"]]],
    );
  });

  test("finds static Express routes and reports unsupported composition", () => {
    const uri = vscode.Uri.file("C:\\repo\\src\\server.ts");
    const result = analyzeExpressRoutes(
      [
        "const app = express();",
        "const router = express.Router();",
        "app.get('/users/:id', handler);",
        "router.post('/users', handler);",
        "app.use('/api', router);",
        "app.get(prefix, handler);",
      ].join("\n"),
      uri,
    );

    assert.deepStrictEqual(
      result.routes.map((route) => [route.methods[0], route.path]),
      [["GET", "/users/:id"], ["POST", "/users"]],
    );
    assert.ok(result.routes.every(
      (route) =>
        route.evidence.kind === "syntax" &&
        route.evidence.line !== undefined &&
        route.uri.toString() === uri.toString(),
    ));
    assert.deepStrictEqual(
      result.diagnostics.map((item) => item.code),
      ["express-router-mount-unresolved", "express-dynamic-route-path"],
    );
  });

  test("discovers Next.js App and Pages API routes with dynamic segments", () => {
    const root = vscode.Uri.file("C:\\repo");
    const appRoute = vscode.Uri.file(
      "C:\\repo\\app\\api\\users\\[id]\\route.ts",
    );
    const appResult = analyzeNextRouteFile(
      appRoute,
      root,
      "export async function GET() { return null; }\nexport const POST = () => null;",
    );
    const pagesRoute = vscode.Uri.file(
      "C:\\repo\\pages\\api\\users\\[id].ts",
    );
    const pagesResult = analyzeNextRouteFile(
      pagesRoute,
      root,
      "export default function handler() {}",
    );

    assert.deepStrictEqual(appResult.routes.map(
      (route) => [route.path, route.methods],
    ), [["/api/users/[id]", ["GET", "POST"]]]);
    assert.deepStrictEqual(pagesResult.routes.map(
      (route) => [route.path, route.methods],
    ), [["/api/users/[id]", []]]);
    assert.deepStrictEqual(
      analyzeNextRouteFile(
        vscode.Uri.file("C:\\repo\\pages\\home.tsx"),
        root,
        "export default function Page() {}",
      ).routes,
      [],
    );
    assert.ok(analyzeNextRouteFile(
      vscode.Uri.file("C:\\repo\\app\\api\\route.mjs"),
      root,
      "export function GET() {}",
    ).diagnostics.some(
      (diagnostic) => diagnostic.code === "next-route-extension-unsupported",
    ));
  });

  test("renders grouped project status, evidence, and bounded large lists", () => {
    const html = renderDashboardHtml({
      analysis: sampleAnalysis(105),
      stale: true,
      cancelled: false,
      hasWorkspace: true,
    });

    assert.ok(html.includes("&lt;web &amp; api&gt;"));
    assert.ok(html.includes("partial · stale"));
    assert.ok(html.includes("Workspace files changed since this analysis."));
    assert.ok(html.includes("Coverage: analyzed"));
    assert.ok(html.includes("Scan limits reached: source files (limit 5000)"));
    assert.ok(html.includes("75 more not shown"));
    assert.ok(html.includes("GET /api/users (Express)"));
    assert.ok(html.includes("Sample partial analysis."));
    assert.ok(html.includes("Refresh analysis"));
    assert.ok(html.includes("vscode.postMessage({ command: \"analyze\" })"));
    assert.ok(!html.includes("<web & api>"));
  });

  test("renders empty results and multiple workspace folders", () => {
    const analysis = sampleAnalysis(0);
    const secondRoot = vscode.Uri.file("D:\\other-repo");
    analysis.workspaceFolders.push({
      name: "other-repo",
      uri: secondRoot,
      projects: [{
        id: secondRoot.toString(),
        name: "service",
        rootUri: secondRoot,
        manifestUris: [],
        findings: [],
        dependencies: [],
        entryPoints: [],
        routes: [],
        routeAnalysis: "unsupported",
        diagnostics: [],
      }],
      diagnostics: [],
    });
    const html = renderDashboardHtml({
      analysis,
      stale: false,
      cancelled: false,
      hasWorkspace: true,
    });

    assert.ok(html.includes("Workspace: repo"));
    assert.ok(html.includes("Workspace: other-repo"));
    assert.ok(html.includes("Coverage: unsupported"));
    assert.ok(html.includes("<li>None found</li>"));
  });

  test("renders workspace-empty, no-workspace, partial, cancelled, and stale dashboard states", () => {
    const noAnalysis = renderDashboardHtml({
      stale: false,
      cancelled: false,
      hasWorkspace: true,
    });
    assert.ok(noAnalysis.includes("Analyze this workspace"));
    assert.ok(noAnalysis.includes("Analyze workspace"));

    const noWorkspace = renderDashboardHtml({
      stale: false,
      cancelled: false,
      hasWorkspace: false,
    });
    assert.ok(noWorkspace.includes("Open a workspace folder"));
    assert.ok(noWorkspace.includes("<button id=\"analyze\" type=\"button\" disabled>"));

    const cancelledWithoutResults = renderDashboardHtml({
      stale: false,
      cancelled: true,
      hasWorkspace: true,
    });
    assert.ok(cancelledWithoutResults.includes("Analysis was cancelled before results were available."));

    const cancelledWithResults = renderDashboardHtml({
      analysis: sampleAnalysis(),
      stale: false,
      cancelled: true,
      hasWorkspace: true,
    });
    assert.ok(cancelledWithResults.includes("Showing the last completed results."));
  });

  test("routes dashboard analyze messages and ignores other messages", async () => {
    let calls = 0;
    const onAnalyze = () => { calls += 1; };

    assert.strictEqual(
      await handleDashboardMessage({ command: "analyze" }, onAnalyze),
      true,
    );
    assert.strictEqual(
      await handleDashboardMessage({ command: "unexpected" }, onAnalyze),
      false,
    );
    assert.strictEqual(await handleDashboardMessage(null, onAnalyze), false);
    assert.strictEqual(calls, 1);
  });

  test("groups tree items by workspace project and exposes route coverage", () => {
    const provider = new WorkspaceTreeProvider();
    provider.refresh(sampleAnalysis(), true);

    const rootItems = provider.getChildren();
    assert.ok(rootItems.some((item) =>
      item.label.includes("Analysis: partial (stale)"),
    ));
    const workspace = rootItems.find((item) => item.label === "repo");
    assert.ok(workspace);
    const project = provider.getChildren(workspace).find(
      (item) => item.label === "<web & api>",
    );
    assert.ok(project);
    const routeGroup = provider.getChildren(project).find(
      (item) => item.label === "Routes (1)",
    );
    assert.ok(routeGroup);
    const route = provider.getChildren(routeGroup)[0];
    assert.strictEqual(route.label, "GET /api/users");
    assert.strictEqual(
      provider.getTreeItem(route).command?.command,
      "codeOrbit.openFile",
    );
  });

  test("marks analysis stale when a watched source file is created", async function () {
    this.timeout(30000);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeorbit-watch-"));
    let folder: vscode.WorkspaceFolder | undefined;
    let watcher: vscode.Disposable | undefined;
    try {
      folder = await addWorkspaceFolder(root);
      const changed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          watcher?.dispose();
          reject(new Error("Timed out waiting for a watched source-file event."));
        }, 15000);
        watcher = watchWorkspaceForChanges([folder!], () => {
          clearTimeout(timer);
          resolve();
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await writeFixture(root, "src/new-file.ts", "export const fresh = true;");
      await changed;
    } finally {
      watcher?.dispose();
      if (folder) {
        await removeWorkspaceFolder(folder);
      }
      await removeFixtureDirectory(root);
    }
  });

  test("watches Python and Java source and manifest changes", async function () {
    this.timeout(30000);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeorbit-polyglot-watch-"));
    let folder: vscode.WorkspaceFolder | undefined;
    let watcher: vscode.Disposable | undefined;
    try {
      folder = await addWorkspaceFolder(root);
      for (const relativePath of ["pyproject.toml", "src/Application.java"]) {
        const changed = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            watcher?.dispose();
            reject(new Error(`Timed out waiting for a watcher event for ${relativePath}.`));
          }, 10000);
          watcher = watchWorkspaceForChanges([folder!], () => {
            clearTimeout(timer);
            resolve();
          });
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        await writeFixture(root, relativePath, "changed = true");
        await changed;
        watcher?.dispose();
        watcher = undefined;
      }
    } finally {
      watcher?.dispose();
      if (folder) {
        await removeWorkspaceFolder(folder);
      }
      await removeFixtureDirectory(root);
    }
  });
});
