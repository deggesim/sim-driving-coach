/**
 * Runnable self-check for computeSessionStats (assert-only, no framework).
 *
 * Run it (with every other self-check) via:
 *
 *   npm run selfcheck
 *
 * `npx ts-node --esm` is broken in this environment, and passing `--types node`
 * to tsc fails with TS2688 because @types/node is not a declared dependency
 * (only transitive, via electron-vite) — hence tsconfig.selfcheck.json.
 */
import assert from "node:assert/strict";
import { computeSessionStats } from "./session-stats.js";
import type { Alert, LapRow, ZoneData } from "../../shared/types.js";

const mkLap = (
  lap_number: number,
  lap_time: number,
  zones: ZoneData[],
  extra: Partial<LapRow> = {},
): LapRow => ({
  id: lap_number,
  session_id: 1,
  setup_id: null,
  lap_number,
  lap_time,
  sector1: 1,
  sector2: 1,
  sector3: 1,
  valid: true,
  zones_json: JSON.stringify(zones),
  recorded_at: "2026-07-26T00:00:00.000Z",
  ...extra,
});

const zone = (z: number, over: Partial<ZoneData> = {}): ZoneData => ({
  zone: z,
  dist: z * 50,
  avgSpeedKmh: 100,
  minSpeedKmh: 80,
  maxBrakePct: 0.5,
  avgThrottlePct: 0.5,
  maxSteerAbs: 0.2,
  steerDuringBrake: 0.1,
  brakeFrames: 10,
  throttleFrames: 10,
  coastFrames: 0,
  overlapFrames: 3,
  tcActivations: 1,
  absActivations: 0,
  tcActiveFrames: 4,
  absActiveFrames: 0,
  brakeStartDist: null,
  brakeEndDist: null,
  throttlePickupDist: null,
  ...over,
});

const alert = (z: number, type: string): Alert => ({
  type: type as Alert["type"],
  priority: 3,
  zone: z,
  dist: z * 50,
  lap: 2,
  message: "x",
  immediate: false,
  timestamp: 0,
});

// --- Deltas / gap / trend on a clean monotonic-improving 3-lap set ---
const improving = computeSessionStats({
  laps: [
    mkLap(1, 120, [zone(8)]),
    mkLap(2, 118, [zone(8)]),
    mkLap(3, 116, [zone(8)]),
  ],
  bestLap: 116,
  setups: [],
  alerts: [alert(8, "LATE_BRAKE"), alert(8, "LATE_BRAKE")],
  cornerNames: new Map([[8, "Curva 8"]]),
});

assert.equal(improving.lapCount, 3);
assert.equal(improving.laps[0].deltaPrevSec, null);
assert.equal(improving.laps[1].deltaPrevSec, -2);
assert.equal(improving.laps[2].deltaBestSec, 0);
assert.ok(Math.abs(improving.laps[0].gapToBestPct - (4 / 116) * 100) < 1e-9);
assert.equal(improving.trend, "improving");

// --- criticalCorners sorted desc by alertCount + aggregation from zones ---
const ranked = computeSessionStats({
  laps: [mkLap(1, 100, [zone(8), zone(15)]), mkLap(2, 100, [zone(8), zone(15)])],
  bestLap: 100,
  setups: [],
  alerts: [
    alert(15, "SLOW_THROTTLE"),
    alert(8, "LATE_BRAKE"),
    alert(8, "LATE_BRAKE"),
  ],
  cornerNames: new Map([[8, "Curva 8"]]),
});
assert.equal(ranked.criticalCorners[0].zone, 8);
assert.equal(ranked.criticalCorners[0].alertCount, 2);
assert.equal(ranked.criticalCorners[0].cornerName, "Curva 8");
assert.equal(ranked.criticalCorners[1].zone, 15);
assert.equal(ranked.criticalCorners[1].cornerName, null);
// zone 8 seen on 2 laps: tcEvents = 1+1, tcMs = (4+4)*16, overlapMs = (3+3)*16
assert.equal(ranked.criticalCorners[0].tcEvents, 2);
assert.equal(ranked.criticalCorners[0].tcMs, 128);
assert.equal(ranked.criticalCorners[0].overlapMs, 96);

// --- flat trend ---
const flat = computeSessionStats({
  laps: [mkLap(1, 100, []), mkLap(2, 100.01, [])],
  bestLap: 100,
  setups: [],
  alerts: [],
  cornerNames: new Map(),
});
assert.equal(flat.trend, "flat");
assert.equal(flat.criticalCorners.length, 0);

console.log("session-stats.selfcheck OK");
