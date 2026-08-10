# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Electron + React app serving as a **real-time voice coach** for sim racing. Supports three simulators: **RaceRoom Racing Experience (R3E)**, **Assetto Corsa EVO (ACE)**, and **Automobilista 2 (AMS2, pCARS2 engine)**. Reads shared memory on Windows, analyzes driving technique, and produces Italian voice alerts during laps. On demand (per session), calls Claude API for a two-tier debriefing: a short synthesis first, a deep-dive only if the user asks for it.

**Language**: All voice output and UI text in Italian. Engineer tone, always include numeric data.
**Code language**: TypeScript strict mode for all source code. Use `.ts` for main/shared modules and `.tsx` for React components.
**Code generation**: Ponytail mode active (lazy style) — shortest working code, reuse before abstraction, no speculative features. See Development Tips for details.

## Commands

See `package.json` scripts. The non-obvious parts:

- `npm run rebuild:native` is **required after every `npm install`** — `better-sqlite3` must be compiled against Electron's Node version. `koffi` (shared memory FFI) does **not** need rebuilding.
- `npm run selfcheck` runs the assert-based self-checks (struct offsets, prompt builder, session stats, voice summary) — no sim needed.
- If TypeScript errors appear in `npm run dev`, stop and run `npm run typecheck` for the full list before restarting.
- `npm run build:electron` is the only script that produces a distributable; `npm run build` is the Vite bundle alone.

## Development Tips

### Common Gotchas

- **Native rebuild forgotten**: After `npm install`, always run `npm run rebuild:native`. Without it, `better-sqlite3` won't load and the app crashes on session start.
- **TypeScript errors on commit**: Run `npm run typecheck` before committing. Commit hooks may catch errors that passed type-check but break the build.
- **Struct offset mismatches**: If the reader logs zeros/garbage for frame data (especially R3E version, ACE status, or AMS2 car/track), check the struct offsets in `r3e-struct.ts`, `ace-struct.ts`, or `ams2-struct.ts` against the installed game version. Run `npm run selfcheck` to validate the offset arithmetic. There is **no standalone reader harness**: start `npm run dev` with the sim running and read the `[R3E]`/`[ACE]`/`[AMS2]` console lines.
- **Multi-line commit messages in PowerShell**: `git commit -m @'…'@` with a here-string fails in this environment (`Remove-Item on system path '/' is blocked`). Write the message to a temp file and use `git commit -F <path>` instead.
- **Prettier is wired up** (`prettier` devDep + `.prettierrc` with defaults): the whole repo is formatted and `npm run format:check` passes clean. Run `npm run format` freely — do **not** hand-match style. `.prettierignore` excludes `out/ dist/ release/ docs/ .claude/ CLAUDE.md`, `r3e-data.json` and `src/main/db/r3e-corners.ts` (vendored/generated).
- **Session start probes fail ("not-live", "no-data")**: The reader started but `awaitReaderReady(~3s)` timed out. Ensure the sim is running AND emitting live frames (not paused menu). Frame-recency check requires fresh SHM updates.
- **Mock history mode leaks into production**: Check `settingsStore` `mockHistoryMode` is **always false** before building. Sessions with negative IDs are test data only.
- **Edits are auto-checked**: a `PostToolUse` hook in `.claude/settings.local.json` runs `.claude/scripts/style-check.mjs` after every Write/Edit — style only, it does **not** run ESLint (that used to be there and cost ~15s per edit; it now runs at commit time, see below). The style check flags `function`/`class` keywords, FontAwesome wildcard imports, and `process.env` in `src/renderer/` — main and preload are Node and **must** use `process.env`. Its messages cite "CODE_STYLE.md", which does not exist in the repo; the rules live in this file and under `.claude/rules/` (`javascript.md` always loaded, `renderer.md` path-scoped to `src/renderer/**`).
- **ESLint runs at commit time**: husky + lint-staged gate every commit (`.husky/pre-commit` → `npx lint-staged`, config in `.lintstagedrc.mjs`). Staging any `.ts`/`.tsx` file triggers the **full-project** `npm run lint` (~25s) and a non-zero exit aborts the commit; a commit touching no TS at all skips it entirely (~4s). lint-staged is used purely as a filter — the arrow function returning a command string is what stops it appending staged filenames. Full-project is deliberate: `parserOptions.projectService` rebuilds the whole TS program anyway, so per-file linting saves ~10s of a 25s run and adds edge cases. Installed via devDependencies + `"prepare": "husky"`, so a fresh clone inherits the hook on `npm install`. Bypass in an emergency with `git commit --no-verify`.
- **Adding a self-check**: name it `*.selfcheck.ts` anywhere under `src/` and `scripts/run-selfchecks.mjs` picks it up automatically (it globs `.selfcheck-out/**`). Assert at import time — a throw exits non-zero. `.selfcheck-out` is wiped before each `tsc` run, so deleting a self-check does not leave a ghost compiled copy behind. Current: `ams2-struct`, `format`, `key-combo`, `prompt-builder`, `session-stats`, `voice-intent`, `voice-summary`.

