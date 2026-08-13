# MooVoice Engine Strategy

Status: Phase 1 decision  
Reference hardware: Dell G16 7630, Core i9-13900HX, RTX 4070 Laptop GPU, 64 GB RAM

## Decision

MooVoice will modernize the source available on the upstream `master` line and
use its RVC-compatible server contract as the Preview 0.1 foundation.

The upstream `v.2` branch is not a viable source migration target because it
contains release documentation and notebooks rather than the client and server
implementation needed for a maintainable fork. MooVoice will not pretend that
the v2 distributed application is editable source.

## Runtime approach

Preview 0.1 supports either a compatible prebuilt Windows NVIDIA engine
extracted into `engine/` or a developer-run source engine listening locally on
port `18888`.

Large model weights and third-party engine binaries will not be committed to
Git. The repository contains launch integration and setup documentation only.

## Windows reference path

```text
voice-changer/
  engine/
    start_https.bat, start_http.bat, start.bat, or MMVCServerSIO.exe
  scripts/windows/Start-MooVoice.ps1
```

Run from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\Start-MooVoice.ps1
```

The launcher reuses an engine already listening on port 18888, searches common
local engine folders, starts the interface on port 8080, waits for services,
and reports specific missing-engine or timeout errors.

## NVIDIA recommendation

The reference machine should use the NVIDIA CUDA/ONNX GPU runtime. DirectML is
a fallback for non-NVIDIA Windows hardware. CPU mode is a diagnostic fallback,
not the intended real-time configuration.

Initial target: Balanced preset, CUDA device 0, RMVPE ONNX when available, and
a conservative chunk size until measured latency is displayed.

## Compatibility gate

1. Engine listens on localhost port 18888.
2. `/info` returns valid engine JSON.
3. MooVoice lists model slots.
4. CUDA is available in engine settings.
5. An RVC model imports without changing its files.
6. Microphone passthrough works.
7. Converted output is stable for at least five minutes.
8. Start, stop, and reconnect work without the legacy screen.

## Packaging and licensing

MooVoice will preserve upstream license notices. Engine executables, model
weights, and user-created voice models remain separate runtime artifacts until
their redistribution terms are verified. The launcher never downloads or
silently installs multi-gigabyte binaries.

## Next implementation steps

1. Validate one compatible NVIDIA engine package on the reference PC.
2. Connect the model browser to existing model-slot APIs.
3. Connect GPU selection and presets to server settings.
4. Connect start, stop, and passthrough.
5. Add latency and error telemetry.
6. Retire the legacy interface after parity testing.
