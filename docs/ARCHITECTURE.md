# Lockedscreen Architecture

## Overview
Lockedscreen is a local-first Windows exam kiosk app built with .NET 8 and WPF. It follows MVVM and separates core domain logic from UI and OS-specific kiosk configuration.

## Projects
- `Lockedscreen.App` (WPF UI): examiner and student experiences, WebView2 rendering, theme switching.
- `Lockedscreen.Core` (Domain): models, grading engine, validation, PIN hashing.
- `Lockedscreen.Import` (Import): DOCX/HTML import and conversion pipeline.
- `Lockedscreen.Storage` (Persistence): local JSON exam/result storage + CSV export.
- `Lockedscreen.KioskHelper` (Admin Tool): official kiosk configuration helper.
- `Lockedscreen.Tests` (xUnit): grading and storage tests.

## Key Flows
1. Examiner creates/imports an exam and publishes a package.
2. Student logs in, takes exam in full-screen kiosk.
3. Results are graded locally and saved to JSON/CSV.
4. Kiosk lockdown is enforced via Assigned Access/Shell Launcher (official Windows methods).

## Data Storage
Local data is stored under `data/` relative to the app executable:
- `data/exams/*.lockedscreen_exam.json`
- `data/results/*.json`
- `data/results/*.csv`

## Security Boundaries
Lockdown is enforced using Windows Assigned Access / Shell Launcher. The app does not install hooks or bypass OS security.