### Code Style Notes

- Code generation follows **Ponytail mode** (lazy style): prefer stdlib over abstractions, reuse existing patterns before writing new ones, no boilerplate.
- All voice/UI text is in **Italian** (eng tone, numeric data always included).
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
                                                     |          written to `detail`)
                                                PdfGenerator (renders both levels)

Gamepad button held (or keyboard shortcut via InputManager)
    → MediaRecorder (getUserMedia)
    → IPC: sttTranscribe (Azure STT)
    → IPC: voiceQuery
    → VoiceCoach streams Claude response
    → IPC: onVoiceChunk / onVoiceDone / onVoiceAudio (MP3)
    → VoiceCoachOverlay + Azure TTS playback
```

### Per-layer file catalogue

The per-file descriptions live in directory-scoped memory files, loaded only when
working under that directory:

- `src/main/CLAUDE.md` — main process, incl. `r3e/` `ace/` `ams2/` `coach/` `tts/` `db/` and `pdf-generator.ts`
- `src/renderer/CLAUDE.md` — `components/` `hooks/` `lib/` `loaders/` `store/` `mocks/`
- `src/shared/CLAUDE.md` — `types.ts` `format.ts` `alert-types.ts`

## Database Schema

Full SQL table reference: invoke the **`db-schema`** skill. Summary: one table set per
game (suffix `_r3e` / `_ace` / `_ams2`, never a shared table with a `game` column);
R3E stores numeric car/track/layout IDs, ACE and AMS2 store strings. Resolve table
names with `tableFor(game, base)` in `src/main/db/setup-row.ts`.

## IPC Channels

Full channel table (`ElectronAPI` in `src/shared/types.ts`): invoke the
**`ipc-channels`** skill.

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
- **Two-tier analysis**: "Esegui analisi" produces **Level 1 only** — `## Analisi sintetica` + `### Azioni suggerite`, non-streaming (`messages.create`, `max_tokens: 2000`), rendered in one shot when complete with the spinner held until then. `## Analisi approfondita` (subsections `### Analisi telemetria`, `### Problemi identificati`, `### Setup attuale vs proposto`) is **Level 2**, fired separately by `session:expandAnalysis`, also non-streaming (`messages.create`, `max_tokens: 32000`), written into the same row's `detail` column. The Level-2 call **must** go through `client.withOptions({ timeout })`: without a client-level timeout the SDK derives one from `max_tokens` and throws "Streaming is required for operations that may take longer than 10 minutes" for any `max_tokens > 21333`, before any HTTP call (a per-request `timeout` does not suppress the guard). Neither level streams: `session:analysisStart` only tells the renderer which version is in flight so it can hold a spinner. The two levels are **additive** — the deep-dive does not repeat "Azioni suggerite", so anything rendering an analysis (UI, PDF) must show synthesis *and* detail, never detail instead of synthesis
- **Analysis heading hierarchy**: `## Analisi sintetica` and `## Analisi approfondita` are the ONLY root (`##`) sections; everything else nests below (`###` subsections, `####` for anything deeper). `.deb-content` in `global.css` styles h2/h3/h4+ differently, and `nestHeadings()` shifts injected analyses by a fixed amount — a prompt that promotes a subsection back to `##` breaks both. Asserted in `prompt-builder.selfcheck.ts`
- **Precomputed stats**: exact numbers (lap deltas, convergence, alert counts, aid durations) are computed in TypeScript by `session-stats.ts` and passed to Claude in a "## Dati Calcolati" block, which both system prompts tell it to cite verbatim. Do not move these computations back into the prompt — they were the source of the wrong-arithmetic class of bug this design removes
- **Corner names**: Seeded from `src/main/db/r3e-corners.ts` for known tracks. For unknown tracks, `seedCornersFromLap()` auto-generates "Curva N" names from braking zones on the first lap. Corner names are used in prompts and alerts
- **Polling**: 16ms (`setTimeout`, not `setInterval`), reconnect every 2s if sim not running. Readers poll only while running — started on demand for a session, stopped on close (see Multi-game above)
- **Alerts during lap**: Audio only, alert-driven (no continuous delta). Only fire when there's a problem
- **Alert priorities**: P1 (safety, immediate, interrupts), P2 (TC/ABS anomaly, immediate, queued), P3 (technique, post-corner, max 1 per zone per lap)
- **Anti-spam**: Max 1 alert per (zone × type) per lap, 4s silence window, no P3 within 3s of zone entry
- **Adaptive thresholds**: Auto-calibrate over first 2 laps (skip if baseline exists in DB)
- **Coach model**: `claude-haiku-4-5-20251001` for Level-1 analysis, comments, and voice queries. Overridable via the `anthropicModel` config key (applies to both engines). The **Level-2 deep-dive** has its own optional override, `anthropicModelDetail` — empty string means "use `anthropicModel`"; set it to a stronger model (e.g. `claude-opus-5`) when the deep-dive quality matters more than its cost. **No prompt caching on either level** (a `cache_control` breakpoint on the Level-2 `system` block was tried and removed): the only reusable prefix is the `buildSessionContext` both levels share, and caching *that* means moving the per-level format rules out of the two system prompts into a trailing user block — see the comment in `expandAnalysis` before re-adding it
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
- **Input trigger**: `InputManager` (main process) installs a `WH_KEYBOARD_LL` hook via koffi — **not** `globalShortcut`. Windows does not deliver a `RegisterHotKey` hotkey while a sim holds the foreground (verified with RaceRoom in fullscreen *and* borderless: the trigger never reached main), which made the push-to-talk key dead exactly while driving. Do not "simplify" this back to `globalShortcut`. Fires `onInputTrigger` push to renderer; `useVoiceCoach` uses this to start/stop audio capture
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
| Store Zustand                           | Nessuna skill: `react-vite-best-practices` copre build/code-splitting Vite, non lo state management. Seguire i pattern in `sessionStore.ts` | `general-purpose` (con il contesto di `src/renderer/CLAUDE.md`, sezione `store/`)                              |
| Electron (IPC, sicurezza, packaging)    | Menzionare `claude-api` se tocca Claude/Anthropic SDK; altrimenti modifiche IPC/main process       | `general-purpose` (con contesto CLAUDE.md)                                                                                                |
| SQLite / query / schema                 | `db-schema` (skill: schema SQLite completo)                              | `general-purpose` (con la skill `db-schema` nel prompt)                                                                                                |
| Claude API / Anthropic SDK              | `claude-api` (SEMPRE, per model IDs, pricing, params, streaming, tool-use, token-counting)         | `general-purpose` (contesto skill fornito da `claude-api`)                                                                                |
| Fine branch / PR / commit               | `superpowers:finishing-a-development-branch`                                                        | —                                                                                                                                         |
| Sottocompiti indipendenti in parallelo  | `superpowers:dispatching-parallel-agents`                                                           | due o più `Explore` o `general-purpose` agents simultanei (es. R3E struct audit + ACE setup reader in parallelo)                          |
| Verifica prima di completare            | `superpowers:verification-before-completion`                                                        | —                                                                                                                                         |

