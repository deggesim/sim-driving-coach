import type { Ams2Car } from "../ams2/ams2-cars.js";
import type { GameSource, LoadFitSums, ZoneData } from "../../shared/types.js";

const MIN_LOAD_SAMPLES = 300;
// Samples below 120 km/h that anchor the intercept: from 175-270 km/h alone the
// fit extrapolated ACE at Monza to 1795 kg and 46 % front (real ~1390 kg, 38 %).
const MIN_LOW_SAMPLES = 20;
// Relative floor for the regression denominator: below it every sample sits at one speed.
const MIN_SPREAD = 1e-9;
// Aero load at the mean sampled v² must be this share of the static load, else the slope is noise.
const MIN_AERO_SHARE = 0.01;
// Plausible measured front share (%); outside it the fit is not a car.
const MIN_FRONT_PCT = 30;
const MAX_FRONT_PCT = 70;

export type WeightDistribution =
  | {
      known: true;
      frontPct: number;
      source: "measured" | "AMS2 table";
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
          source: "AMS2 table",
          aeroFrontPct: null,
          fuelL: null,
        }
      : unknown("car not in the AMS2 table");

  const fits = zones.flatMap((z) => (z.loadFit ? [z.loadFit] : []));
  if (fits.length === 0) return unknown("wheel load not available");
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
      nLow: (a.nLow ?? 0) + (f.nLow ?? 0),
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
      nLow: 0,
    },
  );
  if (t.n < MIN_LOAD_SAMPLES)
    return unknown(`fewer than ${MIN_LOAD_SAMPLES} straight-line samples`);
  if ((t.nLow ?? 0) < MIN_LOW_SAMPLES)
    return unknown(
      `fewer than ${MIN_LOW_SAMPLES} straight-line samples below 120 km/h (one pass down the pit lane is enough)`,
    );

  const den = t.n * t.sxx - t.sx * t.sx;
  if (!(den > MIN_SPREAD * t.n * t.sxx))
    return unknown("all samples at the same speed");

  const slope = (sxy: number, sy: number) => (t.n * sxy - t.sx * sy) / den;
  const bF = slope(t.sxyF, t.syF);
  const bR = slope(t.sxyR, t.syR);
  const aF = (t.syF - bF * t.sx) / t.n;
  const aR = (t.syR - bR * t.sx) / t.n;
  // Loads of 0 / -1 (channel missing) or a non-physical fit: no distribution, never NaN.
  if (!Number.isFinite(aF + aR) || aF <= 0 || aR <= 0)
    return unknown("wheel load not available");
  const frontPct = (aF / (aF + aR)) * 100;
  if (frontPct < MIN_FRONT_PCT || frontPct > MAX_FRONT_PCT)
    return unknown("measured distribution not plausible");

  const aeroOk =
    bF >= 0 &&
    bR >= 0 &&
    (bF + bR) * (t.sx / t.n) >= MIN_AERO_SHARE * (aF + aR);

  return {
    known: true,
    frontPct,
    source: "measured",
    aeroFrontPct: aeroOk ? (bF / (bF + bR)) * 100 : null,
    fuelL: t.fuelN > 0 ? t.fuelSum / t.fuelN : null,
  };
};
