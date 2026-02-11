param(
    [string]$Configuration = 'Release',
    [string]$Runtime = 'win-x64',
    [string]$Publisher = 'CN=YourPublisher',
    [string]$Version = '1.0.0.0',
    [string]$Output = 'installer\\Lockedscreen.msix'
)

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$publishDir = Join-Path $root "artifacts\\publish"
$stagingDir = Join-Path $root "artifacts\\msix_staging"
$manifestPath = Join-Path $root "installer\\AppxManifest.xml"
$assetsSource = Join-Path $root "installer\\Assets"

Write-Host "Publishing app..."
dotnet publish "$root\\src\\Lockedscreen.App\\Lockedscreen.App.csproj" -c $Configuration -r $Runtime --self-contained false -o $publishDir

if (Test-Path $stagingDir) { Remove-Item -Recurse -Force $stagingDir }
New-Item -ItemType Directory -Force $stagingDir | Out-Null

Copy-Item "$publishDir\\*" $stagingDir -Recurse
Copy-Item $manifestPath (Join-Path $stagingDir 'AppxManifest.xml')

# Update manifest identity
[xml]$manifest = Get-Content (Join-Path $stagingDir 'AppxManifest.xml')
$manifest.Package.Identity.Publisher = $Publisher
$manifest.Package.Identity.Version = $Version
$manifest.Save((Join-Path $stagingDir 'AppxManifest.xml'))

# Copy MSIX assets
$assetsDir = Join-Path $stagingDir 'Assets'
if (-not (Test-Path $assetsDir)) {
    New-Item -ItemType Directory -Force $assetsDir | Out-Null
}
if (Test-Path $assetsSource) {
    Copy-Item "$assetsSource\\*" $assetsDir -Recurse -Force
} else {
    Write-Host "Warning: installer\\Assets not found. Add logo assets before packaging."
}

Write-Host "Packing MSIX..."
$makeappx = "makeappx.exe"
$cmd = "$makeappx pack /d `"$stagingDir`" /p `"$Output`""
cmd /c $cmd

Write-Host "MSIX created at $Output"
Write-Host "Sign with SignTool before installing on locked-down devices."
