# LOCKEDSCREEN

LOCKEDSCREEN is a local-first Windows exam application for schools. It supports:

- app-based exams authored inside the app
- link-based exams opened in a controlled webview
- testing mode for lower-stakes rehearsal
- native lockdown and alternate-desktop launch for stronger kiosk behavior on managed Windows devices

## What To Install

Windows packaging currently produces two main deliverables:

- `Lockedscreen-<version>-x64.exe`
  Standard Windows installer for most users.
- `Lockedscreen-Portable-<version>.exe`
  Portable build that can be run without a traditional install.

For students and staff, prefer the standard installer unless you specifically need portable distribution.

## How To Use The App

### 1. Teacher / Admin Setup

Open LOCKEDSCREEN and use the dashboard to:

1. Create an app-based exam or a link-based exam.
2. Configure branding, duration, questions, or the external exam URL.
3. Create or edit the exam configuration package.
4. Review settings in `Admin Console`, especially:
   - invigilator unlock PIN
   - testing mode allowance
   - security posture
   - native companion verification

### 2. App-Based Exam Mode

Use this when the questions live inside LOCKEDSCREEN.

- Students answer the questions directly in the app.
- Multiple-choice scoring is handled locally.
- Results are saved locally and can be exported later.

Launch flow:

1. Create the exam.
2. Ensure the exam has a configuration package.
3. Click `Launch secure session` or `Launch testing session`.
4. The student completes the exam in the student shell.
5. On submission, results are stored locally.

### 3. Link-Based Exam Mode

Use this when the actual exam lives on an LMS or external website.

- LOCKEDSCREEN provides the timer, containment shell, and policy controls.
- The target site opens in the embedded webview.
- Only approved domains and prefixes should be allowed.

Launch flow:

1. Create a link-based exam.
2. Set the start URL.
3. Configure allowed domains and URL rules in the package.
4. Launch the session.
5. The student works inside the hosted exam runtime.

### 4. Testing Mode

Testing mode is for rehearsal and low-stakes use.

Use it when:

- the device is unmanaged
- the native lockdown companion is not installed
- you are on Windows Home without verified native lockdown
- you want to test exam content without full kiosk enforcement

Important limitation:

- Testing mode does not fully control Windows surfaces such as the Windows key, task switching, or the taskbar.

### 5. Restricted App Mode

Restricted App Mode keeps the exam inside the application and applies app-level controls such as:

- fullscreen / always-on-top behavior
- blocked shortcut handling inside the app
- hosted exam navigation rules
- controlled launch of approved applications

Use this for:

- rehearsals
- low-stakes exams
- environments where official kiosk deployment is not available

### 6. Full Kiosk Mode

Full Kiosk Mode is the intended high-stakes mode.

Use it when:

- the native Windows lockdown companion is installed and verified
- or the device is deployed with Assigned Access / Shell Launcher
- preferably both

Expected behavior:

- the secure launch path uses the native companion
- the exam can be handed off to the alternate desktop path
- exit should happen through submission, invigilator unlock, or supervised restart/shutdown

## Recommended Windows Deployment

For serious exam use:

1. Use school-managed Windows devices.
2. Create a dedicated exam account.
3. Install LOCKEDSCREEN for that device or account.
4. Install and verify the native Windows lockdown companion.
5. Where possible, configure Assigned Access or Shell Launcher.
6. Test the full secure launch path before the live exam.

See:

- [Windows kiosk setup](docs/security/windows-kiosk-setup.md)
- [Secure architecture](docs/security/secure-architecture.md)
- [Security notes](docs/security/security-notes.md)

## Reinstall Vs Update

You do not always need to uninstall first.

### Standard Installer Update

If LOCKEDSCREEN is already installed:

1. Close the app.
2. Run the newer installer.
3. Install to the same location.
4. Launch the updated version.

In most cases this is an in-place update, not a clean reinstall.

Your local app data is typically preserved unless you manually remove it.

### Portable Update

If you distribute the portable build:

1. Close the running app.
2. Replace the old portable executable with the new one.
3. If you distribute the unpacked folder, replace the full folder contents together.

Important:

- do not mix old `resources` files with a new executable
- replace the full portable output as a unit

### When A Full Reinstall Is Worth Doing

Use a clean reinstall if:

- the install directory was manually modified
- native helper files are missing or inconsistent
- the app behaves like an older build after an update
- you want to reset the machine to a known-good packaged state

## Building And Packaging

From the repository root:

```powershell
npm install
cmd /c npm run build
cmd /c npm run dist
```

Useful scripts:

- `npm run dev`
- `npm run typecheck`
- `npm run build`
- `npm run dist`

## Current Windows Artifacts

Packaged artifacts are written under:

- `apps/desktop/dist`

Typical files include:

- installer `.exe`
- portable `.exe`
- unpacked build folder

## Distributing To Students

For controlled lab deployment:

- distribute the installer to managed machines
- install the native lockdown companion where required
- verify the exam package and secure launch path on one staging machine first

For less controlled environments:

- use testing mode only
- do not describe it as fully secure containment

## Putting This On GitHub Later

When you are ready to publish:

1. Push the repository to GitHub.
2. Create tagged releases such as `v0.2.9`.
3. Attach the generated installer and portable artifacts to the GitHub release.
4. Add release notes describing:
   - version
   - installation/update instructions
   - security limitations
   - major fixes

That gives users a stable download point without requiring them to build locally.

## Documentation Index

- [Architecture overview](docs/architecture/overview.md)
- [Teacher import guide](docs/teacher-guide/importing-questions.md)
- [Windows kiosk setup](docs/security/windows-kiosk-setup.md)
- [Security notes](docs/security/security-notes.md)
- [Secure architecture](docs/security/secure-architecture.md)
- [SEB technology alignment](docs/security/seb-technology-alignment.md)
