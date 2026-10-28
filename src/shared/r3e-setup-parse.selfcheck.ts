// Self-check: l'aritmetica del parsing R3E (minValue + currentStep * stepSize) e
// la formattazione per-categoria vivevano dentro un componente React senza alcun
// test. Ora hanno due chiamanti su lati opposti dell'IPC: un errore qui sbaglia
// silenziosamente ogni setup R3E, sia incollato a mano sia preso dalla clipboard.
import assert from "node:assert/strict";
import { parseR3eSetupJson } from "./r3e-setup-parse.js";

const item = (
  id: string,
  minValue: number,
  stepSize: number,
  currentStep: number,
  extra: { suffix?: string | string[]; disabled?: boolean } = {},
) => ({
  id,
  minValue,
  stepSize,
  currentStep,
  suffix: extra.suffix ?? "",
  disabled: extra.disabled ?? false,
});

const parse = (values: unknown[]) =>
  parseR3eSetupJson(JSON.stringify({ values }));

// ── Brake bias: l'unico valore che diventa una coppia front/rear ──────────────
assert.deepEqual(parse([item("BrakeBias", 0.4, 0.01, 10)]), [
  { category: "Freni", parameter: "Brake Bias", value: "50.00/50.00%" },
]);

// ── Compound: indice → nome, non il numero ───────────────────────────────────
assert.equal(parse([item("TyreCompoundFront", 0, 1, 2)])[0].value, "Soft");
assert.equal(parse([item("TyreCompoundFront", 0, 1, 0)])[0].value, "Hard");

// ── Unità implicite per famiglia di parametro ────────────────────────────────
assert.equal(parse([item("SpringsFrontLeft", 100, 5, 2)])[0].value, "110 N/mm");
assert.equal(
  parse([item("TyrePressureFrontLeft", 150, 1, 15)])[0].value,
  "165 kPa",
);
assert.equal(parse([item("RideHeightRearRight", 5, 0.5, 4)])[0].value, "7 cm");
assert.equal(parse([item("FuelLoad", 0, 1, 42)])[0].value, "42 L");

// ── suffix: stringa o array, in quel caso vince il primo ────────────────────
assert.equal(
  parse([item("CamberFrontLeft", -4, 0.1, 5, { suffix: ["deg", "°"] })])[0]
    .value,
  "-3.5 deg",
);

// ── Categorie e label: camelCase → parole, "Toein" → "Toe In" ───────────────
assert.deepEqual(parse([item("AntiRollBarFront", 1, 1, 4)])[0], {
  category: "ARB",
  parameter: "Anti Roll Bar Front",
  value: "5",
});
assert.deepEqual(parse([item("ToeinFrontLeft", -0.2, 0.05, 4)])[0], {
  category: "Geometria",
  parameter: "Toe In Front Left",
  value: "0",
});
assert.equal(parse([item("QualcosaDiIgnoto", 0, 1, 1)])[0].category, "Altro");

// ── Gli item disabilitati non entrano nel setup ─────────────────────────────
assert.deepEqual(
  parse([item("BrakeBias", 0.4, 0.01, 10, { disabled: true })]),
  [],
);

// ── Testo che non è un setup: throw, non un array vuoto. È così che main.ts
//    distingue una clipboard con un setup da una clipboard con qualsiasi cosa.
assert.throws(() => parseR3eSetupJson("ciao come stai"));
assert.throws(
  () => parseR3eSetupJson('{"action":"setCarSetupValues"}'),
  /values/,
);
assert.throws(() => parseR3eSetupJson(""));

// Range limit of the raw value, from the real 2026-10-27 export.
const lim = (item: object) =>
  parseR3eSetupJson(JSON.stringify({ values: [item] }))[0].limit;
const brakeP = {
  id: "BrakePressure",
  minValue: 80,
  stepSize: 1,
  maxStep: 21,
  suffix: "%",
  disabled: false,
};
assert.equal(lim({ ...brakeP, currentStep: 21 }), "max");
assert.equal(lim({ ...brakeP, currentStep: 0 }), "min");
assert.equal(lim({ ...brakeP, currentStep: 20 }), undefined);
// Negative step: step 51 is the most negative camber, i.e. the lowest value.
const camberFL = {
  id: "CamberFrontLeft",
  minValue: 0,
  stepSize: -0.1,
  maxStep: 51,
  suffix: "deg",
  disabled: false,
};
assert.equal(lim({ ...camberFL, currentStep: 51 }), "min");
assert.equal(lim({ ...camberFL, currentStep: 0 }), "max");
// No range (maxStep 0) or no maxStep at all: no limit.
assert.equal(lim({ ...brakeP, currentStep: 0, maxStep: 0 }), undefined);
assert.equal(
  lim({
    id: "BrakePressure",
    currentStep: 0,
    minValue: 80,
    stepSize: 1,
    suffix: "%",
    disabled: false,
  }),
  undefined,
);

console.log("r3e-setup-parse selfcheck OK");
