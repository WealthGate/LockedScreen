# LockedScreen Windows setup and updates

Use one public entry point: `LockedScreen-Setup-<version>-x64.exe`. The Windows
setup shows **Student** and **Teacher / School** choices with download sizes.
It fetches just one installer over HTTPS and checks the expected byte count and
SHA-256 digest before launching it. Do not replace payload assets in-place;
make a new release instead.

## GitHub release

Starting with 0.6.61, new installations default to the publisher-managed
[hosted Google connection](hosted-google-oauth.md); teachers connect their account
without creating a Google OAuth project. Optional school-managed Desktop OAuth
remains available. No publisher Web client secret is built into the app.
Leave `LOCKEDSCREEN_GOOGLE_OAUTH_FILE` unset. Existing school-managed connections
are preserved; select the publisher-managed provider and reconnect to migrate.
Earlier installers and exam files containing
the old client cannot be made private by rebuilding. Plan credential
rotation only after dependent installations and packages are migrated.

1. Run `npm ci`. Build Teacher then Student using
   `scripts/build-edition.ps1 -Edition teacher -Target github` and
   `scripts/build-edition.ps1 -Edition student -Target github -SkipNative`.
   Configure production signing in electron-builder before building the
   payloads, so the update metadata also contains the signed hashes.
2. Run `scripts/build-web-setup.ps1`, sign the small setup with the production
   certificate, then run `scripts/build-web-setup.ps1 -ManifestOnly` to refresh
   the hash of the signed setup in `latest.yml`.
3. Attach the web setup, both NSIS payloads, both blockmaps, and all three feeds
   (`latest.yml`, `student.yml`, `teacher.yml`) to the same draft GitHub
   release. A draft is not a public update source.
4. Validate in a test environment: fresh installs of both roles, opening a
   teacher-created exam file, submission and supervised PIN exit, Classroom
   sign-in and turn-in, migration from the current public installer, and an
   automatic same-role update from an earlier test build. Verify that tampered
   downloads do not launch and a running exam defers installation. Confirm
   production signatures before publishing the draft as the latest release.

The old combined installer uses `latest.yml` to offer the chooser as a
one-time migration. Users confirm the role; the old app's update behavior
still controls how it downloads and launches that chooser. Back up the old
workspace before migration. Teacher keeps the existing workspace. Student
starts in its isolated workspace and should re-import teacher-sent exams.
If the old combined app remains installed after choosing Student, remove it
through Windows Settings only after confirming the new Student install works.

Current role-specific installations use `student.yml` or `teacher.yml`;
they download only their matching update and install it on normal exit when
an exam is not active. Do not publish a role payload as the other role's feed.

## Microsoft Store

The GitHub web setup is not an update for the existing Store product. Keep the
existing Store identity and submit an APPX via Partner Center. To build the
full selectable-role Store app, use `scripts/build-store.ps1`,
then validate and test that APPX before uploading it to the existing listing.
It includes teacher and exam delivery features, but all Store users receive
the full APPX. Microsoft requires
[permission for optional MSIX packages](https://learn.microsoft.com/en-us/windows/msix/package/optional-packages)
if you want a single listing with downloadable optional components. That
distribution model is not implemented here.
