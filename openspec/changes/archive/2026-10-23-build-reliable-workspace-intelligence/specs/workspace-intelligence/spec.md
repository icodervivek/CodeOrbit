# Spec Delta

## Purpose

Help developers understand supported JavaScript and TypeScript workspaces through local, project-scoped findings whose evidence and analysis limits are visible.

## ADDED Requirements

### Requirement: Workspace analysis is scoped to projects
The system SHALL keep findings associated with the workspace folder and package/project that produced them, rather than merging unrelated projects into one indistinguishable result.

#### Scenario: Monorepo contains multiple packages
- **WHEN** a workspace contains multiple supported package manifests
- **THEN** the analysis presents each discovered package as a distinct project and associates its dependencies and findings with that project

#### Scenario: Multi-root workspace is analyzed
- **WHEN** the VS Code workspace contains more than one folder
- **THEN** the analysis identifies results by their owning workspace folder and does not combine same-named packages from different folders

### Requirement: Scan limits and incomplete analysis are visible
The system SHALL bound workspace scanning and identify when a scan is partial, capped, cancelled, or unable to read relevant files.

#### Scenario: A scan reaches a configured limit
- **WHEN** the number or size of candidate files exceeds an analysis limit
- **THEN** the result reports that analysis is incomplete and identifies the applicable limit category

#### Scenario: One manifest cannot be read or parsed
- **WHEN** a relevant manifest is unreadable or malformed
- **THEN** the system reports a diagnostic for that file and retains findings successfully collected from other files

#### Scenario: User cancels an analysis
- **WHEN** the user cancels a running scan
- **THEN** the scan stops and the interface identifies the result as cancelled rather than complete

### Requirement: Findings include verifiable evidence
The system SHALL present detected languages, frameworks, and entry points with the project scope and source evidence that supports each finding, distinguishing direct evidence from heuristic inference.

#### Scenario: Framework is inferred from a manifest
- **WHEN** a framework is detected from a declared dependency
- **THEN** the finding identifies the manifest and labels the evidence as a declaration rather than proof of runtime use

#### Scenario: No supported evidence is found
- **WHEN** analysis completes without evidence for a supported technology category
- **THEN** the interface distinguishes no finding from an unsupported or incomplete analysis

### Requirement: Dependency findings distinguish declarations from resolution
The system SHALL report JavaScript and TypeScript package dependencies from supported manifests with their declared category, version expression, and owning manifest, without implying that a declaration is installed or resolved.

#### Scenario: Dependency uses a workspace or non-semver reference
- **WHEN** a dependency declaration uses a workspace, file, alias, Git, tag, or range reference
- **THEN** the system preserves the declared value and does not present it as a resolved version

#### Scenario: Dependency appears in multiple categories or projects
- **WHEN** a dependency is declared in more than one category or package
- **THEN** each declaration remains associated with its category and owning project

### Requirement: Entry-point findings are qualified
The system SHALL distinguish explicitly declared package entry points from candidates inferred through naming or framework conventions and SHALL report when a declared entry target cannot be located.

#### Scenario: Conventional filename is identified
- **WHEN** an entry point is inferred from a common filename
- **THEN** the finding is labeled as a candidate and includes the source file as evidence

#### Scenario: Declared package entry target is missing
- **WHEN** a supported package manifest declares an entry target that cannot be located
- **THEN** the system reports the unresolved target instead of silently omitting it

### Requirement: Supported routes are statically discoverable
The system SHALL discover supported Express route registrations and Next.js API route files from source without executing workspace code, and SHALL associate each route with its project and source location.

#### Scenario: Express route uses a supported static declaration
- **WHEN** source contains a statically recognizable Express route registration with a supported HTTP method and path
- **THEN** the system reports the method, declared path, project, and source location

#### Scenario: Next.js API route follows a supported file convention
- **WHEN** a file matches a supported Next.js App Router or Pages Router API route convention
- **THEN** the system reports the route path and file location, and includes statically identifiable HTTP methods when available

#### Scenario: Route path is dynamic
- **WHEN** a supported route uses framework path parameters or dynamic route segments
- **THEN** the system preserves their dynamic nature in the displayed path rather than treating them as literal values

### Requirement: Route analysis communicates its limitations
The system SHALL label route results as statically discovered and SHALL report when supported source patterns cannot be resolved or when route coverage is incomplete.

