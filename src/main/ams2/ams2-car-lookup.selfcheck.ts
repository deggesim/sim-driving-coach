import assert from "node:assert/strict";
import { findAms2Car } from "./ams2-car-lookup.js";

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
