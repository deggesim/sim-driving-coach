# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Electron + React app serving as a **real-time voice coach** for sim racing. Supports three simulators: **RaceRoom Racing Experience (R3E)**, **Assetto Corsa EVO (ACE)**, and **Automobilista 2 (AMS2, pCARS2 engine)**. Reads shared memory on Windows, analyzes driving technique, and produces Italian voice alerts during laps. On demand (per session), calls Claude API for a two-tier debriefing: a short synthesis first, a deep-dive only if the user asks for it.

**Language**: All voice output and UI text in Italian. Engineer tone, always include numeric data.
**Code language**: TypeScript strict mode for all source code. Use `.ts` for main/shared modules and `.tsx` for React components.
**Code generation**: Ponytail mode active (lazy style) — shortest working code, reuse before abstraction, no speculative features. See Development Tips for details.

## Commands

```bash
# Install & rebuild native modules for Electron
npm install
npm run rebuild:native

# Dev mode with HMR (electron-vite — starts main + preload + renderer concurrently)
npm run dev

# Type-check without emitting (run before committing)
npm run typecheck

# Lint
npm run lint

# Run the assert-based self-checks (struct offsets, session stats, voice summary)
npm run selfcheck

# Production build
npm run build

# Full distributable build (electron-builder)
npm run build:electron
```

Post-install native rebuild is required because `better-sqlite3` needs compilation against Electron's Node version. `koffi` (shared memory FFI) does **not** need rebuilding.

**Build sequence:**
- `npm run typecheck` — Fast type-check only (no emit). Run before committing or when `npm run dev` reports main-process errors.
- `npm run dev` — Watch mode with HMR; uses electron-vite to compile main, preload, and renderer in parallel. Best for development.
- `npm run build` — Production bundle (Vite optimized, no native recompilation needed).
- `npm run build:electron` — Full distributable build including native modules and electron-builder packaging.

**Note**: If TypeScript errors occur in `npm run dev`, stop and run `npm run typecheck` to see the full error list before restarting.

## Development Tips

### Common Gotchas

- **Native rebuild forgotten**: After `npm install`, always run `npm run rebuild:native`. Without it, `better-sqlite3` won't load and the app crashes on session start.
- **TypeScript errors on commit**: Run `npm run typecheck` before committing. Commit hooks may catch errors that passed type-check but break the build.
- **Struct offset mismatches**: If the reader logs zeros/garbage for frame data (especially R3E version, ACE status, or AMS2 car/track), check the struct offsets in `r3e-struct.ts`, `ace-struct.ts`, or `ams2-struct.ts` against the installed game version. Run `npm run selfcheck` to validate the offset arithmetic. There is **no standalone reader harness**: start `npm run dev` with the sim running and read the `[R3E]`/`[ACE]`/`[AMS2]` console lines.
- **Multi-line commit messages in PowerShell**: `git commit -m @'…'@` with a here-string fails in this environment (`Remove-Item on system path '/' is blocked`). Write the message to a temp file and use `git commit -F <path>` instead.
- **Prettier is not wired up**: the global style rules name Prettier, but it is **not** a dependency here and the checked-in files do not match its output — running `npx prettier --write` would reformat the whole repo and bury real diffs. Formatting is enforced only by `npm run lint`. Match the surrounding file's style by hand.
- **Session start probes fail ("not-live", "no-data")**: The reader started but `awaitReaderReady(~3s)` timed out. Ensure the sim is running AND emitting live frames (not paused menu). Frame-recency check requires fresh SHM updates.
- **Mock history mode leaks into production**: Check `settingsStore` `mockHistoryMode` is **always false** before building. Sessions with negative IDs are test data only.

### Code Style Notes

- Code generation follows **Ponytail mode** (lazy style): prefer stdlib over abstractions, reuse existing patterns before writing new ones, no boilerplate.
- All voice/UI text is in **Italian** (eng tone, numeric data always included).
- Use **arrow functions exclusively** (no `function` keyword); prefer **factory functions** over classes.
- No `class` keyword; use closures and plain objects for state.
- **Bootstrap dark theme only** — override Bootstrap components with `--bg`, `--text`, etc. CSS variables in `global.css`.

## Architecture

```
Active game is chosen by the user at session start (GamePickerModal, 3 radios).
Readers poll SHM ON DEMAND, one at a time: nothing runs while idle. On session
start / reopen the picked game's reader is started and probed (awaitReaderReady:
wait for live frames + car/track, ~3s timeout); it keeps running for the session
and is stopped on close (stopAllReaders → back to zero SHM reads). Connection
state is frame-recency based (a game is "live" only if it emitted a frame in the
last ~2.5s, so a closed sim whose SHM survives drops off instead of lingering).
`activeGame` = the picked game during a session; while idle it holds the last
picked game (no reader emitting → no live mirroring). No auto-priority selection.
              |
              v
   R3EReader, AceReader, or Ams2Reader (EventEmitter, one active at a time)
     — poll 16ms while running, emit: connected/disconnected/frame/lapComplete
          |          |
          |          +-- onFrame → ZoneTracker → RuleEngine (P1/P2 immediate)
          |          |                              |
          |          |                         AlertDispatcher
          |          |                              |
          |          |                    TTSManager (Azure TTS / Web Speech)
          |
          +-- onLapComplete → LapRecorder → AdaptiveBaseline → RuleEngine (P3 post-corner)
                                    |               |
                             TrackMapBuilder    SQLite DB (laps_*, zones_json, frames_blob)
                             (world-pos frames)      |
                             → track_maps table      |
                                                [User clicks "Esegui analisi"]
                                                     |
                                       SessionCoachEngine → Claude API → Livello 1
                                                     |             (Analisi sintetica +
                                                     |              Azioni suggerite)
                                              session_analyses_*
                                              (versioned, multiple)
                                                     |
                                     [User clicks "Mostra analisi approfondita"]
                                                     |
                                     expandAnalysis → Claude API → Livello 2
                                                     |         (Analisi approfondita,
                                                     |          streamed into `detail`)
                                                PdfGenerator (renders both levels)

Gamepad button held (or keyboard shortcut via InputManager)
    → MediaRecorder (getUserMedia)
    → IPC: sttTranscribe (Azure STT)
    → IPC: voiceQuery
    → VoiceCoach streams Claude response
    → IPC: onVoiceChunk / onVoiceDone / onVoiceAudio (MP3)
    → VoiceCoachOverlay + Azure TTS playback
```

