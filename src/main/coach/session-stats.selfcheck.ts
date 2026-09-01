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
  laps: [
    mkLap(1, 100, [zone(8), zone(15)]),
    mkLap(2, 100, [zone(8), zone(15)]),
  ],
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

// --- Extended channels: peaks max'd, averages divided by contributing laps ---
const ext = computeSessionStats({
  laps: [
    mkLap(1, 100, [
      zone(8, {
        maxGLat: 1.2,
        avgTyrePressure: [27, 27, 26, 26],
        avgSlipRatio: [0.02, 0.02, 0.1, 0.1],
        avgSuspTravel: [0.03, 0.03, 0.04, 0.04],
        avgTyreTempC: [88, 88, 84, 84],
      }),
    ]),
    mkLap(2, 100, [
      zone(8, {
        maxGLat: 1.8,
        avgTyrePressure: [29, 29, 28, 28],
        avgSlipRatio: [0.04, 0.04, 0.2, 0.2],
        avgSuspTravel: [0.05, 0.05, 0.06, 0.06],
        avgTyreTempC: [90, 90, 86, 86],
      }),
    ]),
  ],
  bestLap: 100,
  setups: [],
  alerts: [alert(8, "LATE_BRAKE")],
  cornerNames: new Map(),
});

const closeQuartet = (
  got: [number, number, number, number] | null,
  want: [number, number, number, number],
  msg: string,
): void => {
  assert.ok(got, msg);
  got.forEach((v, i) =>
    assert.ok(Math.abs(v - want[i]) < 1e-9, `${msg} [${i}]: ${v}`),
  );
};

const c8 = ext.criticalCorners[0];
assert.equal(c8.maxGLat, 1.8, "peak G is the max across laps");
assert.equal(c8.maxGLon, null, "a channel no lap carried stays null");
assert.equal(c8.maxSteerAbs, 0.2);
assert.ok(Math.abs(c8.steerDuringBrake - 0.1) < 1e-9, "steer averaged");
closeQuartet(c8.avgTyrePressure, [28, 28, 27, 27], "pressure averaged");
closeQuartet(c8.avgSlipRatio, [0.03, 0.03, 0.15, 0.15], "slip averaged");
closeQuartet(c8.avgSuspTravel, [0.04, 0.04, 0.05, 0.05], "travel averaged");
closeQuartet(c8.avgTyreTempC, [89, 89, 85, 85], "tyre temps averaged");

// Defense in depth: lap-recorder now omits a channel it has no frames for, but
// a genuinely all-zero quartet (stationary car, or an older lap recorded before
// that fix) must still not surface as a measurement.
const zeros = computeSessionStats({
  laps: [
    mkLap(1, 100, [
      zone(8, {
        avgRpm: 6500,
        avgTyrePressure: [0, 0, 0, 0],
        avgSlipRatio: [0, 0, 0, 0],
        avgSuspTravel: [0, 0, 0, 0],
      }),
    ]),
  ],
  bestLap: 100,
  setups: [],
  alerts: [alert(8, "LATE_BRAKE")],
  cornerNames: new Map(),
});
assert.equal(
  zeros.criticalCorners[0].avgTyrePressure,
  null,
  "all-zero omitted",
);
assert.equal(zeros.criticalCorners[0].avgSlipRatio, null);
assert.equal(zeros.criticalCorners[0].avgSuspTravel, null);
assert.equal(zeros.criticalCorners[0].avgTyreTempC, null);

// Per-channel lap counts: a channel only one of the two laps carried is averaged
// over that one lap, not halved by the lap that lacked it. AMS2 supplies
// pressures without slip ratio, so a shared counter would skew both.
const partial = computeSessionStats({
  laps: [
    mkLap(1, 100, [
      zone(8, {
        avgTyrePressure: [27, 27, 26, 26],
        avgSlipRatio: [0.1, 0.1, 0.2, 0.2],
      }),
    ]),
    mkLap(2, 100, [zone(8, { avgTyrePressure: [29, 29, 28, 28] })]),
  ],
  bestLap: 100,
  setups: [],
  alerts: [alert(8, "LATE_BRAKE")],
  cornerNames: new Map(),
});
closeQuartet(
  partial.criticalCorners[0].avgTyrePressure,
  [28, 28, 27, 27],
  "pressure over both laps",
);
closeQuartet(
  partial.criticalCorners[0].avgSlipRatio,
  [0.1, 0.1, 0.2, 0.2],
  "slip over the single lap that carried it",
);

