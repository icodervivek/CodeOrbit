# Design

## Context

See `proposal.md` for motivation and `specs/workspace-intelligence/spec.md` for the behavior contract. The current extension scans only the first workspace folder, uses `findFiles` result caps without signaling truncation, treats malformed manifests as silent skips, and stores a flat analysis model. The tree and dashboard are snapshot views; the existing test is a scaffold assertion.

## Goals / Non-Goals

**Goals:**
- Introduce project-scoped findings and diagnostics while keeping the extension's local-only operating model.
- Make the scan bounded, cancellable, transparent about partial results, and usable for local and remote VS Code workspaces.
- Add deterministic static analysis for a deliberately limited set of JavaScript/TypeScript route conventions.
- Keep analyzer outputs independent of presentation so future ecosystems can reuse the project model.

**Non-Goals:**
- Runtime execution, dependency installation, network calls, persistent analysis caches, or a complete call graph.
- Ecosystems beyond JavaScript/TypeScript, Python, and Java in this change.
- Exhaustive recognition of dynamic Express router composition or every Next.js routing convention.

## Decisions

### Use a project-scoped normalized analysis model

Represent a workspace analysis as workspace folders containing projects, with each project holding its manifests, dependencies, technology findings, entry-point candidates, routes, diagnostics, and completeness state. Associate each finding with evidence (URI and, when available, source range), the evidence kind, and whether it is declared, syntactically observed, or inferred. Preserve duplicate dependency declarations by project and category.

For JavaScript/TypeScript, use discovered `package.json` directories as project roots and assign source files to the nearest package root; files without a nearer manifest belong to the workspace-folder project. Keep same-named packages in separate roots distinct. This accommodates ordinary repositories and monorepos without assuming a single root manifest.

### Scan through VS Code workspace APIs with explicit budgets

Enumerate each workspace folder independently using `workspace.findFiles` and `workspace.fs`, not direct local filesystem reads, so remote and virtual workspaces remain viable. Replace the catch-all config scan with explicit candidate globs. Exclude generated/vendor directories by default.

Apply per-category file-count and per-file byte limits. Request one more candidate than the configured count ceiling to detect truncation; check file sizes before reading. Return scan metadata with completion, cancellation, truncation categories, and per-file diagnostics. A failure reading one candidate does not discard successful findings from other files. Cancellation stops further stages and leaves the last successful UI result intact while notifying the user that the new scan was cancelled.

### Separate collection, analyzers, and presentation

Use a scanner to collect bounded files and manifests, ecosystem analyzers to parse dependency metadata, detectors to interpret evidence, and framework route analyzers to emit normalized route records. Merge outputs by project and evidence identity, not by display name. Register only the supported ecosystems and framework conventions described in this design; findings from static evidence do not prove runtime behavior.

Use the TypeScript compiler API for a syntax-only pass over JavaScript and TypeScript route source. It can parse supported source extensions without loading or executing project modules. Promote the existing `typescript` package to a runtime dependency so the parser is available in packaged installations; verify the resulting VSIX contents and size.

### Keep route extraction intentionally conservative

For Express, recognize direct calls to common HTTP methods on syntactically identifiable application/router values when the method and path are static string literals. Report the declared path, method, and source range. Do not attempt to prove middleware execution or fully compose mounted routers; emit a limitation diagnostic when composition prevents a reliable effective path.

For Next.js, recognize App Router `app/api/**/route.{js,jsx,ts,tsx}` files and Pages Router `pages/api/**/*.{js,jsx,ts,tsx}` files. Derive paths from their file locations, preserve dynamic segments, and report statically identifiable exported HTTP methods for App Router handlers. Treat Pages Router API files as API routes without claiming that every verb can be inferred from their handler implementation. Ignore non-API page routes in this MVP.

### Add bounded Python and Java manifest and route analyzers

Treat `pyproject.toml`, `requirements*.txt`, and `Pipfile` as Python project manifests, and Maven `pom.xml` and Gradle `build.gradle`/`build.gradle.kts` as Java manifests. Group manifests and source files by their containing project root, preserve declared dependency strings/coordinates and dependency scopes, and report unreadable/unsupported declarations as diagnostics rather than executing build tools or Python packaging code.

Detect Python and Java from source extensions, and detect FastAPI, Flask, Django, and Spring Boot from supported dependencies or static source evidence. Use bounded syntax-pattern analysis to recognize FastAPI/Flask decorators, Django URL entries, and Spring mapping annotations; preserve source locations and report unresolved router/blueprint/include composition. Do not execute interpreters, build tools, or application modules.

### Distinguish declared, inferred, and unresolved entry points

Read supported JavaScript package entry metadata without executing it. Resolve only static targets that can be interpreted safely, retain the manifest evidence, and report missing or unsupported targets as diagnostics. Keep conventional filenames as lower-certainty candidates, not confirmed runtime entry points. Never follow a target outside its owning workspace folder for source navigation.

### Put the dashboard and results tree in a dedicated sidebar container

Contribute a CodeOrbit Activity Bar container with its own icon, then contribute the workspace dashboard and existing native results tree as views inside that container. Remove the results tree from the Explorer contribution so users have one canonical location for CodeOrbit results. Use a sidebar-compatible webview view for the dashboard rather than an editor `WebviewPanel`; the existing dashboard command should reveal the CodeOrbit sidebar dashboard instead of opening a separate editor panel.

Keep the dashboard compact for sidebar width and derive it from the same in-memory analysis model as the tree. Show workspace/project totals, detected technologies and route/entry-point summaries where available, plus scan completeness, stale state, and diagnostics. Provide analyze/refresh actions and clear empty states when there is no workspace or no analysis yet. Keep navigable detailed findings and diagnostics in the project tree beneath the dashboard; do not independently recompute or duplicate analyzer facts in the webview.

On relevant file create/change/delete/rename events, mark the in-memory result stale and offer refresh; do not silently present it as current or automatically rescan on every keystroke. Dispose watchers and event subscriptions with the extension.

### Validate behavior with fixtures and failure cases

Add analyzer-level tests using small fixture projects for single packages, monorepos, multiple workspace roots, dependency categories/references, supported routes, dynamic paths, malformed/unreadable files, and missing entry targets. Add scanner tests for count/size limits, cancellation, and partial results, plus UI/model tests for stale and incomplete states. Keep fixtures deterministic and do not install or execute fixture project dependencies.

## Risks / Trade-offs

- [Static analysis cannot establish runtime behavior] → Label findings by evidence type, conservatively limit route syntax, and report unresolved composition instead of claiming exhaustive coverage.
- [File limits can hide relevant findings] → Detect the extra candidate, expose truncation in results, and make the limit category visible.
- [Project-root inference can misassign shared files] → Use nearest-manifest ownership with an explicit workspace-folder fallback and test nested packages.
- [TypeScript runtime parsing increases extension package size] → Reuse the existing TypeScript package, keep parsing syntax-only, and inspect the packaged extension as part of validation.
- [Remote filesystem providers vary in metadata support] → Keep reads behind VS Code filesystem APIs and surface provider errors as diagnostics rather than falling back to local paths.
- [In-memory stale results can outlive edits] → Watch relevant files, label results stale immediately, and require an explicit refresh to replace them.

## Migration Plan

There is no persisted analysis format or user data to migrate. Replace the flat in-memory model as part of the extension update, retain the existing analyze command and make the dashboard command reveal the sidebar dashboard, and expose partial-result information in the updated views. Move the existing results view from Explorer into the CodeOrbit container without duplicating it. Rollback is the normal extension version rollback; no workspace files are modified by analysis.