### Main process (`src/main/`)

- **main.ts** — Electron entry point; wires IPC handlers, owns the three readers (`R3EReader`/`AceReader`/`Ams2Reader`) but runs them ON DEMAND — one at a time, only during a session (or briefly while probing at start/reopen); idle = zero SHM polling. `startSession`/`session:reopen` are async: they call `awaitReaderReady(game, ~3s)` (start reader → wait for live frames + car/track, else `not-live`/`no-data` error), and `closeSession` calls `stopAllReaders` (stop reader + clear car/track globals). `readerRunning` tracks the single active reader; `startReader`/`stopReader` keep it in sync. `activeGame` is the game the user picks at session start (`session:start` takes a `GameSource`); while idle it holds the last picked game. Connection state is frame-recency based (`isLive(game)` = frame within `LIVE_STALE_MS`; a `liveTicker` re-pushes status so a closed sim drops off the badges). No auto-priority selection
- **preload** (`src/preload/index.ts`) — Context bridge exposing `window.electronAPI` to renderer. Compiled as CJS by electron-vite (required by `sandbox: true`)
- **game-adapter.ts** — Projects R3EFrame → GameFrame (unified 7-field struct: lapDistance, tcActive, absActive, brakeTemps FL/FR/RL/RR). ACE and AMS2 readers emit GameFrame natively
- **input-manager.ts** — Registers global keyboard shortcuts via Electron `globalShortcut`. Fires `onInputTrigger` push event to renderer when the configured key is pressed. Non-Windows stub returns no-ops
- **lap-recorder.ts** — Attaches to reader, aggregates frames into 50m zones with driving metrics, handles 2-lap calibration phase
- **zone-tracker.ts** — Stateful tracker for current 50m zone during a lap (feeds RuleEngine real-time checks)

#### `r3e/`

- **r3e-struct.ts** — R3E shared memory struct layout (v14.0+, 1324 bytes), Pack=4 alignment, auto-computed offsets, read helpers
- **r3e-reader.ts** — Opens `$R3E` via `koffi` + kernel32.dll, polls at 16ms, emits `frame`, `lapComplete`, `connected/disconnected`. Auto-enters mock mode on non-Windows
- **r3e-data-loader.ts** — Loads `r3e-data.json` from the R3E Steam install; resolves numeric IDs → display names for car, track, and layout. Used in prompts and UI; DB always stores numeric IDs for R3E

#### `ace/`

