# Supporto Automobilista 2 (AMS2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Ogni implementer subagent DEVE invocare la skill di dominio indicata nel task (regola CLAUDE.md).

**Goal:** Aggiungere Automobilista 2 (motore pCARS2) come terzo gioco supportato, riusando l'intera pipeline coach/analisi tramite l'astrazione `GameFrame`, con reader SHM dedicato e flusso setup a screenshot (Claude Vision).

**Architecture:** Un nuovo reader `createAms2Reader()` legge l'unica pagina SHM `$pcars2$` (struct pCARS2 v14, letture atomiche via `mSequenceNumber`) ed emette `GameFrame`/`CompactFrame`/`lapComplete` esattamente come il reader ACE. Il main gira 3 reader in parallelo; `activeGame` resta **connection-driven** (nessun selettore UI). Le tabelle DB `*_ams2` replicano quelle ACE (identificatori string). Il setup AMS2 usa un picker a screenshot che invoca Claude Vision (modello dedicato `claude-sonnet-5`).

**Tech Stack:** Electron (main/preload/renderer), TypeScript strict, koffi (FFI kernel32), better-sqlite3, React 19 + react-bootstrap + Zustand, `@anthropic-ai/sdk`.

## Global Constraints

- **Code style**: TypeScript strict; `type` over `interface`; arrow functions ovunque (no `function`, no `class`); named exports; import relativi con estensione `.js` (NodeNext) nel main/shared. English per commenti e codice.
- **UI**: react-bootstrap + tema dark esclusivo via CSS custom properties (`--bg`, `--bg2`, `--text`, `--accent`…); Font Awesome importato per singola icona.
- **Selezione gioco**: **connection-driven** come R3E/ACE. NON creare un selettore `activeGame` in Settings né un campo nello store (la spec §5 e CLAUDE.md su questo punto sono stale). Priorità reader: `r3e > ace > ams2`.
- **Identificatori AMS2**: string leggibili (come ACE) → tabelle `*_ams2` con `car/track/layout` `TEXT`; `resolveNames`/`pushStatus` in modalità passthrough (nessun data-loader).
- **Modello Vision setup**: costante dedicata `claude-sonnet-5` (NON il modello coach). Coach invariato (`getAnthropicModel()`).
- **Platform**: Windows only. Reader in mock automatico su non-Windows (`process.platform !== "win32"`).
- **Struct offsets**: i valori in questo piano sono calcolati da `SharedMemory.h` locale (Pack=4). Vanno **validati empiricamente** alla prima connessione (log di `mVersion`, `mSpeed`, `lapDistance`, nome auto/pista) — §Struct Offset Debugging del CLAUDE.md.
- **Verifica per-task**: dove non c'è un self-check runnabile, il gate è `npm run typecheck` **e** `npm run lint` puliti. Il repo non ha un framework di unit test: NON introdurne uno (YAGNI). L'unico self-check runnabile richiesto è quello della struct (Task 2).
- **Commit**: mai committare senza conferma esplicita dell'utente. I passi "Commit" del piano preparano il messaggio ma l'esecuzione del commit va confermata.

**Fonti di verità (già lette, riportate nei task):**
- Struct: `C:\Program Files (x86)\Steam\steamapps\common\Automobilista 2\Support\SharedMemory\AMS2_SharedMemoryExampleApp\SharedMemory.h` (SHARED_MEMORY_VERSION=14).
- Nome SHM: `App.cpp:15` → `#define MAP_OBJECT_NAME L"$pcars2$"`; pattern seq-number `App.cpp:64-77`.
- Template reader: `src/main/ace/ace-reader.ts`, `src/main/ace/ace-struct.ts`.
- Template picker: `git show 465e719^:src/renderer/components/ScreenshotPicker.tsx` (riportato in Task 6).

---

## File Structure

**Nuovi file:**
- `src/main/ams2/ams2-struct.ts` — offset struct pCARS2 v14 + read helper + costanti (Task 2).
- `src/main/ams2/ams2-struct.selfcheck.ts` — assert runnabile su size/offset (Task 2).
- `src/main/ams2/ams2-reader.ts` — `createAms2Reader()` factory (Task 3).
- `src/renderer/components/Ams2SetupPicker.tsx` — picker a screenshot (Task 6).

**File modificati:**
- `src/shared/types.ts` — `GameSource`, `GameStatus`, `ElectronAPI` (Task 1, 5).
- `src/main/db/db.ts` — tabelle `*_ams2`, indici, migration, fix 5 ternari (Task 1).
- `src/main/main.ts` — fix `t()`/`pushStatus`/`resolveNames`/`lookupCorner`/`openTelemetryFile`/`handleLapComplete`/`reader:reset`, wiring reader, IPC setup screenshot (Task 1, 4, 5).
- `src/preload/index.ts` — metodi `listScreenshots`/`decodeSetup` (Task 5).
- `src/renderer/components/SessionPanel.tsx` — branch picker a 3 vie (Task 7).
- `src/renderer/components/SessionHistory.tsx` — filtro + badge Sim (Task 7).
- `src/renderer/components/StatusBar.tsx` — terzo badge connessione (Task 7).
- `src/renderer/components/SettingsPanel.tsx` — testo descrittivo mock (Task 7).
- `src/renderer/mocks/mockData.ts` — sessione mock AMS2 (Task 7).

---

## Task 1: Fondamenta — tipi core + schema DB + fix helper game→tabella

**Skill:** `sqlite-database-expert` (schema). **Agente (se serve):** `voltagent-data-ai:database-optimizer`.

**Files:**
- Modify: `src/shared/types.ts:51` (GameSource), `src/shared/types.ts:176-183` (GameStatus)
- Modify: `src/main/db/db.ts` (initSchema, migrateSchema, 5 ternari)
- Modify: `src/main/main.ts:433-460` (pushStatus), `src/main/main.ts:501-502` (helper `t`)

**Interfaces:**
- Produces: `GameSource = "r3e" | "ace" | "ams2"`; `GameStatus` con nuovo campo `ams2Connected: boolean`; tabelle `sessions_ams2`, `session_setups_ams2`, `laps_ams2`, `session_analyses_ams2`, `track_maps_ams2`, `baseline_ams2`, `baseline_tc_zones_ams2`, `baseline_abs_zones_ams2`, `corner_names_ams2`. Helper `t(base, game)` e i 5 lookup di `db.ts` risolvono correttamente `ams2`.

- [ ] **Step 1: Estendere `GameSource`**

In `src/shared/types.ts:51` sostituire:
```ts
export type GameSource = "r3e" | "ace";
```
con:
```ts
export type GameSource = "r3e" | "ace" | "ams2";
```

- [ ] **Step 2: Aggiungere `ams2Connected` a `GameStatus`**

In `src/shared/types.ts` (blocco `GameStatus`, righe ~176-183) aggiungere il campo dopo `aceConnected`:
```ts
export type GameStatus = {
  connected: boolean;
  r3eConnected: boolean;
  aceConnected: boolean;
  ams2Connected: boolean;
  calibrating: boolean;
  lapsToCalibration: number;
  car: string | null;
  track: string | null;
  layout: string | null;
  game: GameSource;
};
```

- [ ] **Step 3: Aggiungere le tabelle `*_ams2` in `initSchema`**

