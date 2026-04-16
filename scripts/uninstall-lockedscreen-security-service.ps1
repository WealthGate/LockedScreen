$serviceName = "LockedscreenSecurityService"

sc.exe stop $serviceName | Out-Null
sc.exe delete $serviceName
