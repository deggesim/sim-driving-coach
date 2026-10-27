/**
 * Numeric spring and damper values read back from a loaded setup, for the
 * "quadro assetto" checks (spring isofrequency, damper uniformity). Pure: the
 * input is the `SetupParam[]` the three setup importers already produce.
 * A family is present only when all four wheels were found with one unit —
 * a partial or mixed-unit family is absent, never zeros or a guessed value.
 */
import type { GameSource, SetupParam } from "../../shared/types.js";

type Quartet = [number, number, number, number];

export type SetupLevers = {
  springs?: { values: Quartet; unit: string }; // unit as in the setup ("N/mm", "N/m")
  slowBump?: Quartet;
  slowRebound?: Quartet;
  fastBump?: Quartet;
  fastRebound?: Quartet;
};

type Family = keyof SetupLevers;

const FAMILIES: Family[] = [
  "springs",
  "slowBump",
  "slowRebound",
  "fastBump",
  "fastRebound",
];

// Parameter-name prefix per family, in FAMILIES order.
// R3E: labels come from `idToLabel` ("FastBumpFrontLeft" -> "Fast Bump Front Left").
// The exact damper ids are still to be confirmed on a real export.
const PREFIXES: Record<GameSource, string[]> = {
  r3e: ["Springs", "Bump", "Rebound", "Fast Bump", "Fast Rebound"],
  ace: [
    "Rigidità Molla",
    "Lento Compressione",
    "Lento Estensione",
    "Veloce Compressione",
    "Veloce Estensione",
  ],
  // Canonical names imposed on the Vision prompt (AMS2_CANONICAL_PARAMS).
  ams2: ["Molla", "Slow Bump", "Slow Rebound", "Fast Bump", "Fast Rebound"],
};

// Wheel order FL, FR, RL, RR.
const WHEELS: Record<GameSource, string[]> = {
  r3e: ["Front Left", "Front Right", "Rear Left", "Rear Right"],
  ace: ["FL", "FR", "RL", "RR"],
  ams2: ["FL", "FR", "RL", "RR"],
};

/** First number of the text (decimal comma accepted) + the rest as unit. */
const readValue = (text: string): { n: number; unit: string } | null => {
  const m = /-?\d+(?:[.,]\d+)?/.exec(text);
  if (!m) return null;
  return {
    n: Number(m[0].replace(",", ".")),
    unit: text.slice(m.index + m[0].length).trim(),
  };
};

export const extractSetupLevers = (
  params: SetupParam[],
  game: GameSource,
): SetupLevers => {
  const byName = new Map(params.map((q) => [q.parameter.trim(), q.value]));
  const out: SetupLevers = {};
  FAMILIES.forEach((family, i) => {
    const read = WHEELS[game].map((w) => {
      const v = byName.get(`${PREFIXES[game][i]} ${w}`);
      return v === undefined ? null : readValue(v);
    });
    if (read.some((r) => r === null)) return;
    const found = read as { n: number; unit: string }[];
    if (found.some((r) => r.unit !== found[0].unit)) return;
    const values = found.map((r) => r.n) as Quartet;
    if (family === "springs") out.springs = { values, unit: found[0].unit };
    else out[family] = values;
  });
  return out;
};
