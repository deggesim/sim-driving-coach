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
const SUS_ASYM_EPS_MM = 2; // ponytail: noise floor, tighten if real setups need finer resolution
const SLIP_ASYM_EPS = 0.02; // ratio units, same rationale

type Quartet = [number, number, number, number];

const zeroQuartet = (): Quartet => [0, 0, 0, 0];

/** Running sum of one per-wheel channel plus how many laps carried it. */
type ChannelAccum = { sum: Quartet; laps: number };

const zeroChannel = (): ChannelAccum => ({ sum: zeroQuartet(), laps: 0 });

const addChannel = (into: ChannelAccum, vals: Quartet | undefined): void => {
  if (!vals) return;
  for (let i = 0; i < 4; i++) into.sum[i] += vals[i];
  into.laps += 1;
};

/**
 * Mean over the laps that carried this channel, or null when none did.
 * Counting per channel matters: AMS2 supplies pressures and suspension travel
 * but no slip ratio, so one shared lap counter would divide a channel's sum by
 * another channel's lap count. All-zero counts as absent too - a zero reaching
 * the prompt reads as a measurement.
 */
const meanChannel = (ch: ChannelAccum | undefined): Quartet | null =>
  !ch || ch.laps === 0 || ch.sum.every((v) => v === 0)
    ? null
    : (ch.sum.map((v) => v / ch.laps) as Quartet);

/** Per-zone running sums for the fields averaged across laps. Kept beside byZone
 * so the returned CornerStat carries no scratch state. */
type CornerAccum = {
  laps: number;
  steerSum: number;
  tp: ChannelAccum;
  sr: ChannelAccum;
  sus: ChannelAccum;
  tt: ChannelAccum;
};

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
  maxSteerAbs: number;
  steerDuringBrake: number; // averaged over the laps carrying this zone
  maxGLat: number | null;
  maxGLon: number | null;
  tcEvents: number;
  tcMs: number;
  absEvents: number;
  absMs: number;
  overlapMs: number;
  brakeTempsC: Quartet | null;
  // Averaged over the laps that carried each channel; null when no lap did
  // (AMS2 has no slip ratio) - never a floored zero.
  avgTyrePressure: Quartet | null;
  avgSlipRatio: Quartet | null;
  avgSuspTravel: Quartet | null;
  avgTyreTempC: Quartet | null;
};

