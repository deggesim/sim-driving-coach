/**
 * Per-zone chassis counters (ride height, bottoming, wheel-load regression
 * sums, suspension oscillation, straight-line steering), derived from one
 * lap's frames. Pure: no DB, no IPC. Presence is per counter family (see
 * ZoneData): a zone gets a family only if its frames carry the source channel
 * (`rh`, `wl`, `sus`, `gLat`), never a zero standing in for a missing channel.
 */
import type { CompactFrame, ZoneData } from "../shared/types.js";

export type ChassisCounters = Pick<
  ZoneData,
  "rideHeight" | "bottoming" | "loadFit" | "suspOsc" | "straightSteer"
>;

const BOTTOM_M = 0.003;
const BOTTOM_MIN_FRAMES = 3;
// Share of the lap's top speed above which a straight counts as "fast".
const FAST_STRAIGHT_SHARE = 0.7;
const STRAIGHT_GLAT = 0.3;
const HARD_BRAKE = 0.3;
const UPSET_WINDOW_MS = 500;
const UPSET_GLAT = 0.3;
const LOAD_GLAT = 0.05;
const LOAD_GLON = 0.05;
const LOAD_STEER = 0.02;
const LOAD_MIN_KMH = 30;
// Starting value, to tune per game on a live sim.
const SV_PEAK = 0.1; // m/s
const OSC_WINDOW_MS = 1000;
const OSC_REL = 0.3;
const OSC_HALF_CYCLES = 3;
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

// Velocity (m/s) of wheel w between consecutive frames; 0 where undefined.
const suspVelocity = (frames: CompactFrame[], w: number): number[] =>
  frames.map((f, i) => {
    const prev = frames[i - 1];
    const dt = prev ? (f.ts - prev.ts) / 1000 : 0;
    return f.sus && prev?.sus && dt > 0 ? (f.sus[w] - prev.sus[w]) / dt : 0;
  });

export const chassisCounters = (
  frames: CompactFrame[],
  zoneOf: (d: number) => number,
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
  // A lap whose every `rh` value is exactly 0 means an unpopulated field or a
  // wrong offset (AMS2, not yet verified live): treat it as no `rh`, otherwise
  // every frame would sit below BOTTOM_M and read as constant bottoming.
  const hasRh = frames.some((f) => f.rh?.some((h) => h !== 0));
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
      const hF = Math.min(frh[0], frh[1]);
      const hR = Math.min(frh[2], frh[3]);
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
      };
      rh.minF = Math.min(rh.minF, hF);
      rh.minR = Math.min(rh.minR, hR);
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
      if (phase !== "straight" && upsetAfter(frames, run.start)) b.upset++;
    });

    if (f.wl && f.wl.length >= 4) {
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
    }

    if (f.sus) c.suspOsc ??= { peaks: 0, oscillating: 0 };

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

  // Suspension oscillation, per wheel: a velocity peak, then sign changes of
  // the velocity above OSC_REL of the peak within OSC_WINDOW_MS. The next peak
  // is searched after that window.
  if (frames.some((f) => f.sus)) {
    for (let w = 0; w < 4; w++) {
      const v = suspVelocity(frames, w);
      for (let i = 1; i < frames.length - 1; i++) {
        const a = Math.abs(v[i]);
        if (a <= SV_PEAK || a <= Math.abs(v[i - 1]) || a < Math.abs(v[i + 1]))
          continue;
        let flips = 0;
        let sign = Math.sign(v[i]);
        let j = i + 1;
        for (; j < frames.length; j++) {
          if (frames[j].ts - frames[i].ts > OSC_WINDOW_MS) break;
          if (Math.abs(v[j]) <= OSC_REL * a) continue;
          if (Math.sign(v[j]) !== sign) {
            flips++;
            sign = -sign;
          }
        }
        const s = zoneFor(frames[i]).suspOsc!;
        s.peaks++;
        if (flips >= OSC_HALF_CYCLES) s.oscillating++;
        i = j - 1;
      }
    }
  }
  return out;
};
