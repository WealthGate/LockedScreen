$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$assetsDir = Join-Path $root 'installer\Assets'
New-Item -ItemType Directory -Force $assetsDir | Out-Null

Add-Type -AssemblyName System.Drawing

function New-Icon($size, $path) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    $graphics.SmoothingMode = 'HighQuality'
    $graphics.Clear([System.Drawing.Color]::FromArgb(13, 107, 79))

    $fontSize = [Math]::Max([int]($size * 0.35), 10)
    $font = New-Object System.Drawing.Font 'Segoe UI', $fontSize, ([System.Drawing.FontStyle]::Bold)
    $brush = [System.Drawing.Brushes]::White
    $text = 'LS'
    $sizeF = $graphics.MeasureString($text, $font)
    $x = ($size - $sizeF.Width) / 2
    $y = ($size - $sizeF.Height) / 2
    $graphics.DrawString($text, $font, $brush, $x, $y)

    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bmp.Dispose()
}

New-Icon 44 (Join-Path $assetsDir 'Square44x44Logo.png')
New-Icon 150 (Join-Path $assetsDir 'Square150x150Logo.png')
New-Icon 310 (Join-Path $assetsDir 'Square310x310Logo.png')

# Wide logo 310x150
$widePath = Join-Path $assetsDir 'Wide310x150Logo.png'
$bmp = New-Object System.Drawing.Bitmap 310, 150
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.SmoothingMode = 'HighQuality'
$graphics.Clear([System.Drawing.Color]::FromArgb(13, 107, 79))
$font = New-Object System.Drawing.Font 'Segoe UI', 48, ([System.Drawing.FontStyle]::Bold)
$brush = [System.Drawing.Brushes]::White
$text = 'Lockedscreen'
$sizeF = $graphics.MeasureString($text, $font)
$x = (310 - $sizeF.Width) / 2
$y = (150 - $sizeF.Height) / 2
$graphics.DrawString($text, $font, $brush, $x, $y)
$bmp.Save($widePath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bmp.Dispose()

# Store logo 50x50
New-Icon 50 (Join-Path $assetsDir 'StoreLogo.png')

Write-Host "Icons generated in $assetsDir"
