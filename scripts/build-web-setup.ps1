param([switch]$ManifestOnly, [switch]$Test)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$desktop = Join-Path $root 'apps/desktop'
$version = (Get-Content -Raw (Join-Path $desktop 'package.json') | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Expected a stable release version.' }
$out = Join-Path $desktop 'dist-editions/web'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$setupName = "LockedScreen-Setup-$version-x64.exe"
$setup = Join-Path $out $setupName

function Get-PayloadSource($role) {
  $name = "LockedScreen-$role-Setup-$version-x64.exe"
  $file = Get-Item -LiteralPath (Join-Path $desktop "dist-editions/$($role.ToLowerInvariant())/github/$name")
  $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
  '    internal static readonly WebSetup.Payload {0} = new WebSetup.Payload("{0}", "{1}", {2}L, "{3}");' -f $role, $name, $file.Length, $hash
}

if (!$ManifestOnly) {
  $source = Join-Path $out 'Payloads.g.cs'
  @(
    'using System.Reflection;'
    '[assembly: AssemblyTitle("LockedScreen Setup")]'
    ('[assembly: AssemblyVersion("{0}.0")]' -f $version)
    'internal static class Payloads {'
    ('    internal const string Version = "{0}";' -f $version)
    (Get-PayloadSource 'Student')
    (Get-PayloadSource 'Teacher')
    '}'
  ) | Set-Content -LiteralPath $source -Encoding ASCII

  $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
  $common = @('/nologo', '/platform:x64', '/reference:System.Net.Http.dll',
    '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
    (Join-Path $desktop 'build/WebSetup.cs'), $source)
  & $compiler /target:winexe /optimize+ "/win32icon:$(Join-Path $desktop 'build/icon.ico')" "/out:$setup" @common
  if ($LASTEXITCODE -ne 0) { throw 'Web setup compilation failed.' }
  if ($Test) {
    $testExe = Join-Path $out 'WebSetupTests.exe'
    & $compiler /target:exe /main:WebSetupTests "/out:$testExe" @common (Join-Path $desktop 'test/WebSetupTests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Web setup test compilation failed.' }
    & $testExe
    if ($LASTEXITCODE -ne 0) { throw 'Web setup tests failed.' }
  }
}

# Legacy clients receive the chooser, not either role's installer.
$setupFile = Get-Item -LiteralPath $setup
$stream = $setupFile.OpenRead()
$algorithm = [Security.Cryptography.SHA512]::Create()
try { $hash = [Convert]::ToBase64String($algorithm.ComputeHash($stream)) }
finally { $stream.Dispose(); $algorithm.Dispose() }
@(
  "version: $version"
  'files:'
  "  - url: $setupName"
  "    sha512: $hash"
  "    size: $($setupFile.Length)"
  "path: $setupName"
  "sha512: $hash"
) | Set-Content -LiteralPath (Join-Path $out 'latest.yml') -Encoding ASCII
$setupFile