// Ambient conditions: averaged across every zone of every lap, session-wide
// (not per-corner - the value barely changes within a session).
const conditions = computeSessionStats({
  laps: [
    mkLap(1, 100, [
      zone(8, { avgAirTempC: 20, avgRoadTempC: 26 }),
      zone(9, { avgAirTempC: 22 }),
    ]),
    mkLap(2, 100, [zone(8, { avgAirTempC: 24, avgRoadTempC: 30 })]),
  ],
  bestLap: 100,
  setups: [],
  alerts: [],
  cornerNames: new Map(),
});
assert.ok(
  Math.abs(conditions.avgAirTempC! - 22) < 1e-9,
  "air temp averaged across all zones/laps",
);
assert.ok(
  Math.abs(conditions.avgRoadTempC! - 28) < 1e-9,
  "road temp averaged only over the zones that carried it",
);
assert.equal(flat.avgAirTempC, null, "no channel data ⇒ null, not 0");

// Weather (AMS2 only): same session-wide averaging as temperature.
const weather = computeSessionStats({
  laps: [
    mkLap(1, 100, [zone(8, { avgRainDensity: 0.2, avgWindSpeed: 4 })]),
    mkLap(2, 100, [
      zone(8, {
        avgRainDensity: 0.4,
        avgWindSpeed: 6,
        avgCloudBrightness: 0.5,
      }),
    ]),
  ],
  bestLap: 100,
  setups: [],
  alerts: [],
  cornerNames: new Map(),
});
assert.ok(
  Math.abs(weather.avgRainDensity! - 0.3) < 1e-9,
  "rain density averaged across zones/laps",
);
assert.ok(
  Math.abs(weather.avgWindSpeed! - 5) < 1e-9,
  "wind speed averaged across zones/laps",
);
assert.ok(
  Math.abs(weather.avgCloudBrightness! - 0.5) < 1e-9,
  "cloud brightness averaged only over the zone that carried it",
);
assert.equal(flat.avgRainDensity, null, "no weather data ⇒ null, not 0");

// Setup-diagnostic asymmetries: session-wide across every zone, including one
// with no alert at all (zone 9 here never appears in `alerts`), and epsilon-
// gated to null below the noise floor.
const asym = computeSessionStats({
  laps: [
    mkLap(1, 100, [
      zone(8, { avgSuspTravel: [0.03, 0.026, 0.04, 0.04] }), // front Δ4mm
      zone(9, {
        avgSlipRatioThrottle: [0.05, 0.08, 0.1, 0.1], // front Δ-0.03 in trazione
        avgSlipRatioRelease: [0.02, 0.021, 0.06, 0.09], // rear Δ-0.03 in rilascio
      }),
    ]),
  ],
  bestLap: 100,
  setups: [],
  alerts: [alert(8, "LATE_BRAKE")], // zone 9 carries no alert
  cornerNames: new Map(),
});
assert.ok(
  Math.abs(asym.suspAsymFrontMm! - 4) < 1e-6,
  "front susp asymmetry above noise floor",
);
assert.equal(asym.suspAsymRearMm, null, "rear travel identical ⇒ null");
assert.ok(
  Math.abs(asym.slipAsymFrontThrottle! - -0.03) < 1e-6,
  "front slip asymmetry in trazione, from a zone with no alert",
);
assert.equal(
  asym.slipAsymRearThrottle,
  null,
  "rear identical in trazione ⇒ null",
);
assert.equal(
  asym.slipAsymFrontRelease,
  null,
  "front nearly identical in rilascio, below epsilon ⇒ null",
);
assert.ok(
  Math.abs(asym.slipAsymRearRelease! - -0.03) < 1e-6,
  "rear slip asymmetry in rilascio",
);

assert.equal(flat.suspAsymFrontMm, null, "no travel data ⇒ null, not 0");
assert.equal(flat.slipAsymFrontThrottle, null);

console.log("session-stats.selfcheck OK");