In `src/main/db/db.ts`, dentro `initSchema` (l'unico `db.exec(...)`), aggiungere il blocco seguente **prima** della riga `seedR3ECorners(db);` (`db.ts:220`). Le tabelle replicano quelle ACE (car/track/layout `TEXT`):
```sql
-- ── AMS2 tables (mirror ACE: string identifiers) ──
CREATE TABLE IF NOT EXISTS baseline_ams2 (
  car TEXT NOT NULL, track TEXT NOT NULL, layout TEXT NOT NULL, zone_id INTEGER NOT NULL,
  data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (car, track, layout, zone_id)
);
CREATE TABLE IF NOT EXISTS baseline_tc_zones_ams2 (
  car TEXT NOT NULL, track TEXT NOT NULL, layout TEXT NOT NULL, zone_id INTEGER NOT NULL,
  PRIMARY KEY (car, track, layout, zone_id)
);
CREATE TABLE IF NOT EXISTS baseline_abs_zones_ams2 (
  car TEXT NOT NULL, track TEXT NOT NULL, layout TEXT NOT NULL, zone_id INTEGER NOT NULL,
  PRIMARY KEY (car, track, layout, zone_id)
);
CREATE TABLE IF NOT EXISTS corner_names_ams2 (
  track TEXT NOT NULL, layout TEXT NOT NULL, dist_min REAL NOT NULL, dist_max REAL NOT NULL,
  name TEXT NOT NULL, PRIMARY KEY (track, layout, dist_min)
);
CREATE TABLE IF NOT EXISTS sessions_ams2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT, car TEXT NOT NULL, track TEXT NOT NULL, layout TEXT NOT NULL,
  session_type TEXT NOT NULL DEFAULT 'practice', started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT, best_lap REAL, lap_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS session_setups_ams2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions_ams2(id) ON DELETE CASCADE,
  loaded_at TEXT NOT NULL DEFAULT (datetime('now')), setup_json TEXT NOT NULL, setup_screenshots TEXT
);
CREATE INDEX IF NOT EXISTS idx_setups_ams2_session ON session_setups_ams2(session_id);
CREATE TABLE IF NOT EXISTS laps_ams2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions_ams2(id) ON DELETE CASCADE,
  setup_id INTEGER REFERENCES session_setups_ams2(id) ON DELETE SET NULL,
  lap_number INTEGER NOT NULL, lap_time REAL NOT NULL, sector1 REAL, sector2 REAL, sector3 REAL,
  valid INTEGER NOT NULL DEFAULT 1, zones_json TEXT, frames_blob BLOB,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_laps_ams2_session ON laps_ams2(session_id);
CREATE TABLE IF NOT EXISTS session_analyses_ams2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions_ams2(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, template_v3 TEXT NOT NULL, section5_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(session_id, version)
);
CREATE INDEX IF NOT EXISTS idx_analyses_ams2_session ON session_analyses_ams2(session_id);
CREATE TABLE IF NOT EXISTS track_maps_ams2 (
  track TEXT NOT NULL, layout TEXT NOT NULL, geometry TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (track, layout)
);
```

- [ ] **Step 4: Aggiungere le migration `*_ams2` in `migrateSchema`**

In `src/main/db/db.ts`, dentro l'array `migrations` di `migrateSchema` (`db.ts:224-231`), aggiungere in coda:
```ts
    `ALTER TABLE sessions_ams2 ADD COLUMN leaderboard_mode INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE sessions_ams2 ADD COLUMN fixed_setup      INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE session_analyses_ams2 ADD COLUMN comments_json TEXT`,
```

- [ ] **Step 5: Correggere i 5 ternari game→tabella a 2 vie in `db.ts`**

Sostituire (con `replace_all` dove il testo è identico) in `src/main/db/db.ts`:

Righe 265, 283, 327:
```ts
const table = game === "r3e" ? "corner_names_r3e" : "corner_names_ace";
```
→
```ts
const table = `corner_names_${game}`;
```

Righe 357, 376:
```ts
const table = game === "r3e" ? "track_maps_r3e" : "track_maps_ace";
```
→
```ts
const table = `track_maps_${game}`;
```

- [ ] **Step 6: Correggere l'helper `t()` in `main.ts`**

In `src/main/main.ts:501-502` sostituire:
```ts
  const t = (base: string, game: GameSource = activeGame): string =>
    `${base}_${game === "ace" ? "ace" : "r3e"}`;
```
con:
```ts
  const t = (base: string, game: GameSource = activeGame): string =>
    `${base}_${game}`;
```

- [ ] **Step 7: Correggere `pushStatus` (passthrough nomi + `ams2Connected`)**

In `src/main/main.ts:433-460` sostituire il corpo di `pushStatus`. Il ramo passthrough vale per tutti i giochi con identificatori string (ace **e** ams2); solo r3e risolve gli ID numerici. Aggiungere `ams2Connected` (nuova variabile di stato introdotta in Task 4 — qui usiamo `false` come default e la variabile verrà dichiarata al Step successivo).
```ts
  const pushStatus = (): void => {
    const names =
      activeGame !== "r3e"
        ? {
            carName: currentCar,
            trackName: currentTrack,
            layoutName: currentLayout,
          }
        : {
            carName: currentCar ? getCarName(Number(currentCar)) : "",
            trackName: currentTrack ? getTrackName(Number(currentTrack)) : "",
            layoutName: currentLayout
              ? getLayoutName(Number(currentLayout))
              : "",
          };
    const status: GameStatus = {
      connected: r3eConnected || aceConnected || ams2Connected,
      r3eConnected,
      aceConnected,
      ams2Connected,
      calibrating: recorder.isCalibrating(),
      lapsToCalibration: recorder.lapsToCalibration(),
      car: names.carName || null,
      track: names.trackName || null,
      layout: names.layoutName || null,
      game: activeGame,
    };
    pushToRenderer("status", status);
  };
```

- [ ] **Step 8: Dichiarare `ams2Connected`**

In `src/main/main.ts:380-382` aggiungere la variabile accanto alle altre:
```ts
  let r3eConnected = false;
  let aceConnected = false;
  let ams2Connected = false;
  let activeGame: GameSource = "r3e";
```

- [ ] **Step 9: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS (0 errori). Nota: `ams2Connected` è ora dichiarato (Step 8) e usato in `pushStatus` (Step 7); nessun reader ams2 ancora → resta sempre `false`, corretto a questo stadio.

- [ ] **Step 10: Commit**

```bash
git add src/shared/types.ts src/main/db/db.ts src/main/main.ts
git commit -m "feat(ams2): extend GameSource, add AMS2 DB tables, fix game→table mapping"
```

---

## Task 2: Modulo struct pCARS2 v14 + self-check

**Skill:** `typescript-advanced-types` (se servono affinamenti sui tipi). **Agente (se serve):** `voltagent-lang:typescript-pro`.

**Files:**
- Create: `src/main/ams2/ams2-struct.ts`
- Create: `src/main/ams2/ams2-struct.selfcheck.ts`

**Interfaces:**
- Produces (consumati dal reader in Task 3):
  - Costanti: `AMS2_SHM_NAME = "$pcars2$"`, `AMS2_VERSION = 14`, `AMS2_STRUCT_SIZE = 20700`, `PARTICIPANT_SIZE = 100`, `GAME_INGAME_PLAYING = 2`, `CAR_ABS = 1 << 4`, `CAR_TCS = 1 << 6`, `MAX_PARTICIPANTS = 64`.
  - Offset table `OFF` (top-level) e `PART` (dentro `ParticipantInfo`), `as const`.
  - `participantOffset(index: number, fieldOffset: number): number` → `OFF.participantInfo + index * PARTICIPANT_SIZE + fieldOffset`.
  - Helper: `readInt32(buf, offset)`, `readUint32(buf, offset)`, `readFloat(buf, offset)`, `readUint8(buf, offset)`, `readString(buf, offset, maxLen)`, `readFloatArray(buf, offset, count)`.

- [ ] **Step 1: Scrivere il self-check (test che fallisce)**

Create `src/main/ams2/ams2-struct.selfcheck.ts`:
```ts
/**
 * Runnable self-check for the pCARS2 struct offset math.
 * Run: npx ts-node --esm --project tsconfig.node.json src/main/ams2/ams2-struct.selfcheck.ts
 * No test framework (assert only) — fails loudly if the offset arithmetic breaks.
 */
import assert from "node:assert/strict";
import {
  AMS2_STRUCT_SIZE,
  PARTICIPANT_SIZE,
  OFF,
  PART,
  participantOffset,
  readFloat,
  readUint32,
} from "./ams2-struct.js";

// Struct-level invariants (derived from SharedMemory.h, Pack=4).
assert.equal(PARTICIPANT_SIZE, 100, "ParticipantInfo size");
assert.equal(AMS2_STRUCT_SIZE, 20700, "SharedMemory total size");
assert.equal(OFF.version, 0, "mVersion offset");
assert.equal(OFF.viewedParticipantIndex, 20, "mViewedParticipantIndex offset");
assert.equal(OFF.participantInfo, 28, "mParticipantInfo base offset");
assert.equal(OFF.speed, 6848, "mSpeed offset");
assert.equal(OFF.brake, 6860, "mBrake offset");
assert.equal(OFF.throttle, 6864, "mThrottle offset");
assert.equal(OFF.carFlags, 6816, "mCarFlags offset");
assert.equal(OFF.brakeTempCelsius, 7184, "mBrakeTempCelsius offset");
assert.equal(OFF.sequenceNumber, 7320, "mSequenceNumber offset");

// Participant arithmetic: player 0's lapDistance sits at 28 + 0*100 + 80 = 108.
assert.equal(PART.currentLapDistance, 80, "PART.currentLapDistance");
assert.equal(participantOffset(0, PART.currentLapDistance), 108, "player 0 lapDistance");
assert.equal(participantOffset(1, PART.currentLapDistance), 208, "player 1 lapDistance");

// Sample-buffer round-trip: write known values, read them back at computed offsets.
const buf = Buffer.alloc(AMS2_STRUCT_SIZE);
buf.writeUInt32LE(14, OFF.version);
buf.writeFloatLE(72.5, OFF.speed);
buf.writeUInt32LE(6, OFF.sequenceNumber);
buf.writeFloatLE(1234.5, participantOffset(3, PART.currentLapDistance));
assert.equal(readUint32(buf, OFF.version), 14, "read version");
assert.equal(readFloat(buf, OFF.speed), 72.5, "read speed");
assert.equal(readUint32(buf, OFF.sequenceNumber), 6, "read seq");
assert.equal(readFloat(buf, participantOffset(3, PART.currentLapDistance)), 1234.5, "read player 3 dist");

console.log("ams2-struct self-check OK");
```

- [ ] **Step 2: Eseguire il self-check e verificarne il fallimento**

Run: `npx ts-node --esm --project tsconfig.node.json src/main/ams2/ams2-struct.selfcheck.ts`
Expected: FAIL — `Cannot find module './ams2-struct.js'` (il modulo non esiste ancora).

- [ ] **Step 3: Scrivere `ams2-struct.ts`**

Create `src/main/ams2/ams2-struct.ts`. Gli offset sono calcolati da `SharedMemory.h` (Pack=4, allineamento a 4 byte; `bool`=1 byte con padding prima del successivo campo a 4 byte). Vedi commenti per la derivazione.
```ts
/**
 * pCARS2 / Automobilista 2 shared-memory struct layout (SHARED_MEMORY_VERSION = 14).
 * Offsets derived from SharedMemory.h with Pack=4 alignment (all members <= 4 bytes,
 * so effective alignment is 4; `bool` occupies 1 byte + padding to the next 4-byte field).
 * Single memory-mapped page named "$pcars2$" (App.cpp:15).
 *
 * IMPORTANT: validate empirically on first connection (log mVersion, mSpeed, lapDistance,
 * car/track name) against the in-game HUD — see CLAUDE.md §Struct Offset Debugging.
 */

// ── Constants ──
export const AMS2_SHM_NAME = "$pcars2$";
export const AMS2_VERSION = 14;
export const MAX_PARTICIPANTS = 64;
export const PARTICIPANT_SIZE = 100; // sizeof(ParticipantInfo), Pack=4
export const AMS2_STRUCT_SIZE = 20700; // sizeof(SharedMemory), Pack=4

// mGameState enum (Type#1)
export const GAME_INGAME_PLAYING = 2;

// mCarFlags bits (Type#9)
export const CAR_ABS = 1 << 4; // 16
export const CAR_TCS = 1 << 6; // 64

// Tyre order matches TYRE_* enum: FL=0, FR=1, RL=2, RR=3.

/**
 * ParticipantInfo field offsets (relative to the participant's base).
 * bool(1)+char[64] → 65; float[3] aligns to 68 → 80; then four 4-byte fields.
 */
export const PART = {
  isActive: 0, // bool
  name: 1, // char[64]
  worldPosition: 68, // float[3] X,Y,Z
  currentLapDistance: 80, // float (metres)
  racePosition: 84, // uint
  lapsCompleted: 88, // uint
  currentLap: 92, // uint
  currentSector: 96, // int
} as const;

/**
 * Top-level SharedMemory field offsets used by the coach.
 * mParticipantInfo occupies 28 .. 28 + 64*100 = 6428, hence the jump after it.
 */
export const OFF = {
  version: 0, // uint  mVersion
  buildVersionNumber: 4, // uint
  gameState: 8, // uint  mGameState (2 = ingame playing)
  sessionState: 12, // uint
  raceState: 16, // uint
  viewedParticipantIndex: 20, // int   mViewedParticipantIndex
  numParticipants: 24, // int
  participantInfo: 28, // ParticipantInfo[64], stride 100

  carName: 6444, // char[64]  mCarName
  carClassName: 6508, // char[64]  mCarClassName
  trackLocation: 6576, // char[64]  mTrackLocation
  trackVariation: 6640, // char[64]  mTrackVariation
  trackLength: 6704, // float     mTrackLength (metres)

  lapInvalidated: 6712, // bool   mLapInvalidated (current lap)
  lastLapTime: 6720, // float  mLastLapTime (seconds)
  currentSector1Time: 6752, // float mCurrentSector1Time
  currentSector2Time: 6756, // float mCurrentSector2Time
  currentSector3Time: 6760, // float mCurrentSector3Time

  carFlags: 6816, // uint   mCarFlags
  speed: 6848, // float  mSpeed (m/s)
  rpm: 6852, // float  mRpm
  brake: 6860, // float  mBrake (0..1)
  throttle: 6864, // float  mThrottle (0..1)
  steering: 6872, // float  mSteering (-1..1)
  gear: 6876, // int    mGear
  antiLockActive: 6888, // bool   mAntiLockActive

  tyreTemp: 7072, // float[4]  mTyreTemp (Celsius)
  brakeTempCelsius: 7184, // float[4]  mBrakeTempCelsius (Celsius)

  sequenceNumber: 7320, // uint   mSequenceNumber (odd = write in progress)
} as const;

export const participantOffset = (index: number, fieldOffset: number): number =>
  OFF.participantInfo + index * PARTICIPANT_SIZE + fieldOffset;

// ── Read helpers (offset-based, mirror ace-struct.ts) ──
export const readInt32 = (buf: Buffer, offset: number): number =>
  buf.readInt32LE(offset);

export const readUint32 = (buf: Buffer, offset: number): number =>
  buf.readUInt32LE(offset);

export const readFloat = (buf: Buffer, offset: number): number =>
  buf.readFloatLE(offset);

export const readUint8 = (buf: Buffer, offset: number): number =>
  buf.readUInt8(offset);

/** Read a null-terminated ASCII string from a fixed-size char[n] field. */
export const readString = (
  buf: Buffer,
  offset: number,
  maxLen: number,
): string => {
  const end = buf.indexOf(0, offset);
  const actualEnd = end === -1 || end > offset + maxLen ? offset + maxLen : end;
  return buf.toString("ascii", offset, actualEnd).replace(/\0/g, "").trim();
};

/** Read float[count] into a number[]. */
export const readFloatArray = (
  buf: Buffer,
  offset: number,
  count: number,
): number[] => {
  const result: number[] = [];
  for (let i = 0; i < count; i++) result.push(buf.readFloatLE(offset + i * 4));
  return result;
};
```

- [ ] **Step 4: Eseguire il self-check e verificarne il passaggio**

Run: `npx ts-node --esm --project tsconfig.node.json src/main/ams2/ams2-struct.selfcheck.ts`
Expected: stdout `ams2-struct self-check OK`, exit 0.
(Se ts-node ESM dà errori di risoluzione moduli: fallback `npx tsc -p tsconfig.node.json --noEmit` per il typecheck e verifica manuale delle assert; ma il comando sopra è quello atteso dato che `ts-node` è in devDependencies.)

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/ams2/ams2-struct.ts src/main/ams2/ams2-struct.selfcheck.ts
git commit -m "feat(ams2): pCARS2 v14 struct offsets + runnable self-check"
```

---

## Task 3: Reader `createAms2Reader()`

**Skill:** `electron-best-practices` (processo main / FFI). **Agente (se serve):** `voltagent-core-dev:electron-pro`.

**Files:**
- Create: `src/main/ams2/ams2-reader.ts`
- Reference (leggere, non modificare): `src/main/ace/ace-reader.ts`

**Interfaces:**
- Consumes (da Task 2): tutte le export di `ams2-struct.ts`; `POLL_INTERVAL_MS`/`RECONNECT_INTERVAL_MS` da `src/shared/alert-types.js`; `GameFrame`/`CompactFrame` da `src/shared/types.js`.
- Produces (consumato da Task 4):
  - `export type Ams2SessionInfo = { car: string; track: string; layout: string; trackLength: number; }`
  - `export type Ams2Reader = { start: () => void; stop: () => void; on: EventEmitter["on"]; getSessionInfo: () => Ams2SessionInfo; }`
  - `export const createAms2Reader = (options?: { mock?: boolean }) => Ams2Reader`
  - Eventi emessi: `"connected"`, `"disconnected"`, `"ams2:frame"` (`GameFrame`), `"ams2:fullFrame"` (`Record<string, unknown>`), `"lapComplete"` (payload sotto).
  - Payload `lapComplete`: `{ lapNumber, lapTime, sectorTimes: [number,number,number], frames: CompactFrame[], car, track, layout, layoutLength, valid }`.

- [ ] **Step 1: Scrivere `ams2-reader.ts`**

Create `src/main/ams2/ams2-reader.ts`. Segue il pattern ACE (koffi + kernel32, `setTimeout` a 16ms, probe/stale/reconnect, mock su non-Windows) ma con **una sola** pagina SHM, lettura atomica via `mSequenceNumber`, e lap-complete via incremento di `mLapsCompleted` del partecipante osservato.
```ts
import { EventEmitter } from "events";
import { createRequire } from "module";
import {
  AMS2_SHM_NAME,
  AMS2_STRUCT_SIZE,
  AMS2_VERSION,
  CAR_TCS,
  GAME_INGAME_PLAYING,
  MAX_PARTICIPANTS,
  OFF,
  PART,
  participantOffset,
  readFloat,
  readFloatArray,
  readInt32,
  readString,
  readUint32,
} from "./ams2-struct.js";
import {
  POLL_INTERVAL_MS,
  RECONNECT_INTERVAL_MS,
} from "../../shared/alert-types.js";
import type { CompactFrame, GameFrame } from "../../shared/types.js";

const _require = createRequire(import.meta.url);

type Ams2ReaderOptions = { mock?: boolean };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NativePointer = any;

type Kernel32 = {
  OpenFileMappingA: (a: number, i: number, n: string) => NativePointer;
  MapViewOfFile: (
    h: NativePointer,
    a: number,
    oh: number,
    ol: number,
    b: number,
  ) => NativePointer;
  UnmapViewOfFile: (addr: NativePointer) => boolean;
  CloseHandle: (h: NativePointer) => boolean;
  GetLastError: () => number;
};

const FILE_MAP_READ = 0x0004;
const STALE_LIMIT = 120; // ~2s of frozen sequence number while playing → disconnect

export type Ams2SessionInfo = {
  car: string;
  track: string;
  layout: string;
  trackLength: number;
};

export type Ams2Reader = {
  start: () => void;
  stop: () => void;
  on: EventEmitter["on"];
  getSessionInfo: () => Ams2SessionInfo;
};

export const createAms2Reader = (
  options: Ams2ReaderOptions = {},
): Ams2Reader => {
  const emitter = new EventEmitter();
  const isMock = options.mock ?? process.platform !== "win32";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let koffi: any = null;
  let kernel32: Kernel32 | null = null;
  let handle: NativePointer = null;
  let view: NativePointer = null;

  let stopped = false;
  let connected = false;
  let pollTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let loggedOffsets = false;

  // Session cache
  let cachedCar = "";
  let cachedTrack = "";
  let cachedLayout = "";
  let cachedTrackLength = 0;

  // Lap accumulation
  let lapFrames: CompactFrame[] = [];
  let prevLapsCompleted = -1;
  let lapInvalidatedAccum = false;
  let lastSectors: [number, number, number] = [-1, -1, -1];
  let lastSeq = -1;
  let staleCount = 0;

  const isNullPtr = (ptr: NativePointer): boolean => {
    try {
      return koffi.address(ptr) === 0n;
    } catch {
      return ptr === null || ptr === undefined;
    }
  };

  const decodeBuffer = (v: NativePointer, size: number): Buffer => {
    const raw: Uint8Array = koffi.decode(v, koffi.array("uint8_t", size));
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  };

  const cleanup = (): void => {
    if (view && kernel32) {
      try {
        kernel32.UnmapViewOfFile(view);
      } catch {
        /* ignore */
      }
    }
    if (handle && kernel32) {
      try {
        kernel32.CloseHandle(handle);
      } catch {
        /* ignore */
      }
    }
    view = null;
    handle = null;
    if (connected) {
      connected = false;
      emitter.emit("disconnected");
    }
  };

  const scheduleReconnect = (): void => {
    if (stopped) return;
    reconnectTimer = setTimeout(() => tryConnect(), RECONNECT_INTERVAL_MS);
  };

  const tryConnect = (): void => {
    if (stopped) return;
    try {
      if (!koffi) {
        koffi = _require("koffi");
        const lib = koffi.load("kernel32.dll");
        kernel32 = {
          OpenFileMappingA: lib.func(
            "void* __stdcall OpenFileMappingA(uint32 dwDesiredAccess, int bInheritHandle, const char* lpName)",
          ),
          MapViewOfFile: lib.func(
            "void* __stdcall MapViewOfFile(void* hFileMappingObject, uint32 dwDesiredAccess, uint32 dwFileOffsetHigh, uint32 dwFileOffsetLow, size_t dwNumberOfBytesToMap)",
          ),
          UnmapViewOfFile: lib.func(
            "bool __stdcall UnmapViewOfFile(const void* lpBaseAddress)",
          ),
          CloseHandle: lib.func("bool __stdcall CloseHandle(void* hObject)"),
          GetLastError: lib.func("uint32 __stdcall GetLastError()"),
        } as Kernel32;
      }
      handle = kernel32!.OpenFileMappingA(FILE_MAP_READ, 0, AMS2_SHM_NAME);
      if (isNullPtr(handle)) {
        handle = null;
        scheduleReconnect();
        return;
      }
      view = kernel32!.MapViewOfFile(
        handle,
        FILE_MAP_READ,
        0,
        0,
        AMS2_STRUCT_SIZE,
      );
      if (isNullPtr(view)) {
        kernel32!.CloseHandle(handle);
        handle = null;
        view = null;
        scheduleReconnect();
        return;
      }
      connected = true;
      staleCount = 0;
      emitter.emit("connected");
      poll();
    } catch (err) {
      console.error("[AMS2] connect error:", err);
      cleanup();
      scheduleReconnect();
    }
  };

  /** Read a stable snapshot using the sequence-number protocol (App.cpp:64-77). */
  const readStable = (): Buffer | null => {
    const buf = decodeBuffer(view, AMS2_STRUCT_SIZE);
    const seq = readUint32(buf, OFF.sequenceNumber);
    if (seq % 2 !== 0) return null; // write in progress
    const buf2 = decodeBuffer(view, AMS2_STRUCT_SIZE);
    if (readUint32(buf2, OFF.sequenceNumber) !== seq) return null; // torn read
    // Stale detection: sequence frozen while we expect fresh data.
    if (seq === lastSeq) staleCount++;
    else {
      staleCount = 0;
      lastSeq = seq;
    }
    return buf;
  };

  const updateSession = (buf: Buffer): void => {
    cachedCar = readString(buf, OFF.carName, 64) || cachedCar;
    cachedTrack = readString(buf, OFF.trackLocation, 64) || cachedTrack;
    const variation = readString(buf, OFF.trackVariation, 64);
    cachedLayout = variation || cachedTrack;
    const len = readFloat(buf, OFF.trackLength);
    if (len > 0) cachedTrackLength = len;
  };

  const poll = (): void => {
    if (stopped) return;
    try {
      const buf = readStable();
      if (!buf) {
        if (staleCount > STALE_LIMIT) {
          cleanup();
          scheduleReconnect();
          return;
        }
        pollTimer = setTimeout(() => poll(), POLL_INTERVAL_MS);
        return;
      }

      const version = readUint32(buf, OFF.version);
      const gameState = readUint32(buf, OFF.gameState);

      if (!loggedOffsets) {
        loggedOffsets = true;
        console.log(
          `[AMS2] connected: mVersion=${version} (expected ${AMS2_VERSION}) ` +
            `speed=${(readFloat(buf, OFF.speed) * 3.6).toFixed(1)}km/h ` +
            `car="${readString(buf, OFF.carName, 64)}" ` +
            `track="${readString(buf, OFF.trackLocation, 64)}"`,
        );
      }

      // Only produce coach data while actually driving.
      if (gameState !== GAME_INGAME_PLAYING) {
        pollTimer = setTimeout(() => poll(), POLL_INTERVAL_MS);
        return;
      }

      updateSession(buf);

      let idx = readInt32(buf, OFF.viewedParticipantIndex);
      if (idx < 0 || idx >= MAX_PARTICIPANTS) idx = 0;

      const lapDistance = readFloat(buf, participantOffset(idx, PART.currentLapDistance));
      const lapsCompleted = readUint32(buf, participantOffset(idx, PART.lapsCompleted));
      const wpos = readFloatArray(buf, participantOffset(idx, PART.worldPosition), 3);

      const speed = readFloat(buf, OFF.speed); // m/s
      const throttle = readFloat(buf, OFF.throttle);
      const brake = readFloat(buf, OFF.brake);
      const steering = readFloat(buf, OFF.steering);
      const gear = readInt32(buf, OFF.gear);
      const rpm = readFloat(buf, OFF.rpm);
      const carFlags = readUint32(buf, OFF.carFlags);
      const antiLock = readFloat(buf, OFF.antiLockActive) !== 0 || buf.readUInt8(OFF.antiLockActive) !== 0;
      const brakeTemps = readFloatArray(buf, OFF.brakeTempCelsius, 4);

      // ── Driver aids ──
      // ponytail: AMS2 exposes NO "TC cutting now" flag. Heuristic: TCS enabled +
      // near-full throttle. Kept conservative (0.95) to avoid P2 alert spam.
      // Upgrade path: derive from rear-wheel slip (mTyreRPS vs mSpeed) if needed.
      const tcsEnabled = (carFlags & CAR_TCS) !== 0;
      const tcActive = tcsEnabled && throttle > 0.95 ? 1 : 0;
      const absActive = brake > 0.05 && antiLock ? 1 : 0;

      const gameFrame: GameFrame = {
        lapDistance,
        tcActive,
        absActive,
        brakeTempFL: brakeTemps[0] ?? -1,
        brakeTempFR: brakeTemps[1] ?? -1,
        brakeTempRL: brakeTemps[2] ?? -1,
        brakeTempRR: brakeTemps[3] ?? -1,
      };
      emitter.emit("ams2:frame", gameFrame);

      // Full frame for telemetry logging.
      emitter.emit("ams2:fullFrame", {
        car: cachedCar,
        track: cachedTrack,
        layout: cachedLayout,
        lapDistance,
        speedKmh: speed * 3.6,
        throttle,
        brake,
        steering,
        gear,
        rpm,
        tcActive,
        absActive,
        brakeTemps,
        wx: wpos[0],
        wy: wpos[1],
        wz: wpos[2],
      });

      // Accumulate frame + lap-invalidation over the lap.
      if (buf.readUInt8(OFF.lapInvalidated) !== 0) lapInvalidatedAccum = true;
      lapFrames.push({
        d: lapDistance,
        spd: speed * 3.6,
        thr: throttle,
        brk: brake,
        str: steering,
        gear,
        abs: absActive,
        tc: tcActive,
        bt: [...brakeTemps],
        ts: Date.now(),
        rpm,
        wx: wpos[0],
        wy: wpos[1],
        wz: wpos[2],
      });

      // ── Lap completion: mLapsCompleted increment ──
      if (prevLapsCompleted >= 0 && lapsCompleted > prevLapsCompleted) {
        const lapTime = readFloat(buf, OFF.lastLapTime);
        emitter.emit("lapComplete", {
          lapNumber: lapsCompleted,
          lapTime: lapTime > 0 ? lapTime : 0,
          // ponytail: sector times from the previous poll (locked-in values before
          // the line reset them); ~1 frame imprecision, still better than ACE's [-1].
          sectorTimes: lastSectors,
          frames: [...lapFrames],
          car: cachedCar,
          track: cachedTrack,
          layout: cachedLayout,
          layoutLength: cachedTrackLength,
          valid: !lapInvalidatedAccum,
        });
        lapFrames = [];
        lapInvalidatedAccum = false;
      }
      prevLapsCompleted = lapsCompleted;
      lastSectors = [
        readFloat(buf, OFF.currentSector1Time),
        readFloat(buf, OFF.currentSector2Time),
        readFloat(buf, OFF.currentSector3Time),
      ];

      pollTimer = setTimeout(() => poll(), POLL_INTERVAL_MS);
    } catch (err) {
      console.error("[AMS2] poll error:", err);
      cleanup();
      scheduleReconnect();
    }
  };

  // ── Mock mode (non-Windows) ──
  const startMock = (): void => {
    connected = true;
    emitter.emit("connected");
    cachedCar = "formula_ultimate_gen2";
    cachedTrack = "Interlagos";
    cachedLayout = "Grand Prix";
    cachedTrackLength = 4309;
    let dist = 0;
    const tick = (): void => {
      if (stopped) return;
      dist = (dist + 40) % cachedTrackLength;
      emitter.emit("ams2:frame", {
        lapDistance: dist,
        tcActive: 0,
        absActive: 0,
        brakeTempFL: 450,
        brakeTempFR: 450,
        brakeTempRL: 430,
        brakeTempRR: 430,
      } as GameFrame);
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
  };

  return {
    start: () => {
      stopped = false;
      if (isMock) startMock();
      else tryConnect();
    },
    stop: () => {
      stopped = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      cleanup();
    },
    on: emitter.on.bind(emitter),
    getSessionInfo: (): Ams2SessionInfo => ({
      car: cachedCar,
      track: cachedTrack,
      layout: cachedLayout,
      trackLength: cachedTrackLength,
    }),
  };
};
```

Nota `antiLockActive`: è un `bool` (1 byte). Il codice legge il byte con `buf.readUInt8(OFF.antiLockActive)`; la doppia lettura via `readFloat` è ridondante — **semplificare a** `const antiLock = buf.readUInt8(OFF.antiLockActive) !== 0;` (rimuovere l'`|| readFloat...`). Correggere in questo step.

- [ ] **Step 2: Semplificare la lettura del bool `antiLockActive`**

Sostituire nel file appena creato:
```ts
      const antiLock = readFloat(buf, OFF.antiLockActive) !== 0 || buf.readUInt8(OFF.antiLockActive) !== 0;
```
con:
```ts
      const antiLock = buf.readUInt8(OFF.antiLockActive) !== 0;
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. (`readFloat`/`readString`/`readUint32`/`readInt32`/`readFloatArray` tutti usati; se `readUint8` risulta unused nell'import, rimuoverlo dall'import — non è importato in questo file.)

- [ ] **Step 4: Commit**

```bash
git add src/main/ams2/ams2-reader.ts
git commit -m "feat(ams2): SHM reader (seq-number atomic read, GameFrame + lapComplete)"
```

---

## Task 4: Wiring del reader in `main.ts`

**Skill:** `electron-best-practices`. **Agente (se serve):** `voltagent-core-dev:electron-pro`.

**Files:**
- Modify: `src/main/main.ts` (import, globals, handler reader, `resolveNames`, `lookupCorner`, `openTelemetryFile`, `handleLapComplete`, `reader:reset`, start/stop)

**Interfaces:**
- Consumes (da Task 3): `createAms2Reader`, `Ams2Reader`.
- Produces: terzo reader integrato; `ams2Connected` popolato; `activeGame` a 3 vie con priorità `r3e > ace > ams2`.

- [ ] **Step 1: Import del factory**

In `src/main/main.ts:35` aggiungere dopo l'import ACE:
```ts
import { createAms2Reader, type Ams2Reader } from "./ams2/ams2-reader.js";
```

- [ ] **Step 2: Ref globale del reader**

In `src/main/main.ts:86-88` aggiungere:
```ts
let mainWindow: BrowserWindow | null = null;
let r3eReaderInst: R3EReader | null = null;
let aceReaderInst: AceReader | null = null;
let ams2ReaderInst: Ams2Reader | null = null;
```

- [ ] **Step 3: Istanziazione**

In `src/main/main.ts:637-640` aggiungere:
```ts
  const r3eReader = createR3EReader();
  const aceReader = createAceReader();
  const ams2Reader = createAms2Reader();
  r3eReaderInst = r3eReader;
  aceReaderInst = aceReader;
  ams2ReaderInst = ams2Reader;
```

- [ ] **Step 4: Aggiornare la priorità `activeGame` negli handler R3E/ACE esistenti**

La priorità diventa `r3e > ace > ams2`. In `src/main/main.ts` sostituire i due handler `disconnected` esistenti perché al disconnect scelgano il gioco a priorità più alta ancora connesso.

R3E disconnected (`main.ts:648-653`):
```ts
  r3eReader.on("disconnected", () => {
    r3eConnected = false;
    if (aceConnected) activeGame = "ace";
    else if (ams2Connected) activeGame = "ams2";
    closeTelemetryFile();
    pushStatus();
  });
```

ACE disconnected (`main.ts:666-671`):
```ts
  aceReader.on("disconnected", () => {
    aceConnected = false;
    if (r3eConnected) activeGame = "r3e";
    else if (ams2Connected) activeGame = "ams2";
    closeTelemetryFile();
    pushStatus();
  });
```

- [ ] **Step 5: Handler `connected`/`disconnected` AMS2**

Aggiungere dopo l'handler ACE `disconnected` (dopo `main.ts:671`). AMS2 ha priorità più bassa: si auto-assegna solo se né R3E né ACE sono connessi. Come ACE, legge la sessione al connect via `getSessionInfo()`.
```ts
  ams2Reader.on("connected", () => {
    ams2Connected = true;
    if (!r3eConnected && !aceConnected) activeGame = "ams2";
    const info = ams2Reader.getSessionInfo();
    if (info.track) currentTrack = info.track;
    if (info.layout) currentLayout = info.layout;
    if (info.car) currentCar = info.car;
    pushStatus();
  });

  ams2Reader.on("disconnected", () => {
    ams2Connected = false;
    if (r3eConnected) activeGame = "r3e";
    else if (aceConnected) activeGame = "ace";
    closeTelemetryFile();
    pushStatus();
  });
```

- [ ] **Step 6: Handler `ams2:frame` e `ams2:fullFrame`**

Aggiungere dopo l'handler `ace:fullFrame` (dopo `main.ts:748`). Modella `ace:frame`/`ace:fullFrame`.
```ts
  ams2Reader.on("ams2:frame", (frame: GameFrame) => {
    const info = ams2Reader.getSessionInfo();
    let statusDirty = false;
    if (info.car && info.car !== currentCar) {
      currentCar = info.car;
      statusDirty = true;
    }
    if (info.track && info.track !== currentTrack) {
      currentTrack = info.track;
      statusDirty = true;
    }
    if (info.layout && info.layout !== currentLayout) {
      currentLayout = info.layout;
      statusDirty = true;
    }
    if (statusDirty) pushStatus();
    if (currentSessionId) {
      zoneTracker.update(frame);
      ruleEngine.processFrame(frame, currentLapNumber);
    }
    pushToRenderer("session:frame", frame);
  });

  ams2Reader.on("ams2:fullFrame", (frame: Record<string, unknown>) => {
    if (telemetryEnabled && activeGame === "ams2") {
      if (!telemetryStream && frame.car) {
        openTelemetryFile(
          "ams2",
          frame.car as string,
          frame.track as string,
          frame.layout as string,
        );
      }
      writeFrame(frame);
    }
  });
```

- [ ] **Step 7: Registrare `lapComplete` + `recorder.attach`**

In `src/main/main.ts:819-827` aggiungere la registrazione AMS2 accanto alle altre:
```ts
  r3eReader.on("lapComplete", (lapData) =>
    handleLapComplete(lapData as LapRecord, "r3e"),
  );
  aceReader.on("lapComplete", (lapData) =>
    handleLapComplete(lapData as LapRecord, "ace"),
  );
  ams2Reader.on("lapComplete", (lapData) =>
    handleLapComplete(lapData as LapRecord, "ams2"),
  );
```
e:
```ts
  recorder.attach(r3eReader);
  recorder.attach(aceReader);
  recorder.attach(ams2Reader);
```

- [ ] **Step 8: Generalizzare i rami `game === "ace"` per gli identificatori string**

AMS2 usa nomi string come ACE: i rami che oggi discriminano `=== "ace"` per il passthrough devono valere per "tutto ciò che non è r3e".

`resolveNames` (`main.ts:231`): sostituire
```ts
  if (game === "ace") {
```
con
```ts
  if (game !== "r3e") {
```

`lookupCorner` (`main.ts:396`): sostituire
```ts
    if (activeGame === "ace") {
      return getCornerName(db, "ace", currentTrack, currentLayout, dist);
    }
```
con
```ts
    if (activeGame !== "r3e") {
      return getCornerName(db, activeGame, currentTrack, currentLayout, dist);
    }
```

`handleLapComplete` (`main.ts:758`): sostituire
```ts
    if (game === "ace") {
```
con
```ts
    if (game !== "r3e") {
```

E la logica `aceLayoutPending` (`main.ts:797-798`) generalizzarla: sostituire
```ts
        const aceLayoutPending =
          game === "ace" && sessionRow.layout === "" && lapData.layout !== "";
```
con
```ts
        const aceLayoutPending =
          game !== "r3e" && sessionRow.layout === "" && lapData.layout !== "";
```

- [ ] **Step 9: `reader:reset` a 3 vie**

In `src/main/main.ts:917-928` sostituire il corpo dell'handler con uno switch a 3 reader:
```ts
  ipcMain.handle(
    "reader:reset",
    (_event, { game }: { game: GameSource }) => {
      const reader =
        game === "r3e" ? r3eReader : game === "ace" ? aceReader : ams2Reader;
      reader.stop();
      setTimeout(() => reader.start(), 150);
    },
  );
```

- [ ] **Step 10: Start / stop del reader**

In `src/main/main.ts:1817-1818` (before-quit) aggiungere:
```ts
    r3eReader.stop();
    aceReader.stop();
    ams2Reader.stop();
```
In `src/main/main.ts:1822-1824` (start) aggiungere:
```ts
  r3eReader.start();
  aceReader.start();
  ams2Reader.start();
```
In `src/main/main.ts:1847-1849` (window-all-closed) aggiungere:
```ts
  r3eReaderInst?.stop();
  aceReaderInst?.stop();
  ams2ReaderInst?.stop();
```

- [ ] **Step 11: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/main/main.ts
git commit -m "feat(ams2): wire third reader into main (connection-driven activeGame)"
```

---

## Task 5: IPC setup a screenshot (main + preload + tipi)

**Skill:** `electron-best-practices` (IPC) + `claude-api` (chiamata Vision). **Agente (se serve):** `voltagent-core-dev:electron-pro`.

**Files:**
- Modify: `src/main/main.ts` (2 nuovi handler IPC, dopo il blocco ACE setup `~main.ts:1765`)
- Modify: `src/preload/index.ts:153` (2 metodi, prima del `});` di chiusura)
- Modify: `src/shared/types.ts` (blocco `ElectronAPI`)

**Interfaces:**
- Produces (consumato dal picker in Task 6):
  - `window.electronAPI.listScreenshots(): Promise<Array<{ name: string; thumbnailB64: string; alreadyUsed?: { setupName: string; loadedAt: string; sessionId: number } }>>`
  - `window.electronAPI.decodeSetup(params: { filenames: string[]; expectedCar: string }): Promise<SetupData>`
  - Canali IPC: `setup:listScreenshots`, `setup:decodeSetup`.
- `SetupData` (già esistente in `types.ts`): `{ name?; carVerified; carFound; setupText; params: SetupParam[]; screenshots: string[] }`.

- [ ] **Step 1: Handler `setup:listScreenshots` + `setup:decodeSetup` in `main.ts`**

Inserire dopo l'handler `ace:listSetupTracks` (fine blocco ACE setup, `~main.ts:1792`). Rispetto alla vecchia versione (git `465e719^`): appid **1066890**, **steamid auto-rilevato**, tabella `session_setups_ams2`, modello `claude-sonnet-5`.
```ts
  // ──────────────────────────────────────────────
  // AMS2 setup decoding IPC (screenshot → Claude Vision → SetupData)
  // ──────────────────────────────────────────────

  const AMS2_STEAM_APPID = "1066890";
  const SETUP_VISION_MODEL = "claude-sonnet-5";

  /** Auto-detect the single Steam userdata account and return the AMS2 screenshots dir. */
  const getAms2ScreenshotsDir = async (): Promise<string | null> => {
    const fs = await import("fs");
    const pathMod = await import("path");
    const steamBase = "C:\\Program Files (x86)\\Steam\\userdata";
    try {
      const accounts = fs
        .readdirSync(steamBase)
        .filter((d) => /^\d+$/.test(d));
      if (accounts.length === 0) return null;
      return pathMod.join(
        steamBase,
        accounts[0],
        "760",
        "remote",
        AMS2_STEAM_APPID,
        "screenshots",
      );
    } catch {
      return null;
    }
  };

  ipcMain.handle("setup:listScreenshots", async () => {
    const fs = await import("fs");
    const pathMod = await import("path");
    const screenshotsDir = await getAms2ScreenshotsDir();
    if (!screenshotsDir) return [];
    const thumbnailsDir = pathMod.join(screenshotsDir, "thumbnails");

    // Annotate screenshots already used by a prior AMS2 setup.
    const usedMap = new Map<
      string,
      { setupName: string; loadedAt: string; sessionId: number }
    >();
    try {
      const rows = db
        .prepare(
          "SELECT id, session_id, loaded_at, setup_json, setup_screenshots FROM session_setups_ams2 WHERE setup_screenshots IS NOT NULL",
        )
        .all() as Array<{
        id: number;
        session_id: number;
        loaded_at: string;
        setup_json: string;
        setup_screenshots: string;
      }>;
      for (const row of rows) {
        let filenames: string[] = [];
        try {
          filenames = JSON.parse(row.setup_screenshots);
        } catch {
          continue;
        }
        let setupName = "";
        try {
          setupName = (JSON.parse(row.setup_json) as { name?: string }).name ?? "";
        } catch {
          /* ignore */
        }
        for (const fname of filenames) {
          if (!usedMap.has(fname)) {
            usedMap.set(fname, {
              setupName,
              loadedAt: row.loaded_at,
              sessionId: row.session_id,
            });
          }
        }
      }
    } catch {
      /* table missing / not ready — no annotations */
    }

    try {
      const files = fs
        .readdirSync(screenshotsDir)
        .filter((f: string) => /\.(jpg|jpeg|png)$/i.test(f))
        .sort()
        .reverse();
      return files.map((name: string) => {
        const thumbPath = pathMod.join(thumbnailsDir, name);
        const fullPath = pathMod.join(screenshotsDir, name);
        const src = fs.existsSync(thumbPath) ? thumbPath : fullPath;
        const thumbnailB64 = fs.readFileSync(src).toString("base64");
        const alreadyUsed = usedMap.get(name);
        return { name, thumbnailB64, ...(alreadyUsed ? { alreadyUsed } : {}) };
      });
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "setup:decodeSetup",
    async (
      _event,
      { filenames, expectedCar }: { filenames: string[]; expectedCar: string },
    ) => {
      const fs = await import("fs");
      const pathMod = await import("path");
      const screenshotsDir = await getAms2ScreenshotsDir();
      if (!screenshotsDir) throw new Error("Cartella screenshot AMS2 non trovata");

      const apiKey = getAnthropicApiKey();
      if (!apiKey) throw new Error("Anthropic API Key non configurata");

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey });

      const imageContents = filenames.map((name) => {
        const fullPath = pathMod.join(screenshotsDir, name);
        const data = fs.readFileSync(fullPath).toString("base64");
        return {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: "image/jpeg" as const,
            data,
          },
        };
      });

      const systemPrompt = `Sei un esperto di setup per il simulatore di guida Automobilista 2 (AMS2).
Analizza le schermate del setup dell'auto e restituisci un JSON con questa struttura esatta:
{
  "carVerified": boolean,
  "carFound": "nome auto trovato nelle schermate",
  "setupText": "riepilogo markdown del setup",
  "params": [
    { "category": "categoria", "parameter": "nome parametro", "value": "valore" }
  ]
}
Devi verificare se l'auto nelle schermate corrisponde a: "${expectedCar}".
Estrai TUTTI i parametri di setup visibili: sospensioni, freni, aerodinamica, trasmissione, gomme, differenziale, elettronica, ecc.
IMPORTANTE — precisione numerica: leggi ogni cifra di ogni valore con la massima attenzione. Gli slider e altri elementi grafici dell'UI possono apparire adiacenti ai numeri: ignorali e trascrivi solo le cifre del testo numerico visualizzato sullo schermo.
Restituisci solo il JSON, senza testo aggiuntivo.`;

      const response = await client.messages.create({
        model: SETUP_VISION_MODEL,
        max_tokens: 4000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              ...imageContents,
              {
                type: "text" as const,
                text: `Analizza queste ${filenames.length} schermate del setup e restituisci il JSON.`,
              },
            ],
          },
        ],
      });

      const raw =
        response.content[0].type === "text" ? response.content[0].text : "{}";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

      return {
        carVerified: parsed.carVerified ?? false,
        carFound: parsed.carFound ?? "",
        setupText: parsed.setupText ?? "",
        params: parsed.params ?? [],
        screenshots: filenames,
      } as SetupData;
    },
  );
