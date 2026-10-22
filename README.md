<p align="center">
  <img src="resources/codeorbit-logo.png" alt="CodeOrbit logo" width="96">
</p>

<h1 align="center">CodeOrbit</h1>

CodeOrbit is a local, rule-based VS Code extension for getting oriented in JavaScript, TypeScript, Python, and Java workspaces. It groups findings by workspace folder and project, shows where detections came from, and reports when analysis is incomplete.

## Features

- Detect JavaScript, TypeScript, Python, and Java files and selected React, Next.js, Vite, Express, FastAPI, Flask, Django, and Spring Boot evidence.
- List declared dependencies from `package.json`, `pyproject.toml`, `requirements*.txt`, `Pipfile`, Maven `pom.xml`, and Gradle build files with their declared version and dependency category. A declaration does not mean that a dependency is installed or used at runtime.
- Show declared entry points separately from filename-based candidates, including common Python module names and Spring Boot application classes.
- Discover selected static Express, Next.js, FastAPI, Flask, Django, and Spring Boot routes.
- Group results by workspace folder and nearest ecosystem manifest/project root, including monorepos and multi-root workspaces.
- Show scan status, file-level diagnostics, truncation, and unsupported route-analysis coverage in the CodeOrbit Activity Bar dashboard and workspace tree.
- Navigate from a finding to its source file and explicitly refresh the analysis.

## Supported analysis

The analyzer supports JavaScript/TypeScript manifests and selected Python and Java project manifests. Python dependencies are read from `pyproject.toml`, `requirements*.txt`, and `Pipfile`; Java dependencies are read from Maven `pom.xml` and Gradle `build.gradle` or `build.gradle.kts`. Python requirements and Java configuration files are not executed. Other ecosystems such as Go, Rust, and PHP are not currently analyzed.

Express route discovery recognizes direct calls such as `app.get("/path", handler)` when the receiver is initialized with a recognizable Express factory/router and the path is a static string. It does not execute code or fully combine mounted routers, middleware, or dynamic route paths.

Next.js route discovery covers `app/api/**/route.{js,jsx,ts,tsx}` and `pages/api/**/*.{js,jsx,ts,tsx}` conventions, including `src/app` and `src/pages` layouts. Dynamic segments are retained. App Router methods are listed when their named exports are statically recognizable; Pages Router files are reported as API routes without inferring a complete HTTP method set.

FastAPI and Flask route discovery recognizes same-line decorators with static string paths and supported HTTP methods. Django discovery recognizes static `path()` and `re_path()` entries in URL configuration files. `include()`, `include_router()`, and blueprint registration are not composed into effective paths and produce coverage diagnostics when recognized.

Spring Boot dependency declarations and `@SpringBootApplication` evidence are recognized from Maven/Gradle files and Java source. Static controller mappings such as `@GetMapping`, `@PostMapping`, and `@RequestMapping` are reported with class-level static prefixes and supported HTTP methods. Runtime-generated mappings and broader Spring configuration are not evaluated.

Technology findings identify evidence, not runtime certainty. A framework listed in a manifest is declared by that project; CodeOrbit does not prove that the application imports or runs it. Filename-based entry points are candidates. Package entry targets that cannot be found or safely followed are reported as diagnostics.

## Analysis limits and privacy

Analysis is local. CodeOrbit does not send source to a service, execute workspace scripts, import project modules, install project dependencies, or resolve a complete transitive dependency graph.

The scanner currently limits each workspace folder to 200 project manifests, 5,000 source files, and 5,000 selected configuration files. It skips common generated and environment directories such as `node_modules`, `.venv`, `venv`, `__pycache__`, `.gradle`, and `target`. Individual files larger than 1 MiB are not analyzed. File discovery reports its current workspace/project phase and performs bounded parallel file metadata and content I/O. Reaching a limit, malformed or unreadable files, and unsupported route syntax can produce partial results and diagnostics rather than a complete-looking report. The limits are currently fixed and are not user-configurable.

The analysis is an in-memory snapshot. Relevant source, manifest, and configuration changes mark it stale in the CodeOrbit sidebar dashboard and workspace tree; use **CodeOrbit: Refresh Workspace** to analyze again. A cancelled scan leaves the last completed result unchanged and is shown in the dashboard. The dashboard refreshes when analysis state changes.

## Use

1. Open one or more workspace folders in VS Code.
2. Select the **CodeOrbit** icon in the Activity Bar. The sidebar dashboard offers an **Analyze workspace** action; you can also run **CodeOrbit: Analyze Workspace** from the Command Palette.
3. Expand a workspace folder and project to inspect technologies, dependencies, entry points, routes, and diagnostics.
4. The workspace-results tree is available below the dashboard in the CodeOrbit sidebar. **CodeOrbit: Open Dashboard** reveals this sidebar; use **CodeOrbit: Refresh Workspace** after changes.

## Development

```sh
npm install
npm test
```

Press F5 in VS Code to start an Extension Development Host. Open a supported JavaScript/TypeScript, Python, or Java workspace there and run **CodeOrbit: Analyze Workspace**.

## Known limitations

- Static route discovery is intentionally incomplete for runtime-generated paths, mounted-router composition, and unsupported syntax.
- Dependency findings describe declarations, not installed packages, resolved transitive trees, or security vulnerabilities.
- Route analysis is conservative and limited to the listed static framework conventions; dynamic composition can result in partial coverage.
- Python and Java dependency/route discovery covers the listed manifest formats and conventions, not every packaging tool or framework pattern.
- Results are not persisted between extension sessions.

## Commands

- **CodeOrbit: Analyze Workspace**
- **CodeOrbit: Refresh Workspace**
- **CodeOrbit: Open Dashboard** (reveals the CodeOrbit Activity Bar sidebar)
