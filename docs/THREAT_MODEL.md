# Threat Model

## Goals
- Prevent access to other apps during exams using official OS kiosk mechanisms.
- Preserve exam integrity while avoiding OS bypass techniques.

## Out of Scope
- Bypassing or disabling Windows security controls.
- Suppressing system key combinations with global hooks.
- Preventing power actions (shutdown/restart).

## Assumptions
- Device is provisioned by an admin using Assigned Access or Shell Launcher.
- The kiosk user has no admin rights.
- Physical access is supervised during exams.

## Risks
- Misconfigured kiosk policy could allow access to other apps.
- Unpatched OS or elevated permissions could weaken lockdown.
- Unsupported DOCX formatting could cause rendering deviations.

## Mitigations
- KioskHelper and documentation prioritize official configuration methods.
- Preview & warnings during import help catch formatting issues.
- Results are saved locally to prevent network dependency.
