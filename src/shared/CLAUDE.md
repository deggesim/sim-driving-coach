# Shared (`src/shared/`)

Loaded when working under `src/shared/`. The full IPC channel table lives in the `ipc-channels` skill.

- **types.ts** — All shared types: `GameSource`, `Alert`, `AlertType`, `AlertPriority`, `Deviation`, `DeviationType`, `GameFrame`, `CompactFrame` (with ACE-only optional fields + world-space `wx`/`wy`/`wz` for track map), `ZoneData` (with ACE-only optional fields), `TrackMapGeometry`, `TrackMapBounds`, `TrackMapRow`, `LapRecord`, `GameStatus`, `SessionRow` (with `ended_at`, `car_class_name`, resolved name fields), `LapRow` (with `setup_id`, `zones_json`), `SessionSetupRow`, `SessionAnalysisRow`, `SessionDetail`, `SessionStartResult`, `SessionListParams`, `SessionListResult`, `SetupData`, `SetupParam`, `R3EFrame`, `CornerEntry`, `CornerNamesMap`, `AzureVoice`, `ElectronAPI`
- **format.ts** — `formatLapTime(seconds)` utility (M:SS.mmm)
- **alert-types.ts** — Alert type constants, BRAKE_TEMP thresholds, ANTI_SPAM constants, CALIBRATION_LAPS, POLL_INTERVAL_MS, BASELINE_EMA_ALPHA, DEVIATION_THRESHOLDS
