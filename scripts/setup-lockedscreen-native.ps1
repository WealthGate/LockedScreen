param(
    [switch]$Build,
    [switch]$InstallService
)

$root = Split-Path -Parent $PSScriptRoot
$serviceExe = Join-Path $root "apps\windows-lockdown\Lockedscreen.Security.Service\bin\Release\net8.0-windows\Lockedscreen.Security.Service.exe"

if ($Build) {
    Push-Location $root
    try {
        cmd /c npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "Build failed."
        }
    }
    finally {
        Pop-Location
    }
}

if ($InstallService) {
    & (Join-Path $PSScriptRoot "install-lockedscreen-security-service.ps1") -ServiceExePath $serviceExe
}

Write-Host "Native setup complete."
Write-Host "Service binary: $serviceExe"