- **ace-reader.ts** — Opens three ACE SHM pages (PhysicsEvo 800B, GraphicsEvo 3940B, StaticEvo 256B) via koffi at 16ms. Emits GameFrame + CompactFrame (with ACE-only fields: rpm, gLat, gLon, tyre pressures, slip ratios, suspension travel). Car/track/layout are readable strings from SHM (e.g. `"ks_porsche_718_gt4"`, `"monza"`). Lap completion detected via `totalLapCount` increment. Mock fallback on non-Windows. **SHM spec:** https://docs.google.com/document/d/1WzqMLkW2o_C0LGcvdMRelAV31ZIifux0CSHD9k6ddz0/edit?tab=t.0
- **ace-struct.ts** — Struct definitions for all three ACE SHM pages with read helpers
- **ace-setup-reader.ts** — Decodes binary protobuf `.carsetup` files from `D:\Salvataggi\ACE\Car Setups\{car}\{track}\`. Extracts setup params (steering ratio, brake bias, ARBs, dampers, geometry, electronics, aero, fuel, compound). Returns `SetupData` with Italian-labelled params. **Spec:** `ace_carsetup_spec.md` (local, reverse-engineered)

#### `ams2/`

- **ams2-reader.ts** — Opens the single SHM page `$pcars2$` via `koffi`, polls at 16ms. Reads `mSequenceNumber` before and after copying the buffer to detect torn reads (atomic snapshot); frozen sequence number for ~2s while playing → disconnect. Emits GameFrame natively + `lapComplete` (via `mLapsCompleted` increment). Car/track/layout are readable strings from SHM. Mock fallback on non-Windows
- **ams2-struct.ts** — pCARS2 `SharedMemory` struct layout (`SHARED_MEMORY_VERSION = 14`), Pack=4 alignment, offsets derived from `SharedMemory.h`. Validated by the runnable `ams2-struct.selfcheck.ts` (see Struct Offset Debugging below for the working run command)

#### `coach/`

- **adaptive-baseline.ts** — EMA (alpha=0.3) baseline per zone, detects deviations (LATE_BRAKE, SLOW_THROTTLE, TRAIL_BRAKING, COASTING, BRAKE_THROTTLE_OVERLAP), persists to SQLite. Game-aware (R3E/ACE/AMS2) — queries the per-game table (`baseline_r3e`/`baseline_ace`/`baseline_ams2`, resolved via a `_${game}` suffix, not a `game` column)
- **rule-engine.ts** — AlertDispatcher (priority queue, P1>P2>P3, dedup per zone/type/lap, 4s silence window) + RuleEngine (frame-level P1/P2, post-lap P3)
- **session-coach.ts** — On-demand session analysis engine (`createSessionCoachEngine`). Exposes three entry points sharing one loader (`loadSessionBundle`: session + laps + setups + prior analyses + `leaderboardMode`/`fixedSetup`, which it derives from the session row — it is the **single source** for those two flags, no caller passes them in): `analyzeSession` (Level 1 — non-streaming `messages.create`, `max_tokens: 2000`, writes `synthesis` + `summary`), `expandAnalysis` (Level 2 — streaming, `max_tokens: 32000`, `UPDATE … SET detail`, optional `modelOverride` = `anthropicModelDetail`), and `commentAnalysis`. Multiple analyses per session (incremental version counter). Extracts the `<sintesi-vocale>` block (max 3 sentences) into `summary` for TTS and strips it from the rendered text.
- **prompt-builder.ts** — Builds the Claude prompts from session data + laps + setups + deviations + corner names + the precomputed stats block. Exports `buildSynthesisPrompt` / `SYNTHESIS_SYSTEM_PROMPT` (Level 1 — named after the `synthesis` column, deliberately **not** "summary", which in this codebase means only the `<sintesi-vocale>` TTS extract), `buildSessionPrompt` / `SESSION_SYSTEM_PROMPT` (Level 2), `buildCommentPrompt` / `COMMENT_SYSTEM_PROMPT`, plus `buildStatsBlock` and `getSignificantZones`
- **session-stats.ts** — Computes the authoritative numeric facts in TypeScript (lap deltas, convergence, alert counts, aid durations) and injects them as a "## Dati Calcolati" block. The system prompts instruct Claude to **cite** these numbers, never recompute them — the only figure it may estimate is the seconds/lap impact
- **track-map-builder.ts** — Derives a 2D SVG path of the circuit from a lap's world-space frames (wx/wz). Down-samples to ~100ms intervals, filters outliers, returns `TrackMapGeometry` (svgPath + bounds). Called after lap completion; result persisted to `track_maps` table
- **voice-coach.ts** — Handles free-form voice queries; builds session context from SQLite (laps, zones, deviations, corner names), streams Claude response in Italian (max 3-4 sentences, radio tone)

#### `tts/`

- **azure-tts.ts** — Azure Cognitive Services TTS REST wrapper (axios). Endpoints: voices list + synthesis + STT transcription. Includes Italian number-to-words preprocessing. Falls back gracefully if Azure is not configured

#### `db/`

- **db.ts** — `better-sqlite3` wrapper. Schema has separate tables for each game (see Database Schema below). Exposes `seedCornersFromLap()` (auto-generates "Curva N" corner names from braking zones), `getTrackMap()` / `saveTrackMap()` (track-map geometry cache)
- **r3e-corners.ts** — Auto-generated corner seed data for R3E tracks (sourced from sealhud). Do not edit manually. Used by `db.ts` to seed `corner_names`
- **setup-row.ts** — Shared DB helpers: `tableFor(game, base)` resolves game-specific table names; `parseSetupRow()` deserializes `setup_json`. Used by `main.ts`, `session-coach.ts`, `voice-coach.ts`

#### `pdf-generator.ts`

- Generates session analysis PDFs via Electron's `printToPDF` + HTML/CSS rendering. Accepts session + analyses + setups data

### Renderer (`src/renderer/`)

#### `components/`

- **TitleBar.tsx** — Custom frameless title bar with app icon, tab switcher (current session / session list / settings), TTS mute toggle, and window controls (minimize/maximize/close). Drag region for frameless mode
- **SessionPanel.tsx** — The one session panel, shared by the live and historical views via `mode: "live" | "historical"`. Owns session lifecycle (start/end), setup loading and the on-demand analysis trigger, and composes `AnalysisHeader` + `LapsTable` + `AnalysisList` plus the setup modals. In `historical` mode the lifecycle controls are read-only (analyze + PDF export stay enabled) and a "Indietro" button appears. **This is the parent of `AnalysisList`** — there is no separate `SessionDetail.tsx`
- **RealtimeAnalysis.tsx** — Thin wrapper for the live tab ("Analisi in tempo reale"): calls `loadCurrent()` on mount and renders `<SessionPanel mode="live">`. No layout of its own
- **AnalysisHeader.tsx** — Session header bar with car/track/status badge and action buttons: [Nuova sessione] [Chiudi sessione] [Carica setup] [Esegui analisi] [Esporta PDF] [Indietro]. Reads from `sessionStore`. Game badge via `GameBadge`
- **GamePickerModal.tsx** — Modal shown on "Nuova sessione": 3 radios (R3E/ACE/AMS2) to declare the running sim. Reads live connection state from `ipcStore` status (frame-recency), preselects the single live sim, and calls `sessionStart(game)` on confirm (Confirm disabled when the selected sim is not live)
- **GameBadge.tsx** — Shared game-identity badge (`GameSource` → label + colour class). Used in `AnalysisHeader`, `SessionHistory`, `GamePickerModal`, `StatusBar`. Colours in `global.css`: R3E red, ACE azure (light text), AMS2 yellow (dark text)
- **AnalysisList.tsx** — Accordion of all `SessionAnalysisRow` versions for the current session, rendered from markdown via `marked`. Each item shows the Level-1 synthesis plus a `<details>` block for the Level-2 deep-dive: the saved `detail`, or a "Mostra analisi approfondita" button when it is null. Both levels stream on the same `(sessionId, version)` key, so the component discriminates them: a version **not** yet in the list is a new Level-1 analysis and gets its own placeholder item (with Spinner), while a version already present is an expand and streams inside that item's body
- **LapsTable.tsx** — Bootstrap dark Table listing laps for the current session (lap#, time, sectors, valid flag, setup badge, timestamp). Reads from `sessionStore`. Setup badge shows "#N" index linked to session setups. Row click opens `LapTelemetryCharts`
- **LapTelemetryCharts.tsx** — Modal/panel with Recharts line charts (brake, throttle, speed vs. lap distance) and a SVG track-map overlay for a selected lap. Fetches frame data via `lapGetFrames` IPC and track geometry via `trackMapGet` IPC
- **SessionHistory.tsx** — Paginated list of all past sessions (R3E + ACE + AMS2). Columns: Sim, Auto (with class), Circuito, Giri, Best lap, Data, Stato. Filters: game/car/track (Sim filter includes "Automobilista 2"). Sort: date asc/desc. Bulk delete with confirmation modal. Row click → `SessionPanel mode="historical"` inline (back button returns to list). Loads all sessions client-side (up to 500), then filters/paginates in-memory
- **TTSManager.tsx** — Headless component, Web Speech API (it-IT), priority queue, P1 interrupts. Used for real-time lap alerts when Azure TTS is not enabled
- **StatusBar.tsx** — Connection status, car/track/layout (resolved names), calibration state, last alert
- **SettingsPanel.tsx** — All user settings: API key, Anthropic model selector (populated live from the Models API via `anthropicListModels` on mount; a saved model missing from the list is flagged obsolete with a warning `Alert` and kept selectable), assistant name, Azure TTS/STT config, voice selection, keyboard shortcut capture, mock mode toggle. No active-game selector here — the game is chosen per-session at session start via `GamePickerModal`, not in settings
- **VoiceCoachOverlay.tsx** — Fixed overlay showing voice interaction state: idle (hidden), listening (pulsing mic), processing (spinner + transcript), speaking (streaming answer)
- **R3eSetupPicker.tsx** — R3E only. Modal to paste the JSON exported by RaceRoom (CTRL+C in the setup screen). Parses JSON into categorised `SetupParam[]` (Italian labels), previews via `R3eSetupTabs`, then saves as `SetupData`
- **R3eSetupTabs.tsx** — Tabbed display of R3E `SetupParam[]` grouped by category (Freni, Gomme, Sospensioni, etc.). Used inside `R3eSetupPicker` and `SetupDetailModal`
- **AceSetupTabs.tsx** — Tabbed display of ACE `SetupParam[]` grouped by category (Pneumatici, Elettronica, Carburante e Strategia, Sospensioni, Ammortizzatori, Aerodinamica) with per-wheel value breakdowns. Used inside `AceSetupPicker` and `SetupDetailModal`
- **SetupSelectionModal.tsx** — Modal for loading a setup. Offers two tabs: (1) browse setup history for the current car/track (`sessionGetSetupHistory` IPC → reuse via `sessionReuseSetup`); (2) open the game-specific picker (`R3eSetupPicker` or `AceSetupPicker`). Shows `SetupDetailModal` for preview
- **SetupDetailModal.tsx** — Read-only modal showing all parameters of a `SessionSetupRow` via `R3eSetupTabs`. Optionally shows a "Usa" button to reuse the setup
- **AceSetupPicker.tsx** — ACE only. Modal to browse `D:\Salvataggi\ACE\Car Setups\` via 3-step flow: car dropdown → track dropdown → .carsetup file list. IPC calls: `aceListSetupCars`, `aceListSetupTracks`, `aceListSetupFiles`, `aceReadSetup`. Shows a validation badge when the selected car/track doesn't match `expectedCar`/`expectedTrack`
- **Ams2SetupPicker.tsx** — AMS2 only. Modal to browse Steam screenshots for the AMS2 setup screen (IPC `setup:listScreenshots`), select one or more, then decode via Claude Vision (IPC `setup:decodeSetup`). Flags screenshots already used by a prior setup; shows a validation badge when the detected car doesn't match `expectedCar`

#### `hooks/`

- **useIPC.ts** — Subscribes to push channels (`onFrame`, `onLapComplete`, `onStatus`, `onInputTrigger`, voice channels) and writes to `ipcStore`. Also exposes `useConfig()` (configGet/configSet)
- **useVoiceCoach.ts** — Integrates keyboard shortcut (via `onInputTrigger`), MediaRecorder (audio capture), Azure STT via IPC, voice query streaming, and Azure/Web Speech TTS playback. State machine: idle → listening → processing → speaking
- **useSetupPicker.ts** — Manages setup selection UI state (open/close, selected game-specific picker, reuse flow)
- **useFlash.ts** — Returns a boolean that briefly becomes `true` when triggered (used for visual flash animation on new lap)

#### `loaders/`

- **settingsLoader.ts** — Module-level Promise (`settingsLoaderPromise`) that bulk-loads all config keys from SQLite via IPC at startup and writes them to `settingsStore` in a single `initFromConfig()` call. Stable reference — safe for React 19's `use()` hook to avoid re-suspension

#### `store/`

- **ipcStore.ts** — Zustand store for real-time IPC push state (frame, lastAlert, lastLap, status)
- **sessionStore.ts** — Zustand store for the active or selected session. Subscribes to `session:*` push channels via `subscribeSessionIPC()` (called once from `App.tsx`). State: `{ mode, session, laps, setups, analyses, streaming, loading, error }`. Methods: `loadCurrent()`, `loadById(id, game)`, `setDetail()`, `reset()`. Internal `_apply*` handlers for each push event
- **settingsStore.ts** — Zustand store for all user settings: `apiKey`, `anthropicModel`, `anthropicModelDetail` (Level-2 override, `""` = same as base), `assistantName`, `gamepadButton` (config key: `gamepadTriggerButton`), `ttsEnabled`, `azureTtsEnabled`, `azureSpeechKey`, `azureRegion`, `azureVoiceName`, `mockHistoryMode`, `telemetryLogEnabled`, `keyboardVoiceKey`, `aceSetupsPath`. No `activeGame` field — the game is picked per-session at session start (`GamePickerModal`), not persisted

#### `mocks/`

- **mockData.ts** — Static mock data for `mockHistoryMode`. Exports `MOCK_SESSIONS` (three `SessionRow` entries: R3E BMW M4 GT3 at Nürburgring, ACE Porsche 718 GT4 at Monza, AMS2 Formula Ultimate Gen2 at Interlagos — 3 laps each) and `MOCK_DETAILS` (keyed by negative session id, each with laps + analyses)

### Shared (`src/shared/`)

- **types.ts** — All shared types: `GameSource`, `Alert`, `AlertType`, `AlertPriority`, `Deviation`, `DeviationType`, `GameFrame`, `CompactFrame` (with ACE-only optional fields + world-space `wx`/`wy`/`wz` for track map), `ZoneData` (with ACE-only optional fields), `TrackMapGeometry`, `TrackMapBounds`, `TrackMapRow`, `LapRecord`, `GameStatus`, `SessionRow` (with `ended_at`, `car_class_name`, resolved name fields), `LapRow` (with `setup_id`, `zones_json`), `SessionSetupRow`, `SessionAnalysisRow`, `SessionDetail`, `SessionStartResult`, `SessionListParams`, `SessionListResult`, `SetupData`, `SetupParam`, `R3EFrame`, `CornerEntry`, `CornerNamesMap`, `AzureVoice`, `ElectronAPI`
- **format.ts** — `formatLapTime(seconds)` utility (M:SS.mmm)
- **alert-types.ts** — Alert type constants, BRAKE_TEMP thresholds, ANTI_SPAM constants, CALIBRATION_LAPS, POLL_INTERVAL_MS, BASELINE_EMA_ALPHA, DEVIATION_THRESHOLDS

## Database Schema

```sql
-- R3E tables (numeric ids)
sessions_r3e         (id PK, car, track, layout, session_type, started_at, ended_at, best_lap, lap_count)
session_setups_r3e   (id PK, session_id FK→sessions_r3e, loaded_at, setup_json, setup_screenshots)
laps_r3e             (id PK, session_id FK→sessions_r3e, setup_id FK→session_setups_r3e,
                      lap_number, lap_time, sector1/2/3, valid, zones_json, frames_blob, recorded_at)
