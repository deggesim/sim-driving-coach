import type { Ams2Car } from "../ams2/ams2-cars.js";
import type { GameSource, LoadFitSums, ZoneData } from "../../shared/types.js";

const MIN_LOAD_SAMPLES = 300;
// Relative floor for the regression denominator: below it every sample sits at one speed.
const MIN_SPREAD = 1e-9;

export type WeightDistribution =
  | {
      known: true;
      frontPct: number;
      source: "misurata" | "tabella AMS2";
      aeroFrontPct: number | null;
      fuelL: number | null;
    }
  | { known: false; reason: string };

const unknown = (reason: string): WeightDistribution => ({
  known: false,
  reason,
});

// Static front share: from the AMS2 car table there, else from the intercept of
// axle load vs v² summed over every zone (intercept = static, slope = aero).
export const weightDistribution = (
  game: GameSource,
  zones: ZoneData[],
  car: Ams2Car | null,
): WeightDistribution => {
  if (game === "ams2")
    return car
      ? {
          known: true,
          frontPct: car.frontPct,
          source: "tabella AMS2",
          aeroFrontPct: null,
          fuelL: null,
        }
      : unknown("auto non presente nella tabella AMS2");

  const fits = zones.flatMap((z) => (z.loadFit ? [z.loadFit] : []));
  if (fits.length === 0) return unknown("carico ruota non disponibile");
  const t = fits.reduce<LoadFitSums>(
    (a, f) => ({
      n: a.n + f.n,
      sx: a.sx + f.sx,
      sxx: a.sxx + f.sxx,
      syF: a.syF + f.syF,
      syR: a.syR + f.syR,
      sxyF: a.sxyF + f.sxyF,
      sxyR: a.sxyR + f.sxyR,
      fuelSum: a.fuelSum + f.fuelSum,
      fuelN: a.fuelN + f.fuelN,
    }),
    {
      n: 0,
      sx: 0,
      sxx: 0,
      syF: 0,
      syR: 0,
      sxyF: 0,
      sxyR: 0,
      fuelSum: 0,
      fuelN: 0,
    },
  );
  if (t.n < MIN_LOAD_SAMPLES)
    return unknown(`meno di ${MIN_LOAD_SAMPLES} campioni in linea retta`);

  const den = t.n * t.sxx - t.sx * t.sx;
  if (!(den > MIN_SPREAD * t.n * t.sxx))
    return unknown("campioni tutti alla stessa velocità");

  const slope = (sxy: number, sy: number) => (t.n * sxy - t.sx * sy) / den;
  const bF = slope(t.sxyF, t.syF);
  const bR = slope(t.sxyR, t.syR);
  const aF = (t.syF - bF * t.sx) / t.n;
  const aR = (t.syR - bR * t.sx) / t.n;
  // Loads of 0 / -1 (channel missing) or a non-physical fit: no distribution, never NaN.
  if (!Number.isFinite(aF + aR) || aF <= 0 || aR <= 0)
    return unknown("carico ruota non disponibile");

  return {
    known: true,
    frontPct: (aF / (aF + aR)) * 100,
    source: "misurata",
    aeroFrontPct: bF + bR > 0 ? (bF / (bF + bR)) * 100 : null,
    fuelL: t.fuelN > 0 ? t.fuelSum / t.fuelN : null,
  };
};
