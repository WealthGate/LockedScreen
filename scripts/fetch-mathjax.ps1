$ErrorActionPreference = 'Stop'

$targetDir = Join-Path $PSScriptRoot '..\src\Lockedscreen.App\Assets\MathJax'
$targetDir = Resolve-Path $targetDir
$targetFile = Join-Path $targetDir 'tex-mml-chtml.js'

Write-Host "Downloading MathJax to $targetFile"

$uri = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js'
Invoke-WebRequest -Uri $uri -OutFile $targetFile

Write-Host 'Done.'
