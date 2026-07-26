/**
 * Pure, deterministic session-stat precompute.
 *
 * The model narrates/judges but must NOT calculate: exact numeric facts
 * (lap deltas, convergence, alert counts, aid durations) are computed here from
 * the same ZoneData[] the prompt-builder consumes and passed as authoritative.
 * "Estimated impact per lap" is deliberately NOT computed (it stays a model judgment).
 */

import type {
  Alert,
  LapRow,
  SessionSetupRow,
  ZoneData,
} from "../../shared/types.js";

const FRAME_MS = 16;
const FLAT_EPS = 0.05; // seconds: |lastThird - firstThird| below this ⇒ "flat"

export type LapStat = {
  lapNumber: number;
  lapTime: number;
  deltaPrevSec: number | null; // lapTime[n] - lapTime[n-1]
  deltaBestSec: number; // lapTime[n] - bestLap
  gapToBestPct: number; // deltaBestSec / bestLap * 100
  valid: boolean;
  setupLabel: string | null;
};

export type CornerStat = {
  zone: number;
  dist: number;
  cornerName: string | null;
  alertCount: number;
  alertsByType: Record<string, number>;
  minSpeedKmh: number;
  maxBrakePct: number;
  tcEvents: number;
  tcMs: number;
  absEvents: number;
  absMs: number;
  overlapMs: number;
  brakeTempsC: [number, number, number, number] | null;
};

export type SessionStats = {
  lapCount: number;
  analyzableLapCount: number;
  bestLap: number | null;
  trend: "improving" | "worsening" | "mixed" | "flat";
  laps: LapStat[];
  criticalCorners: CornerStat[]; // sorted desc by alertCount
  setupCount: number;
};

export type ComputeStatsInput = {
  laps: LapRow[]; // ordered by lap_number asc
  bestLap: number | null;
  setups: SessionSetupRow[];
  alerts?: Alert[];
  cornerNames: Map<number, string>;
};

const avg = (arr: number[]): number =>
  arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

const parseZones = (json: string | null): ZoneData[] => {
  if (!json) return [];
  try {
    return JSON.parse(json) as ZoneData[];
  } catch {
    return [];
  }
};

export const computeSessionStats = (input: ComputeStatsInput): SessionStats => {
  const { laps, setups, alerts, cornerNames } = input;

  const times = laps.map((l) => l.lap_time);
  const bestLap = input.bestLap ?? (times.length ? Math.min(...times) : null);

  const setupLabelById = new Map<number, string>(
    setups.map((s) => [s.id, s.setup.name ?? s.setup.carFound]),
  );

  const lapStats: LapStat[] = laps.map((l, i) => {
    const deltaBestSec = bestLap != null ? l.lap_time - bestLap : 0;
    return {
      lapNumber: l.lap_number,
      lapTime: l.lap_time,
      deltaPrevSec: i > 0 ? l.lap_time - laps[i - 1].lap_time : null,
      deltaBestSec,
      gapToBestPct: bestLap ? (deltaBestSec / bestLap) * 100 : 0,
      valid: l.valid,
      setupLabel:
        l.setup_id != null ? (setupLabelById.get(l.setup_id) ?? null) : null,
    };
  });

  const analyzableLapCount = laps.filter(
    (l) => l.sector1 != null && l.sector2 != null && l.sector3 != null,
  ).length;

  // Trend heuristic: last-third vs first-third average lap time.
  // ponytail: 3-band heuristic; swap for linear regression if finer signal needed.
  let trend: SessionStats["trend"] = "flat";
  if (times.length >= 2) {
    const third = Math.max(1, Math.floor(times.length / 3));
    const diff = avg(times.slice(-third)) - avg(times.slice(0, third));
    const deltas = times.slice(1).map((t, i) => t - times[i]);
    const worseningCount = deltas.filter((d) => d > 0).length;
    const improvingCount = deltas.filter((d) => d < 0).length;
    if (Math.abs(diff) < FLAT_EPS) trend = "flat";
    else if (diff < 0) trend = worseningCount === 0 ? "improving" : "mixed";
    else trend = improvingCount === 0 ? "worsening" : "mixed";
  }

  // Critical corners: aggregate alerts by zone, then enrich from zones_json.
  const byZone = new Map<number, CornerStat>();
  for (const a of alerts ?? []) {
    let c = byZone.get(a.zone);
    if (!c) {
      c = {
        zone: a.zone,
        dist: a.dist,
        cornerName: cornerNames.get(a.zone) ?? null,
        alertCount: 0,
        alertsByType: {},
        minSpeedKmh: Infinity,
        maxBrakePct: 0,
        tcEvents: 0,
        tcMs: 0,
        absEvents: 0,
        absMs: 0,
        overlapMs: 0,
        brakeTempsC: null,
      };
      byZone.set(a.zone, c);
    }
    c.alertCount += 1;
    c.alertsByType[a.type] = (c.alertsByType[a.type] ?? 0) + 1;
  }

  for (const lap of laps) {
    for (const z of parseZones(lap.zones_json)) {
      const c = byZone.get(z.zone);
      if (!c) continue;
      c.minSpeedKmh = Math.min(c.minSpeedKmh, z.minSpeedKmh);
      c.maxBrakePct = Math.max(c.maxBrakePct, z.maxBrakePct);
      c.tcEvents += z.tcActivations;
      c.tcMs += (z.tcActiveFrames ?? 0) * FRAME_MS;
      c.absEvents += z.absActivations;
      c.absMs += (z.absActiveFrames ?? 0) * FRAME_MS;
      c.overlapMs += z.overlapFrames * FRAME_MS;
      if (z.avgBrakeTempC) c.brakeTempsC = z.avgBrakeTempC;
    }
  }

  const criticalCorners = [...byZone.values()]
    .map((c) => ({
      ...c,
      minSpeedKmh: Number.isFinite(c.minSpeedKmh) ? c.minSpeedKmh : 0,
    }))
    .sort((a, b) => b.alertCount - a.alertCount);

  return {
    lapCount: laps.length,
    analyzableLapCount,
    bestLap,
    trend,
    laps: lapStats,
    criticalCorners,
    setupCount: setups.length,
  };
};
