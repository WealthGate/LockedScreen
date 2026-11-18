$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content -LiteralPath (Join-Path $root 'apps/desktop/package.json') -Raw | ConvertFrom-Json).version
$exe = Join-Path $root "apps/desktop/dist-store/$version/win-unpacked/Lockedscreen.exe"
if (!(Test-Path -LiteralPath $exe)) { $exe = Join-Path $root 'apps/desktop/dist-store/win-unpacked/Lockedscreen.exe' }
if (!(Test-Path -LiteralPath $exe)) { throw 'Build the Store candidate before creating its test shortcut.' }
$builtVersion = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($exe).ProductVersion
if ($builtVersion -notlike "$version*") { throw "The unpacked build is $builtVersion, not $version. Rebuild the candidate first." }
$profile = Join-Path $root "tmp/acceptance-$version"
New-Item -ItemType Directory -Force -Path $profile | Out-Null
$shortcutPath = Join-Path $root "tmp/LockedScreen-$version-Test.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exe
$shortcut.Arguments = '--user-data-dir="' + $profile + '"'
$shortcut.WorkingDirectory = Split-Path $exe -Parent
$shortcut.IconLocation = "$exe,0"
$shortcut.Description = "LockedScreen $version acceptance test with a separate local workspace"
$shortcut.WindowStyle = 1
$shortcut.Save()
Write-Output "Test shortcut: $shortcutPath"
Write-Output "Separate test workspace: $profile"
Write-Output 'This does not install the APPX, change certificate trust, or replace the Store app.'
