# Safe Exam Browser Technology Alignment

## Goal

This document maps the current Lockedscreen codebase to the Windows lockdown model used by Safe Exam Browser and identifies what must be added to reach comparable behavior for high-stakes exams.

## What SEB Uses on Windows

Based on the Safe Exam Browser public overview and Windows documentation, SEB on Windows relies on more than a fullscreen browser window. Its documented model includes:

- encrypted per-exam configuration files
- URL filtering
- process monitoring
- disabled taskbar and start menu access
- blocking or restricting Alt+Tab, Windows+Tab, Print Screen, and related shortcuts
- removal of some Windows Security Screen options while the exam is running
- kiosk modes such as Explorer-shell suppression
- optional use of approved third-party applications

Those capabilities imply a native Windows enforcement layer in addition to the browser runtime.

## Current Lockedscreen State

The current repo already has useful foundations:

- encrypted and integrity-checked exam configuration packages
- Electron hardening with preload isolation
- URL allowlisting for hosted exams
- process observation and security logging
- approved application launch policy
- student and teacher flows for app-based and link-based exams

The current repo does not yet provide SEB-equivalent Windows lockdown because the active enforcement is still primarily Electron-level.

## Gap Analysis

### Already Comparable

- Protected exam package transport
- URL filtering and controlled hosted exam sessions
- Allowlisted launch of approved third-party tools
- Local security diagnostics and audit logs

### Not Yet Comparable

- Native desktop isolation on Windows Home, Pro, Enterprise, and Education
- Explorer-shell suppression or alternate-desktop execution
- Foreground-window hiding or termination for prohibited apps
- Windows-specific handling for taskbar, Start menu, task switching, and Print Screen
- Policy-driven control path for Windows Security Screen behavior
- Verifiable native helper and service health checks
- Certificate pinning between the runtime and remote exam systems

## Required Architecture Changes

### 1. Native Windows Helper

Add a signed native executable responsible for:

- creating or switching to the exam desktop when configured
- hiding or suppressing Explorer shell surfaces when using shell-suppression mode
- applying Windows-specific shortcut restrictions that Electron cannot enforce
- reporting enforcement state back to the Electron main process

### 2. Windows Service

Add a Windows service responsible for:

- supervising the helper lifecycle
- brokering elevated or privileged operations
- exposing a narrow authenticated IPC channel to the desktop app
- writing security events for service-level enforcement failures

### 3. Hybrid Policy Engine

Keep the Electron main process responsible for:

- package validation
- exam session orchestration
- browser runtime controls
- approved-app policy
- diagnostics presentation

Move Windows-specific lockdown decisions into the native companion.

### 4. Deployment Modes

Support these explicit modes:

- `restricted-app`
- `windows-native-companion`
- `assigned-access`
- `shell-launcher`
- `hybrid`

`hybrid` should be the strongest deployment on managed devices. `windows-native-companion` is the path to SEB-like behavior on Windows Home and other editions where official kiosk features alone are not enough.

## Recommended Implementation Order

1. Add runtime detection and verification for the native helper and service.
2. Define authenticated IPC between Electron and the native companion.
3. Implement foreground-window and process supervision.
4. Implement desktop isolation or Explorer-shell suppression modes.
5. Add certificate pinning for hosted exam backends.
6. Build installer support for the helper and service.

## Practical Conclusion

Lockedscreen can use the same class of technology as Safe Exam Browser, but not by staying Electron-only. The repository now needs a native Windows lockdown component beside the existing exam runtime. Without that component, the app remains a controlled exam shell, not a complete Windows lockdown environment.
