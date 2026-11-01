import assert from "node:assert/strict";
import { findAms2Car } from "./ams2-car-lookup.js";
import { AMS2_CARS } from "./ams2-cars.js";

assert.equal(findAms2Car("Porsche 992 GT3 R")?.frontPct, 43.8);
assert.equal(
  findAms2Car("porsche  992 gt3 r")?.frontPct,
  43.8,
  "case and spaces",
);
assert.equal(findAms2Car("Porsche 992 GT3 R ")?.weightKg, 1390);
assert.equal(findAms2Car("Mercedes-AMG GT3")?.frontPct, 48);
assert.equal(findAms2Car("Auto Inesistente"), null);
assert.equal(findAms2Car(""), null);

// Dataset guard
assert.ok(AMS2_CARS.length >= 150, `only ${AMS2_CARS.length} cars`);
assert.ok(
  AMS2_CARS.every((c) => c.frontPct >= 30 && c.frontPct <= 70),
  "frontPct out of range",
);
const DIFFS = [
  "C-LSD",
  "SPL/C-LSD",
  "FIXED",
  "SPOOL",
  "OPEN",
  "G-LSD",
  "GC-LSD",
];
for (const c of AMS2_CARS)
  assert.ok(DIFFS.includes(c.differential), `${c.name}: ${c.differential}`);

// Names the game reports, seen in real sessions, that differ from the sheet
assert.equal(findAms2Car("Caterham Academy")?.name, "Caterham Academy (270R)");
assert.equal(findAms2Car("Kart 4-Stroke Race")?.name, "Kart GX390 Race");
assert.equal(findAms2Car("Formula Vee Gen1")?.name, "Formula Vee");
assert.equal(findAms2Car("Formula Vee Gen1 + Fin")?.name, "Formula Vee + Fin");
// Two rows with different specs, or no row at all: never a variant picked at random
for (const name of [
  "Ginetta G40",
  "Ginetta G40 Cup",
  "Copa Uno",
  "Formula Vee Gen2",
  "Audi R8 LMS GT3",
])
  assert.equal(findAms2Car(name), null, name);

// Ambiguous (same name, different specs) -> null; identical duplicates -> a car
assert.equal(findAms2Car("MetalMoro AJR"), null);
assert.equal(findAms2Car("Ginetta G58")?.weightKg, 1020);

// Punctuation and accent variants
const academy = findAms2Car("Caterham Academy 270R");
assert.ok(academy);
assert.equal(findAms2Car("caterham academy (270r)"), academy);
assert.equal(findAms2Car("Formula Inter MG15")?.name, "Fórmula Inter MG15");
