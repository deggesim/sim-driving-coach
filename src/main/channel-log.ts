/**
 * Smoke-test logging for CompactFrame's extended channels.
 *
 * Each reader fills a different subset (coverage table in CLAUDE.md), and the
 * distinction that matters when validating an offset is "channel absent" vs
 * "channel present but reading zero" — a wrong offset almost always shows up as
 * the second. So both are printed as words, never as a plausible-looking 0.0.
 *
 * One line per game is logged unconditionally on the first moving frame: that is
 * the coverage check, and it costs nothing. Keep a line coming every ~2s after
 * that with
 *
 *   $env:SDC_CHANNEL_LOG=1; npm run dev
 *
 * which is what to use to sanity-check magnitudes while driving (G ~1-2,
 * pressures 20-30 PSI, suspension travel tens of mm, slip |0.02-0.15|).
 */
import type { CompactFrame } from "../shared/types.js";

const LOG_EVERY = 120; // ~2s at the 16ms poll
const MOVING_KMH = 30; // below this, G/slip/pressures are not yet meaningful

const quartet = (
  vals: number[] | undefined,
  scale: number,
  digits: number,
): string =>
  vals === undefined
    ? "assente"
    : vals.every((v) => v === 0)
      ? "zeri"
      : vals.map((v) => (v * scale).toFixed(digits)).join("/");

const scalar = (v: number | undefined, digits: number): string =>
  v === undefined ? "assente" : v.toFixed(digits);

/** Pure formatter, so `channel-log.selfcheck.ts` can assert it. */
export const formatChannels = (f: CompactFrame): string =>
  `@${f.d.toFixed(0)}m ${f.spd.toFixed(0)}km/h rpm=${scalar(f.rpm, 0)} ` +
  `gLat=${scalar(f.gLat, 2)}g gLon=${scalar(f.gLon, 2)}g ` +
  `press=${quartet(f.tp, 1, 1)}PSI temp=${quartet(f.tt, 1, 0)}°C ` +
  `slip=${quartet(f.sr, 1, 3)} sosp=${quartet(f.sus, 1000, 1)}mm`;

const counters = new Map<string, number>();

/**
 * Call right after pushing a frame into the lap buffer, e.g.
 * `logChannels("R3E", lapFrames.at(-1))`.
 */
export const logChannels = (tag: string, f: CompactFrame | undefined): void => {
  if (!f || f.spd < MOVING_KMH) return;
  const n = (counters.get(tag) ?? 0) + 1;
  counters.set(tag, n);
  if (n === 1) {
    console.log(
      `[${tag}] canali (prima frame >${MOVING_KMH}km/h) ${formatChannels(f)}`,
    );
  } else if (process.env.SDC_CHANNEL_LOG === "1" && n % LOG_EVERY === 0) {
    console.log(`[${tag}] canali ${formatChannels(f)}`);
  }
};
