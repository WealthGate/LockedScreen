param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$releaseRoot = Split-Path $PSScriptRoot -Parent
Push-Location $releaseRoot
try {
  $nativeOutput = Join-Path $releaseRoot 'apps/desktop/build/store-native'
  foreach ($component in @('Service', 'Client', 'Agent')) {
    dotnet publish "apps/windows-lockdown/Lockedscreen.Security.$component/Lockedscreen.Security.$component.csproj" -c Release -r win-x64 --self-contained true -o $nativeOutput
    if ($LASTEXITCODE -ne 0) { throw "Native publish failed: $component" }
  }
  Add-Type -AssemblyName System.Drawing
  $assetOutput = Join-Path $releaseRoot 'apps/desktop/build/appx'
  New-Item -ItemType Directory -Force -Path $assetOutput | Out-Null
  $sourceIcon = [System.Drawing.Image]::FromFile((Join-Path $releaseRoot 'apps/desktop/build/icon.png'))
  try {
    foreach ($asset in @(@('StoreLogo',50,50), @('Square44x44Logo',44,44), @('Square150x150Logo',150,150), @('Wide310x150Logo',310,150))) {
      $bitmap = [System.Drawing.Bitmap]::new([int]$asset[1], [int]$asset[2])
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $size = [Math]::Min([int]$asset[1], [int]$asset[2])
        $graphics.DrawImage($sourceIcon, [int](($asset[1]-$size)/2), 0, $size, $size)
        $bitmap.Save((Join-Path $assetOutput ($asset[0]+'.png')), [System.Drawing.Imaging.ImageFormat]::Png)
      } finally { $graphics.Dispose(); $bitmap.Dispose() }
    }
  } finally { $sourceIcon.Dispose() }
  if ($PrepareOnly) { return }
  npm.cmd run typecheck
  if ($LASTEXITCODE -ne 0) { throw 'Type check failed' }
  npm.cmd run build:desktop
  if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed' }
  Push-Location apps/desktop
  try {
    npx.cmd electron-builder --config electron-builder.store.cjs --win appx --x64 --publish never
    if ($LASTEXITCODE -ne 0) { throw 'Store packaging failed' }
  } finally { Pop-Location }
} finally { Pop-Location }
