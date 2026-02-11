# Kiosk Setup (Official Windows Methods)

Lockedscreen must rely on supported Windows kiosk mechanisms. The app does not block system keys or modify OS security boundaries.

## Options
1. **Assigned Access (Multi-app Kiosk)**
   - Supported on Windows 10/11 Pro, Enterprise, Education.
   - Uses `Set-AssignedAccess` with an XML configuration.
   - Allows Win32 app paths in newer Windows builds.

2. **Shell Launcher (Win32 Shell Replacement)**
   - Supported in Windows Enterprise/Education.
   - Replaces the shell for the kiosk user with the Lockedscreen app.

The **Lockedscreen.KioskHelper** tool provides a guided flow for creating the kiosk user and applying Assigned Access.

## Using KioskHelper
1. Run **Lockedscreen.KioskHelper** as Administrator.
2. Create a local kiosk account (e.g., `ExamUser`).
3. Specify the path to `Lockedscreen.App.exe`.
4. Click **Enable Kiosk** to apply Assigned Access.
5. Sign in as the kiosk user to launch Lockedscreen automatically.

## Manual Assigned Access (PowerShell)
If you prefer to run directly in PowerShell (Admin), use the same flow:

```
New-LocalUser -Name "ExamUser" -Password (ConvertTo-SecureString "<PIN>" -AsPlainText -Force) -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires
Add-LocalGroupMember -Group "Users" -Member "ExamUser"

# Create XML with DesktopAppPath pointing to Lockedscreen.App.exe
Set-AssignedAccess -ConfigurationFilePath "C:\path\to\kiosk.xml"
```

## Disable Kiosk
```
Clear-AssignedAccess
```

## Limitations
- Assigned Access behavior varies by Windows edition and version.
- Classic Win32 kiosk is best supported in Enterprise/Education editions.
- If `Set-AssignedAccess` is unavailable, use Windows Configuration Designer or MDM to apply the XML.

## Safety Note
Shutdown and restart are always allowed by Windows. Exit back to normal Windows must use admin/invigilator credentials.
