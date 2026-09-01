/**
 * Runnable self-check for aggregateZones' per-channel extended-field detection
 * (assert-only, no framework).
 *
 * Run it (with every other self-check) via:
 *
 *   npm run selfcheck
 */
import assert from "node:assert/strict";
import { aggregateZones } from "./lap-recorder.js";
import type { CompactFrame } from "../shared/types.js";

const frame = (d: number, over: Partial<CompactFrame> = {}): CompactFrame => ({
  d,
  spd: 120,
  thr: 0.2,
  brk: 0.6,
  str: 0.3,
  gear: 3,
  abs: 0,
  tc: 0,
  bt: [600, 600, 500, 500],
  ts: 0,
  ...over,
});

// AMS2 shape: rpm, G-forces, pressures, suspension travel and tyre temps, but no
// slip ratio. The missing channel must stay missing - a single hasExtended flag
// keyed off rpm used to switch the whole block on and floor `sr` to [0,0,0,0],
// which reads downstream as a measured zero.
const ams2 = aggregateZones(
  [
    frame(10, {
      rpm: 6000,
      gLat: -1.2,
      gLon: 0.8,
      tp: [27, 27, 26, 26],
      sus: [0.03, 0.03, 0.04, 0.04],
      tt: [88, 88, 84, 84],
    }),
    frame(20, {
      rpm: 7000,
      gLat: 1.6,
      gLon: -1.4,
      tp: [29, 29, 28, 28],
      sus: [0.05, 0.05, 0.06, 0.06],
      tt: [90, 90, 86, 86],
    }),
  ],
  100,
);
assert.equal(ams2.length, 1, "both frames fall in zone 0; zone 1 has none");
assert.equal(ams2[0].avgRpm, 6500);
assert.equal(ams2[0].maxGLat, 1.6, "peak magnitude, sign discarded");
assert.equal(ams2[0].maxGLon, 1.4);
assert.deepEqual(ams2[0].avgTyrePressure, [28, 28, 27, 27]);
assert.deepEqual(ams2[0].avgTyreTempC, [89, 89, 85, 85]);
assert.equal(ams2[0].avgSlipRatio, undefined, "channel no frame carried");

// R3E / ACE shape: slip ratio present, nothing else - each channel independent.
const withSlip = aggregateZones(
  [frame(10, { rpm: 6000, sr: [0.02, 0.02, 0.12, 0.12] })],
  100,
);
assert.deepEqual(withSlip[0].avgSlipRatio, [0.02, 0.02, 0.12, 0.12]);
assert.equal(withSlip[0].avgTyrePressure, undefined);
assert.equal(withSlip[0].avgTyreTempC, undefined);

// Slip ratio split by drivetrain phase: throttle frames feed avgSlipRatioThrottle,
// off-throttle frames (coast + brake, thr<=5%) feed avgSlipRatioRelease.
const phased = aggregateZones(
  [
    frame(10, { thr: 0.8, brk: 0, sr: [0.1, 0.1, 0.3, 0.3] }),
    frame(15, { thr: 0, brk: 0.6, sr: [0.02, 0.02, 0.05, 0.05] }),
  ],
  100,
);
phased[0].avgSlipRatio!.forEach((v, i) =>
  assert.ok(Math.abs(v - [0.06, 0.06, 0.175, 0.175][i]) < 1e-9),
);
assert.deepEqual(phased[0].avgSlipRatioThrottle, [0.1, 0.1, 0.3, 0.3]);
assert.deepEqual(phased[0].avgSlipRatioRelease, [0.02, 0.02, 0.05, 0.05]);

// A reader supplying no extended channel at all leaves every field off, while
// brake temps (not part of the extended block) still come through.
const bare = aggregateZones([frame(10)], 100);
assert.equal(bare[0].avgRpm, undefined);
assert.equal(bare[0].maxGLat, undefined);
assert.equal(bare[0].avgSuspTravel, undefined);
assert.ok(bare[0].avgBrakeTempC, "brake temps are outside the extended block");

console.log("lap-recorder.selfcheck OK");
