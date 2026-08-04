---
name: ipc-channels
description: Full IPC channel reference for this app (ElectronAPI in src/shared/types.ts) — every push channel, handle, and one-way message between main and renderer, with payload shapes. Use when adding, changing, renaming, or debugging an IPC channel, when wiring a new main-process handler to the renderer, or when you need to know what a given channel returns.
---

# IPC Channels (`ElectronAPI` in `src/shared/types.ts`)

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
| Push      | `onSessionAnalysisStart`                                                   | `{ sessionId, version }` — a level started working (spinner) |
| Push      | `onSessionAnalysisDone`                                                    | `{ sessionId, analysis: SessionAnalysisRow, speak }` — `speak: false` on a voice-triggered analysis (the voice path speaks the summary) |
| Push      | `onAppError`                                                               | `{ message }` — main-process error surfaced to the UI (`app:error`) |
| Handle    | `configGet / configSet`                                                    | app_config table                                             |
| Handle    | `sessionStart`                                                             | Opens new session for the given `GameSource` → `SessionStartResult` |
| Handle    | `sessionEnd`                                                               | Closes active session                                        |
| Handle    | `sessionReopen`                                                            | Reopens a closed session as active → `SessionStartResult`    |
| Handle    | `sessionAnalyze`                                                           | Triggers the Level-1 analysis on demand                      |
| Handle    | `sessionExpandAnalysis`                                                    | Triggers the Level-2 deep-dive for one `analysisId` → `{ ok, reason? }`; text arrives on the `analysisStart`/`analysisDone` push channels |
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
| Handle    | `sessionDeleteSetup`                                                       | Delete a `SessionSetupRow` — **refuses** if any lap still references it, returning `{ ok: false, lapCount }` |
| Handle    | `sessionUpdateFlags`                                                       | Sets `leaderboardMode` / `fixedSetup` on the session row — the flags `loadSessionBundle` then derives for both prompts |
| Handle    | `lapGetFrames`                                                             | Decompress `frames_blob` → `CompactFrame[]` for a lap        |
| Handle    | `lapAssignSetup`                                                           | Reassign (or clear) the `setup_id` on a lap row              |
| Handle    | `lapDelete`                                                                | Delete a single lap row                                      |
| Handle    | `trackMapGet`                                                              | Retrieve cached `TrackMapGeometry` for game/car/track/layout |
| Handle    | `voiceQuery`                                                               | Streaming voice response via `VoiceCoach`                    |
| Handle    | `sttTranscribe`                                                            | Azure STT → transcribed string                               |
| Handle    | `ttsGetVoices / ttsSynthesize / ttsTest`                                   | Azure TTS                                                    |
| Handle    | `anthropicListModels`                                                      | Live Claude model list (`GET /v1/models`) for the analysis model selector; `[]` on missing key/error |
| Handle    | `telemetryLogGetDir`                                                       | Returns the path of the telemetry log directory              |
| Handle    | `aceListSetupCars / aceListSetupTracks / aceListSetupFiles / aceReadSetup` | ACE file-based setup                                         |
| Handle    | `listScreenshots / decodeSetup`                                            | AMS2 setup import (`setup:listScreenshots` / `setup:decodeSetup`) — Steam screenshots → Claude Vision → `SetupData` |
| Handle    | `readerReset`                                                              | Forced stop+start of that game's reader (`reader:reset`); no-op if it isn't currently running |
| One-way   | `windowClose / windowMinimize / windowMaximize`                            | Frameless window                                             |
