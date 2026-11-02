/**
 * Per-lap calibration summary for a live session, printed at lap completion
 * when `SDC_CHANNEL_LOG=1` (`npm run dev:debug`). It reduces one lap's frames to
 * the few numbers needed to tune thresholds that were set without a sim:
 *
 *  - slip under hard braking, front/rear, against `LOCK_SLIP`;
 *  - rear slip after a downshift, against `NERVOUS_SLIP`;
 *  - per wheel: hot pressure and the centre-minus-shoulders temperature gap,
 *    the quantity the pressure diagnosis judges.
 *
 * Pure: no DB, no IPC. A channel the frames lack is reported as "assente".
 */
import type { CompactFrame } from "../shared/types.js";
import {
  HARD_BRAKE,
  LIFTED_THROTTLE,
  LOCK_SLIP,
  NERVOUS_SLIP,
  NERVOUS_WINDOW_MS,
} from "./ladder-counters.js";

const WHEELS = ["FL", "FR", "RL", "RR"] as const;

const mean = (xs: number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;

const quantile = (sorted: number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

// Worst (most negative) slip first: min / 5th percentile / median, and how many
// samples sit under each candidate threshold.
const slipSummary = (label: string, xs: number[]): string => {
  if (xs.length === 0) return `${label}: nessun campione`;
  const s = xs.toSorted((a, b) => a - b);
  const under = (t: number): string =>
    `<${t} ${((s.filter((v) => v < t).length / s.length) * 100).toFixed(1)}%`;
  return (
    `${label} n=${s.length} min=${s[0].toFixed(3)} p5=${quantile(s, 0.05).toFixed(3)} ` +
    `p50=${quantile(s, 0.5).toFixed(3)} | ${[LOCK_SLIP, -0.15, NERVOUS_SLIP].map(under).join(" ")}`
  );
};

const slipLines = (frames: CompactFrame[]): string[] => {
  if (!frames.some((f) => f.sr)) return ["slip: assente (nessun canale sr)"];
  const front: number[] = [];
  const rear: number[] = [];
  for (const f of frames) {
    if (!f.sr || f.brk <= HARD_BRAKE) continue;
    front.push(Math.min(f.sr[0], f.sr[1]));
    rear.push(Math.min(f.sr[2], f.sr[3]));
  }
  // Same downshift definition as ladder-counters: gear drop while braking or lifted.
  const afterDownshift: number[] = [];
  let lastGear = 0;
  frames.forEach((f, i) => {
    const prev = lastGear;
    if (f.gear > 0) lastGear = f.gear;
    if (!f.sr || f.gear <= 0 || f.gear >= prev) return;
    if (f.brk <= 0 && f.thr > LIFTED_THROTTLE) return;
    let worst = Infinity;
    for (let j = i; j < frames.length; j++) {
      if (frames[j].ts - f.ts > NERVOUS_WINDOW_MS) break;
      const r = frames[j].sr;
      if (r) worst = Math.min(worst, r[2], r[3]);
    }
    if (Number.isFinite(worst)) afterDownshift.push(worst);
  });
  return [
    `slip frenata dura (brk>${HARD_BRAKE}) ${slipSummary("anteriore", front)}`,
    `slip frenata dura (brk>${HARD_BRAKE}) ${slipSummary("posteriore", rear)}`,
    `slip posteriore entro ${NERVOUS_WINDOW_MS}ms da una scalata ${slipSummary("scalate", afterDownshift)}`,
  ];
};

const tyreLine = (frames: CompactFrame[]): string => {
  const parts = WHEELS.map((w, i) => {
    const col = (key: "tp" | "tti" | "ttc" | "tto"): number[] =>
      frames.flatMap((f) => (f[key] ? [f[key][i]] : []));
    const tp = col("tp");
    const [ti, tc, to] = [col("tti"), col("ttc"), col("tto")];
    if (tp.length === 0 || tc.length === 0)
      return `${w} ${tp.length ? `${mean(tp).toFixed(1)}PSI` : "p=assente"} sup=assente`;
    const [I, C, O] = [mean(ti), mean(tc), mean(to)];
    return (
      `${w} ${mean(tp).toFixed(1)}PSI I/C/E ${I.toFixed(0)}/${C.toFixed(0)}/${O.toFixed(0)} ` +
      `Δcentro=${(C - (I + O) / 2).toFixed(1)}°C I-E=${(I - O).toFixed(1)}°C`
    );
  });
  return `gomme (media giro) ${parts.join(" | ")}`;
};

/** One line per quantity, ready for console.log. */
export const calibrationLines = (frames: CompactFrame[]): string[] => [
  ...slipLines(frames),
  tyreLine(frames),
];
