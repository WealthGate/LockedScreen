$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$path = Join-Path $root 'tmp/oauth-token-encryption-key.txt'
New-Item -ItemType Directory -Force -Path (Split-Path $path -Parent) | Out-Null
if (Test-Path -LiteralPath $path) {
  if ((Get-Content -LiteralPath $path -Raw) -notmatch '^[A-Za-z0-9+/]{43}=$') { throw 'Existing key file is invalid; do not overwrite a key used by production.' }
} else {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  [System.IO.File]::WriteAllText($path, [Convert]::ToBase64String($bytes))
}
$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
$owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.SetOwner($owner)
$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($owner, 'FullControl', 'Allow'))
$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'), 'FullControl', 'Allow'))
Set-Acl -LiteralPath $path -AclObject $acl
Write-Output "Prepared private encryption key file: $path"
Write-Output 'Keep this key backed up privately. Do not send it in chat or commit it to Git.'