#### Scenario: Route registration is dynamic or unsupported
- **WHEN** a route depends on runtime composition or syntax outside supported static patterns
- **THEN** the system does not claim exhaustive route coverage and exposes an appropriate limitation or diagnostic

#### Scenario: No routes are discovered
- **WHEN** route analysis finds no supported routes
- **THEN** the result distinguishes a completed search with no matches from unsupported frameworks, unreadable files, or incomplete scanning

### Requirement: Analysis stays local and does not execute project code
The system SHALL analyze workspace files locally and SHALL NOT execute project scripts, install dependencies, import workspace modules, or transmit source contents for analysis.

#### Scenario: Workspace contains executable lifecycle scripts
- **WHEN** a scanned manifest declares install or lifecycle scripts
- **THEN** analysis reads supported metadata without invoking those scripts

### Requirement: Findings support navigation and refresh
The system SHALL let users navigate from a finding with a valid source location to its workspace file and SHALL identify results that are stale or no longer navigable.

#### Scenario: User opens a current finding
- **WHEN** the user activates a finding whose source file still exists
- **THEN** the editor opens that file in the owning workspace

#### Scenario: Finding source changed or disappeared
- **WHEN** a finding is stale or its file no longer exists
- **THEN** the system reports the navigation or freshness problem and allows the workspace to be reanalyzed

### Requirement: CodeOrbit has a dedicated Activity Bar dashboard
The system SHALL provide a CodeOrbit Activity Bar entry that opens a workspace dashboard in the VS Code sidebar and keeps the workspace-results tree within the CodeOrbit container rather than separately contributing it to Explorer.

#### Scenario: User opens the CodeOrbit Activity Bar entry
- **WHEN** the user selects the CodeOrbit icon in the Activity Bar
- **THEN** VS Code opens the CodeOrbit sidebar containing a dashboard for the current workspace

#### Scenario: Analysis has not yet run
- **WHEN** the CodeOrbit dashboard is opened and no current workspace analysis exists
- **THEN** the dashboard presents an empty state that explains analysis is needed and provides an action to analyze the workspace

#### Scenario: Workspace analysis is available
- **WHEN** the CodeOrbit dashboard is opened after analysis
- **THEN** the sidebar dashboard summarizes the current workspace analysis status and project findings, and the detailed project-results tree is available in the same CodeOrbit container

#### Scenario: Existing analysis is partial or stale
- **WHEN** the current analysis is partial, cancelled, or stale
- **THEN** the sidebar dashboard visibly communicates that state and offers the appropriate analyze or refresh action without presenting incomplete findings as current and complete

### Requirement: Supported Python and Java projects are analyzed
The system SHALL recognize Python and Java source files, report supported manifest dependency declarations with their source and declared version expression, and identify selected Python and Java web frameworks without executing workspace code.

#### Scenario: Python dependencies and frameworks are declared
- **WHEN** a Python project contains `pyproject.toml`, `requirements*.txt`, or `Pipfile` declarations for FastAPI, Flask, or Django
- **THEN** the project results preserve the declared dependencies and versions and show Python and the evidenced frameworks with manifest or source evidence

#### Scenario: Java dependencies and Spring Boot are declared
- **WHEN** a Java project contains Maven `pom.xml` or Gradle `build.gradle`/`build.gradle.kts` dependencies or Spring Boot source annotations
- **THEN** the project results preserve supported dependency coordinates, versions, and scopes and show Java and Spring Boot with manifest or source evidence

#### Scenario: Python web routes use supported static declarations
- **WHEN** Python source contains supported FastAPI or Flask route decorators, or Django `path()`/`re_path()` entries
- **THEN** the results show statically recognized paths, supported HTTP methods where available, and the source file and line

#### Scenario: Spring Boot routes use supported static mappings
- **WHEN** Java source contains supported Spring mapping annotations and static paths
- **THEN** the results show the mapping path, statically identifiable HTTP methods, class-level static prefix when recognized, and source file and line

#### Scenario: Framework route composition cannot be resolved
- **WHEN** Python router/blueprint or Django URL includes require composition outside the supported static analysis
- **THEN** the results report a route coverage diagnostic rather than claiming complete effective paths
