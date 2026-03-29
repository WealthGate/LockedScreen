param(
    [Parameter(Mandatory = $true)]
    [string]$ServiceExePath
)

$resolved = (Resolve-Path $ServiceExePath).Path
$serviceName = "LockedscreenSecurityService"

sc.exe stop $serviceName | Out-Null
sc.exe delete $serviceName | Out-Null
sc.exe create $serviceName binPath= "`"$resolved`"" start= auto DisplayName= "Lockedscreen Security Service"
sc.exe description $serviceName "Provides the Lockedscreen native security companion service for secure exam sessions."
sc.exe start $serviceName