```

- [ ] **Step 2: Metodi preload**

In `src/preload/index.ts`, prima del `});` di chiusura (`index.ts:156`), aggiungere:
```ts
  // AMS2 setup analysis (screenshot → Claude Vision → SetupData)
  listScreenshots: () => ipcRenderer.invoke("setup:listScreenshots"),
  decodeSetup: (params: { filenames: string[]; expectedCar: string }) =>
    ipcRenderer.invoke("setup:decodeSetup", params),
```

- [ ] **Step 3: Tipi `ElectronAPI`**

In `src/shared/types.ts`, nel blocco `ElectronAPI` accanto ai metodi ACE setup (`aceListSetupCars`…), aggiungere:
```ts
  listScreenshots: () => Promise<
    Array<{
      name: string;
      thumbnailB64: string;
      alreadyUsed?: { setupName: string; loadedAt: string; sessionId: number };
    }>
  >;
  decodeSetup: (params: {
    filenames: string[];
    expectedCar: string;
  }) => Promise<SetupData>;
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/main.ts src/preload/index.ts src/shared/types.ts
git commit -m "feat(ams2): screenshot setup IPC (Claude Vision, sonnet-5, steamid auto-detect)"
```

---

## Task 6: Componente `Ams2SetupPicker.tsx`

**Skill:** `react-vite-best-practices`. **Agente (se serve):** `voltagent-lang:react-specialist`.

**Files:**
- Create: `src/renderer/components/Ams2SetupPicker.tsx`
- Reference: `git show 465e719^:src/renderer/components/ScreenshotPicker.tsx` (base), `src/renderer/components/AceSetupPicker.tsx` (prop shape corrente)

**Interfaces:**
- Consumes: `window.electronAPI.listScreenshots()`, `window.electronAPI.decodeSetup(...)` (da Task 5); `SetupData` da `../../shared/types`.
- Produces (consumato da Task 7): componente con props `{ show: boolean; expectedCar: string; onClose: () => void; onConfirm: (setup: SetupData) => void }` — **stessa shape** di `R3eSetupPicker`/`AceSetupPicker`. Export **named** `export const Ams2SetupPicker`.

- [ ] **Step 1: Creare `Ams2SetupPicker.tsx`**

Adattato dal vecchio `ScreenshotPicker.tsx` (fasi pick → confirm-duplicates → decoding → verify). Differenze rispetto all'originale: **named export** e arrow-function component (preferenze utente); import di tipo con `import type`; riuso classi CSS `screenshot-picker-modal`/`picker-*` (già presenti in `global.css`).
```tsx
/**
 * Ams2SetupPicker — modal to select Steam screenshots (AMS2) for setup decoding.
 * Shows thumbnails, multi-select, then Claude Vision decode. Warns on already-used shots.
 */

