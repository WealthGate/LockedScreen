param([switch]$PrepareOnly, [string]$NodeExecutable)
$ErrorActionPreference = 'Stop'
$releaseRoot = Split-Path $PSScriptRoot -Parent
$version = (Get-Content -LiteralPath (Join-Path $releaseRoot 'apps/desktop/package.json') -Raw | ConvertFrom-Json).version
Push-Location $releaseRoot
try {
  $nativeOutput = Join-Path $releaseRoot 'apps/desktop/build/store-native'
  $buildRoot = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot 'apps/desktop/build')) + [System.IO.Path]::DirectorySeparatorChar
  $nativeOutput = [System.IO.Path]::GetFullPath($nativeOutput)
  if (!$nativeOutput.StartsWith($buildRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $nativeOutput -Leaf) -ne 'store-native') { throw 'Unsafe native staging directory.' }
  if (Test-Path -LiteralPath $nativeOutput) {
    if ((Get-Item -LiteralPath $nativeOutput).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Native staging must not be a symbolic link.' }
    Remove-Item -LiteralPath $nativeOutput -Recurse -Force
  }
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
  if (!$NodeExecutable) { $NodeExecutable = (Get-Command node.exe).Source }
  if ([int](& $NodeExecutable -p 'process.versions.node.split(".")[0]') -lt 24) { throw 'Builds require Node 24 or newer. Provide -NodeExecutable for a non-default runtime.' }
  & $NodeExecutable (Join-Path $releaseRoot 'node_modules/typescript/bin/tsc') --noEmit --project apps/desktop/tsconfig.json
  if ($LASTEXITCODE -ne 0) { throw 'Type check failed' }
  Push-Location apps/desktop
  try {
    & $NodeExecutable (Join-Path $releaseRoot 'node_modules/electron-vite/bin/electron-vite.js') build
    if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed' }
    & $NodeExecutable (Join-Path $releaseRoot 'node_modules/electron-builder/cli.js') --config electron-builder.store.cjs "--config.directories.output=dist-store/$version" --win appx --x64 --publish never
    if ($LASTEXITCODE -ne 0) { throw 'Store packaging failed' }
    Copy-Item -LiteralPath "dist-store/$version/LockedScreen-Store-$version-x64.appx" -Destination "dist-store/LockedScreen-Store-$version-x64.appx"
  } finally { Pop-Location }
} finally { Pop-Location }