export type SessionStats = {
  lapCount: number;
  analyzableLapCount: number;
  bestLap: number | null;
  trend: "improving" | "worsening" | "mixed" | "flat";
  laps: LapStat[];
  criticalCorners: CornerStat[]; // sorted desc by alertCount
  setupCount: number;
  // Ambient conditions, averaged across every zone of every lap (ACE, AMS2 -
  // not a per-corner channel, since it barely varies within a session).
  avgAirTempC: number | null;
  avgRoadTempC: number | null;
  // Weather, AMS2 only, same session-wide averaging rationale.
  avgRainDensity: number | null;
  avgWindSpeed: number | null;
  avgCloudBrightness: number | null;
  // Setup-diagnostic asymmetries: session-wide (every zone, not just critical
  // corners) and epsilon-gated to null below the noise floor. Camber, ride
  // height and diff power/coast are static setup values with no telemetry
  // channel of their own - these give Claude a citable number when proposing
  // changes to those levers instead of just the raw setup value.
  suspAsymFrontMm: number | null; // corsa sospensione media FL-FR
  suspAsymRearMm: number | null; // RL-RR
  slipAsymFrontThrottle: number | null; // slip ratio medio FL-FR in trazione (gas>5%)
  slipAsymRearThrottle: number | null; // RL-RR in trazione
  slipAsymFrontRelease: number | null; // FL-FR fuori trazione (rilascio/frenata/coasting)
  slipAsymRearRelease: number | null; // RL-RR fuori trazione
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
  const accums = new Map<number, CornerAccum>();
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
        maxSteerAbs: 0,
        steerDuringBrake: 0,
        maxGLat: null,
        maxGLon: null,
        tcEvents: 0,
        tcMs: 0,
        absEvents: 0,
        absMs: 0,
        overlapMs: 0,
        brakeTempsC: null,
        avgTyrePressure: null,
        avgSlipRatio: null,
        avgSuspTravel: null,
        avgTyreTempC: null,
      };
      byZone.set(a.zone, c);
    }
    c.alertCount += 1;
    c.alertsByType[a.type] = (c.alertsByType[a.type] ?? 0) + 1;
  }

  let airTempSum = 0;
  let airTempCount = 0;
  let roadTempSum = 0;
  let roadTempCount = 0;
  let rainSum = 0;
  let rainCount = 0;
  let windSum = 0;
  let windCount = 0;
  let cloudSum = 0;
  let cloudCount = 0;

  // Session-wide (every zone, unlike the per-corner accums below which only
  // cover zones with an alert).
  const sessionSus = zeroChannel();
  const sessionSlipThrottle = zeroChannel();
  const sessionSlipRelease = zeroChannel();

  for (const lap of laps) {
    for (const z of parseZones(lap.zones_json)) {
      addChannel(sessionSus, z.avgSuspTravel);
      addChannel(sessionSlipThrottle, z.avgSlipRatioThrottle);
      addChannel(sessionSlipRelease, z.avgSlipRatioRelease);

      if (z.avgAirTempC != null) {
        airTempSum += z.avgAirTempC;
        airTempCount += 1;
      }
      if (z.avgRoadTempC != null) {
        roadTempSum += z.avgRoadTempC;
        roadTempCount += 1;
      }
      if (z.avgRainDensity != null) {
        rainSum += z.avgRainDensity;
        rainCount += 1;
      }
      if (z.avgWindSpeed != null) {
        windSum += z.avgWindSpeed;
        windCount += 1;
      }
      if (z.avgCloudBrightness != null) {
        cloudSum += z.avgCloudBrightness;
        cloudCount += 1;
      }

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
      c.maxSteerAbs = Math.max(c.maxSteerAbs, z.maxSteerAbs);
      if (z.maxGLat != null) c.maxGLat = Math.max(c.maxGLat ?? 0, z.maxGLat);
      if (z.maxGLon != null) c.maxGLon = Math.max(c.maxGLon ?? 0, z.maxGLon);

      let a = accums.get(z.zone);
      if (!a) {
        a = {
          laps: 0,
          steerSum: 0,
          tp: zeroChannel(),
          sr: zeroChannel(),
          sus: zeroChannel(),
          tt: zeroChannel(),
        };
        accums.set(z.zone, a);
      }
      a.laps += 1;
      a.steerSum += z.steerDuringBrake;
      addChannel(a.tp, z.avgTyrePressure);
      addChannel(a.sr, z.avgSlipRatio);
      addChannel(a.sus, z.avgSuspTravel);
      addChannel(a.tt, z.avgTyreTempC);
    }
  }

  // ponytail: TODO — a corner with alerts but no zone data in any lap (P1/P2
  // fired on a lap that never completed) is floored to 0 here and renders as
  // "v.min 0km/h, freno 0%" in the prompt, which the model can read as a real
  // measured zero. Upgrade path: keep it null and have buildStatsBlock omit the
  // field instead of flooring it.
  const criticalCorners = [...byZone.values()]
    .map((c) => {
      const acc = accums.get(c.zone);
      return {
        ...c,
        minSpeedKmh: Number.isFinite(c.minSpeedKmh) ? c.minSpeedKmh : 0,
        steerDuringBrake: acc?.laps ? acc.steerSum / acc.laps : 0,
        avgTyrePressure: meanChannel(acc?.tp),
        avgSlipRatio: meanChannel(acc?.sr),
        avgSuspTravel: meanChannel(acc?.sus),
        avgTyreTempC: meanChannel(acc?.tt),
      };
    })
    .sort((a, b) => b.alertCount - a.alertCount);

  const meanSus = meanChannel(sessionSus); // m, FL/FR/RL/RR
  const meanSlipThrottle = meanChannel(sessionSlipThrottle);
  const meanSlipRelease = meanChannel(sessionSlipRelease);

  const gateMm = (delta: number): number | null =>
    Math.abs(delta) > SUS_ASYM_EPS_MM ? delta : null;
  const gateSlip = (delta: number): number | null =>
    Math.abs(delta) > SLIP_ASYM_EPS ? delta : null;

  return {
    lapCount: laps.length,
    analyzableLapCount,
    bestLap,
    trend,
    laps: lapStats,
    criticalCorners,
    setupCount: setups.length,
    avgAirTempC: airTempCount > 0 ? airTempSum / airTempCount : null,
    avgRoadTempC: roadTempCount > 0 ? roadTempSum / roadTempCount : null,
    avgRainDensity: rainCount > 0 ? rainSum / rainCount : null,
    avgWindSpeed: windCount > 0 ? windSum / windCount : null,
    avgCloudBrightness: cloudCount > 0 ? cloudSum / cloudCount : null,
    suspAsymFrontMm: meanSus ? gateMm((meanSus[0] - meanSus[1]) * 1000) : null,
    suspAsymRearMm: meanSus ? gateMm((meanSus[2] - meanSus[3]) * 1000) : null,
    slipAsymFrontThrottle: meanSlipThrottle
      ? gateSlip(meanSlipThrottle[0] - meanSlipThrottle[1])
      : null,
    slipAsymRearThrottle: meanSlipThrottle
      ? gateSlip(meanSlipThrottle[2] - meanSlipThrottle[3])
      : null,
    slipAsymFrontRelease: meanSlipRelease
      ? gateSlip(meanSlipRelease[0] - meanSlipRelease[1])
      : null,
    slipAsymRearRelease: meanSlipRelease
      ? gateSlip(meanSlipRelease[2] - meanSlipRelease[3])
      : null,
  };
};
