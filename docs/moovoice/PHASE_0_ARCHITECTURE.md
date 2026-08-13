# MooVoice Phase 0 Architecture

Status: Initial audit  
Target: MooVoice Preview 0.1  
Base commit: `f1caf8e7c39fd0d6866202be27bf142790191a51`

## Branch policy

- `master` remains compatible with the upstream `w-okada/voice-changer` repository.
- `develop` integrates completed MooVoice work.
- Feature work branches from `develop`.
- Preview releases are tagged from tested release branches.

## Current application path

### Frontend

The active browser interface is a React 18 and TypeScript application under
`client/demo`. Webpack creates the distributable frontend. The application
entrypoint is `client/demo/src/000_index.tsx`; the main screen and controls
live under `client/demo/src/components/demo`.

The current screen is tightly coupled to model-specific controls. MooVoice
should introduce a new presentation layer and preserve the existing hooks and
server contracts until compatibility tests prove replacements safe.

### Browser audio client

`client/lib` is the browser audio and server communication library. It owns
Socket.IO communication, audio worklets, IndexedDB-backed settings, server
configuration, and the voice changer client abstraction.

Preview 0.1 should consume this library instead of rewriting low-level audio
transport.

### Backend

`server/MMVCServerSIO.py` starts a FastAPI/Uvicorn server and Socket.IO
application. The REST layer is under `server/restapi`, realtime messaging is
under `server/sio`, and model implementations are under
`server/voice_changer`.

RVC has its own inference, embedder, pitch extraction, pipeline, ONNX export,
and model-slot code. This is the initial MooVoice engine target.

### Native launcher

The Python server can launch a bundled Windows native browser shell that opens
the local web interface. Preview 0.1 should preserve this behavior while the
installer and update strategy are evaluated.

## Preview 0.1 decisions

1. Windows and NVIDIA CUDA are the primary reference configuration.
2. RVC is the primary tested model family.
3. Preserve current backend API contracts.
4. Build a new MooVoice React shell around existing client hooks.
5. Keep Advanced controls available but remove them from the default path.
6. Add a hardware-informed Low Latency, Balanced, and Studio preset layer.
7. Preserve attribution, license notices, and model-specific terms.
8. Do not delete legacy engines until packaging and runtime dependency tracing
   is complete.

## Identified cleanup risks

- The root project mixes active application code, legacy model engines,
  trainers, recorders, Docker builds, generated frontend output, and
  documentation.
- `docker_vcclient/Dockerfile` clones upstream branch `v.1.5.3.13` rather
  than building the checked-out source. It cannot be treated as a current
  reproducible MooVoice build.
- `server/requirements.txt` pins an older PyTorch/CUDA-era stack and includes
  duplicate `websockets` declarations.
- The repository has no application test workflow; the only GitHub Actions
  workflow is CLA-related.
- The frontend demo package declares no real tests.
- Built frontend files are stored in the repository, increasing the chance of
  source and distribution drift.
- Multiple model families remain wired into shared UI components, so removing
  them before runtime tracing could break packaging or settings migration.

## Safe change boundary

Preview 0.1 may change:

- MooVoice-specific React components and CSS
- navigation and information architecture
- labeling and help text
- settings presentation
- RVC model import experience
- visual status and diagnostics
- build documentation and test workflows

Preview 0.1 should initially avoid changing:

- realtime audio protocol
- Socket.IO event formats
- RVC inference calculations
- model file serialization
- server setting keys
- native launcher lifecycle

## Immediate next work

1. Create `feature/moovoice-shell` from `develop`.
2. Inventory frontend providers, hooks, and existing settings contracts.
3. Define MooVoice design tokens and accessible component primitives.
4. Implement the new home shell without removing the legacy screen.
5. Add an internal route or build flag to compare MooVoice with the legacy UI.
6. Add frontend build and type-check validation.
