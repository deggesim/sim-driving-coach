/**
 * Runnable self-check for chassisCounters (assert-only, no framework).
 * Most fixtures live in zone 0 (`zoneOf` constant); the zone-split one uses d.
 *
 *   npm run selfcheck
 */
import assert from "node:assert/strict";
import { chassisCounters } from "./chassis-counters.js";
import type { CompactFrame } from "../shared/types.js";

const STEP_MS = 16;
const FLAT = [0.05, 0.05, 0.05, 0.05];

const make = (
  n: number,
  over: (i: number) => Partial<CompactFrame> = () => ({}),
): CompactFrame[] =>
  Array.from({ length: n }, (_, i) => ({
    d: i * 0.1,
    spd: 250,
    thr: 1,
    brk: 0,
    str: 0,
    gear: 5,
    abs: 0,
    tc: 0,
    bt: [500, 500, 500, 500],
    ts: i * STEP_MS,
    gLat: 0,
    gLon: 0,
    ...over(i),
  }));

const zone0 = (frames: CompactFrame[]) =>
  chassisCounters(frames, () => 0).get(0) ?? assert.fail("zone 0 missing");

// --- Bottoming ------------------------------------------------------------

// Fast straight: 5 frames with FL on the floor → ONE front event, straight.
const straightTouch = make(30, (i) => ({
  rh: i >= 10 && i < 15 ? [0.002, 0.05, 0.05, 0.05] : FLAT,
}));
assert.deepEqual(zone0(straightTouch).bottoming, {
  straight: 1,
  brake: 0,
  other: 0,
  upset: 0,
  front: 1,
  rear: 0,
  straightFront: 1,
  straightRear: 0,
  upsetFront: 0,
  upsetRear: 0,
});

// ACE-style [F, F, R, R]: both front wheels below 3 mm → still ONE front event.
const aceTouch = make(30, (i) => ({
  rh: i >= 10 && i < 15 ? [0.002, 0.002, 0.05, 0.05] : FLAT,
}));
assert.equal(zone0(aceTouch).bottoming!.front, 1);

// Rear axle only.
const rearTouch = make(30, (i) => ({
  rh: i >= 10 && i < 15 ? [0.05, 0.05, 0.002, 0.002] : FLAT,
}));
assert.deepEqual(
  [zone0(rearTouch).bottoming!.front, zone0(rearTouch).bottoming!.rear],
  [0, 1],
);

// 2 frames below 3 mm: not an event.
const shortTouch = make(30, (i) => ({
  rh: i >= 10 && i < 12 ? [0.002, 0.002, 0.05, 0.05] : FLAT,
}));
assert.equal(zone0(shortTouch).bottoming!.front, 0);

// Two runs split by one clear frame: two events.
const twoRuns = make(40, (i) => ({
  rh: [10, 11, 12, 20, 21, 22].includes(i) ? [0.002, 0.002, 0.05, 0.05] : FLAT,
}));
assert.equal(zone0(twoRuns).bottoming!.front, 2);

// Under braking → "brake"; followed within 500 ms by a steer sign flip and a
// 0.4 g swing → upset.
const brakeUpset = make(60, (i) => ({
  spd: i < 5 ? 250 : 150,
  brk: i >= 5 ? 0.8 : 0,
  str: i < 20 ? 0.1 : -0.1,
  gLat: i < 20 ? -0.2 : 0.2,
  rh: i >= 10 && i < 14 ? [0.002, 0.002, 0.05, 0.05] : FLAT,
}));
assert.deepEqual(zone0(brakeUpset).bottoming, {
  straight: 0,
  brake: 1,
  other: 0,
  upset: 1,
  front: 1,
  rear: 0,
  straightFront: 0,
  straightRear: 0,
  upsetFront: 1,
  upsetRear: 0,
});
// Per phase and axle: a rear touch on the straight, a front upsetting one under braking.
const mixed = zone0(
  make(80, (i) => ({
    spd: i < 40 ? 250 : 150,
    brk: i >= 40 ? 0.8 : 0,
    str: i < 60 ? 0.1 : -0.1,
    gLat: i < 40 ? 0 : i < 60 ? -0.2 : 0.2,
    rh:
      i >= 10 && i < 14
        ? [0.05, 0.05, 0.002, 0.002]
        : i >= 50 && i < 54
          ? [0.002, 0.002, 0.05, 0.05]
          : FLAT,
  })),
).bottoming!;
assert.deepEqual(
  [mixed.straightRear, mixed.straightFront, mixed.upsetFront, mixed.upsetRear],
  [1, 0, 1, 0],
);