session_analyses_r3e (id PK, session_id FK→sessions_r3e, version, synthesis, summary, detail,
                      comments_json, created_at) -- UNIQUE(session_id, version)
                     -- synthesis = Level 1 (always). detail = Level 2 (NULL until the user
                     -- expands). summary = the <sintesi-vocale> extract for TTS.
                     -- Migrated from template_v3/section5_summary via guarded ALTER … RENAME.

-- ACE tables (same structure, string ids)
sessions_ace / session_setups_ace / laps_ace / session_analyses_ace

-- AMS2 tables (same structure, string ids — mirrors ACE)
sessions_ams2 / session_setups_ams2 / laps_ams2 / session_analyses_ams2

-- Per-game baseline / corner-name / track-map tables: one table set per game
-- (suffix _r3e / _ace / _ams2, NOT a shared table with a `game` column).
-- R3E uses INTEGER car/track/layout; ACE and AMS2 use TEXT.
baseline_<game>           (car, track, layout, zone_id, data JSON, updated_at) -- PK: car+track+layout+zone_id
baseline_tc_zones_<game>  (car, track, layout, zone_id)
baseline_abs_zones_<game> (car, track, layout, zone_id)
corner_names_<game>       (track, layout, dist_min PK, dist_max, name)
track_maps_<game>         (track, layout PK, geometry JSON, created_at)

