# Windows Lockdown Companion

This folder contains the first native Windows companion for Lockedscreen:

- `Lockedscreen.Security.Service`
- `Lockedscreen.Security.Client`
- `Lockedscreen.Security.Agent`
- `Lockedscreen.Security.Protocol`

The current implementation provides:

- a true Windows Service host path for `Lockedscreen.Security.Service`
- a working native IPC boundary for service status and session coordination
- a user-session lockdown agent for keyboard suppression, taskbar hiding, and disallowed process enforcement
- an alternate-desktop host flow which launches the exam shell on a dedicated Win32 desktop and restores the original desktop when the session ends

The service still needs to be registered from an elevated administrator shell. Helper scripts are available in `/scripts`.

Alternate-desktop launch notes:

- the teacher shell remains on the default desktop
- the packaged Lockedscreen executable is relaunched on the alternate desktop with a startup route argument
- the relaunched shell skips native re-hosting and only applies app-level session policy

Build commands:

```powershell
dotnet build apps/windows-lockdown/Lockedscreen.Security.Service/Lockedscreen.Security.Service.csproj -c Release
dotnet build apps/windows-lockdown/Lockedscreen.Security.Client/Lockedscreen.Security.Client.csproj -c Release
dotnet build apps/windows-lockdown/Lockedscreen.Security.Agent/Lockedscreen.Security.Agent.csproj -c Release
```

Development run:

```powershell
dotnet run --project apps/windows-lockdown/Lockedscreen.Security.Service/Lockedscreen.Security.Service.csproj
dotnet run --project apps/windows-lockdown/Lockedscreen.Security.Client/Lockedscreen.Security.Client.csproj -- status
```

Service install scripts:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-lockedscreen-security-service.ps1 -ServiceExePath <path-to-Lockedscreen.Security.Service.exe>
powershell -ExecutionPolicy Bypass -File scripts/uninstall-lockedscreen-security-service.ps1
```