// Same touch, steady steering: brake event, no upset.
const brakeCalm = make(60, (i) => ({
  spd: i < 5 ? 250 : 150,
  brk: i >= 5 ? 0.8 : 0,
  rh: i >= 10 && i < 14 ? [0.002, 0.002, 0.05, 0.05] : FLAT,
}));
assert.equal(zone0(brakeCalm).bottoming!.upset, 0);
assert.equal(zone0(brakeCalm).bottoming!.brake, 1);

// Slow, no brake → "other".
const slowTouch = make(60, (i) => ({
  spd: i < 5 ? 250 : 100,
  rh: i >= 10 && i < 14 ? [0.05, 0.05, 0.002, 0.002] : FLAT,
}));
assert.equal(zone0(slowTouch).bottoming!.other, 1);

// The event goes to the zone of its FIRST frame, even if the run crosses the boundary.
const split = chassisCounters(
  make(40, (i) => ({
    d: 48 + i * 0.1,
    rh: i >= 15 && i < 25 ? [0.002, 0.002, 0.05, 0.05] : FLAT,
  })),
  (d) => Math.floor(d / 50),
);
assert.equal(split.get(0)!.bottoming!.front, 1);
assert.equal(split.get(1)!.bottoming!.front, 0);

// No `rh` on the lap: families absent.
const noRh = make(30);
assert.equal(zone0(noRh).rideHeight, undefined);
assert.equal(zone0(noRh).bottoming, undefined);

// All-zero `rh` on the whole lap = unpopulated field / wrong offset: absent.
const zeroRh = make(30, () => ({ rh: [0, 0, 0, 0] }));
assert.equal(zone0(zeroRh).rideHeight, undefined);
assert.equal(zone0(zeroRh).bottoming, undefined);
// Real values plus a genuine 0-touch (3 frames at exactly 0): the event counts.
const zeroTouch = make(30, (i) => ({
  rh: i >= 10 && i < 13 ? [0, 0, 0.05, 0.05] : FLAT,
}));
assert.equal(zone0(zeroTouch).bottoming!.front, 1);
assert.notEqual(zone0(zeroTouch).rideHeight, undefined);
// Lap median of the axle means outside 5-300 mm = garbage or a unit error: absent.
for (const h of [0.001, 0.4]) {
  const implausible = zone0(make(30, () => ({ rh: [h, h, h, h] })));
  assert.equal(implausible.rideHeight, undefined, `median ${h} m`);
  assert.equal(implausible.bottoming, undefined, `median ${h} m`);
}

// --- Ride-height sums -----------------------------------------------------

const rhLap = make(20, (i) => ({
  // first 10 frames: fast straight, last 10: mid-corner (steering, coasting).
  ...(i < 10 ? {} : { spd: 120, str: 0.2, thr: 0.1, gLat: 1.5 }),
  rh: i === 3 ? [0.04, 0.06, 0.065, 0.08] : [0.05, 0.06, 0.07, 0.08],
}));
const rh = zone0(rhLap).rideHeight!;
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
assert.equal(rh.straightN, 10);
assert.equal(rh.midN, 10);
// The minimum keeps the lower wheel; the straight/mid sums use the axle mean.
near(rh.minF, 0.04);
near(rh.minR, 0.065);
near(rh.straightF, 9 * 0.055 + 0.05);
near(rh.straightR, 9 * 0.075 + 0.0725);
near(rh.midF, 10 * 0.055);
near(rh.midR, 10 * 0.075);

// --- Load fit -------------------------------------------------------------

