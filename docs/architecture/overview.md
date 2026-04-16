# Architecture Overview

## Design Principles

- Local-first operation for reliability in school environments
- Clear separation between desktop shell, renderer UI, domain logic, and storage
- Secure-by-default Electron configuration
- Simple import rules that can be validated deterministically
- Windows lockdown delegated to a native companion and optionally reinforced by official Windows kiosk mechanisms

## Major Layers

### Desktop Shell / Lockdown Component

`apps/desktop/src/main`

- Owns Electron app lifecycle
- Creates the locked BrowserWindow
- Applies security-focused web preferences
- Restricts navigation, new windows, and external content
- Mediates approved filesystem and storage operations
- Protects configuration package import and export
- Orchestrates managed exam sessions and diagnostics
- Launches approved third-party applications when policy allows
- Integrates with a native Windows helper and service for desktop isolation, process supervision, and system-surface suppression

### Preload Boundary

`apps/desktop/src/preload`

- Exposes a narrow, validated API to the renderer
- Prevents direct Node.js access from React components
- Centralizes IPC request and response contracts

### Renderer Application / Exam Runtime Component

`apps/desktop/src/renderer`

- React and TypeScript UI
- Teacher dashboard, exam builder, import preview, results, and student exam flows
- Theme system, animation, and responsive layouts
- State managed through Zustand or Redux Toolkit
- Admin console for package editing, security posture, and diagnostics
- Student runtime for native and hosted exams under kiosk-managed policy

### Shared Packages

`packages/shared-types`

- Canonical TypeScript models for exams, questions, attempts, settings, and imports

`packages/parser`

- Converts teacher input files into validated question models
- Reports parsing errors with line-level context where possible

`packages/exam-engine`

- Exam session timing
- Question ordering
- Answer recording
- Flagging and completion rules
- Autograding for multiple-choice questions

`packages/storage`

- Repository abstraction over SQLite or structured JSON
- CRUD for exams, attempts, settings, and import sessions

`packages/ui`

- Shared design primitives and composed UI blocks
- Theme tokens, cards, labels, navigation chrome, and result views

## Supported Data Flow

### App-Based Exam Flow

1. Teacher creates or imports an exam.
2. Exam is stored locally with metadata and question set.
3. Student session loads an exam snapshot.
4. Exam engine tracks time, navigation, responses, and flags.
5. Submission triggers autograding and result persistence.
6. Teacher reviews or exports results.

### Link-Based Exam Flow

1. Teacher defines exam metadata and approved target URL.
2. Student launches the link-based session in the controlled shell.
3. Lockedscreen tracks identity, timer, and session boundaries.
4. On timeout, the session ends and records completion status.

## Security Boundaries

Security is layered:

1. A native Windows lockdown companion or official Windows kiosk mode provides the strongest shell escape protection.
2. The Lockedscreen lockdown component enforces package integrity, session orchestration, navigation policy, and approved-app workflows.
3. Preload validates access to local services.
4. The exam runtime renders native or hosted exams inside the current session policy.
5. Storage is local-first and only reachable through the controlled application API.

## Deployment Assumption

The system is intended for school-managed Windows devices where administrators control:

- the exam account
- the installed application
- allowed domains
- power and restart behavior
- device policy

Without that managed-device assumption, no desktop app can guarantee full exam containment.

## SEB Alignment Direction

To reach Safe Exam Browser style behavior on Windows Home, Pro, Enterprise, and Education, Lockedscreen needs:

1. A native Windows helper and Windows service outside the Electron renderer.
2. Desktop or shell isolation comparable to alternate-desktop or Explorer-suppression kiosk modes.
3. Process and foreground-window supervision with allow and deny lists.
4. A browser runtime that stays policy-driven while the native layer handles Windows-specific lockdown.
