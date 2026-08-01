---
name: db-schema
description: SQLite schema reference for this app — the per-game table sets (sessions/laps/setups/analyses/baseline/corner_names/track_maps with _r3e, _ace, _ams2 suffixes), column meanings, FK links, and the blob/JSON payload formats. Use when writing or changing a query, adding a column or table, running a schema migration, or reasoning about how lap, setup, and analysis rows relate.
---

# Database Schema

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

Table-name resolution: `tableFor(game, base)` in `src/main/db/setup-row.ts`.