// 20 steady frames (kept), plus frames that must be rejected one reason each.
const loadLap = make(30, (i) => {
  const wl = [2000 + i * 10, 2100 + i * 10, 1500, 1600];
  if (i < 20) return { spd: 100 + i * 5, wl, fuel: 50 - i };
  if (i === 20) return { spd: 100, wl, gLat: 0.5 }; // cornering
  if (i === 21) return { spd: 100, wl, gLon: -0.5 }; // braking
  if (i === 22) return { spd: 100, wl, str: 0.1 }; // steering
  if (i === 23) return { spd: 20, wl }; // too slow
  if (i === 24) return { spd: 100, wl: [2000, 0, 1500, 1600] }; // sensor off
  return { spd: 100, wl: undefined };
});
let expectedSxyF = 0;
let expectedSxyR = 0;
let expectedSx = 0;
for (let i = 0; i < 20; i++) {
  const x = ((100 + i * 5) / 3.6) ** 2;
  expectedSx += x;
  expectedSxyF += x * (2000 + i * 10 + 2100 + i * 10);
  expectedSxyR += x * (1500 + 1600);
}
const lf = zone0(loadLap).loadFit!;
assert.equal(lf.n, 20);
assert.ok(Math.abs(lf.sx - expectedSx) < 1e-3);
assert.ok(Math.abs(lf.sxyF - expectedSxyF) < 1e-3);
assert.ok(Math.abs(lf.sxyR - expectedSxyR) < 1e-3);
assert.equal(lf.fuelN, 20);
assert.equal(lf.fuelSum, (50 + 31) * 10); // 50..31
// Without wl: absent. Without fuel: fuelN 0 (not counted as zero litres).
assert.equal(zone0(noRh).loadFit, undefined);
const noFuel = zone0(
  make(10, () => ({ wl: [1000, 1000, 1000, 1000] })),
).loadFit!;
assert.equal(noFuel.n, 10);
assert.equal(noFuel.fuelN, 0);
// Quasi-steady straight (0.08 g each way) still counts.
assert.equal(
  zone0(
    make(10, () => ({
      spd: 200,
      wl: [1000, 1000, 1000, 1000],
      gLat: 0.08,
      gLon: 0.08,
    })),
  ).loadFit!.n,
  10,
);

// Pit-lane frames (kept out of the lap by the readers) feed only the load fit,
// in the lap's first zone: the speed limiter is the steady slow run that
// anchors the intercept. Their ride height on the floor must not count.
const pitFit = chassisCounters(
  make(10, (i) => ({ d: 120 + i, wl: [1000, 1000, 1000, 1000] })),
  (d) => Math.floor(d / 50),
  make(25, () => ({
    spd: 60,
    wl: [1000, 1000, 1500, 1500],
    rh: [0.002, 0.002, 0.002, 0.002],
  })),
).get(2);
assert.equal(pitFit?.loadFit?.n, 35);
assert.equal(pitFit?.loadFit?.nLow, 25);
assert.equal(pitFit?.bottoming, undefined);
assert.equal(pitFit?.rideHeight, undefined);

// --- Straight-line steering -----------------------------------------------

// 3 reversals of 0.02 over 1000 m at 200 km/h, |gLat| 0.05.
const weave = make(1126, (i) => {
  const seg = Math.floor(i / 281);
  const t = (i % 281) / 280;
  return {
    spd: 200,
    gLat: 0.05,
    str: (seg % 2 === 0 ? t : 1 - t) * 0.02,
  };
});
const ss = zone0(weave).straightSteer!;
assert.equal(ss.reversals, 3);
assert.ok(Math.abs(ss.metres - 1000) < 10, `metres ${ss.metres}`);

// Corner in the middle breaks the run: no reversal across it.
const interrupted = make(400, (i) => ({
  spd: i >= 190 && i < 210 ? 100 : 200,
  gLat: 0.05,
  str: i < 190 ? i * 0.0001 : 0,
}));
assert.equal(zone0(interrupted).straightSteer!.reversals, 0);

// Steady wheel and slow driving: counted metres only above 150 km/h.
const slowSteer = zone0(make(100, () => ({ spd: 100, gLat: 0.05 })));
assert.deepEqual(slowSteer.straightSteer, { metres: 0, reversals: 0 });
// No gLat: family absent.
assert.equal(
  zone0(make(10, () => ({ gLat: undefined }))).straightSteer,
  undefined,
);

