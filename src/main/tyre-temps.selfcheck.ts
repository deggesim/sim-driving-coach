/**
 * Runnable self-check for the surface-temperature helpers (assert-only).
 *
 * Run it (with every other self-check) via:
 *
 *   npm run selfcheck
 */
import assert from "node:assert/strict";
import { leftRightToInnerOuter, surfaceTemps } from "./tyre-temps.js";

// Left wheels (0, 2): inner = right, outer = left. Right wheels (1, 3): mirrored.
const [inner, outer] = leftRightToInnerOuter(
  [10, 20, 30, 40],
  [11, 21, 31, 41],
);
assert.deepEqual(inner, [11, 20, 31, 40]);
assert.deepEqual(outer, [10, 21, 30, 41]);

// Rounded to 0.1 °C.
assert.deepEqual(
  surfaceTemps([84.04, 1, 1, 1], [81.06, 1, 1, 1], [81, 1, 1, 1]),
  { tti: [84, 1, 1, 1], ttc: [81.1, 1, 1, 1], tto: [81, 1, 1, 1] },
);

// One unavailable value (R3E -1, AMS2 UNSET 0) drops the whole triple.
assert.deepEqual(
  surfaceTemps([-1, 80, 80, 80], [80, 80, 80, 80], [80, 80, 80, 80]),
  {},
);
assert.deepEqual(
  surfaceTemps([80, 80, 80, 80], [0, 80, 80, 80], [80, 80, 80, 80]),
  {},
);

console.log("tyre-temps self-check OK");
