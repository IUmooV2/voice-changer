# Running MooVoice on Windows

## First run

1. Pull the latest `feature/moovoice-shell` branch.
2. Place a compatible voice-changer engine in the repository's `engine` folder.
3. Open PowerShell in the repository root.
4. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\Start-MooVoice.ps1
```

MooVoice starts the engine, starts the interface, waits for both, and opens
`https://localhost:8080`.

## Current preview limitation

The MooVoice shell is connected to browser audio selection and engine health
detection. Model import, GPU selection, presets, and live conversion are still
being connected to the backend APIs. The legacy interface remains available
for compatibility until those controls reach parity.

## Troubleshooting

### Conversion engine not found

The launcher expects `start_https.bat`, `start_http.bat`, `start.bat`, or
`MMVCServerSIO.exe` inside `engine`. Pass `-EngineDirectory` if it is elsewhere.

### Port 18888 is already in use

This usually means an engine is already running, so the launcher reuses it. If
MooVoice still reports offline, close older voice-changer windows and retry.

### Certificate warning

The development interface uses a local self-signed certificate. Continue only
when the address is exactly `localhost:8080`.

### Interface-only development

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\Start-MooVoice.ps1 -SkipEngine
```
