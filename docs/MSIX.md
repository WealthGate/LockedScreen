# MSIX Packaging (Preferred)

This repo includes a minimal MSIX packaging setup in `installer/`.

## Prerequisites
- Windows SDK (includes `makeappx.exe` and `signtool.exe`)
- A code signing certificate (test or production)

## Steps
1. Prepare your logo assets and update `installer/AppxManifest.xml`.
   - You can generate placeholders with:
   ```
   .\scripts\generate-icons.ps1
   ```
2. Build the MSIX package:

```
.\installer\build-msix.ps1 -Publisher "CN=YourPublisher" -Version "1.0.0.0" -Output "installer\Lockedscreen.msix"
```

3. Sign the package:

```
# Example using a PFX certificate
signtool sign /fd SHA256 /a /f C:\path\to\cert.pfx /p <password> installer\Lockedscreen.msix
```

4. Install (admin or sideload enabled):

```
Add-AppxPackage -Path installer\Lockedscreen.msix
```

## CI Build
A GitHub Actions workflow at `.github/workflows/msix.yml` builds and uploads the MSIX artifact.
You must provide a valid Publisher string and optionally signing steps for production.

## Notes
- For kiosk usage, install the MSIX on the admin account, then point Assigned Access at the app executable path.
- Replace publisher and version per your release process.
