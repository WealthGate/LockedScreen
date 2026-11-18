param(
  [Parameter(Mandatory)][string]$PackagePath,
  [Parameter(Mandatory)][string]$ReportPath
)
$ErrorActionPreference = 'Stop'
$kit = 'C:\Program Files (x86)\Windows Kits\10\App Certification Kit\appcert.exe'
if (!(Test-Path -LiteralPath $kit)) { throw 'Windows App Certification Kit is not installed.' }
$package = (Resolve-Path -LiteralPath $PackagePath).Path
$report = [System.IO.Path]::GetFullPath($ReportPath)
New-Item -ItemType Directory -Force -Path (Split-Path $report -Parent) | Out-Null
& $kit reset
if ($LASTEXITCODE -ne 0) { throw 'WACK reset failed.' }
& $kit test -appxpackagepath $package -reportoutputpath $report
$result = $LASTEXITCODE
if (!(Test-Path -LiteralPath $report)) { throw "WACK did not produce the report (exit $result)." }
Write-Output "WACK completed with exit $result; report: $report"
exit $result