-- Shared table
app_config           (key PK, value)
```

R3E stores numeric IDs; ACE and AMS2 store string identifiers (e.g. `"monza"`, `"ks_porsche_718_gt4"` for ACE; `"Interlagos"`, `"Formula Ultimate Gen2"` for AMS2).

`zones_json` on laps stores the serialized `ZoneData[]` for each completed lap (used for baseline and prompt building).

`frames_blob` on laps stores gzip-compressed `CompactFrame[]` (used for telemetry charts and track-map generation on demand).

`session_setups_*` is separate from laps — one session can have multiple setups loaded over time. Each lap row has a `setup_id` FK pointing to which setup was active when the lap was recorded.

`session_analyses_*` supports multiple versioned analyses per session (triggered on demand by the user).

## IPC Channels (`ElectronAPI` in `src/shared/types.ts`)

| Direction | Method / Channel                                                           | Notes                                                        |
| --------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Push      | `onFrame`                                                                  | Main → Renderer, `R3EFrame`                                  |
| Push      | `onLapComplete`                                                            | Main → Renderer, `LapRecord`                                 |
| Push      | `onStatus`                                                                 | Main → Renderer, `GameStatus`                                |
| Push      | `onInputTrigger`                                                           | Keyboard shortcut fired (from `InputManager`)                |
| Push      | `onVoiceChunk / onVoiceDone / onVoiceAudio`                                | Voice coach streaming                                        |
| Push      | `onSessionStarted`                                                         | `SessionRow`                                                 |
| Push      | `onSessionClosed`                                                          | `{ id, game }`                                               |
| Push      | `onSessionLapAdded`                                                        | `{ sessionId, game, lap: LapRow }`                           |
| Push      | `onSessionSetupLoaded`                                                     | `{ sessionId, game, setup: SessionSetupRow }`                |
| Push      | `onSessionAnalysisChunk`                                                   | `{ sessionId, version, token }` — streaming                  |
| Push      | `onSessionAnalysisDone`                                                    | `{ sessionId, analysis: SessionAnalysisRow }`                |
| Handle    | `configGet / configSet`                                                    | app_config table                                             |
| Handle    | `sessionStart`                                                             | Opens new session for the given `GameSource` → `SessionStartResult` |
| Handle    | `sessionEnd`                                                               | Closes active session                                        |
| Handle    | `sessionReopen`                                                            | Reopens a closed session as active → `SessionStartResult`    |
| Handle    | `sessionAnalyze`                                                           | Triggers the Level-1 analysis on demand                      |
| Handle    | `sessionExpandAnalysis`                                                    | Triggers the Level-2 deep-dive for one `analysisId` → `{ ok, reason? }`; text arrives on the `analysisChunk`/`analysisDone` push channels |
| Handle    | `sessionCommentAnalysis`                                                   | Sends a driver comment on an analysis → appended to `comments_json` |
| Handle    | `sessionLoadSetup`                                                         | Saves setup to `session_setups_*`, links to active session   |
| Handle    | `sessionGetSetupHistory`                                                   | Past setups for car/track/layout → `SessionSetupRow[]`       |
| Handle    | `sessionReuseSetup`                                                        | Copies an existing setup to the active session               |
| Handle    | `sessionList`                                                              | Paginated session list → `SessionListResult`                 |
| Handle    | `sessionGetCurrent`                                                        | Current session + laps + setups + analyses → `SessionDetail` |
| Handle    | `sessionGetDetail`                                                         | Historical session by id+game → `SessionDetail`              |
| Handle    | `sessionExportPdf`                                                         | Generates PDF → file path                                    |
| Handle    | `sessionDelete`                                                            | Delete single session `{ id, game }`                         |
| Handle    | `sessionDeleteAll`                                                         | Bulk delete `[{ id, game }]` (transaction)                   |
| Handle    | `sessionDeleteAnalysis`                                                    | Delete a single `SessionAnalysisRow` by id                   |
| Handle    | `lapGetFrames`                                                             | Decompress `frames_blob` → `CompactFrame[]` for a lap        |
| Handle    | `lapAssignSetup`                                                           | Reassign (or clear) the `setup_id` on a lap row              |
| Handle    | `trackMapGet`                                                              | Retrieve cached `TrackMapGeometry` for game/car/track/layout |
| Handle    | `voiceQuery`                                                               | Streaming voice response via `VoiceCoach`                    |
| Handle    | `sttTranscribe`                                                            | Azure STT → transcribed string                               |
| Handle    | `ttsGetVoices / ttsSynthesize / ttsTest`                                   | Azure TTS                                                    |
| Handle    | `anthropicListModels`                                                      | Live Claude model list (`GET /v1/models`) for the analysis model selector; `[]` on missing key/error |
| Handle    | `telemetryLogGetDir`                                                       | Returns the path of the telemetry log directory              |
| Handle    | `aceListSetupCars / aceListSetupTracks / aceListSetupFiles / aceReadSetup` | ACE file-based setup                                         |
| One-way   | `windowClose / windowMinimize / windowMaximize`                            | Frameless window                                             |

## Key Design Decisions (Do Not Change)

- **Multi-game**: No `activeGame` config field. The three readers (R3E/ACE/AMS2) exist in the main process but poll ON DEMAND — one at a time, only during an active session (or briefly while probing at start/reopen). Idle = zero SHM reads (no continuous parallel polling). The user picks the game at session start via `GamePickerModal` (3 radios, no live autodetect) — `session:start` takes a `GameSource`, starts that reader, and probes it (`awaitReaderReady`); `activeGame` locks to it for the session; while idle `activeGame` holds the last picked game. Connection state is still frame-recency based (`isLive`), NOT a raw connected flag (a closed sim stops emitting frames and drops off the badges). No auto-priority selection. R3E, ACE, and AMS2 share the same coach/analysis pipeline via the `GameFrame` abstraction
- **Data source R3E**: Shared Memory (`$R3E`) via `koffi` — not telemetry files. Numeric car/track/layout IDs resolved via R3EDataLoader
- **Data source ACE**: Three SHM pages (PhysicsEvo, GraphicsEvo, StaticEvo) via `koffi`. Car/track/layout are readable strings from SHM
- **Data source AMS2**: A single SHM page (`$pcars2$`, the pCARS2-engine `SharedMemory` struct) via `koffi` — not three pages like ACE. Reads are made atomic by checking `mSequenceNumber` before and after the copy (torn-read detection), not by a locking API. Car/track/layout are readable strings from SHM
- **Setup loading R3E**: User pastes the JSON exported by RaceRoom (CTRL+C in setup screen) into `R3eSetupPicker`. Parsed client-side into `SetupParam[]` with Italian labels — no Claude Vision, no IPC round-trip
- **Setup loading ACE**: `.carsetup` binary files browsed via car→track→file dropdown flow in `AceSetupPicker` → protobuf decode (no Claude Vision). Validation badge warns when selected car/track doesn't match the reference
- **Setup loading AMS2**: User selects one or more setup-screen screenshots (Steam screenshot folder, auto-detected steamid, appid `1066890`) via `Ams2SetupPicker` → sent to Claude Vision (`claude-sonnet-5`) for OCR/decode into `SetupData`. Distinct from both R3E (JSON paste) and ACE (binary file decode) — this is the only game whose setup import uses Claude Vision
- **Session lifecycle**: Explicit start/end managed by the user. Laps accumulate in the active session. Setup loads are stored as `session_setups_*` rows and linked to subsequent laps via `setup_id`. Analysis is triggered on demand ("Esegui analisi"), not automatically per-lap
- **Analysis model**: Session-level, on-demand, versioned, and **two-tier**. `SessionCoachEngine` reads all laps + setups + prior analyses for the session and produces a new `SessionAnalysisRow`. Multiple analyses per session supported. The `<sintesi-vocale>` block (max 3 sentences) is extracted into `summary` for TTS playback and stripped from the displayed text
- **Two-tier analysis**: "Esegui analisi" produces **Level 1 only** — `## Analisi sintetica` + `## Azioni suggerite`, non-streaming (`messages.create`, `max_tokens: 2000`), rendered in one shot when complete with the spinner held until then. `## Analisi approfondita` (subsections `### Analisi telemetria`, `### Problemi identificati`, `### Setup attuale vs proposto`) is **Level 2**, fired separately by `session:expandAnalysis` and streamed (`max_tokens: 32000`) into the same row's `detail` column. The two levels are **additive** — the deep-dive does not repeat "Azioni suggerite", so anything rendering an analysis (UI, PDF) must show synthesis *and* detail, never detail instead of synthesis
- **Precomputed stats**: exact numbers (lap deltas, convergence, alert counts, aid durations) are computed in TypeScript by `session-stats.ts` and passed to Claude in a "## Dati Calcolati" block, which both system prompts tell it to cite verbatim. Do not move these computations back into the prompt — they were the source of the wrong-arithmetic class of bug this design removes
- **Corner names**: Seeded from `corner-names.json` for known tracks. For unknown tracks, `seedCornersFromLap()` auto-generates "Curva N" names from braking zones on the first lap. Corner names are used in prompts and alerts
- **Polling**: 16ms (`setTimeout`, not `setInterval`), reconnect every 2s if sim not running. Readers poll only while running — started on demand for a session, stopped on close (see Multi-game above)
- **Alerts during lap**: Audio only, alert-driven (no continuous delta). Only fire when there's a problem
- **Alert priorities**: P1 (safety, immediate, interrupts), P2 (TC/ABS anomaly, immediate, queued), P3 (technique, post-corner, max 1 per zone per lap)
- **Anti-spam**: Max 1 alert per (zone × type) per lap, 4s silence window, no P3 within 3s of zone entry
- **Adaptive thresholds**: Auto-calibrate over first 2 laps (skip if baseline exists in DB)
- **Coach model**: `claude-haiku-4-5-20251001` for Level-1 analysis, comments, and voice queries. Overridable via the `anthropicModel` config key (applies to both engines). The **Level-2 deep-dive** has its own optional override, `anthropicModelDetail` — empty string means "use `anthropicModel`"; set it to a stronger model (e.g. `claude-opus-5`) when the deep-dive quality matters more than its cost. Level 2 also marks its `system` block with `cache_control: { type: "ephemeral" }`; note this is inert on Haiku 4.5, whose minimum cacheable prefix (4096 tokens) exceeds the ~1050-token system prompt, and only takes effect on a model with a lower floor
- **Zones**: 50m segments along track distance
- **Brake temp window**: ideal 550°C ±137.5°C (413-688°C). Skip if value is -1 (unavailable)
- **Qualification/Leaderboard**: Tire temps fixed at 85°C — do not flag as issue
- **Delete**: Single (`sessionDelete`) and bulk (`sessionDeleteAll`) session deletion. Cascade deletes laps, setups, and analyses. Individual analyses can also be deleted via `sessionDeleteAnalysis`
- **Window**: 1200×800, no frame, contextIsolation: true, nodeIntegration: false
- **Platform**: Windows only (R3E, ACE, and AMS2 are all Windows-only)
- **TTS**: Azure Cognitive Services is the primary TTS/STT provider. Web Speech API is the fallback for real-time lap alerts only
- **State management**: Three Zustand stores — `ipcStore` (real-time frames/alerts), `sessionStore` (active/selected session), `settingsStore` (user settings). Do not scatter state back into `App.tsx`
- **PDF**: `printToPDF` + HTML/CSS template (Electron main process). Do not reintroduce jsPDF
- **Track map**: World-space (wx/wz) frames in `CompactFrame` are used by `track-map-builder.ts` to derive an SVG path after each lap. Geometry is cached in `track_maps` and retrieved on demand via `trackMapGet` for `LapTelemetryCharts`
- **Telemetry charts**: `LapTelemetryCharts` fetches raw frames via `lapGetFrames` (gzip-decompress from `frames_blob`) and renders brake/throttle/speed vs. distance with Recharts. Track-map SVG is overlaid in the same view
- **Input trigger**: `InputManager` (main process) registers a `globalShortcut`. Fires `onInputTrigger` push to renderer. `useVoiceCoach` uses this to start/stop audio capture — no gamepad polling in the renderer
- **Voice queries**: Keyboard shortcut hold → Azure STT → Claude streaming → Azure TTS. Max 3-4 sentences, radio tone, Italian, no bullet points
- **Mock mode**: `mockHistoryMode` in settingsStore injects `MOCK_SESSIONS` and `MOCK_DETAILS` from `mockData.ts` into the session list (negative IDs). Used to test SessionHistory and SessionDetail without a live session

