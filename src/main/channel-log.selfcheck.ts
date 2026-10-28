/**
 * Runnable self-check for the smoke-test channel formatter (assert-only).
 *
 * Run it (with every other self-check) via:
 *
 *   npm run selfcheck
 */
import assert from "node:assert/strict";
import { formatCalibration, formatChannels } from "./channel-log.js";
import type { CompactFrame } from "../shared/types.js";

const frame = (over: Partial<CompactFrame> = {}): CompactFrame => ({
  d: 1234,
  spd: 180,
  thr: 1,
  brk: 0,
  str: 0.1,
  gear: 5,
  abs: 0,
  tc: 0,
  bt: [600, 600, 500, 500],
  ts: 0,
  ...over,
});

// A channel the reader never filled must say so, not render as a number: the
// whole point of the line is telling "absent" apart from "reading zero".
const bare = formatChannels(frame());
assert.ok(bare.includes("rpm=assente"), bare);
assert.ok(bare.includes("gLat=assenteg"), bare);
assert.ok(bare.includes("press=assentePSI"), bare);
assert.ok(bare.includes("slip=assente"), bare);
assert.ok(bare.includes("sup=assente"), bare);
assert.ok(
  !bare.includes("0.0"),
  "an absent channel must not render as a value",
);

// All-zero is the signature of a wrong offset and must not read as a measurement.
const zeros = formatChannels(frame({ tp: [0, 0, 0, 0], sr: [0, 0, 0, 0] }));
assert.ok(zeros.includes("press=zeriPSI"), zeros);
assert.ok(zeros.includes("slip=zeri"), zeros);

// Units and scaling: pressures PSI as read, temps rounded, suspension m → mm.
const full = formatChannels(
  frame({
    rpm: 6820,
    gLat: -1.42,
    gLon: 0.88,
    tp: [24.6, 24.8, 23.9, 24.1],
    tt: [88.4, 90.1, 85.2, 84.3],
    tti: [85, 80, 72, 74],
    ttc: [83, 81, 73, 73],
    tto: [80, 82, 74, 72],
    sr: [0.021, 0.019, -0.114, -0.108],
    sus: [0.0312, 0.032, 0.0481, 0.0476],
    sv: [0.0421, -0.0105, 0.1, 0],
  }),
);
assert.ok(full.includes("rpm=6820"), full);
assert.ok(full.includes("gLat=-1.42g gLon=0.88g"), full);
assert.ok(full.includes("press=24.6/24.8/23.9/24.1PSI"), full);
assert.ok(full.includes("temp=88/90/85/84°C"), full);
assert.ok(
  full.includes("sup(I-C-E)=85-83-80/80-81-82/72-73-74/74-73-72°C"),
  full,
);
assert.ok(full.includes("slip=0.021/0.019/-0.114/-0.108"), full);
assert.ok(full.includes("sosp=31.2/32.0/48.1/47.6mm"), full);
assert.ok(full.includes("vsosp=42/-11/100/0mm/s"), full);
assert.ok(bare.includes("vsosp=assente"), bare);

// Ride height m → mm (1 decimal), wheel load N as read.
assert.ok(
  formatChannels(frame({ rh: [0.052, 0.051, 0.061, 0.06] })).includes(
    "alt=52.0/51.0/61.0/60.0mm",
  ),
);
assert.ok(bare.includes("alt=assente"), bare);
assert.ok(
  formatChannels(frame({ wl: [3000, 3100, 3900, 4000] })).includes(
    "carico=3000/3100/3900/4000N",
  ),
);
assert.ok(bare.includes("carico=assente"), bare);

// Calibration line: accepted (mm/s, compression negative) and null.
assert.equal(
  formatCalibration({ scale: -0.001, k: 1012.345, reason: null }),
  "[sospensioni] calibrazione: k=1012.35, unità mm/s, compressione negativa",
);
assert.equal(
  formatCalibration({ scale: 1, k: 0.98, reason: null }),
  "[sospensioni] calibrazione: k=0.98, unità m/s, compressione positiva",
);
assert.equal(
  formatCalibration({
    scale: null,
    k: 12,
    reason: "pendenza k=12.00 fuori banda",
  }),
  "[sospensioni] calibrazione assente: pendenza k=12.00 fuori banda",
);

console.log("channel-log.selfcheck OK");
