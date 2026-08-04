# Main process (`src/main/`)

Loaded when working under `src/main/`. Architecture-wide decisions live in the root `CLAUDE.md`.

- **main.ts** — Electron entry point; wires IPC handlers, owns the three readers (`R3EReader`/`AceReader`/`Ams2Reader`) but runs them ON DEMAND — one at a time, only during a session (or briefly while probing at start/reopen); idle = zero SHM polling. `startSession`/`session:reopen` are async: they call `awaitReaderReady(game, ~3s)` (start reader → wait for live frames + car/track, else `not-live`/`no-data` error), and `closeSession` calls `stopAllReaders` (stop reader + clear car/track globals). `readerRunning` tracks the single active reader; `startReader`/`stopReader` keep it in sync. `activeGame` is the game the user picks at session start (`session:start` takes a `GameSource`); while idle it holds the last picked game. Connection state is frame-recency based (`isLive(game)` = frame within `LIVE_STALE_MS`; a `liveTicker` re-pushes status so a closed sim drops off the badges). No auto-priority selection
- **preload** (`src/preload/index.ts`) — Context bridge exposing `window.electronAPI` to renderer. Compiled as CJS by electron-vite (required by `sandbox: true`)
- **game-adapter.ts** — Projects R3EFrame → GameFrame (unified 7-field struct: lapDistance, tcActive, absActive, brakeTemps FL/FR/RL/RR). ACE and AMS2 readers emit GameFrame natively
- **input-manager.ts** — Registers global keyboard shortcuts via Electron `globalShortcut`. Fires `onInputTrigger` push event to renderer when the configured key is pressed. Non-Windows stub returns no-ops
- **lap-recorder.ts** — Attaches to reader, aggregates frames into 50m zones with driving metrics, handles 2-lap calibration phase
- **zone-tracker.ts** — Stateful tracker for current 50m zone during a lap (feeds RuleEngine real-time checks)

## `r3e/`

- **r3e-struct.ts** — R3E shared memory struct layout (`VERSION_MAJOR = 3`; `STRUCT_SIZE_KNOWN` ≈ 2012 bytes, mapped through `NumCars` — `DriverData[128]` is deliberately not mapped), Pack=4 alignment, auto-computed offsets, read helpers
- **r3e-reader.ts** — Opens `$R3E` via `koffi` + kernel32.dll, polls at 16ms, emits `frame`, `lapComplete`, `connected/disconnected`. Auto-enters mock mode on non-Windows
- **r3e-data-loader.ts** — Loads `r3e-data.json` from the R3E Steam install; resolves numeric IDs → display names for car, track, and layout. Used in prompts and UI; DB always stores numeric IDs for R3E

## `ace/`

