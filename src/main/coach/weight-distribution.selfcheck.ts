/**
 * Runnable self-check for weightDistribution (assert-only, no framework).
 *
 *   npm run selfcheck
 */
import assert from "node:assert/strict";
import { findAms2Car } from "../ams2/ams2-car-lookup.js";
import { weightDistribution } from "./weight-distribution.js";
import type { LoadFitSums, ZoneData } from "../../shared/types.js";

// Axle load = static + aero * v^2, one sample per speed in `speeds` (m/s).
const sums = (
  speeds: number[],
  front: (x: number) => number,
  rear: (x: number) => number,
  fuel?: number,
): LoadFitSums => {
  const s: LoadFitSums = {
    n: 0,
    sx: 0,
    sxx: 0,
    syF: 0,
    syR: 0,
    sxyF: 0,
    sxyR: 0,
    fuelSum: 0,
    fuelN: 0,
  };
  for (const v of speeds) {
    const x = v * v;
    const yF = front(x);
    const yR = rear(x);
    s.n++;
    s.sx += x;
    s.sxx += x * x;
    s.syF += yF;
    s.syR += yR;
    s.sxyF += x * yF;
    s.sxyR += x * yR;
    if (fuel !== undefined) {
      s.fuelSum += fuel;
      s.fuelN++;
    }
  }
  return s;
};

const zone = (loadFit?: LoadFitSums): ZoneData => ({ loadFit }) as ZoneData;

// 10..60 m/s, 400 samples, split over two zones.
const speeds = Array.from({ length: 400 }, (_, i) => 10 + (i * 50) / 399);
const half = (a: number[]) => [a.slice(0, 200), a.slice(200)] as const;
const [s1, s2] = half(speeds);
const F = (x: number) => 6000 + 0.1 * x;
const R = (x: number) => 7600 + 0.16 * x;

const synth = [zone(sums(s1, F, R, 40)), zone(sums(s2, F, R, 30)), zone()];
const m = weightDistribution("r3e", synth, null);
assert.ok(m.known && m.source === "misurata");
assert.ok(m.known && Math.abs(m.frontPct - 44.12) < 0.05); // 6000 / 13600
assert.ok(m.known && Math.abs(m.aeroFrontPct! - 38.46) < 0.05); // 0.10 / 0.26
assert.ok(m.known && m.fuelL !== null && Math.abs(m.fuelL - 35) < 1e-9);

// No fuel samples -> fuelL null; no aero -> aeroFrontPct null.
const flat = weightDistribution(
  "ace",
  [
    zone(
      sums(
        speeds,
        () => 6000,
        () => 7600,
      ),
    ),
  ],
  null,
);
assert.ok(flat.known && flat.fuelL === null && flat.aeroFrontPct === null);

assert.deepEqual(
  weightDistribution("ace", [zone(sums(speeds.slice(0, 50), F, R))], null),
  { known: false, reason: "meno di 300 campioni in linea retta" },
);
assert.deepEqual(
  weightDistribution("r3e", [zone(sums(Array(400).fill(30), F, R))], null),
  { known: false, reason: "campioni tutti alla stessa velocità" },
);
const noLoad = { known: false, reason: "carico ruota non disponibile" };
assert.deepEqual(weightDistribution("r3e", [zone()], null), noLoad);
assert.deepEqual(weightDistribution("r3e", [], null), noLoad);
assert.deepEqual(
  weightDistribution(
    "r3e",
    [
      zone(
        sums(
          speeds,
          () => 0,
          () => 0,
        ),
      ),
    ],
    null,
  ),
  noLoad,
);
assert.deepEqual(
  weightDistribution(
    "r3e",
    [
      zone(
        sums(
          speeds,
          () => -1,
          () => -1,
        ),
      ),
    ],
    null,
  ),
  noLoad,
);

// AMS2 never measures: table only, even when sums exist.
assert.deepEqual(
  weightDistribution("ams2", [], findAms2Car("Porsche 992 GT3 R")),
  {
    known: true,
    frontPct: 43.8,
    source: "tabella AMS2",
    aeroFrontPct: null,
    fuelL: null,
  },
);
assert.deepEqual(weightDistribution("ams2", synth, null), {
  known: false,
  reason: "auto non presente nella tabella AMS2",
});

console.log("weight-distribution selfcheck OK");