import {
  faArrowLeft,
  faCheck,
  faCircleNotch,
  faExclamationTriangle,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Form, Modal, Spinner } from "react-bootstrap";
import type { SetupData } from "../../shared/types";

type AlreadyUsedInfo = {
  setupName: string;
  loadedAt: string;
  sessionId: number;
};
type ScreenshotEntry = {
  name: string;
  thumbnailB64: string;
  alreadyUsed?: AlreadyUsedInfo;
};

type Props = {
  show: boolean;
  expectedCar: string;
  onClose: () => void;
  onConfirm: (setup: SetupData) => void;
};

type Phase = "pick" | "confirm-duplicates" | "decoding" | "verify";

export const Ams2SetupPicker = ({
  show,
  expectedCar,
  onClose,
  onConfirm,
}: Props) => {
  const [screenshots, setScreenshots] = useState<ScreenshotEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("pick");
  const [decodedSetup, setDecodedSetup] = useState<SetupData | null>(null);
  const [setupName, setSetupName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!show || loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    window.electronAPI
      .listScreenshots()
      .then((list) => {
        setScreenshots(list);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [show]);

  const toggle = (name: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const screenshotMap = new Map(screenshots.map((s) => [s.name, s]));
  const selectedDuplicates = Array.from(selected).filter(
    (name) => screenshotMap.get(name)?.alreadyUsed !== undefined,
  );

  const startDecode = async (): Promise<void> => {
    setPhase("decoding");
    setError(null);
    try {
      const result = await window.electronAPI.decodeSetup({
        filenames: Array.from(selected),
        expectedCar,
      });
      setDecodedSetup(result);
      setPhase("verify");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore durante il decoding");
      setPhase("pick");
    }
  };

  const handleDecodeRequest = (): void => {
    if (selected.size === 0) return;
    if (selectedDuplicates.length > 0) setPhase("confirm-duplicates");
    else void startDecode();
  };

  const handleConfirm = (): void => {
    if (decodedSetup && setupName.trim()) {
      onConfirm({ ...decodedSetup, name: setupName.trim() });
    }
  };

  const handleClose = (): void => {
    setPhase("pick");
    setSelected(new Set());
    setDecodedSetup(null);
    setSetupName("");
    setError(null);
    onClose();
  };

  const formatDate = (iso: string): string => {
    try {
      return new Date(iso).toLocaleDateString("it-IT", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  };

  return (
    <Modal
      show={show}
      onHide={handleClose}
      size="xl"
      className="screenshot-picker-modal"
    >
      <Modal.Header className="picker-header">
        <Modal.Title className="picker-title">
          Seleziona screenshot setup
          <span className="picker-subtitle"> · {expectedCar}</span>
        </Modal.Title>
        <Button variant="link" className="picker-close" onClick={handleClose}>
          <FontAwesomeIcon icon={faXmark} />
        </Button>
      </Modal.Header>

      <Modal.Body className="picker-body">
        {phase === "pick" && (
          <>
            {error && <div className="picker-error mb-3">{error}</div>}
            {loading ? (
              <div className="picker-loading">
                <Spinner size="sm" variant="danger" /> Caricamento screenshot...
              </div>
            ) : screenshots.length === 0 ? (
              <p className="text-secondary">
                Nessuno screenshot trovato nella cartella Steam di AMS2. Cattura
                le schermate del setup in-game con F12.
              </p>
            ) : (
              <div className="picker-grid">
                {screenshots.map((s) => (
                  <div
                    key={s.name}
                    className={`picker-thumb ${selected.has(s.name) ? "selected" : ""} ${s.alreadyUsed ? "already-used" : ""}`}
                    onClick={() => toggle(s.name)}
                    title={
                      s.alreadyUsed
                        ? `Già usato nel setup "${s.alreadyUsed.setupName || "senza nome"}" (${formatDate(s.alreadyUsed.loadedAt)})`
                        : undefined
                    }
                  >
                    <img
                      src={`data:image/jpeg;base64,${s.thumbnailB64}`}
                      alt={s.name}
                      className="picker-img"
                    />
                    {selected.has(s.name) && (
                      <div className="picker-check">
                        <FontAwesomeIcon icon={faCheck} />
                      </div>
                    )}
                    {s.alreadyUsed && (
                      <div className="picker-used-badge">
                        <FontAwesomeIcon
                          icon={faExclamationTriangle}
                          className="me-1"
                        />
                        Già scansionato
                      </div>
                    )}
                    <div className="picker-name">
                      {s.name.replace(/_1\.jpg$/, "")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {phase === "confirm-duplicates" && (
          <div className="picker-confirm">
            <div className="picker-confirm-icon">
              <FontAwesomeIcon icon={faExclamationTriangle} />
            </div>
            <h6 className="picker-confirm-title">Screenshot già scansionati</h6>
            <p className="picker-confirm-text">
              {selectedDuplicates.length === 1
                ? "1 screenshot selezionato è già presente in un setup precedente:"
                : `${selectedDuplicates.length} screenshot selezionati sono già presenti in setup precedenti:`}
            </p>
            <ul className="picker-confirm-list">
              {selectedDuplicates.map((name) => {
                const info = screenshotMap.get(name)!.alreadyUsed!;
                return (
                  <li key={name}>
                    <span className="picker-confirm-filename">
                      {name.replace(/_1\.jpg$/, "")}
                    </span>
                    {" — "}
                    <span className="text-dim">
                      setup "{info.setupName || "senza nome"}" del{" "}
                      {formatDate(info.loadedAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="picker-confirm-question">
              Vuoi procedere comunque con il decode?
            </p>
          </div>
        )}

        {phase === "decoding" && (
          <div className="picker-loading">
            <FontAwesomeIcon icon={faCircleNotch} spin />
            <span>Analisi setup in corso con Claude Vision...</span>
          </div>
        )}

        {phase === "verify" && decodedSetup && (
          <div className="picker-verify">
            <div className="picker-car-check mb-3">
              {decodedSetup.carVerified ? (
                <Badge bg="success">
                  <FontAwesomeIcon icon={faCheck} className="me-1" />
                  Auto verificata: {decodedSetup.carFound}
                </Badge>
              ) : (
                <Badge bg="warning" text="dark">
                  Attenzione: auto rilevata "{decodedSetup.carFound}" — potrebbe
                  non corrispondere a "{expectedCar}"
                </Badge>
              )}
            </div>

            <Form.Group className="mb-3" style={{ maxWidth: 360 }}>
              <Form.Label className="text-dim" style={{ fontSize: 13 }}>
                Nome setup <span className="text-danger">*</span>
              </Form.Label>
              <Form.Control
                size="sm"
                type="text"
                placeholder="es. Qualifica Interlagos baseline"
                value={setupName}
                onChange={(e) => setSetupName(e.target.value)}
                autoFocus
              />
            </Form.Group>

            {decodedSetup.params.length > 0 && (
              <div className="picker-params">
                <table className="setup-table w-100">
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th>Parametro</th>
                      <th>Valore</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decodedSetup.params.map((p, i) => (
                      <tr key={i}>
                        <td className="text-dim">{p.category}</td>
                        <td>{p.parameter}</td>
                        <td className="setup-value">{p.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal.Body>

      <Modal.Footer className="picker-footer">
        {phase === "pick" && (
          <>
            <span className="text-secondary me-auto">
              {selected.size > 0
                ? `${selected.size} screenshot selezionati${selectedDuplicates.length > 0 ? ` (${selectedDuplicates.length} già scansionati)` : ""}`
                : "Seleziona le schermate del setup"}
            </span>
            <Button variant="secondary" size="sm" onClick={handleClose}>
              Annulla
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={selected.size === 0}
              onClick={handleDecodeRequest}
            >
              Decodifica setup
            </Button>
          </>
        )}

        {phase === "confirm-duplicates" && (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPhase("pick")}
            >
              <FontAwesomeIcon icon={faArrowLeft} className="me-1" />
              Torna alla selezione
            </Button>
            <Button variant="danger" size="sm" onClick={() => void startDecode()}>
              Procedi comunque
            </Button>
          </>
        )}

        {phase === "verify" && decodedSetup && (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPhase("pick");
                setSetupName("");
              }}
            >
              <FontAwesomeIcon icon={faArrowLeft} className="me-1" />
              Riseleziona
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!setupName.trim()}
              onClick={handleConfirm}
            >
              <FontAwesomeIcon icon={faCheck} className="me-1" />
              Salva setup
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
};
```

- [ ] **Step 2: Verificare che le classi CSS `picker-*` esistano**

Run: `npx rg -n "screenshot-picker-modal|picker-grid|picker-confirm-list" src/renderer`
Expected: match in `global.css` (le classi sono rimaste dopo la migrazione a `R3eSetupPicker`). Se `picker-confirm-list`/`picker-confirm-icon`/`picker-confirm-title` mancano, aggiungerle in `global.css` riusando le variabili dark theme (`--bg2`, `--border`, `--text-dim`).

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/Ams2SetupPicker.tsx src/renderer/global.css
git commit -m "feat(ams2): Ams2SetupPicker (screenshot → Vision decode)"
```

---

## Task 7: Wiring renderer (picker, storico, status, mock)

**Skill:** `react-vite-best-practices`. **Agente (se serve):** `voltagent-lang:react-specialist`.

**Files:**
- Modify: `src/renderer/components/SessionPanel.tsx` (branch picker a 3 vie)
- Modify: `src/renderer/components/SessionHistory.tsx` (filtro + badge Sim)
- Modify: `src/renderer/components/StatusBar.tsx` (terzo badge)
- Modify: `src/renderer/mocks/mockData.ts` (sessione mock AMS2)
- Modify: `src/renderer/components/SettingsPanel.tsx` (testo mock)

**Interfaces:**
- Consumes: `Ams2SetupPicker` (Task 6); `GameStatus.ams2Connected` (Task 1).

- [ ] **Step 1: Import + branch picker in `SessionPanel.tsx`**

Aggiungere l'import (`SessionPanel.tsx:6-11`, in ordine alfabetico con gli altri picker):
```tsx
import { Ams2SetupPicker } from "./Ams2SetupPicker";
```
Sostituire il branch picker (`SessionPanel.tsx:166-181`) con la versione a 3 vie:
```tsx
      {/* Setup pickers */}
      {game === "ace" ? (
        <AceSetupPicker
          show={showPicker}
          expectedCar={currentCar}
          expectedTrack={currentTrack}
          onClose={() => setShowPicker(false)}
          onConfirm={handleSetupConfirm}
        />
      ) : game === "ams2" ? (
        <Ams2SetupPicker
          show={showPicker}
          expectedCar={currentCar}
          onClose={() => setShowPicker(false)}
          onConfirm={handleSetupConfirm}
        />
      ) : (
        <R3eSetupPicker
          show={showPicker}
          expectedCar={currentCar}
          onClose={() => setShowPicker(false)}
          onConfirm={handleSetupConfirm}
        />
      )}
```
Nota: il flusso R3E-only `showSetupSelection` (`SessionPanel.tsx:62` e `:119-123`) resta su `=== "r3e"` — AMS2 apre direttamente il picker a screenshot come ACE (nessun cambiamento necessario lì, poiché il ramo `else` di `onOpenPicker` già apre `setShowPicker(true)` per tutti i non-r3e).

- [ ] **Step 2: Filtro + badge Sim in `SessionHistory.tsx`**

Aggiungere l'opzione al filtro (dopo `SessionHistory.tsx:227`, `<option value="ace">AC Evo</option>`):
```tsx
          <option value="ams2">Automobilista 2</option>
```
Sostituire il badge Sim (`SessionHistory.tsx:312-318`) con la versione a 3 vie:
```tsx
                  <td>
                    <Badge
                      bg={
                        s.game === "ace"
                          ? "info"
                          : s.game === "ams2"
                            ? "primary"
                            : "secondary"
                      }
                      style={{ fontSize: 12 }}
                    >
                      {s.game === "ace"
                        ? "ACE"
                        : s.game === "ams2"
                          ? "AMS2"
                          : "R3E"}
                    </Badge>
```
(Il blocco `s.id < 0` per il badge "mock" che segue resta invariato.)

- [ ] **Step 3: Terzo badge connessione in `StatusBar.tsx`**

Dopo il badge ACE (`StatusBar.tsx:59`), aggiungere il badge AMS2 (stesso pattern, `status.ams2Connected`, `onResetReader?.("ams2")`, classe `status-badge ms-1`):
```tsx
        {status.ams2Connected ? (
          <Button
            variant="success"
            size="sm"
            className="status-badge ms-1"
            title="Forza riconnessione AMS2"
            onClick={() => onResetReader?.("ams2")}
          >
            AMS2 connesso
          </Button>
        ) : (
          <Badge bg="secondary" className="status-badge ms-1">
            AMS2 disconnesso
          </Badge>
        )}
```

- [ ] **Step 4: Sessione mock AMS2 in `mockData.ts`**

Aggiungere in `src/renderer/mocks/mockData.ts`:
1. Una analisi `ANALYSIS_AMS2` sul modello di `ANALYSIS_ACE` (stesso shape `SessionAnalysisRow` con `template_v3`, `section5_summary`, `created_at`, `comments: []`).
2. Una terza `SessionRow` in `MOCK_SESSIONS` (id `-3`):
```ts
  {
    id: -3,
    game: "ams2",
    car: "formula_ultimate_gen2",
    track: "Interlagos",
    layout: "Grand Prix",
    session_type: "Practice",
    started_at: "2026-04-17 18:00:00",
    ended_at: "2026-04-17 18:40:00",
    best_lap: 71.234,
    lap_count: 3,
    car_name: "Formula Ultimate Gen2",
    car_class_name: "Formula",
    track_name: "Interlagos",
    layout_name: "Grand Prix",
  },
```
3. `MOCK_LAPS_AMS2` (3 giri, id `-301..-303`, `setup_id: null`, `zones_json: null`) sul modello di `MOCK_LAPS_ACE`.
4. La chiave `[-3]` in `MOCK_DETAILS`:
```ts
  [-3]: {
    session: MOCK_SESSIONS[2],
    laps: MOCK_LAPS_AMS2,
    setups: [],
    analyses: [ANALYSIS_AMS2],
  },
```

- [ ] **Step 5: Testo descrittivo mock in `SettingsPanel.tsx`**

Aggiornare i testi in `SettingsPanel.tsx:816` e `:824-825` per menzionare 3 sessioni (R3E + ACE + AMS2). Esempio per `:816`:
```tsx
              3 sessioni mock visibili nello storico (R3E + ACE + AMS2, 3 giri
              ciascuna)
```
e `:824-825`:
```tsx
              una sessione R3E (BMW M4 GT3 - Nürburgring), una ACE (Porsche 718
              GT4 - Monza) e una AMS2 (Formula Ultimate - Interlagos)
```

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/SessionPanel.tsx src/renderer/components/SessionHistory.tsx src/renderer/components/StatusBar.tsx src/renderer/mocks/mockData.ts src/renderer/components/SettingsPanel.tsx
git commit -m "feat(ams2): renderer wiring (picker branch, history filter/badge, status badge, mock)"
```

---

## Task 8: Verifica end-to-end (mock + checklist offset empirici)

**Skill:** `superpowers:verification-before-completion`.

**Files:** nessuno (solo verifica).

- [ ] **Step 1: Typecheck + lint puliti su tutto**

Run: `npm run typecheck && npm run lint`
Expected: PASS, 0 errori/warning.

- [ ] **Step 2: Self-check struct ancora verde**

Run: `npx ts-node --esm --project tsconfig.node.json src/main/ams2/ams2-struct.selfcheck.ts`
Expected: `ams2-struct self-check OK`.

- [ ] **Step 3: Mock mode — sessione AMS2 nello storico**

Run: `npm run dev`
Nel'app: Settings → attivare `mockHistoryMode`. Aprire lo storico sessioni.
Expected:
- Compare la riga AMS2 (badge "AMS2", auto "Formula Ultimate Gen2", pista "Interlagos", 3 giri, badge "mock").
- Il filtro "Sim" ha l'opzione "Automobilista 2" e filtra correttamente.
- Click sulla riga → `SessionDetail` mostra i 3 giri mock + l'analisi `ANALYSIS_AMS2` (markdown Template v3 renderizzato).
- La StatusBar mostra il badge "AMS2 disconnesso" (nessun gioco attivo su non-Windows/mock).

- [ ] **Step 4: Checklist validazione offset empirica (da eseguire su Windows con AMS2 in pista)**

Documentare (in PR description o commit) la checklist di prima connessione:
1. Avviare AMS2, entrare in pista (una qualsiasi vettura/circuito).
2. Con l'app avviata, osservare il log `[AMS2] connected: mVersion=14 ... speed=... car="..." track="..."`.
3. Verificare: `mVersion === 14`; `speed` plausibile (km/h coerente con l'HUD); `car`/`track` leggibili e corretti; `lapDistance` che cresce lungo il giro e si azzera al traguardo.
4. Se i valori sono a zero/spazzatura → mismatch offset: confrontare con `SharedMemory.h` e la §Struct Offset Debugging del CLAUDE.md (probabile differenza di `PARTICIPANT_SIZE` o padding). Aggiornare `OFF`/`PART` e ri-eseguire il self-check.
5. Completare un giro → verificare che `lapComplete` produca un giro nella `LapsTable` con `lapTime` corretto e `sectorTimes` plausibili.

- [ ] **Step 5: Aggiornare CLAUDE.md**

Aggiornare `CLAUDE.md` per riflettere il supporto AMS2 (Project Overview "tre simulatori", sezione `ace/` → aggiungere `ams2/`, Database Schema → tabelle `*_ams2`, Key Design Decisions → data source AMS2 + setup screenshot). Correggere le due affermazioni stale su `activeGame` (righe ~80 e ~160): `activeGame` è connection-driven nel main, non un config/selettore.

- [ ] **Step 6: Commit finale**

```bash
git add CLAUDE.md
git commit -m "docs(ams2): document AMS2 support in CLAUDE.md"
```

---

## Self-Review

**Spec coverage** (spec §Architettura 1-5 + Flusso + Verifica):
- §1 Tipo cardine + schema DB → Task 1 (GameSource, tabelle `*_ams2`, migration, fix 5 ternari + `t()`). ✓ Include il "bug latente" della spec §1.
- §2 Reader `ams2-struct.ts` + `ams2-reader.ts` → Task 2 + Task 3 (offset reali da header, seq-number read, mock, eventi, lapComplete via `mLapsCompleted`, speed ×3.6, `tcActive` euristica documentata, `absActive` da `mAntiLockActive`, brakeTemps da `mBrakeTempCelsius`). ✓
- §3 Wiring main → Task 4 (3° reader, handler, `resolveNames` identità, `readerReset` esteso, priorità). ✓
- §4 Setup screenshot → Task 5 (IPC `setup:listScreenshots`/`setup:decodeSetup`, appid 1066890, steamid auto, `session_setups_ams2`, `claude-sonnet-5`) + Task 6 (`Ams2SetupPicker`) + Task 7 (branch picker). ✓
- §5 Renderer → Task 7 (SessionHistory, StatusBar, mockData). **Deviazione documentata**: nessun selettore `activeGame` in SettingsPanel (connection-driven, confermato dall'utente) — spec §5 e CLAUDE.md corretti in Task 8.
- §Verifica → Task 2 (self-check), Task 8 (typecheck/lint, mock, checklist offset). ✓
- §Fuori scope: rispettato (no decode `.vts`, no screenshot per R3E/ACE, solo player osservato, no campi extra DRS/ERS/meteo).

**Placeholder scan:** nessun "TBD"/"add error handling"/"similar to Task N"; ogni step di codice contiene codice completo. Offset struct = valori reali calcolati.

**Type consistency:** `Ams2Reader`/`Ams2SessionInfo` (Task 3) usati in Task 4; `OFF`/`PART`/`participantOffset`/helper (Task 2) usati in Task 3 e nel self-check; props `{ show, expectedCar, onClose, onConfirm }` di `Ams2SetupPicker` (Task 6) coerenti col branch in Task 7; canali `setup:listScreenshots`/`setup:decodeSetup` (Task 5) coerenti tra main/preload/tipi/picker; `ams2Connected` (Task 1) usato in `pushStatus` (Task 1) e `StatusBar` (Task 7).

**Rischio noto (dalla spec):** gli offset struct vanno validati empiricamente (Task 8 Step 4); `tcActive` è un'euristica documentata (`ponytail:` nel reader). `AMS2_STRUCT_SIZE = 20700` calcolato — se AMS2 aggiorna la struct (nuova versione), rivalidare.
