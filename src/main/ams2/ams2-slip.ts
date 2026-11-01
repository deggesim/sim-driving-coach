export type SlipSample = {
  speedMps: number;
  wheelRadS: number[];
  brake: number;
  throttle: number;
  steering: number;
  gLat: number;
  gLon: number;
  driven?: boolean[]; // per wheel; unknown = all driven (strict everywhere)
};

// Driven wheels calibrate only off throttle: 6-10 such samples per lap at Monza
// (real ~31ms poll), so 30 took four laps. Undriven wheels also calibrate at
// steady speed under throttle (~230 per lap), where they roll freely.
const DRIVEN_SAMPLES = 10;
const FREE_SAMPLES = 30;
const ALL_DRIVEN = [true, true, true, true];

/** Driven wheels [FL, FR, RL, RR] from the AMS2 table's driveline; AWD/unknown = all. */
export const drivenWheels = (driveline: string | undefined): boolean[] =>
  driveline === "RWD"
    ? [false, false, true, true]
    : driveline === "FWD"
      ? [true, true, false, false]
      : ALL_DRIVEN;

const median = (v: number[]): number =>
  v.toSorted((a, b) => a - b)[v.length >> 1];

/**
 * AMS2 has no slip channel: slip = (r * |w| - v) / v, with the tyre radius r
 * self-calibrated per wheel as the median of v / |w| over straight-line samples
 * above 50 km/h with no brake: off throttle for the driven wheels, any steady
 * speed for the undriven ones.
 */
export const createSlipEstimator = (): {
  slip: (s: SlipSample) => number[] | undefined;
  radius: () => number[] | undefined; // calibrated per-wheel radius (m), if any
  reset: () => void;
} => {
  let samples: number[][] = [[], [], [], []];
  let radii: (number | undefined)[] = [
    undefined,
    undefined,
    undefined,
    undefined,
  ];
  const ready = (): number[] | undefined =>
    radii.every((r) => r !== undefined) ? (radii as number[]) : undefined;

  return {
    slip: (s) => {
      if (!ready()) {
        const base =
          s.speedMps > 50 / 3.6 &&
          s.brake === 0 &&
          Math.abs(s.steering) < 0.02 &&
          s.wheelRadS.every((w) => Math.abs(w) > 0);
        const coasting = base && s.throttle < 0.05 && Math.abs(s.gLat) < 0.05;
        const steady = base && Math.abs(s.gLat) < 0.1 && Math.abs(s.gLon) < 0.1;
        const driven = s.driven ?? ALL_DRIVEN;
        s.wheelRadS.forEach((w, i) => {
          if (radii[i] !== undefined) return;
          if (!(driven[i] ? coasting : coasting || steady)) return;
          samples[i].push(s.speedMps / Math.abs(w));
          // ponytail: radius frozen once enough samples, rolling median if tyre wear/pressure drift matters
          if (samples[i].length >= (driven[i] ? DRIVEN_SAMPLES : FREE_SAMPLES))
            radii[i] = median(samples[i]);
        });
      }
      const r = ready();
      if (!r) return undefined;
      if (s.speedMps < 1) return [0, 0, 0, 0];
      // ponytail: driven wheels coast ~1% fast in lift-off (drivetrain drag), so the calibrated radius reads ~1% high on them; ignored (spec)
      return s.wheelRadS.map(
        (w, i) => (r[i] * Math.abs(w) - s.speedMps) / s.speedMps,
      );
    },
    radius: ready,
    reset: () => {
      samples = [[], [], [], []];
      radii = [undefined, undefined, undefined, undefined];
    },
  };
};
