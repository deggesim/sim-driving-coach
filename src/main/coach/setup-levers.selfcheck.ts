/** Self-check for extractSetupLevers + AMS2 canonical names (assert-only). Run via `npm run selfcheck`. */
import assert from "node:assert/strict";
import { extractSetupLevers } from "./setup-levers.js";
import {
  AMS2_CANONICAL_PARAMS,
  buildAms2SetupSystemPrompt,
} from "../ams2/ams2-setup-vision.js";
import type { SetupParam } from "../../shared/types.js";

const p = (parameter: string, value: string): SetupParam => ({
  category: "x",
  parameter,
  value,
});
const wheels = (prefix: string, values: string[], names: string[]) =>
  names.map((w, i) => p(`${prefix} ${w}`, values[i]));
const AX = ["FL", "FR", "RL", "RR"];
const R3E_W = ["Front Left", "Front Right", "Rear Left", "Rear Right"];

// R3E springs
const r3e = extractSetupLevers(
  wheels("Springs", ["120 N/mm", "120 N/mm", "150 N/mm", "150 N/mm"], R3E_W),
  "r3e",
);
assert.deepEqual(r3e.springs, { values: [120, 120, 150, 150], unit: "N/mm" });

// R3E dampers: Bump/Rebound are the slow ones, Fast Bump/Fast Rebound the fast ones
const r3eD = extractSetupLevers(
  [
    ...wheels("Bump", ["1", "2", "3", "4"], R3E_W),
    ...wheels("Rebound", ["5", "6", "7", "8"], R3E_W),
    ...wheels("Fast Bump", ["9", "10", "11", "12"], R3E_W),
    ...wheels("Fast Rebound", ["13", "14", "15", "16"], R3E_W),
  ],
  "r3e",
);
assert.deepEqual(r3eD.slowBump, [1, 2, 3, 4]);
assert.deepEqual(r3eD.slowRebound, [5, 6, 7, 8]);
assert.deepEqual(r3eD.fastBump, [9, 10, 11, 12]);
assert.deepEqual(r3eD.fastRebound, [13, 14, 15, 16]);

// ACE
const ace = extractSetupLevers(
  wheels(
    "Rigidità Molla",
    ["95000 N/m", "95000 N/m", "110000 N/m", "110000 N/m"],
    AX,
  ),
  "ace",
);
assert.deepEqual(ace.springs, {
  values: [95000, 95000, 110000, 110000],
  unit: "N/m",
});
const aceD = extractSetupLevers(
  [
    ...wheels(
      "Lento Estensione",
      ["5000 Ns/m", "5000 Ns/m", "6000 Ns/m", "6000 Ns/m"],
      AX,
    ),
    ...wheels("Veloce Compressione", ["1", "2", "3", "4"], AX),
  ],
  "ace",
);
assert.deepEqual(aceD.slowRebound, [5000, 5000, 6000, 6000]);
assert.deepEqual(aceD.fastBump, [1, 2, 3, 4]);
assert.equal(aceD.slowBump, undefined);

// AMS2: decimal comma, partial set, mixed units
assert.deepEqual(
  extractSetupLevers(
    wheels("Molla", ["225,5 N/mm", "225 N/mm", "180 N/mm", "180 N/mm"], AX),
    "ams2",
  ).springs,
  { values: [225.5, 225, 180, 180], unit: "N/mm" },
);
assert.equal(
  extractSetupLevers(
    [p("Molla FL", "225 N/mm"), p("Molla FR", "225 N/mm")],
    "ams2",
  ).springs,
  undefined,
  "front only",
);
assert.equal(
  extractSetupLevers(
    wheels("Molla", ["225 N/mm", "225 N/mm", "180000 N/m", "180000 N/m"], AX),
    "ams2",
  ).springs,
  undefined,
  "mixed units",
);
assert.equal(
  extractSetupLevers(wheels("Molla", ["n/d", "1", "2", "3"], AX), "ams2")
    .springs,
  undefined,
  "no number",
);
assert.deepEqual(extractSetupLevers([], "r3e"), {});

// A name of one game is not read as another game's
assert.equal(
  extractSetupLevers(
    wheels("Molla", ["1 N/mm", "1 N/mm", "1 N/mm", "1 N/mm"], AX),
    "ace",
  ).springs,
  undefined,
);

// AMS2 prompt <-> extractor stay in step
const prompt = buildAms2SetupSystemPrompt("Porsche 992 GT3 R");
assert.equal(AMS2_CANONICAL_PARAMS.length, 20);
assert.ok(AMS2_CANONICAL_PARAMS.every((name) => prompt.includes(name)));
assert.ok(prompt.includes("Porsche 992 GT3 R"));
const all = extractSetupLevers(
  AMS2_CANONICAL_PARAMS.map((name) => p(name, "7")),
  "ams2",
);
for (const k of ["slowBump", "slowRebound", "fastBump", "fastRebound"] as const)
  assert.deepEqual(all[k], [7, 7, 7, 7], k);
assert.deepEqual(all.springs, { values: [7, 7, 7, 7], unit: "" });
