# Security Notes

## Scope

LOCKEDSCREEN aims to provide a secure exam environment on managed Windows devices. Security is achieved through layered controls across the operating system, the Electron shell, the renderer boundary, and local storage.

Every major security control should be described as one of:

- `app-enforced`
- `native-companion-enforced`
- `os-kiosk-enforced`
- `advisory`

This keeps the product honest about what the renderer can do on its own, what the native Windows companion can do, and what still depends on Windows deployment.

## Native Windows Companion

To align with Safe Exam Browser style Windows lockdown, LOCKEDSCREEN needs a native helper and Windows service responsible for:

- alternate desktop or Explorer-shell suppression
- process and foreground-window monitoring
- Windows-specific shortcut and shell-surface suppression
- secure communication back to the Electron main process
- supervised launch of approved third-party applications

This companion should use documented Windows APIs and signed binaries. It should not depend on kernel drivers or antivirus-style persistence.

## Electron Hardening

The desktop app should be configured with:

- `contextIsolation: true`
- `sandbox: true` where compatible with the chosen preload bridge
- `nodeIntegration: false`
- `enableRemoteModule: false`
- strict preload API exposure through `contextBridge`
- navigation and window-open allowlists
- blocked permission requests by default
- CSP headers or equivalent content restrictions for renderer assets

## IPC Rules

- Expose only task-specific IPC endpoints.
- Validate every payload at runtime.
- Reject unknown channels.
- Return structured errors rather than renderer-accessible stack traces.
- Separate teacher administration actions from student session actions.

## Hosted Exam Controls

Link-based exams must be restricted to approved domains. Recommended controls:

- normalize and validate the URL before launch
- enforce HTTPS
- compare the hostname against a teacher-managed allowlist
- support explicit URL prefix rules where the package requires them
- block navigation to unapproved origins
- prevent arbitrary downloads or external protocol handlers

## Content Safety

Teacher-authored rich content should be sanitized before render. This applies to:

- imported formatted text
- HTML fragments
- math markup wrappers
- hosted content metadata shown in the app shell

Do not render unsanitized HTML directly into the React tree.

## Storage Safety

- Store only the data required to run exams and retain results.
- Version the local schema.
- Validate imported question data before persistence.
- Protect exported configuration packages with encryption and integrity validation.
- Consider encryption at rest for result exports and high-stakes deployments.
- Keep audit information for submissions, unlock events, and timeouts.

## Operational Security

The app should be deployed with school operational controls:

- managed exam accounts
- restricted device policies
- supervised startup and shutdown
- locked peripheral usage where required
- pre-exam validation of time synchronization and network readiness

## Non-Goals

LOCKEDSCREEN should not:

- install drivers or kernel hooks
- attempt to intercept protected system shortcuts through unsupported means
- masquerade as antivirus or device management software
- claim full security on unmanaged consumer devices