## Workflow di sviluppo — Skill e Agenti

Prima di iniziare qualsiasi task di sviluppo, invocare la skill corrispondente tramite il tool `Skill`.

**Legenda colonne:**

- **Skill** — sequenza da invocare nell'ordine indicato (`→` = passo successivo)
- **Agente** — sottoagente da spawnare per quel sottocompito specifico (`|` = alternativa, scegliere uno)
- Gli agenti sono sempre sequenziali rispetto alle skill. Il parallelismo tra agenti si attiva solo con `superpowers:dispatching-parallel-agents` quando i sottocompiti sono davvero indipendenti.

| Task                                    | Skill (nell'ordine)                                                                                 | Agente (uno, in base al bisogno)                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Nuova feature **semplice**              | `feature-dev:feature-dev` (implementazione guidata)                                                 | `feature-dev:code-architect` se serve progettare nuovi layer/file \| `feature-dev:code-explorer` se serve esplorare il codebase esistente |
| Nuova feature **complessa**             | `superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:subagent-driven-development` → `superpowers:verification-before-completion` | agenti in parallelo via `superpowers:dispatching-parallel-agents` (es. 2+ `Explore` per R3E/ACE/AMS2 analysis) |
| Bug fix                                 | `superpowers:systematic-debugging`                                                                  | `Explore` (narrow search for error pattern) \| `general-purpose` (if correlation across modules needed)                                  |
| Code review                             | `superpowers:requesting-code-review` o `code-review:code-review`                                   | `feature-dev:code-reviewer`                                                                                                               |
| Refactoring TypeScript / tipi avanzati  | `simplify` (per semplificare codice) \| `code-simplifier` (per refactoring locale)                 | `code-simplifier` agent oppure handle inline                                                                                              |
| Componente React / hook                 | `react-vite-best-practices` (prima di implementare)                                                 | `general-purpose` (con react-vite-best-practices skill menzionata nel prompt)                                                              |
| Store Zustand                           | Nessuna skill: `react-vite-best-practices` copre build/code-splitting Vite, non lo state management. Seguire i pattern in `sessionStore.ts` | `general-purpose` (con il contesto della sezione `store/` di questo file)                              |
| Electron (IPC, sicurezza, packaging)    | Menzionare `claude-api` se tocca Claude/Anthropic SDK; altrimenti modifiche IPC/main process       | `general-purpose` (con contesto CLAUDE.md)                                                                                                |
| SQLite / query / schema                 | Context dal CLAUDE.md Database Schema section; nessuna skill specifica                              | `general-purpose` (con contesto DB schema)                                                                                                |
| Claude API / Anthropic SDK              | `claude-api` (SEMPRE, per model IDs, pricing, params, streaming, tool-use, token-counting)         | `general-purpose` (contesto skill fornito da `claude-api`)                                                                                |
| Fine branch / PR / commit               | `superpowers:finishing-a-development-branch`                                                        | —                                                                                                                                         |
| Sottocompiti indipendenti in parallelo  | `superpowers:dispatching-parallel-agents`                                                           | due o più `Explore` o `general-purpose` agents simultanei (es. R3E struct audit + ACE setup reader in parallelo)                          |
| Verifica prima di completare            | `superpowers:verification-before-completion`                                                        | —                                                                                                                                         |

**Soglia semplice vs complessa**: una feature è **semplice** se soddisfa _tutte_ queste condizioni — tocca un solo dominio (solo React, o solo IPC, o solo SQLite…), non introduce nuovi layer/file architetturali (solo modifiche a file esistenti o un singolo file nuovo), il design è già chiaro senza brainstorming, e l'implementazione è stimabile in ≤ ~3 step. Se anche solo una condizione non regge (multi-dominio, nuovi layer/astrazioni, design da concordare, o > ~3 step) è **complessa** → percorso `superpowers` completo.

**Regola multi-dominio**: se il task copre più aree (es. nuova feature React + IPC Electron), invocare prima `superpowers:brainstorming`, poi usare le skill di dominio durante l'implementazione (`react-vite-best-practices`, `electron-best-practices`).

**Regola subagent-driven-development**: quando si usa `superpowers:subagent-driven-development`, includere nel prompt di ogni implementer subagent la skill di dominio rilevante (dalla tabella sopra). Non usare solo `general-purpose` senza indicare la skill — ogni subagent deve invocarla prima di implementare.

## Struct Offset Debugging

If the reader logs all zeros or -1 (`npm run dev` with the sim running — there is no standalone reader script): struct offset mismatch. Check:

1. `VersionMajor` at offset 0 must be `3` (updated to v3.x for R3E)
2. If version OK but other fields wrong: `PlayerData` inline size differs from installed R3E version. Compare with `R3E.cs` from SecondMonitor connectors
3. For ACE: verify `AC_LIVE = 2` in PhysicsEvo status field; if 0, ACE is not running
4. For AMS2: the `[AMS2] connected: ...` log line must show `mVersion=14`. If `mVersion` is wrong or speed/lapDistance/car/track are zero or garbage, the offsets in `ams2-struct.ts` (`OFF`/`PART`) don't match the installed AMS2 version — compare against `SharedMemory.h` (likely a `PARTICIPANT_SIZE` or struct-padding change), update the offsets, then re-run `npm run selfcheck`