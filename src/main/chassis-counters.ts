/**
 * Per-zone chassis counters (ride height, bottoming, wheel-load regression
 * sums, straight-line steering), derived from one lap's frames. Pure: no DB,
 * no IPC. Presence is per counter family (see ZoneData): a zone gets a family
 * only if its frames carry the source channel (`rh`, `wl`, `gLat`), never a
 * zero standing in for a missing channel.
 */
import type { CompactFrame, ZoneData } from "../shared/types.js";

export type ChassisCounters = Pick<
  ZoneData,
  "rideHeight" | "bottoming" | "loadFit" | "straightSteer"
>;

const BOTTOM_M = 0.003;
const BOTTOM_MIN_FRAMES = 3;
// Plausible lap median of the axle-mean ride height; outside it, `rh` is absent.
const RH_MEDIAN_MIN_M = 0.005;
const RH_MEDIAN_MAX_M = 0.3;
// Share of the lap's top speed above which a straight counts as "fast".
const FAST_STRAIGHT_SHARE = 0.7;
const STRAIGHT_GLAT = 0.3;
const HARD_BRAKE = 0.3;
const UPSET_WINDOW_MS = 500;
const UPSET_GLAT = 0.3;
// 0.05 g kept ~14 frames per lap at Monza, all at 250-260 km/h; 0.1 g keeps
// ~400 and matches the low-speed front share within 1-1.5 points.
const LOAD_GLAT = 0.1;
const LOAD_GLON = 0.1;
const LOAD_STEER = 0.02;
const LOAD_MIN_KMH = 30;
const LOAD_LOW_KMH = 120;
const STEER_STRAIGHT_KMH = 150;
const STEER_STRAIGHT_GLAT = 0.2;
const STEER_REVERSAL = 0.01;
const MID_STEER = 0.05;
const MID_BRAKE = 0.05;
const MID_THROTTLE = 0.2;

type Phase = "straight" | "brake" | "other";

// An upset: the steering changes sign and lateral g swings by > UPSET_GLAT
// within UPSET_WINDOW_MS of frame i.
const upsetAfter = (frames: CompactFrame[], i: number): boolean => {
  let lo = Infinity;
  let hi = -Infinity;
  let pos = false;
  let neg = false;
  for (let j = i; j < frames.length; j++) {
    const f = frames[j];
    if (f.ts - frames[i].ts > UPSET_WINDOW_MS) break;
    if (f.gLat !== undefined) {
      lo = Math.min(lo, f.gLat);
      hi = Math.max(hi, f.gLat);
    }
    if (f.str > 0) pos = true;
    if (f.str < 0) neg = true;
  }
  return pos && neg && hi - lo > UPSET_GLAT;
};