// --- Damper velocity histogram --------------------------------------------

// Triangle wave on every wheel: compression (sus rising) 5 mm in 24 frames,
// extension 5 mm in 36 frames → 60 % of the samples in rebound, all slow
// (13.0 and 8.7 mm/s). Hard braking on frames 100-149 dives the front by
// up to 20 mm (±50 mm/s on top of the triangle). sv = forward slope of the very
// same sus sequence, in m/s, positive = compression.
const UP = 24;
const DOWN = 36;
const AMP = 0.005;
const triangle = (i: number) => {
  const p = i % (UP + DOWN);
  return p < UP ? (AMP * p) / UP : AMP * (1 - (p - UP) / DOWN);
};
const dive = (i: number) =>
  i < 100 || i >= 150 ? 0 : (0.02 * (i < 125 ? i - 100 : 150 - i)) / 25;
const susAt = (i: number) => {
  const f = triangle(i) + dive(i);
  const r = triangle(i);
  return [f, f, r, r];
};
const damped = make(600, (i) => ({
  brk: i >= 100 && i < 150 ? 0.8 : 0,
  sus: susAt(i),
  sv: susAt(i + 1).map((s, w) => (s - susAt(i)[w]) / (STEP_MS / 1000)),
}));
const remap = (
  frames: CompactFrame[],
  over: (f: CompactFrame, i: number) => Partial<CompactFrame>,
) => frames.map((f, i) => ({ ...f, ...over(f, i) }));
const scaleSv = (frames: CompactFrame[], k: number) =>
  remap(frames, (f) => ({ sv: f.sv?.map((v) => v * k) }));
const negate = (frames: CompactFrame[]) =>
  remap(frames, (f) => ({
    sus: f.sus?.map((v) => -v),
    sv: f.sv?.map((v) => -v),
  }));
const withSv = (frames: CompactFrame[], sv: (i: number) => number[]) =>
  remap(frames, (_, i) => ({ sv: sv(i) }));
const noBrake = (frames: CompactFrame[]) => remap(frames, () => ({ brk: 0 }));
const total = (h: Record<string, number>) =>
  Object.values(h).reduce((a, b) => a + b, 0);

const h = zone0(damped).damperHist!;
// Shares per axle as built by the fixture (the dive shifts a few front samples).
assert.ok(Math.abs(h.lowRebF / (h.lowRebF + h.lowBumpF) - 0.6) < 0.05);
assert.equal(h.lowRebR / (h.lowRebR + h.lowBumpR), 0.6);
assert.equal(h.highBumpR + h.highRebR, 0);
// The dive on top of compression is fast: 5 frames × 2 front wheels.
assert.equal(h.highBumpF, 10);
assert.equal(total(h), 600 * 4);
// mm/s: same counts.
assert.deepEqual(zone0(scaleSv(damped, 1000)).damperHist, h);
// Both sus and sv negated (compression negative): same counts.
assert.deepEqual(zone0(negate(damped)).damperHist, h);
// sv unrelated to sus (constant, or ×50): no family.
assert.equal(
  zone0(withSv(damped, () => [0.2, 0.2, 0.2, 0.2])).damperHist,
  undefined,
);
assert.equal(zone0(scaleSv(damped, 50)).damperHist, undefined);
// No hard braking: compression direction unknown, no family.
assert.equal(zone0(noBrake(damped)).damperHist, undefined);
// Frames under 30 km/h are not counted (one full period → shares unchanged).
const slowPeriod = zone0(
  remap(damped, (f, i) => ({ spd: i >= 300 && i < 360 ? 20 : f.spd })),
).damperHist!;
assert.equal(total(slowPeriod), 540 * 4);
assert.equal(
  slowPeriod.lowRebR / (slowPeriod.lowRebR + slowPeriod.lowBumpR),
  0.6,
);
// Pit frames are not counted.
assert.deepEqual(
  chassisCounters(damped, () => 0, damped).get(0)!.damperHist,
  h,
);
// No sv at all (ACE, old recordings): no family.
assert.equal(zone0(make(600)).damperHist, undefined);

console.log("chassis-counters self-check OK");