**Soglia semplice vs complessa**: una feature è **semplice** se soddisfa _tutte_ queste condizioni — tocca un solo dominio (solo React, o solo IPC, o solo SQLite…), non introduce nuovi layer/file architetturali (solo modifiche a file esistenti o un singolo file nuovo), il design è già chiaro senza brainstorming, e l'implementazione è stimabile in ≤ ~3 step. Se anche solo una condizione non regge (multi-dominio, nuovi layer/astrazioni, design da concordare, o > ~3 step) è **complessa** → percorso `superpowers` completo.

**Regola multi-dominio**: se il task copre più aree (es. nuova feature React + IPC Electron), invocare prima `superpowers:brainstorming`, poi usare le skill di dominio durante l'implementazione (`react-vite-best-practices`, `electron-best-practices`).

**Regola subagent-driven-development**: quando si usa `superpowers:subagent-driven-development`, includere nel prompt di ogni implementer subagent la skill di dominio rilevante (dalla tabella sopra). Non usare solo `general-purpose` senza indicare la skill — ogni subagent deve invocarla prima di implementare.

## Struct Offset Debugging

Reader emitting zeros, -1, or garbage? Invoke the **`struct-offset-debugging`** skill
for the per-game runbook (R3E `VersionMajor`, ACE `AC_LIVE`, AMS2 `mVersion=14`).
