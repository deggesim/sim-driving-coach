/**
 * Runnable self-check for ladderCounters (assert-only, no framework).
 * Every fixture keeps `d` inside zone 0 (0.1 m per frame), so one corner or
 * downshift window never straddles a zone boundary.
 *
 *   npm run selfcheck
 */
import assert from "node:assert/strict";
import { ladderCounters } from "./ladder-counters.js";
import type { CompactFrame } from "../shared/types.js";

const zoneOf = (d: number): number => Math.floor(d / 50);

const STEP_MS = 16;

// n frames at 16 ms, continuing the time/distance of `after` when given.
const run = (
  n: number,
  over: Partial<CompactFrame>,
  after: CompactFrame[] = [],
): CompactFrame[] => {
  const start = after.length;
  return Array.from({ length: n }, (_, i) => ({
    d: (start + i) * 0.1,
    spd: 108,
    thr: 0,
    brk: 0,
    str: 0,
    gear: 3,
    abs: 0,
    tc: 0,
    bt: [500, 500, 500, 500],
    ts: (start + i) * STEP_MS,
    ...over,
  }));
};

const zone0 = (frames: CompactFrame[]) =>
  ladderCounters(frames, zoneOf).get(0) ?? assert.fail("zone 0 missing");

// Hard braking with both fronts locked.
const braking = run(10, { brk: 0.8, sr: [-0.4, -0.4, 0, 0] });
const b = zone0(braking);
assert.equal(b.hardBrakeFrames, 10);
assert.equal(b.absHardBrakeFrames, 0);
assert.equal(b.lockFramesFront, 10);
assert.equal(b.lockFramesRear, 0);

// Mixed zone: 10 hard-brake frames, only 4 carry `sr`. Locks and their
// denominator are measured on those 4.
const mixed = zone0([
  ...run(6, { brk: 0.8, sr: undefined }),
  ...run(4, { brk: 0.8, sr: [-0.4, -0.4, 0, 0] }, run(6, {})),
]);
assert.equal(mixed.hardBrakeFrames, 10);
assert.equal(mixed.srHardBrakeFrames, 4);
assert.equal(mixed.lockFramesFront, 4);
assert.equal(b.srHardBrakeFrames, 10);

// Slip between -0.25 and -0.10 is braking slip, not a lock.
const gripping = zone0(run(10, { brk: 0.8, sr: [-0.15, -0.15, -0.15, -0.15] }));
assert.equal(gripping.srHardBrakeFrames, 10);
assert.equal(gripping.lockFramesFront, 0);
assert.equal(gripping.lockFramesRear, 0);

// ABS frames are counted inside the hard-brake frames only.
const abs = zone0(run(4, { brk: 0.8, abs: 1 }, []));
assert.equal(abs.hardBrakeFrames, 4);
assert.equal(abs.absHardBrakeFrames, 4);

// Without `sr` the sr-dependent counters stay off; the others are still there.
const noSr = zone0(run(10, { brk: 0.8 }));
assert.equal(noSr.hardBrakeFrames, 10);
assert.equal(noSr.lockFramesFront, undefined);
assert.equal(noSr.srHardBrakeFrames, undefined);
assert.equal(noSr.downshifts, undefined);
assert.equal(noSr.spinFramesRear, undefined);
assert.equal(noSr.cornersEntry, undefined, "no gLat, no corner counters");

// A downshift on a frame without `sr` is not counted, nor is a shift into neutral.
const dsPre = run(5, { brk: 0.5, gear: 4, sr: [0, 0, 0, 0] });
const dsNoSr = [
  ...dsPre,
  ...run(5, { brk: 0.5, gear: 3, sr: undefined }, dsPre),
];
assert.equal(zone0(dsNoSr).downshifts, 0);
const neutPre = run(5, { brk: 0.5, gear: 3, sr: [0, 0, 0, 0] });
const toNeutral = [
  ...neutPre,
  ...run(5, { brk: 0.5, gear: 0, sr: [0, 0, 0, 0] }, neutPre),
];
assert.equal(zone0(toNeutral).downshifts, 0);