export const chassisCounters = (
  frames: CompactFrame[],
  zoneOf: (d: number) => number,
  // Kept out of the lap by the readers; the speed limiter is the steady slow
  // run that anchors the load fit's intercept (weight-distribution.ts).
  pitFrames: CompactFrame[] = [],
): Map<number, ChassisCounters> => {
  const out = new Map<number, ChassisCounters>();
  const zoneFor = (f: CompactFrame): ChassisCounters => {
    const z = zoneOf(f.d);
    let c = out.get(z);
    if (!c) {
      c = {};
      out.set(z, c);
    }
    return c;
  };
  const addLoad = (c: ChassisCounters, f: CompactFrame): void => {
    if (!f.wl || f.wl.length < 4) return;
    const lf = (c.loadFit ??= {
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
    });
    if (
      f.gLat !== undefined &&
      f.gLon !== undefined &&
      Math.abs(f.gLat) < LOAD_GLAT &&
      Math.abs(f.gLon) < LOAD_GLON &&
      Math.abs(f.str) < LOAD_STEER &&
      f.spd >= LOAD_MIN_KMH &&
      f.wl.every((w) => w > 0)
    ) {
      const x = (f.spd / 3.6) ** 2;
      const yF = f.wl[0] + f.wl[1];
      const yR = f.wl[2] + f.wl[3];
      lf.n++;
      if (f.spd < LOAD_LOW_KMH) lf.nLow = (lf.nLow ?? 0) + 1;
      lf.sx += x;
      lf.sxx += x * x;
      lf.syF += yF;
      lf.syR += yR;
      lf.sxyF += x * yF;
      lf.sxyR += x * yR;
      if (f.fuel !== undefined) {
        lf.fuelSum += f.fuel;
        lf.fuelN++;
      }
    }
  };
  // A lap whose median axle-mean `rh` is outside RH_MEDIAN_MIN_M..RH_MEDIAN_MAX_M
  // means an unpopulated field, a wrong offset or a unit error (offsets not yet
  // verified live; all zeros is one case): treat it as no `rh`, otherwise
  // every frame could sit below BOTTOM_M and read as constant bottoming.
  const axleMeans = frames
    .flatMap((f) =>
      f.rh ? [(f.rh[0] + f.rh[1]) / 2, (f.rh[2] + f.rh[3]) / 2] : [],
    )
    .toSorted((a, b) => a - b);
  const median = axleMeans[Math.floor(axleMeans.length / 2)];
  const hasRh = median >= RH_MEDIAN_MIN_M && median <= RH_MEDIAN_MAX_M;
  const vMax = frames.reduce((m, f) => Math.max(m, f.spd), 0);
  const phaseOf = (f: CompactFrame): Phase =>
    f.brk > HARD_BRAKE
      ? "brake"
      : f.gLat !== undefined &&
          f.spd > FAST_STRAIGHT_SHARE * vMax &&
          Math.abs(f.gLat) < STRAIGHT_GLAT
        ? "straight"
        : "other";

  // Bottoming run state per axle: [front, rear].
  const runs = [
    { len: 0, start: 0 },
    { len: 0, start: 0 },
  ];
  // Zigzag state for straight-line steering. Reset whenever the straight breaks.
  let steerDir = 0;
  let steerExt = 0;
  let steerArmed = false;

  frames.forEach((f, i) => {
    const c = zoneFor(f);

    const frh = hasRh ? f.rh : undefined;
    if (frh) {
      // Minimum: the lower wheel. Straight/mid sums: the axle mean, so roll
      // alone does not open a gap between the straight and mid-corner.
      const hF = (frh[0] + frh[1]) / 2;
      const hR = (frh[2] + frh[3]) / 2;
      const rh = (c.rideHeight ??= {
        minF: Infinity,
        minR: Infinity,
        straightF: 0,
        straightR: 0,
        straightN: 0,
        midF: 0,
        midR: 0,
        midN: 0,
      });
      c.bottoming ??= {
        straight: 0,
        brake: 0,
        other: 0,
        upset: 0,
        front: 0,
        rear: 0,
        straightFront: 0,
        straightRear: 0,
        upsetFront: 0,
        upsetRear: 0,
      };
      rh.minF = Math.min(rh.minF, frh[0], frh[1]);
      rh.minR = Math.min(rh.minR, frh[2], frh[3]);
      if (phaseOf(f) === "straight") {
        rh.straightF += hF;
        rh.straightR += hR;
        rh.straightN++;
      }
      if (
        Math.abs(f.str) > MID_STEER &&
        f.brk <= MID_BRAKE &&
        f.thr <= MID_THROTTLE
      ) {
        rh.midF += hF;
        rh.midR += hR;
        rh.midN++;
      }
    }
    // One event per axle: BOTTOM_MIN_FRAMES consecutive frames under BOTTOM_M,
    // counted once when the run reaches that length, on its first frame's zone.
    [0, 1].forEach((axle) => {
      const run = runs[axle];
      const h = frh && Math.min(frh[axle * 2], frh[axle * 2 + 1]);
      if (h === undefined || h >= BOTTOM_M) {
        run.len = 0;
        return;
      }
      if (run.len++ === 0) run.start = i;
      if (run.len !== BOTTOM_MIN_FRAMES) return;
      const first = frames[run.start];
      const b = zoneFor(first).bottoming!;
      const phase = phaseOf(first);
      b[phase]++;
      b[axle === 0 ? "front" : "rear"]++;
      if (phase === "straight")
        b[axle === 0 ? "straightFront" : "straightRear"]++;
      else if (upsetAfter(frames, run.start)) {
        b.upset++;
        b[axle === 0 ? "upsetFront" : "upsetRear"]++;
      }
    });

    addLoad(c, f);

    if (f.gLat !== undefined) {
      const ss = (c.straightSteer ??= { metres: 0, reversals: 0 });
      if (
        f.spd > STEER_STRAIGHT_KMH &&
        Math.abs(f.gLat) < STEER_STRAIGHT_GLAT
      ) {
        const prev = frames[i - 1];
        if (prev) ss.metres += (f.spd / 3.6) * ((f.ts - prev.ts) / 1000);
        if (!steerArmed) {
          steerArmed = true;
          steerDir = 0;
          steerExt = f.str;
        } else if (steerDir === 0) {
          if (Math.abs(f.str - steerExt) > STEER_REVERSAL) {
            steerDir = Math.sign(f.str - steerExt);
            steerExt = f.str;
          }
        } else if (f.str * steerDir > steerExt * steerDir) {
          steerExt = f.str;
        } else if ((steerExt - f.str) * steerDir > STEER_REVERSAL) {
          ss.reversals++;
          steerDir = -steerDir;
          steerExt = f.str;
        }
      } else steerArmed = false;
    } else steerArmed = false;
  });

  // Pit-lane frames: only the load fit, in the lap's first zone.
  if (frames[0]) pitFrames.forEach((f) => addLoad(zoneFor(frames[0]), f));
  return out;
};
