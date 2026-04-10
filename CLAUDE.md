# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install --legacy-peer-deps   # Required flag — agora-rtm has a peer dep conflict with agora-rtc-sdk-ng
npm start                        # Production server on port 3000
npm run dev                      # Dev server with nodemon (auto-restart)
```

Default credentials (set in `.env`): `bacsdemo` / `agora1234`

## Architecture

This is a **no-build vanilla JS** project: the Express backend serves the frontend as static files. There is no bundler, transpiler, or framework.

### Request flow

```
Browser → Express (backend/server.js)
  GET /              → serves frontend/index.html (with auth credentials injected)
  GET /lib/*         → node_modules/ (Agora RTC/RTM SDKs loaded in browser)
  GET /assets/*      → assets/ (VRM model files)
  GET /api/agora/*   → backend/controllers/agoraController.js
```

### Frontend script load order (index.html)

```
utils/config.js          → CONFIG, API, STORAGE, UTILS globals
utils/vrmAvatarManager.js → VrmAvatarManager class + POSE_LIBRARY
utils/chat.js            → ChatManager class
app.js                   → main IIFE (wires everything together)
```

`app.js` is wrapped in an IIFE to prevent console access to SDK variables.

### ConvoAI lifecycle

1. **Page load** — `init()` fetches channel info from backend, creates Agora RTC/RTM clients, initializes VRM avatar (renders idle immediately)
2. **Start** — joins RTC (publishes mic), joins RTM, POSTs to `/api/agora/start` → backend calls Agora ConvoAI REST API to spawn the AI agent
3. **Agent joins RTC** → `user-published` event → subscribe to audio, call `vrmManager.connectAudioTrack()` for lip-sync
4. **RTM presence events** → agent state changes (`speaking`/`listening`/`thinking`/`idle`) → `updateAgentStateUI()` drives both the dot indicator and VRM avatar poses/expressions
5. **RTM message events** → `user.transcription` and `assistant.transcription` objects → displayed in chat panel
6. **Stop** — leaves RTC/RTM, calls `vrmManager.disconnectAudio()` (avatar stays rendering in idle), POSTs to `/api/agora/stop/:agentId`

### VRM avatar system (`frontend/utils/vrmAvatarManager.js`)

Three.js (0.168.0) + `@pixiv/three-vrm` (3.2.0) are loaded **lazily from CDN** via a dynamically injected `<script type="importmap">`. They are attached to `window.THREE`, `window.GLTFLoader`, etc. and only load when `vrmManager.init()` is called.

Key public API:
- `init(containerId, modelUrl, onProgress)` — loads libs, creates WebGL scene, loads VRM, starts render loop
- `switchModel(newUrl)` — swaps VRM model at runtime; audio pipeline is independent and keeps working
- `connectAudioTrack(agoraAudioTrack)` — creates a separate `AudioContext` + `AnalyserNode` (FFT 256) tapped off the Agora track. Agora continues playing to speakers; the analyser feeds lip-sync only
- `setAgentState(state)` — drives head movement patterns and facial expressions per frame
- `playPose(name)` — triggers a named pose from `POSE_LIBRARY` with smooth lerp transitions
- `disconnectAudio()` / `dispose()` — teardown

The render loop reads frequency bands → viseme blend shapes (`aa`, `oh`, `ih`, `ee`, `ou`) every frame. Silence gate (total energy < 0.10) closes the mouth. Energy envelope + syllable wobble (~7 Hz) prevent the mouth from locking open.

### Backend (`backend/controllers/agoraController.js`)

- `GET /api/agora/channel-info` — generates a unified RTC+RTM `AccessToken2` and returns `{ appId, channel, uid, token }`
- `POST /api/agora/start` — generates agent token, builds full ConvoAI config (ASR: ares/en-US, LLM from env, TTS: MiniMax), POSTs to `https://api.agora.io/api/conversational-ai-agent/v2/projects/{appId}/join`
- `DELETE /api/agora/stop/:agentId` — POSTs to Agora leave endpoint

Auth credentials are injected into the served HTML as `window.APP_AUTH_USERNAME` / `window.APP_AUTH_PASSWORD` so the frontend can include Basic Auth headers on API calls.

### Adding a new VRM avatar

1. Drop the `.vrm` file into `assets/avatars/`
2. Add an entry to `CONFIG.AVAILABLE_AVATARS` in `frontend/utils/config.js`

The dropdown in the UI is populated from that array at runtime.

### Environment variables (`.env`)

Required: `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `AGORA_API_KEY`, `AGORA_API_SECRET`
LLM: `LLM_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_SYSTEM_PROMPT`
TTS: `TTS_MINIMAX_API_KEY`, `TTS_MINIMAX_GROUP_ID`, `TTS_MINIMAX_VOICE_ID`