- **ace-reader.ts** — Opens three ACE SHM pages (PhysicsEvo 800B, GraphicsEvo 3940B, StaticEvo 256B) via koffi at 16ms. Emits GameFrame + CompactFrame (with ACE-only fields: rpm, gLat, gLon, tyre pressures, slip ratios, suspension travel). Car/track/layout are readable strings from SHM (e.g. `"ks_porsche_718_gt4"`, `"monza"`). Lap completion detected via `totalLapCount` increment. Mock fallback on non-Windows. **SHM spec:** https://docs.google.com/document/d/1WzqMLkW2o_C0LGcvdMRelAV31ZIifux0CSHD9k6ddz0/edit?tab=t.0
- **ace-struct.ts** — Struct definitions for all three ACE SHM pages with read helpers
- **ace-setup-reader.ts** — Decodes binary protobuf `.carsetup` files from `D:\Salvataggi\ACE\Car Setups\{car}\{track}\`. Extracts setup params (steering ratio, brake bias, ARBs, dampers, geometry, electronics, aero, fuel, compound). Returns `SetupData` with Italian-labelled params. **Spec:** `ace_carsetup_spec.md` (local, reverse-engineered)

## `ams2/`

- **ams2-reader.ts** — Opens the single SHM page `$pcars2$` via `koffi`, polls at 16ms. Reads `mSequenceNumber` before and after copying the buffer to detect torn reads (atomic snapshot); frozen sequence number for ~2s while playing → disconnect. Emits GameFrame natively + `lapComplete` (via `mLapsCompleted` increment). Car/track/layout are readable strings from SHM. Mock fallback on non-Windows
- **ams2-struct.ts** — pCARS2 `SharedMemory` struct layout (`SHARED_MEMORY_VERSION = 14`), Pack=4 alignment, offsets derived from `SharedMemory.h`. Validated by `ams2-struct.selfcheck.ts` (run via `npm run selfcheck`)

## `coach/`

- **adaptive-baseline.ts** — EMA (alpha=0.3) baseline per zone, detects deviations (LATE_BRAKE, SLOW_THROTTLE, TRAIL_BRAKING, COASTING, BRAKE_THROTTLE_OVERLAP), persists to SQLite. Game-aware (R3E/ACE/AMS2) — queries the per-game table (`baseline_r3e`/`baseline_ace`/`baseline_ams2`, resolved via a `_${game}` suffix, not a `game` column)
- **rule-engine.ts** — AlertDispatcher (priority queue, P1>P2>P3, dedup per zone/type/lap, 4s silence window) + RuleEngine (frame-level P1/P2, post-lap P3)
- **session-coach.ts** — On-demand session analysis engine (`createSessionCoachEngine`). Exposes three entry points sharing one loader (`loadSessionBundle`: session + laps + setups + prior analyses + `leaderboardMode`/`fixedSetup`, which it derives from the session row — it is the **single source** for those two flags, no caller passes them in): `analyzeSession` (Level 1 — non-streaming `messages.create`, `max_tokens: 2000`, writes `synthesis` + `summary`), `expandAnalysis` (Level 2 — non-streaming `messages.create` too, `max_tokens: 32000`, `UPDATE … SET detail`, optional `modelOverride` = `anthropicModelDetail`), and `commentAnalysis`. Neither level streams: both fire `onStart({ sessionId, version })` once (→ `session:analysisStart`) so the renderer can hold a spinner, then deliver the whole text via `onDone`. Multiple analyses per session (incremental version counter). Extracts the `<sintesi-vocale>` block (max 3 sentences) into `summary` for TTS and strips it from the rendered text.
- **prompt-builder.ts** — Builds the Claude prompts from session data + laps + setups + deviations + corner names + the precomputed stats block. Exports `buildSynthesisPrompt` / `SYNTHESIS_SYSTEM_PROMPT` (Level 1 — named after the `synthesis` column, deliberately **not** "summary", which in this codebase means only the `<sintesi-vocale>` TTS extract), `buildSessionPrompt` / `SESSION_SYSTEM_PROMPT` (Level 2), `buildCommentPrompt` / `COMMENT_SYSTEM_PROMPT`, plus `buildStatsBlock` and `getSignificantZones`
- **session-stats.ts** — Computes the authoritative numeric facts in TypeScript (lap deltas, convergence, alert counts, aid durations) and injects them as a "## Dati Calcolati" block. The system prompts instruct Claude to **cite** these numbers, never recompute them — the only figure it may estimate is the seconds/lap impact
- **track-map-builder.ts** — Derives a 2D SVG path of the circuit from a lap's world-space frames (wx/wz). Down-samples to ~100ms intervals, filters outliers, returns `TrackMapGeometry` (svgPath + bounds). Called after lap completion; result persisted to `track_maps` table
- **voice-coach.ts** — Handles free-form voice queries; streams Claude response in Italian (max 3-4 sentences, radio tone). Does **no DB access**: `main.ts` owns the session identity and pushes laps, setups and analyses in via `updateContext` before each query (resolved by id+game, so a reopened session gets its own data). Renders the most recent analysis in full (`synthesis` + `detail` + driver comments), older ones as their `summary`
- **voice-summary.ts** — Owns the `<sintesi-vocale>` contract: `extractVoiceSummary()` / `stripVoiceTag()`. Dependency-free on purpose (no Anthropic SDK) so it stays self-checkable. The closing tag is optional — a Level-1 response truncated at `max_tokens` can open it and never close it, so the regex falls back to end-of-text rather than leaking raw tag markup into the rendered synthesis

## `tts/`

- **azure-tts.ts** — Azure Cognitive Services TTS REST wrapper (axios). Endpoints: voices list + synthesis + STT transcription. Applies `preprocessTTSText` from `shared/format.ts` (Italian number-to-words) before SSML escaping — the expansion itself lives in shared because the renderer's Web Speech fallback needs it too. Falls back gracefully if Azure is not configured

## `db/`

- **db.ts** — `better-sqlite3` wrapper. Schema has separate tables for each game (see the `db-schema` skill). Exposes `seedCornersFromLap()` (auto-generates "Curva N" corner names from braking zones), `getTrackMap()` / `saveTrackMap()` (track-map geometry cache)
- **r3e-corners.ts** — Auto-generated corner seed data for R3E tracks (sourced from sealhud). Do not edit manually. Used by `db.ts` to seed `corner_names`
- **setup-row.ts** — Shared DB helpers: `tableFor(game, base)` resolves game-specific table names; `parseSetupRow()` deserializes `setup_json`. Used by `main.ts` and `session-coach.ts`

## `pdf-generator.ts`

- Generates session analysis PDFs via Electron's `printToPDF` + HTML/CSS rendering. Accepts session + analyses + setups data
