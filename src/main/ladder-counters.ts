/**
 * Per-zone event counts for the setup ladder, derived from one lap's frames.
 * Pure: no DB, no IPC. Presence is per counter family (see ZoneData): a family
 * whose source channel the frames lack is left out, never reported as 0.
 */
import type { CompactFrame, ZoneData } from "../shared/types.js";

export type LadderCounters = Pick<
  ZoneData,
  | "hardBrakeFrames"
  | "absHardBrakeFrames"
  | "srHardBrakeFrames"
  | "lockFramesFront"
  | "lockFramesRear"
  | "downshifts"
  | "nervousDownshifts"
  | "exitFrames"
  | "spinFramesFront"
  | "spinFramesRear"
  | "cornersEntry"
  | "cornersEntryUnder"
  | "cornersEntryOver"
  | "cornersExit"
  | "cornersExitOver"
>;

const HARD_BRAKE = 0.3;
// Starting value, to calibrate on a live sim: peak braking slip on many tyre
// models already sits around -0.08...-0.15, so a tighter lock flags ordinary braking.
const LOCK_SLIP = -0.25;
// Starting value, to calibrate on a live sim (same reason as LOCK_SLIP).
const NERVOUS_SLIP = -0.1;
const NERVOUS_WINDOW_MS = 500;
const LIFTED_THROTTLE = 0.05;
const EXIT_THROTTLE = 0.5;
const SPIN_ASYMMETRY = 0.15;
const STEER_ON = 0.05;
const CORNER_MERGE_MS = 300;
const CORNER_MIN_MS = 1000;
const CORNER_MIN_SPEED_MS = 10;
const PHASE_MIN_FRAMES = 3;
const ENTRY_BRAKE = 0.05;
const MID_THROTTLE = 0.2;
const PHASE_UNDER = 0.85;
const PHASE_OVER = 1.15;

const SR_KEYS = [
  "srHardBrakeFrames",
  "lockFramesFront",
  "lockFramesRear",
  "downshifts",
  "nervousDownshifts",
  "exitFrames",
  "spinFramesFront",
  "spinFramesRear",
] as const;
const CORNER_KEYS = [
  "cornersEntry",
  "cornersEntryUnder",
  "cornersEntryOver",
  "cornersExit",
  "cornersExitOver",
] as const;

const mean = (xs: number[]): number | undefined =>
  xs.length >= PHASE_MIN_FRAMES
    ? xs.reduce((a, b) => a + b, 0) / xs.length
    : undefined;

// Contiguous steering runs, merged across gaps < CORNER_MERGE_MS, short ones dropped.
const corners = (frames: CompactFrame[]): CompactFrame[][] => {
  const out: CompactFrame[][] = [];
  let cur: CompactFrame[] = [];
  for (const f of frames) {
    if (Math.abs(f.str) <= STEER_ON) continue;
    if (cur.length > 0 && f.ts - cur[cur.length - 1].ts >= CORNER_MERGE_MS) {
      out.push(cur);
      cur = [];
    }
    cur.push(f);
  }
  if (cur.length > 0) out.push(cur);
  return out.filter((c) => c[c.length - 1].ts - c[0].ts >= CORNER_MIN_MS);
};

export const ladderCounters = (
  frames: CompactFrame[],
  zoneOf: (d: number) => number,
): Map<number, LadderCounters> => {
  const out = new Map<number, LadderCounters>();
  const hasGLat = frames.some((f) => f.gLat !== undefined);
  const zoneFor = (f: CompactFrame): LadderCounters => {
    let c = out.get(zoneOf(f.d));
    if (!c) {
      c = { hardBrakeFrames: 0, absHardBrakeFrames: 0 };
      out.set(zoneOf(f.d), c);
    }
    return c;
  };
  const bump = (c: LadderCounters, key: keyof LadderCounters): void => {
    c[key] = (c[key] ?? 0) + 1;
  };

  // A zone gets the sr family as soon as one of its frames carries `sr`.
  for (const f of frames) {
    const c = zoneFor(f);
    if (f.sr && c.downshifts === undefined) for (const k of SR_KEYS) c[k] = 0;
  }

  frames.forEach((f, i) => {
    const c = zoneFor(f);
    const hard = f.brk > HARD_BRAKE;
    if (hard) {
      bump(c, "hardBrakeFrames");
      if (f.abs > 0) bump(c, "absHardBrakeFrames");
    }
    const sr = f.sr;
    if (sr && c.downshifts !== undefined) {
      if (hard) bump(c, "srHardBrakeFrames");
      if (hard && Math.min(sr[0], sr[1]) < LOCK_SLIP)
        bump(c, "lockFramesFront");
      if (hard && Math.min(sr[2], sr[3]) < LOCK_SLIP) bump(c, "lockFramesRear");
      if (f.thr > EXIT_THROTTLE && Math.abs(f.str) > STEER_ON) {
        bump(c, "exitFrames");
        if (Math.abs(sr[0] - sr[1]) > SPIN_ASYMMETRY)
          bump(c, "spinFramesFront");
        if (Math.abs(sr[2] - sr[3]) > SPIN_ASYMMETRY) bump(c, "spinFramesRear");
      }
    }
    const prev = frames[i - 1];
    // Counted only on frames carrying `sr`, so nervous/downshifts share one population.
    if (
      sr &&
      c.downshifts !== undefined &&
      prev &&
      f.gear < prev.gear &&
      f.gear > 0 &&
      prev.gear > 0 &&
      (f.brk > 0 || f.thr <= LIFTED_THROTTLE)
    ) {
      bump(c, "downshifts");
      for (let j = i; j < frames.length; j++) {
        if (frames[j].ts - f.ts > NERVOUS_WINDOW_MS) break;
        const r = frames[j].sr;
        if (r && Math.min(r[2], r[3]) < NERVOUS_SLIP) {
          bump(c, "nervousDownshifts");
          break;
        }
      }
    }
  });

  if (!hasGLat) return out;

  for (const corner of corners(frames)) {
    const c = zoneFor(corner[0]);
    for (const k of CORNER_KEYS) c[k] ??= 0;
    const ks = corner.flatMap((f) => {
      const v = f.spd / 3.6;
      return f.gLat === undefined || v <= CORNER_MIN_SPEED_MS
        ? []
        : [{ f, k: Math.abs(f.gLat) / (v * v * Math.abs(f.str)) }];
    });
    const phase = (keep: (f: CompactFrame) => boolean): number | undefined =>
      mean(ks.filter((x) => keep(x.f)).map((x) => x.k));
    const entry = phase((f) => f.brk > ENTRY_BRAKE);
    const mid = phase((f) => f.brk <= ENTRY_BRAKE && f.thr <= MID_THROTTLE);
    const exit = phase((f) => f.thr > EXIT_THROTTLE);
    if (mid === undefined) continue;
    if (entry !== undefined) {
      bump(c, "cornersEntry");
      if (entry < PHASE_UNDER * mid) bump(c, "cornersEntryUnder");
      if (entry > PHASE_OVER * mid) bump(c, "cornersEntryOver");
    }
    if (exit !== undefined) {
      bump(c, "cornersExit");
      if (exit > PHASE_OVER * mid) bump(c, "cornersExitOver");
    }
  }
  return out;
};
