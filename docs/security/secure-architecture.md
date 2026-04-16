# Lockedscreen Secure Architecture

## Two-Part Runtime Model

Lockedscreen now uses two coordinated internal roles:

1. `Windows Lockdown Component`
2. `Exam Runtime Component`

The Windows lockdown component is split between the Electron main process and a native Windows helper/service pair. Together they own:

- exam package validation
- protected package import and export
- session start and end orchestration
- runtime restriction activation
- desktop or shell isolation
- process and window supervision
- Windows-specific shortcut and surface suppression
- process and environment diagnostics
- approved application launch and supervision
- security logging

The exam runtime component lives in the renderer and owns:

- app-based exam presentation
- hosted exam presentation in a controlled embedded runtime
- student-facing session shell
- minimal approved controls such as back-to-start, restart, and invigilator unlock

This separation keeps policy and enforcement decisions out of the renderer where possible.

## Security Levels

### Restricted App Mode

Use this mode for:

- rehearsals
- lower-stakes exams
- unmanaged test devices
- Windows Home validation

Capabilities:

- full-screen session shell
- invigilator PIN exit path
- package-driven runtime policy
- hosted URL filtering
- browser/session clearing
- approved application workflow
- diagnostics and logging

Limits:

- cannot claim control over protected Windows key paths
- cannot replace official kiosk deployment
- depends on app-level restrictions and administrator supervision

### Full Kiosk Mode

Use this mode for:

- high-stakes exams
- school-managed Windows devices
- dedicated exam accounts
- native companion deployments
- Assigned Access or Shell Launcher deployments

Capabilities:

- all Restricted App Mode controls
- package model tuned for kiosk deployment
- native Windows helper and service verification
- admin-visible verification of kiosk posture
- clearer separation between app-enforced, native-companion-enforced, and OS-enforced controls

Important:

Full Kiosk Mode is strongest when Lockedscreen runs with a verified native Windows lockdown companion and, where available, Windows itself is configured to launch Lockedscreen as the dedicated exam shell or allowed app for the exam account.

## Exam Configuration Packages

Each exam can have one or more configuration packages. Packages store:

- source mode and start URL
- browser display mode
- allowed domains and URL rules
- session handling rules
- key restriction metadata
- clipboard, capture, and printing policy
- environment and process policy
- approved third-party application list
- branding and student interface options

Packages are separate from submissions and other student runtime data.

### Protected Package Files

Exported package files are:

- password protected
- encrypted with authenticated encryption
- validated against a checksum when imported

This does not make the whole workstation tamper-proof. It does make package tampering detectable and protects configuration packages in transit or storage.

## URL Filtering

Hosted exam packages can define:

- allowed domains
- explicit URL prefix rules
- start URL
- protected back-to-start behavior
- query parameter preservation rules

Navigation outside the allowed set is blocked by the lockdown component where the embedded runtime allows.

## Session Handling

Policies can control:

- clear browser session on start
- clear browser session on end
- ask before quit
- restart session instead of quit
- protected back-to-start
- optional exit URL metadata
- timeout action

## Approved Applications

Packages can include approved third-party applications such as:

- calculator tools
- spreadsheet tools
- coding tools
- subject-specific utilities

Lockedscreen can launch only applications explicitly defined in the package and records those launches in the local log.

## Diagnostics and Verification

The admin console shows:

- package integrity summaries
- validation items
- environment checks
- process policy observations
- recent security log events

Each check is labeled as one of:

- `app-enforced`
- `native-companion-enforced`
- `os-kiosk-enforced`
- `advisory`

## Known Limits

Lockedscreen does not:

- intercept protected Windows secure-attention sequences
- install drivers or kernel hooks
- pretend to fully secure unmanaged consumer devices
- guarantee that VM, remote-session, or screen-sharing heuristics are perfect

The strongest Windows lockdown depends on either a verified native Windows companion, official kiosk deployment, or both.

## Recommended Windows Deployment

1. Install the Lockedscreen native Windows helper and Windows service.
2. Provision a dedicated exam account when using official kiosk controls.
3. Install Lockedscreen for that account or all users.
4. Configure Lockedscreen for native-companion mode, Assigned Access, Shell Launcher, or hybrid deployment.
5. Apply school policy for notifications, power behavior, peripheral restrictions, and network access.
6. Verify the package, native companion, environment checks, and deployment record in the Lockedscreen admin console before the exam starts.
