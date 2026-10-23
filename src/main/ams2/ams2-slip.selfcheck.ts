import assert from "node:assert/strict";
import { createSlipEstimator, type SlipSample } from "./ams2-slip.js";

const est = createSlipEstimator();
const roll = (v: number, w: number): SlipSample => ({
  speedMps: v,
  wheelRadS: [w, w, w, w],
  brake: 0,
  throttle: 0,
  steering: 0,
  gLat: 0,
});
for (let i = 0; i < 99; i++)
  assert.equal(est.slip(roll(50, 50 / 0.33)), undefined);
est.slip(roll(50, 50 / 0.33)); // 100th sample freezes r = 0.33
const locked = est.slip({ ...roll(40, (40 * 0.8) / 0.33), brake: 1 })!;
assert.ok(Math.abs(locked[0] - -0.2) < 1e-6);
assert.deepEqual(est.slip({ ...roll(0.5, 1), brake: 1 }), [0, 0, 0, 0]);
est.reset();
assert.equal(est.slip({ ...roll(40, 100), brake: 1 }), undefined);
// a braking sample never calibrates
const est2 = createSlipEstimator();
for (let i = 0; i < 200; i++) est2.slip({ ...roll(50, 50 / 0.33), brake: 0.5 });
assert.equal(est2.slip(roll(50, 50 / 0.33)), undefined);

console.log("ams2-slip self-check OK");