// Soft braking still emits the always-present counters, at 0.
const coast = zone0(run(5, {}));
assert.equal(coast.hardBrakeFrames, 0);
assert.equal(coast.absHardBrakeFrames, 0);

// Downshift 4 -> 3 under braking, rear slip 200 ms later: nervous.
const downshift = (slipFrames: number, slip = -0.15): CompactFrame[] => {
  const pre = run(5, { brk: 0.5, gear: 4, sr: [0, 0, 0, 0] });
  const post = run(60, { brk: 0.5, gear: 3, sr: [0, 0, 0, 0] }, pre);
  post[slipFrames].sr = [0, 0, slip, 0];
  return [...pre, ...post];
};
const quick = zone0(downshift(Math.round(200 / STEP_MS)));
assert.equal(quick.downshifts, 1);
assert.equal(quick.nervousDownshifts, 1);
const late = zone0(downshift(Math.round(600 / STEP_MS) + 1));
assert.equal(late.downshifts, 1);
assert.equal(late.nervousDownshifts, 0, "slip after the 500 ms window");

// Rear slip of -0.08 (ordinary braking slip) is not nervous.
const mild = zone0(downshift(Math.round(200 / STEP_MS), -0.08));
assert.equal(mild.downshifts, 1);
assert.equal(mild.nervousDownshifts, 0, "-0.08 is above the -0.10 threshold");

// A downshift with neither brake nor lifted throttle is not counted.
const pushing = run(5, { thr: 0.9, gear: 4, sr: [0, 0, 0, 0] });
const pushed = [
  ...pushing,
  ...run(5, { thr: 0.9, gear: 3, sr: [0, 0, 0, 0] }, pushing),
];
assert.equal(zone0(pushed).downshifts, 0);

// A 2 s corner at 108 km/h (30 m/s), steer 0.2: entry, centre, exit.
const corner = (exitG: number): CompactFrame[] => {
  const entry = run(40, { str: 0.2, brk: 0.3, gLat: 0.6 });
  const mid = run(40, { str: 0.2, gLat: 1.0 }, entry);
  const exit = run(40, { str: 0.2, thr: 0.8, gLat: exitG }, [...entry, ...mid]);
  return [...entry, ...mid, ...exit];
};
const c = zone0(corner(1.0));
assert.equal(c.cornersEntry, 1);
assert.equal(c.cornersEntryUnder, 1);
assert.equal(c.cornersEntryOver, 0);
assert.equal(c.cornersExit, 1);
assert.equal(c.cornersExitOver, 0);
assert.equal(zone0(corner(1.3)).cornersExitOver, 1);

// A 0.5 s corner is discarded.
const brief = run(31, { str: 0.2, gLat: 1.0 });
assert.equal(zone0(brief).cornersEntry, undefined);

// Two steering runs split by < 300 ms merge into one corner (1 s in total).
const merged = [...run(30, { str: 0.2, gLat: 1.0 })];
merged.push(...run(5, { str: 0, gLat: 0 }, merged));
merged.push(...run(30, { str: 0.2, gLat: 1.0 }, merged));
assert.equal(
  zone0(merged).cornersEntry,
  0,
  "merged corner kept, no entry phase",
);

// Corner counters are emitted where a corner starts, not on every zone.
const far = run(5, {});
far.forEach((f, i) => (f.d = 120 + i));
const split = ladderCounters([...corner(1.0), ...far], zoneOf);
assert.equal(split.get(0)?.cornersEntry, 1);
assert.equal(split.get(2)?.cornersEntry, undefined);
assert.equal(split.get(2)?.hardBrakeFrames, 0);

// Exit wheelspin on the rear axle: every exit frame counts.
const exits = zone0(run(12, { thr: 0.8, str: 0.2, sr: [0, 0, 0.25, 0.02] }));
assert.equal(exits.exitFrames, 12);
assert.equal(exits.spinFramesRear, 12);
assert.equal(exits.spinFramesFront, 0);

console.log("ladder-counters self-check OK");
