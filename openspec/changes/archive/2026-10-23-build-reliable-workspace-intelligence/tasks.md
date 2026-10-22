# Tasks

## 1. Project Model and Bounded Scanning

- [x] 1.1 Replace the flat analysis shape with workspace-folder, project, evidence, route, diagnostic, and completeness records; add model tests for project ownership and same-named packages in separate roots.
- [x] 1.2 Refactor discovery to scan every workspace folder through VS Code workspace APIs, assign files to the nearest package root, apply explicit count/size limits, and report truncation, malformed/unreadable manifests, provider errors, and cancellation; add scanner fixtures for single-root, monorepo, multi-root, limits, and partial results.

## 2. JavaScript/TypeScript Findings

- [x] 2.1 Parse supported package dependency sections without collapsing categories or projects, retain declared version expressions and evidence, and test workspace/file/Git/alias references and malformed values.
- [x] 2.2 Implement evidence-qualified language/framework and entry-point findings, resolve only supported static manifest targets within workspace boundaries, and test declared, inferred, missing, and unsupported targets.

## 3. Static Route Discovery

- [x] 3.1 Make the TypeScript parser available at extension runtime and implement conservative Express route extraction for supported static method/path declarations; test methods, source locations, dynamic paths, and unresolved router composition.
- [x] 3.2 Implement Next.js App Router and Pages Router API route-file discovery with dynamic segments and method evidence where supported; test nested routes, dynamic segments, unsupported patterns, and no-route versus incomplete outcomes.

## 4. User-Facing Results and Refresh

- [x] 4.1 Update the tree and dashboard to group findings by workspace folder and project, display evidence and completeness/diagnostic states, and navigate to source files; verify rendering for empty, large, partial, and multi-project results.
- [x] 4.2 Add cancellation feedback, stale-result marking for relevant file create/change/delete/rename events, safe navigation for missing files, and explicit refresh; test that cancelled scans preserve the last successful result and stale results are not shown as current.

## 5. Documentation and Integration Verification

- [x] 5.1 Update the README with first-release support, static-analysis limitations, local-only behavior, and scan status semantics; verify the documented capabilities match the analyzers and UI.
- [x] 5.2 Run compile, lint, fixture/unit tests, extension integration tests, and package inspection; verify the packaged extension includes its runtime parser dependency and that the full test suite passes.

## 6. CodeOrbit Sidebar Dashboard

- [x] 6.1 Add a CodeOrbit Activity Bar container and icon, move the workspace-results tree into that container, and remove its Explorer contribution; verify the extension manifest exposes one results tree only under CodeOrbit.
- [x] 6.2 Replace the editor-panel dashboard with a sidebar webview view that summarizes the current analysis and reflects empty, no-workspace, partial, cancelled, and stale states; wire analyze/refresh actions and live updates to the existing analysis model, and test each state and action.
- [x] 6.3 Make the existing dashboard command reveal the CodeOrbit sidebar dashboard, document the new location and behavior in the README, and run tests plus VSIX inspection; verify the dashboard and tree appear in the CodeOrbit container with no duplicate Explorer view.

## 7. Python and Java Analysis

- [x] 7.1 Discover and group Python/Java manifests and source files, parse supported dependency declarations, and identify language/framework evidence; verify manifest fixtures and project grouping tests pass.
- [x] 7.2 Add conservative FastAPI, Flask, Django, and Spring Boot static route analyzers with source evidence and composition diagnostics; verify representative route and unsupported-composition fixtures pass.
- [x] 7.3 Update supported-ecosystem documentation and verify the full test suite and extension package include the new analyzers and stale-file watchers cover their sources/manifests.
