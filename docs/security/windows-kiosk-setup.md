# Windows Lockdown Setup

LOCKEDSCREEN should be deployed through a native Windows lockdown companion, official Windows kiosk features, or both. Do not attempt to replace those controls with registry hacks, unsupported global keyboard traps, or background tools that only simulate kiosk behavior.

## Recommended Model

Use:

- the Lockedscreen native Windows helper and Windows service for SEB-style lockdown on supported Windows editions
- a dedicated exam account
- Windows Assigned Access for single-app kiosk deployments
- or Shell Launcher where the institution uses Windows Enterprise and needs deeper shell replacement

In hybrid deployments, the native companion handles Windows-specific lockdown while Assigned Access or Shell Launcher reinforce shell containment.

## Prerequisites

- A managed Windows device
- Administrator access on the device
- LOCKEDSCREEN installed for all users or for the exam account
- The Lockedscreen native helper and service installed when using native-companion mode
- A dedicated local or Azure AD exam account when using Assigned Access or Shell Launcher
- Auto sign-in policy only if allowed by school policy

## Assigned Access Setup

Typical Windows 11 flow:

1. Sign in with an administrator account.
2. Open `Settings > Accounts > Other users`.
3. Create a dedicated account such as `exam-student`.
4. Open `Settings > Accounts > Access work or school` if your organization manages policies centrally.
5. Open `Settings > Accounts > Other users > Set up a kiosk`.
6. Select the dedicated exam account.
7. Choose LOCKEDSCREEN as the kiosk application.
8. Confirm the single-app kiosk configuration.
9. Test sign-in with the exam account.

Expected result:

- Windows opens directly into LOCKEDSCREEN for that account.
- Start menu access is blocked by kiosk mode.
- App switching is not available to the student.
- If the app closes, Windows attempts to return to the kiosk shell.

## Shell Launcher Alternative

For environments that require full shell replacement:

1. Use a Windows edition that supports Shell Launcher.
2. Configure a dedicated exam account.
3. Set LOCKEDSCREEN as the shell application for that account.
4. Define restart behavior if the app exits unexpectedly.
5. Test power cycle, sign-in, and sign-out behavior before production use.

This approach is appropriate when the institution already uses enterprise device management and wants stronger control than consumer kiosk settings provide.

## Allowed Exit Paths

The deployment should allow only:

1. exam submission
2. invigilator unlock through an administrator password or unlock PIN
3. device restart or shutdown under supervised conditions

## Operational Checklist

- Verify the kiosk account cannot launch Explorer or other desktop apps.
- Confirm notifications, chats, and background popups are disabled by policy.
- Confirm network access reaches only required school systems.
- Confirm link-based exam domains match the app allowlist.
- Test app relaunch after crash or forced close.
- Test timeout and submission handling before each live exam.

## Important Limitation

No desktop application can guarantee secure containment on an unmanaged personal computer. The full security promise depends on a verified native lockdown companion, managed device policy, official kiosk deployment, or a combination of those controls.

## Windows Home

Windows Home can run LOCKEDSCREEN in two ways:

- testing mode, when no native lockdown companion is installed
- native-companion mode, when the Lockedscreen helper and service are installed and verified

Without the native companion, Windows Home cannot provide the controls required to suppress the Windows key, task view, taskbar surfaces, or desktop switching for a desktop Electron app.
