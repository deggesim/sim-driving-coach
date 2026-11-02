/**
 * Runnable self-check for the per-lap calibration summary (assert-only).
 *
 *   npm run selfcheck
 */
import assert from "node:assert/strict";
import { calibrationLines } from "./calibration-log.js";
import type { CompactFrame } from "../shared/types.js";

const frame = (over: Partial<CompactFrame> = {}): CompactFrame => ({
  d: 100,
  spd: 150,
  thr: 0,
  brk: 0,
  str: 0,
  gear: 4,
  abs: 0,
  tc: 0,
  bt: [500, 500, 500, 500],
  ts: 0,
  ...over,
});

// No slip channel: said in words, tyres still reported as absent.
const bare = calibrationLines([frame()]);
assert.equal(bare[0], "slip: assente (nessun canale sr)");
assert.ok(bare[1].includes("p=assente"), bare[1]);

// Hard braking: front locks to -0.30 on one frame out of four (25 % < -0.25);
// a downshift 4 -> 3 with the rear dipping to -0.12 inside 500 ms is one sample.
const frames = [
  frame({ ts: 0, brk: 0.8, sr: [-0.05, -0.05, -0.04, -0.04] }),
  frame({ ts: 100, brk: 0.8, sr: [-0.3, -0.05, -0.04, -0.04] }),
  frame({ ts: 200, brk: 0.8, sr: [-0.05, -0.05, -0.04, -0.04] }),
  frame({ ts: 300, brk: 0.8, gear: 3, sr: [-0.05, -0.05, -0.12, -0.04] }),
];
const out = calibrationLines(
  frames.map((f) => ({
    ...f,
    tp: [24, 24, 22, 22],
    tti: [90, 90, 80, 80],
    ttc: [88, 88, 78, 78],
    tto: [86, 86, 76, 76],
  })),
);
assert.ok(out[0].includes("anteriore n=4 min=-0.300"), out[0]);
assert.ok(out[0].includes("<-0.25 25.0%"), out[0]);
assert.ok(out[1].includes("posteriore n=4 min=-0.120"), out[1]);
assert.ok(out[2].includes("scalate n=1 min=-0.120"), out[2]);
assert.ok(
  out[3].includes("FL 24.0PSI I/C/E 90/88/86 Δcentro=0.0°C I-E=4.0°C"),
  out[3],
);

console.log("calibration-log.selfcheck OK");
