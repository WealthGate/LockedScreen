# Build and Run

## Prerequisites
- Windows 10/11
- .NET 8 SDK
- WebView2 Runtime (for HTML preview and hosted exams)

## Build
```
cd C:\Users\shedd\Lockscreen

dotnet build Lockedscreen.sln
```

## Run (Development)
```
dotnet run --project src\Lockedscreen.App\Lockedscreen.App.csproj
```

## Run Kiosk Helper
```
dotnet run --project src\Lockedscreen.KioskHelper\Lockedscreen.KioskHelper.csproj
```

## Tests
```
dotnet test tests\Lockedscreen.Tests\Lockedscreen.Tests.csproj
```

## Offline MathJax Bundle (Optional)
```
.\scripts\fetch-mathjax.ps1
```
This downloads MathJax into `src\Lockedscreen.App\Assets\MathJax` so math rendering works without network access.
