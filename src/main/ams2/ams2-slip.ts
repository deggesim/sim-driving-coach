export type SlipSample = {
  speedMps: number;
  wheelRadS: number[];
  brake: number;
  throttle: number;
  steering: number;
  gLat: number;
};

const CALIBRATION_SAMPLES = 100;

const median = (v: number[]): number =>
  v.toSorted((a, b) => a - b)[v.length >> 1];

/**
 * AMS2 has no slip channel: slip = (r * |w| - v) / v, with the tyre radius r
 * self-calibrated per wheel as the median of v / |w| over the first 100 samples
 * of pure rolling (straight, no brake, off throttle, > 50 km/h).
 */
export const createSlipEstimator = (): {
  slip: (s: SlipSample) => number[] | undefined;
  radius: () => number[] | undefined; // calibrated per-wheel radius (m), if any
  reset: () => void;
} => {
  let samples: number[][] = [[], [], [], []];
  let radius: number[] | undefined;

  return {
    slip: (s) => {
      if (!radius) {
        const rolling =
          s.speedMps > 50 / 3.6 &&
          s.brake === 0 &&
          s.throttle < 0.05 &&
          Math.abs(s.steering) < 0.02 &&
          Math.abs(s.gLat) < 0.05 &&
          s.wheelRadS.every((w) => Math.abs(w) > 0);
        if (rolling) {
          s.wheelRadS.forEach((w, i) =>
            samples[i].push(s.speedMps / Math.abs(w)),
          );
          // ponytail: radius frozen after 100 samples, rolling median if tyre wear/pressure drift matters
          if (samples[0].length >= CALIBRATION_SAMPLES)
            radius = samples.map(median);
        }
        if (!radius) return undefined;
      }
      if (s.speedMps < 1) return [0, 0, 0, 0];
      // ponytail: driven wheels coast ~1% fast in lift-off (drivetrain drag), so the calibrated radius reads ~1% high on them; ignored (spec)
      const r = radius;
      return s.wheelRadS.map(
        (w, i) => (r[i] * Math.abs(w) - s.speedMps) / s.speedMps,
      );
    },
    radius: () => radius,
    reset: () => {
      samples = [[], [], [], []];
      radius = undefined;
    },
  };
};
