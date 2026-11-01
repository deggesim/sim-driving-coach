import assert from "node:assert/strict";
import {
  createSlipEstimator,
  drivenWheels,
  type SlipSample,
} from "./ams2-slip.js";

const roll = (v: number, w: number, over: Partial<SlipSample> = {}) => ({
  speedMps: v,
  wheelRadS: [w, w, w, w],
  brake: 0,
  throttle: 0,
  steering: 0,
  gLat: 0,
  gLon: 0,
  ...over,
});
const W = 50 / 0.33;

// Unknown driveline: every wheel is driven and calibrates off throttle, on 10 samples.
const est = createSlipEstimator();
for (let i = 0; i < 9; i++) assert.equal(est.slip(roll(50, W)), undefined);
est.slip(roll(50, W)); // 10th sample freezes r = 0.33
const locked = est.slip(roll(40, (40 * 0.8) / 0.33, { brake: 1 }))!;
assert.ok(Math.abs(locked[0] - -0.2) < 1e-6);
assert.deepEqual(est.slip(roll(0.5, 1, { brake: 1 })), [0, 0, 0, 0]);
est.reset();
assert.equal(est.slip(roll(40, 100, { brake: 1 })), undefined);
// a braking sample never calibrates
const est2 = createSlipEstimator();
for (let i = 0; i < 200; i++) est2.slip(roll(50, W, { brake: 0.5 }));
assert.equal(est2.slip(roll(50, W)), undefined);

// RWD: steady speed under throttle calibrates the fronts (30 samples), never
// the driven rears, which still need 10 samples off throttle.
const rwd = drivenWheels("RWD");
assert.deepEqual(rwd, [false, false, true, true]);
assert.deepEqual(drivenWheels("FWD"), [true, true, false, false]);
assert.deepEqual(drivenWheels(undefined), [true, true, true, true]);
const est3 = createSlipEstimator();
for (let i = 0; i < 200; i++)
  est3.slip(roll(50, W, { throttle: 0.6, gLon: 0.05, driven: rwd }));
assert.equal(est3.radius(), undefined, "rears not calibrated under throttle");
for (let i = 0; i < 9; i++) est3.slip(roll(50, W, { driven: rwd }));
assert.equal(est3.radius(), undefined);
est3.slip(roll(50, W, { driven: rwd }));
assert.ok(est3.radius()!.every((r) => Math.abs(r - 0.33) < 1e-9));
// steady means |gLon| < 0.1: accelerating hard calibrates nothing
const est4 = createSlipEstimator();
for (let i = 0; i < 200; i++)
  est4.slip(roll(50, W, { throttle: 1, gLon: 0.4, driven: rwd }));
for (let i = 0; i < 10; i++) est4.slip(roll(50, W, { driven: rwd }));
assert.equal(
  est4.radius(),
  undefined,
  "fronts need 30, 10 coasting are not enough",
);

console.log("ams2-slip self-check OK");
