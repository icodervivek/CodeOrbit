# Proposal

## Why

CodeOrbit currently provides a small JavaScript/TypeScript overview, but its scan can silently omit unreadable manifests, does not distinguish multiple projects, and presents heuristic detections without evidence or completeness status. Users need a trustworthy, local workspace map that explains what was detected, where the evidence came from, and where analysis is incomplete.

## What Changes

- Organize findings by workspace project/package instead of merging all packages into one summary.
- Add evidence-backed Python and Java project analysis, including dependencies from supported manifests and static route discovery for FastAPI, Flask, Django, and Spring Boot.
- Make bounded scans and partial results visible, with per-file diagnostics and evidence for stack, dependency, and entry-point findings.
- Extend the JavaScript/TypeScript MVP with selected Express and Next.js route discovery, clearly labeling statically discovered results and unsupported patterns.
- Keep the analysis local and deterministic, and provide a shared analyzer/result structure that can accommodate additional ecosystems later.
- Add automated fixture-based coverage for representative project layouts, parser failures, route patterns, and scan limits.
- Add a dedicated CodeOrbit Activity Bar container with a compact workspace dashboard and move the existing project-results tree into that container instead of the Explorer view.

## Capabilities

### New Capabilities
- `workspace-intelligence`: Analyze supported JavaScript/TypeScript workspaces and present project-scoped, evidence-backed findings, routes, and analysis status.

### Modified Capabilities
- None.

## Impact

The extension scanner, analysis model, JavaScript/TypeScript, Python, and Java detectors, route analyzers, tree provider, dashboard, VS Code view contributions, icon asset, and tests will be affected. Supported Python manifests are `pyproject.toml`, `requirements*.txt`, and `Pipfile`; supported Java manifests are Maven `pom.xml` and Gradle build files. Other ecosystems, complete call graphs, dynamic route execution, and dependency vulnerability scanning are out of scope.
