param(
  [Parameter(Mandatory)][ValidateSet('student','teacher')][string]$Edition,
  [ValidateSet('github','store')][string]$Target = 'github',
  [string]$StudentIdentity,
  [switch]$SkipNative
)
$ErrorActionPreference = 'Stop'
$releaseRoot = Split-Path $PSScriptRoot -Parent
$savedEnvironment = @{}
foreach ($key in @('LOCKEDSCREEN_EDITION','LOCKEDSCREEN_TARGET','LOCKEDSCREEN_STUDENT_IDENTITY','LOCKEDSCREEN_STORE_PRODUCT_ID','LOCKEDSCREEN_STAGE')) {
  $savedEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}
Push-Location $releaseRoot
try {
  $env:LOCKEDSCREEN_EDITION = $Edition
  $env:LOCKEDSCREEN_TARGET = $Target
  $env:LOCKEDSCREEN_STAGE = Join-Path $releaseRoot ("apps/desktop/build/edition-app/" + $Edition + '-' + [guid]::NewGuid().ToString('N'))
  $env:LOCKEDSCREEN_STORE_PRODUCT_ID = '9NRCCBKRLXBJ'
  if ($Edition -eq 'student' -and $Target -eq 'store') {
    if (!$StudentIdentity) { throw 'Reserve a separate Student listing and provide its registered identity JSON.' }
    $env:LOCKEDSCREEN_STUDENT_IDENTITY = (Resolve-Path -LiteralPath $StudentIdentity).Path
    $registered = Get-Content -LiteralPath $env:LOCKEDSCREEN_STUDENT_IDENTITY -Raw | ConvertFrom-Json
    foreach ($key in @('identityName','publisher','publisherDisplayName','applicationId','displayName','storeProductId')) {
      if (![string]$registered.$key) { throw "Missing registered field: $key" }
    }
    if ($registered.identityName -eq 'WealthGate.LockedScreen') { throw 'Student requires a different registered identity.' }
    $env:LOCKEDSCREEN_STORE_PRODUCT_ID = $registered.storeProductId
  }
  if (!$SkipNative) {
    & (Join-Path $PSScriptRoot 'build-store.ps1') -PrepareOnly
  }
  if (!(Test-Path 'apps/desktop/build/store-native/Lockedscreen.Security.Agent.exe')) { throw 'Native helper build is missing.' }
  npm.cmd run typecheck
  if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed.' }
  npm.cmd run build:desktop
  if ($LASTEXITCODE -ne 0) { throw 'Edition desktop build failed.' }
  node scripts/stage-edition.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Edition staging failed.' }
  Push-Location $env:LOCKEDSCREEN_STAGE
  try {
    npm.cmd install --omit=dev --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Edition runtime dependency installation failed.' }
  } finally { Pop-Location }
  Push-Location apps/desktop
  try {
    npx.cmd electron-builder --config electron-builder.edition.cjs --win --x64 --publish never
    if ($LASTEXITCODE -ne 0) { throw 'Edition packaging failed.' }
  } finally { Pop-Location }
} finally {
  Pop-Location
  foreach ($key in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key, $savedEnvironment[$key], 'Process') }
}
