// Regenerates src/main/ams2/ams2-cars.ts from the public "Cars of AMS2" sheet (CSV export).
import { writeFileSync } from "node:fs";

const URL =
  "https://docs.google.com/spreadsheets/d/1tJ899Wf-ElgVdhXFcQOG8ofQDYKTf8J6Lg8IXavCRxA/export?format=csv&gid=2095352073";
const OUT = "src/main/ams2/ams2-cars.ts";

// Minimal RFC 4180 parser: quoted fields, "" escapes, commas and newlines inside quotes.
const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') ((field += '"'), i++);
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") (row.push(field), (field = ""));
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) (row.push(field), rows.push(row));
  return rows;
};

const res = await fetch(URL);
if (!res.ok) throw new Error(`Sheet download failed: HTTP ${res.status}`);
const [, machine, ...data] = parseCsv(await res.text());
const col = Object.fromEntries(machine.map((h, i) => [h.trim(), i]));
for (const h of [
  "name",
  "weight",
  "weight_distribution",
  "driveline",
  "differential",
  "tank_size",
])
  if (!(h in col))
    throw new Error(`Missing column "${h}" in row 2 of the sheet`);

const num = (s) => Number.parseFloat(s.replaceAll(",", ""));
const cars = [];
for (const r of data) {
  const get = (h) => (r[col[h]] ?? "").trim();
  if (!get("weight")) continue; // category rows
  const weightKg = num(get("weight"));
  const frontPct = num(get("weight_distribution").split("/")[0]);
  if (!get("name") || !Number.isFinite(weightKg) || !Number.isFinite(frontPct))
    throw new Error(`Unparseable car row: ${JSON.stringify(r.slice(0, 8))}`);
  // Karts weigh ~155 kg, Copa Truck ~4900 kg. Range check also catches a decimal comma ("43,8") read as 438.
  if (weightKg < 100 || weightKg > 6000 || frontPct < 30 || frontPct > 70)
    throw new Error(`Out-of-range car row: ${JSON.stringify(r.slice(0, 8))}`);
  const tank = num(get("tank_size"));
  cars.push({
    name: get("name"),
    weightKg,
    frontPct,
    driveline: get("driveline"),
    differential: get("differential"),
    tankL: Number.isFinite(tank) ? tank : null,
  });
}

// Sanity floor: a truncated or column-shifted sheet must not overwrite the table.
if (cars.length < 150)
  throw new Error(
    `Only ${cars.length} cars parsed (expected ~208), not writing`,
  );

const header = `// Auto-generated from the community sheet "Cars of AMS2" (ams2cars.info) by scripts/update-ams2-cars.mjs - do not edit manually

export type Ams2Car = {
  name: string;
  weightKg: number;
  frontPct: number;
  driveline: string;
  differential: string;
  tankL: number | null;
};

export const AMS2_CARS: Ams2Car[] = `;
writeFileSync(OUT, `${header}${JSON.stringify(cars, null, 2)};\n`);
console.log(`${cars.length} cars written to ${OUT}`);
