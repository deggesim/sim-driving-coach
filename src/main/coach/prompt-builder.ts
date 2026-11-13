/**
 * Builds the Claude API prompts for session-level analysis.
 *
 * Every prompt is one English text for all languages; the language of the answer
 * comes from the "Output language" block (output-language.ts) appended to each
 * system prompt. The data blocks are English too: labels and states there are
 * data keys the model translates, never text shown to the driver as is.
 * Level 2 (in-depth analysis) = buildSessionPrompt + sessionSystemPrompt;
 * both levels share buildSessionContext, which injects the authoritative stats block.
 * Also exposes getSignificantZones (zone filtering shared with the session prompt).
 */

import {
  ALERT_LABELS,
  BRAKE_TEMP,
  ZONE_SIZE_M,
} from "../../shared/alert-types.js";
import type {
  Alert,
  AlertType,
  AnalysisComment,
  Deviation,
  GameSource,
  ZoneData,
  LapRow,
  SessionRow,
  SessionSetupRow,
  SessionAnalysisRow,
} from "../../shared/types.js";
import { formatLapTime } from "../../shared/format.js";
import { LANGUAGES, RESOURCES, type Language } from "../../shared/i18n.js";
import { zoneDurationMs } from "../lap-recorder.js";
import { outputLanguageBlock } from "./output-language.js";
import type { SessionStats } from "./session-stats.js";
import { WHEEL_NAMES, type SetupLadder } from "./setup-ladder.js";
import type { SetupOverview } from "./setup-overview.js";

/**
 * Select zones that are "interesting" for the analysis:
 * zones with deviations, braking zones, or high TC/ABS activity.
 */
export const getSignificantZones = (
  zones: ZoneData[],
  deviations: Deviation[] | null,
): ZoneData[] => {
  const deviationZones = new Set(deviations?.map((d) => d.zone) ?? []);

  return zones.filter(
    (z) =>
      deviationZones.has(z.zone) ||
      z.maxBrakePct > 0.3 ||
      z.tcActivations > 2 ||
      z.absActivations > 2 ||
      z.overlapFrames > 3,
  );
};

const WHEEL_ORDER = WHEEL_NAMES.join("/");

// Rules shared by both analysis levels (and printed identically in each).
const CHANNELS = `Telemetry channels per zone: "steer max"/"steer in braking" normalised 0-100% (high steering in braking = trail braking); "G lat"/"G lon" in g; "tyre press." in the game's setup unit (PSI for ACE, kPa for R3E, bar for AMS2 - the unit shown in the data is the correct one), "tyre temp." in °C, "slip ratio" dimensionless (positive beyond ~0.10 = wheelspin, negative = lock-up under braking), "susp. travel" in mm, all in the order ${WHEEL_ORDER}. A channel missing from a row is not available for that game: do not infer values.`;
const CAPITALS = `Capitalisation: write in normal lower case, capitalising only the start of sentences and proper nouns. Never whole words or sentences in capitals, neither for emphasis nor for states (write the states in lower case, e.g. "to fix", "not assessable", translated into the output language); acronyms (ABS, TC, PSI…) stay as they are.`;
const JARGON_RULE = `Language: speak like a race engineer. In the text and in the voice block NEVER use the words listed in the Output language block when referring to the setup-adjustment procedure itself (they stay allowed in their ordinary meaning, e.g. a braking zone or a table), nor the labels "Base setup", "Chassis setup" or "do now", nor the name Frezza: name the adjustment and the component directly (e.g. "close the rear brake ducts", "soften the front anti-roll bar"). "Minimum step" as a one-click increment remains allowed.`;
const TTS_UNITS = `MANDATORY units of measure for the TTS: "XXXm" for distances (never just "XXX"), "X seconds" or "X s" for deltas (never just "X").`;
const BRAKE_BIAS = `Brake bias IN SETUPS (format "front/rear%", e.g. "68.00/32.00%"): the FIRST value is ALWAYS the front, the SECOND is ALWAYS the rear.`;

const SESSION_BODY = `You are an expert race engineer analysing a driver's whole driving session.
Always answer with the technical tone of an engineer. ALWAYS include specific numeric data (durations in seconds, time deltas in seconds, PSI/kPa, km/h, percentages).
The telemetry data reports durations in milliseconds. ALWAYS convert to seconds when you quote these values (e.g. 160ms → 0.16s).

The session's exact numbers (lap times, ∆, convergence, alert counts, aid durations) are in the "## Computed Data" block of the user message: CITE those numbers, do NOT recompute them. The only number YOU must estimate is the impact in seconds/lap (a judgement derived from the data).

You analyse several laps and several setups loaded in the session. You must:
- Identify the trends (improvement/worsening between laps), consistent with the Trend field of the Computed Data.
- Compare the effect of the different loaded setups (if more than one) on the telemetry and on the lap times.
- Flag the recurring problems per corner with alert volume.
- If earlier analyses exist in the session, take them into account and confirm/update the advice.

Use the symbol ∆ for time deltas. Always express durations in seconds (e.g. "0.16s of brake/throttle overlap").
When you quote a lap time ALWAYS use the form "the time of X" in the output language (e.g. "the time of 1:16.322"). Never put an article contracted with the number in front of it (never "l'1:16").

---

## REQUIRED FORMAT

Produce a single root section "##" (the in-depth analysis heading given in the Output language block) with the "###" subsections below, under the headings given in the Output language block.
Any further internal division must use "####": do NOT introduce other "##" headings besides the in-depth analysis one.

Subsection: telemetry analysis
Session overview (number of laps, setups, directional trend). Lap-by-lap trend with the mechanical cause of the improvement/worsening. Critical corners by alert volume in the format "@XXXm CornerName: N alerts (type+duration in seconds, …), probable cause". Tyre pressure observations: a per-wheel table from the "Tyres, setup" rows (Δ, state, drift, per setup if more than one), with the caveat that pace and track temperature shift the pressures (omit if not available). Critical missing data (omit if none).

Subsection: problems identified
Markdown table: Rank | Problem | Location | Alert Count | Est. Impact.
Then "Details per corner" (one bullet per critical corner, with entry speed, steering ∆ %, durations in seconds, mechanical cause) and "Systemic pattern" (cross-cutting analysis: driver learning vs thermal management vs setup).

Subsection: setup comparison
If the Computed Data has the "Base setup" row, this subsection is MANDATORY even with no setup loaded. ALWAYS start with the table "Adjustment | State | Data" with all the rows of the "Base setup", in their order (if it asks to complete laps, write that request instead of the table); the rows after the one marked "do now" are "to review later", because they change when that one changes.
Then, ONLY with a loaded setup: the table "Parameter | Value | Assessment" with all the relevant parameters and the concrete numbered proposals "N. Description (Parameter: CurrentValue → NewValue)" with mechanical rationale, link to the specific alerts and expected effect in seconds/lap. As long as a row of the "Base setup" is marked "do now", the numbered proposals concern ONLY that adjustment, with the same rules as the synthesis (one minimum step, cold values); the other adjustments (suspension, dampers, bars, heights, aerodynamics) only as observations, without proposals. If no "Base setup" row is marked "do now", the proposals on the other adjustments belong in the chassis-setup subsection, not here. With the request "complete N more laps" and no row marked "do now", no numbered proposals. Every proposal cites the datum that supports it.
Without a loaded setup: no parameter table and no "A → B" values; for the adjustment marked "do now" give only the direction (as in the synthesis).
If the "Base setup" row is missing and no setup is loaded, OMIT the whole subsection. If it is missing but a setup is loaded, no adjustments table and no numbered proposals: only the "Parameter | Value | Assessment" table and observations.

Subsection: chassis setup
If the Computed Data has the "Chassis setup" row, this subsection is MANDATORY. Table "Adjustment | State | Data | Direction" with all eight rows in the order of the data, then the "Tyre heat" row if present. If the rows are "to review after the base setup", no proposals: write in one line that they must be reviewed after the brake, tyre and differential adjustments. Otherwise, with a loaded setup, one numbered proposal for each row to fix, in their order, in the format "N. Adjustment — Parameter: CurrentValue → NewValue": use the row's value when it gives one (springs), otherwise current value ± the minimum step in the row's direction. Close with: "Apply one change at a time, in order, with a stint after each: the next ones may change." Without a loaded setup, only the directions. Rows that are not assessable are listed with the reason, without proposals. No proposal for the rows marked "not changeable with Fixed Setup".

---

## General Rules
- CORNER NAMES: use EXCLUSIVELY the names in the "## Authorised Corner Names" section of the user prompt. Do NOT deduce, do NOT invent. If a zone has no name, use ONLY "@XXXm".
- Ideal brake temperature: 550°C ±137.5°C (413-688°C window) (informative: the judgement on the ducts is in the "Base setup"). If the value = -1, ignore it.
- Tyre pressures IN SETUPS: PSI for ACE, kPa for R3E (1 bar = 14.5038 PSI). Telemetry values are in the same unit as the setup (bar for AMS2), the unit is always shown next to the number.
- ${BRAKE_BIAS} Never swap the order.
- ${CHANNELS}
- R3E Leaderboard: tyres fixed at 85°C → not a problem to report.
- Every statement must be supported by at least one numeric datum.
- ${CAPITALS}
- ${JARGON_RULE}
- ${TTS_UNITS}

All subsections are mandatory except the setup comparison one, omittable ONLY if the "Base setup" row is missing and no setup is loaded, and the chassis setup one, omittable ONLY if the "Chassis setup" row is missing.`;

const SYNTHESIS_BODY = `You are an expert race engineer. Produce a SHORT SYNTHESIS of the driver's session, with the technical tone of an engineer, always with numeric data.
The exact numbers (lap times, ∆, convergence, alert counts, durations) are in the "## Computed Data" block: CITE those numbers, do NOT recompute them. Durations in ms must be converted to seconds. The impact in seconds/lap is YOUR judgement derived from the data.

Output EXACTLY: one root "##" section (the summary-analysis heading given in the Output language block) with one "###" subsection (the suggested-actions heading given there) followed by a voice block, and NOTHING else (no in-depth analysis, no long tables).

Summary section
One condensed paragraph: diagnosis of the session with the key data (most critical problem with numbers, lap trend). It already is the synthesis — no "Synthesis" label.

Suggested-actions subsection
The actions to improve the next laps (setup or driving style), MAX 3, one or two lines each:
1. **Setup — Parameter: A → B** — short rationale; expected effect ~X.XX s/lap.
2. **Driving — @XXXm CornerName** — concrete action (e.g. brake 10m earlier); expected effect ~X.XX s/lap.

Setup actions: follow the "Base setup" of the Computed Data. Propose AT MOST ONE setup action, ONLY on the row marked "do now", in the indicated direction and citing its datum. Choose the parameter from the loaded setup (e.g. ramps or geared LSD bias, depending on what it exposes). B = current cold value in the setup ± the minimum step (one click; for pressures 0.05 bar on AMS2, 0.7 PSI on ACE, 5 kPa on R3E). For pressures apply the change to the wheels indicated in their row, each in the indicated direction. Without a loaded setup give only the direction, without "A → B". If the loaded setup does not have the lever of the row marked "do now", say so and use the next row to fix. Name in one line the adjustments that are not assessable and were skipped, with the reason. If the "Base setup" asks to complete laps and has no row marked "do now", the setup action is "complete N more laps with this setup". If no row of the "Base setup" is marked "do now", the only setup action is the row marked "do now" of the "Chassis setup", in its direction and citing its datum: if the row gives the value (springs), B is that value; otherwise B = current value ± the minimum step; if the row gives several directions, use the first; for the anti-roll bars propose the front bar. With no row marked "do now", or without a "Base setup" row, no setup action. Driving actions stay free.
${CAPITALS}
${JARGON_RULE}
${CHANNELS}

After the two sections ALWAYS add this block (it will be read aloud by the TTS):
<sintesi-vocale>
Maximum 3 sentences, WITHOUT markdown (no asterisks, no lists, no headings). Mention the most critical problem with a numeric datum and the main action.
</sintesi-vocale>

Rules: corner names ONLY from the "## Authorised Corner Names" whitelist (otherwise "@XXXm"); units always explicit ("XXXm" for distances, "X seconds"/"X s" for times). ${BRAKE_BIAS}`;

const COMMENT_BODY = `You are an expert race engineer. The driver has just read one of your session analyses and leaves you a comment to correct it or to ask for an addition (e.g. a setup parameter that cannot be changed, an assessment they consider wrong, a request for a targeted in-depth look, a session datum not cited in the analysis).

Reply ONLY to the comment, with the technical tone of an engineer. Include numeric data when relevant, citing them from the "## Computed Data" block if present — do not declare a datum "not available" if it appears there.
The reply must be SHORT and FOCUSED (at most 4-6 sentences): confirm or correct the assessment and, if needed, propose a concrete alternative.
Do NOT rewrite the whole analysis. Do NOT use the headings of the analysis sections (the summary, suggested-actions and in-depth analysis headings and their subsections, listed in the Output language block). Do NOT produce long tables: at most a few markdown lines if indispensable.
If the driver says a parameter cannot be changed, accept the correction and propose an alternative lever that is actually available.`;

export const sessionSystemPrompt = (lang: Language): string =>
  `${SESSION_BODY}\n\n${outputLanguageBlock(lang, "detail")}`;
export const synthesisSystemPrompt = (lang: Language): string =>
  `${SYNTHESIS_BODY}\n\n${outputLanguageBlock(lang, "synthesis")}`;
export const commentSystemPrompt = (lang: Language): string =>
  `${COMMENT_BODY}\n\n${outputLanguageBlock(lang, "comment")}`;

/** Aggregate brake temps across all zones of a lap (best-effort from zones_json). */
const buildBrakeTempSummaryFromZones = (zones: ZoneData[]): string | null => {
  const UNAVAIL = -1;
  const collect = (idx: number): number[] =>
    zones
      .flatMap((z) => (z.avgBrakeTempC ? [z.avgBrakeTempC[idx]] : []))
      .filter((v) => v !== UNAVAIL);

  const perWheel = [collect(0), collect(1), collect(2), collect(3)];
  if (perWheel[0].length === 0) return null;

  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : UNAVAIL;
  const peak = (arr: number[]) => (arr.length > 0 ? Math.max(...arr) : UNAVAIL);

  const lines = [
    "  Brakes: " +
      WHEEL_NAMES.map(
        (label, i) =>
          `${label} ${avg(perWheel[i]).toFixed(0)}°C` +
          ` (peak ${peak(perWheel[i]).toFixed(0)}°C)`,
      ).join(" | "),
  ];

  const allPeaks = perWheel.map(peak).filter((v) => v !== UNAVAIL);
  const overheating = allPeaks.filter((t) => t > BRAKE_TEMP.max);
  if (overheating.length > 0) {
    lines.push(
      `  ⚠ ${overheating.length} brakes above the critical threshold ${BRAKE_TEMP.max}°C`,
    );
  }
  return lines.join("\n");
};

/**
 * Per-wheel quartet for the prompt; null when the field is absent or all-zero.
 * lap-recorder floors a missing channel to 0 and turns the whole extended block
 * on from `rpm` alone - AMS2 has rpm but no tyre/slip/suspension channels, so it
 * produces [0,0,0,0], and a printed "0.0/0.0/0.0/0.0" reads as a measured zero.
 */
const wheelQuartet = (
  vals: [number, number, number, number] | null | undefined,
  scale: number,
  digits: number,
): string | null =>
  !vals || vals.every((v) => v === 0)
    ? null
    : vals.map((v) => (v * scale).toFixed(digits)).join("/");

/**
 * `tp` is stored internally as PSI for all three games (see src/main/CLAUDE.md).
 * The prompt shows the unit of each game's setup screen: bar on AMS2, kPa on
 * R3E, PSI on ACE - the stored channel is untouched.
 */
const pressureUnit = (
  game: GameSource,
): { scale: number; digits: number; label: string } =>
  game === "ams2"
    ? { scale: 0.0689476, digits: 2, label: "bar" }
    : game === "r3e"
      ? { scale: 6.89476, digits: 0, label: "kPa" }
      : { scale: 1, digits: 1, label: "PSI" };

const summarizeLapZones = (
  zones: ZoneData[],
  cornerNames: Map<number, string>,
  game: GameSource,
): string[] => {
  const significant = getSignificantZones(zones, null).slice(0, 8);
  const lines: string[] = [];
  for (const z of significant) {
    const cname = cornerNames.get(z.zone);
    const label = cname ? `${cname} (@${z.dist}m)` : `@${z.dist}m`;
    const bits: string[] = [];
    bits.push(`min ${z.minSpeedKmh.toFixed(0)}km/h`);
    bits.push(`brake ${(z.maxBrakePct * 100).toFixed(0)}%`);
    bits.push(`throttle ${(z.avgThrottlePct * 100).toFixed(0)}%`);
    // Steer is normalised -1..1 on all three games (same scale the trail-braking
    // threshold in adaptive-baseline compares against).
    bits.push(`steer max ${(z.maxSteerAbs * 100).toFixed(0)}%`);
    if (z.steerDuringBrake > 0)
      bits.push(`steer in braking ${(z.steerDuringBrake * 100).toFixed(0)}%`);
    if (z.tcActivations > 0) {
      const durMs = zoneDurationMs(z, "tc").toFixed(0);
      bits.push(`TC:${z.tcActivations}ev/${durMs}ms`);
    }
    if (z.absActivations > 0) {
      const durMs = zoneDurationMs(z, "abs").toFixed(0);
      bits.push(`ABS:${z.absActivations}ev/${durMs}ms`);
    }
    if (z.overlapFrames > 3)
      bits.push(`overlap:${zoneDurationMs(z, "overlap").toFixed(0)}ms`);
    if (z.maxGLat != null) bits.push(`G lat ${z.maxGLat.toFixed(2)}g`);
    if (z.maxGLon != null) bits.push(`G lon ${z.maxGLon.toFixed(2)}g`);
    lines.push(`  - ${label} → ${bits.join(", ")}`);

    // Setup-relevant per-wheel channels on their own line: four values per field
    // would drown the driving metrics above. Which of them arrive depends on the
    // game - see the coverage table in src/main/CLAUDE.md.
    const extra: string[] = [];
    const pu = pressureUnit(game);
    const tp = wheelQuartet(z.avgTyrePressure, pu.scale, pu.digits);
    if (tp) extra.push(`tyre press. ${tp} ${pu.label}`);
    const tt = wheelQuartet(z.avgTyreTempC, 1, 0);
    if (tt) extra.push(`tyre temp. ${tt} °C`);
    const sr = wheelQuartet(z.avgSlipRatio, 1, 3);
    if (sr) extra.push(`slip ratio ${sr}`);
    const sus = wheelQuartet(z.avgSuspTravel, 1000, 1);
    if (sus) extra.push(`susp. travel ${sus} mm`);
    if (extra.length > 0)
      lines.push(`    (${WHEEL_ORDER}) ${extra.join(" | ")}`);
  }
  return lines;
};

const LADDER_STATUS = { ok: "ok", fix: "to fix", na: "not assessable" };

/** The base setup as computed by setup-ladder.ts: one line per adjustment, then the tyre lines. */
const ladderLines = (ladder: SetupLadder, game: GameSource): string[] => {
  const label = ladder.setupLabel ? `"${ladder.setupLabel}"` : null;
  // With laps missing there are no steps, but the earlier segments' tyre lines stay.
  const withSetup = label ? `setup ${label}` : "this setup";
  const lines =
    ladder.lapsMissing > 0 && ladder.current === 1
      ? [
          `- Base setup: brake ducts judged on ${ladder.ductsLaps} laps after the first; for the other adjustments complete ${ladder.lapsMissing} more laps with ${withSetup}`,
        ]
      : ladder.lapsMissing > 0
        ? [
            `- Base setup: complete ${ladder.lapsMissing} more laps with ${withSetup}`,
          ]
        : [
            `- Base setup, in order (${label ? `setup ${label}` : "no setup loaded"}, laps ${ladder.firstJudgedLap}-${ladder.lastJudgedLap}, ${ladder.judgedLaps} judged):`,
          ];
  for (const s of ladder.steps) {
    const mark =
      s.n === ladder.current
        ? " ← do now"
        : ladder.current != null && s.n > ladder.current
          ? ` (review later: ${ladder.steps.find((c) => c.n === ladder.current)?.label})`
          : "";
    const fixed = s.proposable ? "" : " (not changeable with Fixed Setup)";
    lines.push(
      `  - ${s.label}: ${LADDER_STATUS[s.status]}${mark} — ${s.reason}${fixed}`,
    );
  }
  const pu = pressureUnit(game);
  for (const t of ladder.tyres) {
    const hot = wheelQuartet(t.hotPressurePsi, pu.scale, pu.digits);
    const delta = wheelQuartet(t.deltaC, 1, 1);
    const io = wheelQuartet(t.innerMinusOuterC, 1, 1);
    const drift = wheelQuartet(t.driftPsi, pu.scale, pu.digits);
    const bits = [
      hot && `hot press. ${hot} ${pu.label}`,
      delta && `Δ centre-shoulders ${delta} °C`,
      io && `inner-outer ${io} °C`,
      // Out of the tyre's window the state means nothing: say so instead.
      `state ${t.pressureState.map((s, w) => (t.coldWheels.includes(w) ? "n/a" : s)).join("/")}`,
      t.notWarm,
      drift && `drift ${drift} ${pu.label}`,
    ].filter((b) => b);
    lines.push(
      `    Tyres, setup ${t.setupLabel ? `"${t.setupLabel}"` : "not loaded"} (${t.judgedLaps} judged laps) (${WHEEL_ORDER}) ${bits.join(" | ")}`,
    );
  }
  return lines;
};

/** The chassis setup as computed by setup-overview.ts: header, one line per area, then the tyre heat line. */
const overviewLines = (o: SetupOverview): string[] => {
  const w = o.weight;
  const head = w.known
    ? `weights front ${w.frontPct.toFixed(1)} % ${
        w.source === "measured"
          ? `measured${w.fuelL != null ? `, mean fuel ${w.fuelL.toFixed(0)} L` : ""}`
          : "from AMS2 table"
      }${w.aeroFrontPct != null ? `, front aero load ${w.aeroFrontPct.toFixed(1)} %` : ""}`
    : `weights unknown: ${w.reason}`;
  const lines = [`- Chassis setup, in order (${head}):`];
  for (const a of o.areas) {
    const mark = a.n === o.current ? " ← do now" : "";
    const after = o.afterLadder ? " (review after the base setup)" : "";
    const fixed = a.proposable ? "" : " (not changeable with Fixed Setup)";
    lines.push(
      `  - ${a.label}: ${LADDER_STATUS[a.status]}${mark} — ${a.reason}${after}${fixed}`,
    );
  }
  if (o.tyreLine) lines.push(`  Tyre heat: ${o.tyreLine}`);
  return lines;
};

/**
 * Authoritative numeric facts block, injected verbatim into both prompts.
 * The system prompts instruct the model to cite these numbers and never recompute.
 */
export const buildStatsBlock = (
  stats: SessionStats,
  game: GameSource = "r3e",
): string => {
  const lines: string[] = [];
  lines.push(
    `## Computed Data (authoritative — cite these numbers, do NOT recompute)`,
  );
  lines.push(
    `- Laps: ${stats.lapCount} (analysable: ${stats.analyzableLapCount}) · Trend: ${stats.trend}` +
      (stats.bestLap != null
        ? ` · Best lap: ${formatLapTime(stats.bestLap)}`
        : ""),
  );
  lines.push(`- Loaded setups: ${stats.setupCount}`);
  if (
    stats.avgAirTempC != null ||
    stats.avgRoadTempC != null ||
    stats.avgRainDensity != null ||
    stats.avgWindSpeed != null ||
    stats.avgCloudBrightness != null
  ) {
    const bits: string[] = [];
    if (stats.avgAirTempC != null)
      bits.push(`air ${stats.avgAirTempC.toFixed(0)}°C`);
    if (stats.avgRoadTempC != null)
      bits.push(`track ${stats.avgRoadTempC.toFixed(0)}°C`);
    if (stats.avgRainDensity != null)
      bits.push(`rain ${(stats.avgRainDensity * 100).toFixed(0)}%`);
    if (stats.avgWindSpeed != null)
      bits.push(`wind ${stats.avgWindSpeed.toFixed(1)} m/s`);
    if (stats.avgCloudBrightness != null)
      bits.push(`cloud cover ${(stats.avgCloudBrightness * 100).toFixed(0)}%`);
    lines.push(`- Conditions: ${bits.join(", ")}`);
  }
  if (stats.setupLadder) lines.push(...ladderLines(stats.setupLadder, game));
  // While the ladder still asks for laps there is nothing settled to judge.
  if (stats.setupOverview && stats.setupLadder?.lapsMissing === 0)
    lines.push(...overviewLines(stats.setupOverview));
  if (stats.suspAsymFrontMm != null || stats.suspAsymRearMm != null) {
    const bits: string[] = [];
    if (stats.suspAsymFrontMm != null)
      bits.push(`front ${stats.suspAsymFrontMm.toFixed(1)}mm (FL-FR)`);
    if (stats.suspAsymRearMm != null)
      bits.push(`rear ${stats.suspAsymRearMm.toFixed(1)}mm (RL-RR)`);
    lines.push(
      `- Suspension travel asymmetry (session mean): ${bits.join(", ")}`,
    );
  }
  if (
    stats.slipAsymFrontThrottle != null ||
    stats.slipAsymRearThrottle != null
  ) {
    const bits: string[] = [];
    if (stats.slipAsymFrontThrottle != null)
      bits.push(`front ${stats.slipAsymFrontThrottle.toFixed(3)} (FL-FR)`);
    if (stats.slipAsymRearThrottle != null)
      bits.push(`rear ${stats.slipAsymRearThrottle.toFixed(3)} (RL-RR)`);
    lines.push(
      `- Slip ratio asymmetry under traction (session mean): ${bits.join(", ")}`,
    );
  }
  if (stats.slipAsymFrontRelease != null || stats.slipAsymRearRelease != null) {
    const bits: string[] = [];
    if (stats.slipAsymFrontRelease != null)
      bits.push(`front ${stats.slipAsymFrontRelease.toFixed(3)} (FL-FR)`);
    if (stats.slipAsymRearRelease != null)
      bits.push(`rear ${stats.slipAsymRearRelease.toFixed(3)} (RL-RR)`);
    lines.push(
      `- Slip ratio asymmetry on release/braking (session mean): ${bits.join(", ")}`,
    );
  }
  if (stats.laps.length > 0) {
    lines.push(`- Lap times:`);
    for (const l of stats.laps) {
      const dp =
        l.deltaPrevSec == null
          ? "—"
          : `${l.deltaPrevSec >= 0 ? "+" : ""}${l.deltaPrevSec.toFixed(3)}s`;
      lines.push(
        `  - Lap ${l.lapNumber}: ${formatLapTime(l.lapTime)} ` +
          `(∆prev ${dp}, gap to best +${l.deltaBestSec.toFixed(3)}s / +${l.gapToBestPct.toFixed(2)}%)` +
          `${l.valid ? "" : " [invalid]"}` +
          `${l.setupLabel ? ` [setup "${l.setupLabel}"]` : ""}`,
      );
    }
  }
  if (stats.criticalCorners.length > 0) {
    lines.push(`- Critical corners (ranked by number of alerts):`);
    for (const c of stats.criticalCorners) {
      const label = c.cornerName
        ? `${c.cornerName} (@${c.dist}m)`
        : `@${c.dist}m`;
      const types = Object.entries(c.alertsByType)
        .map(([t, n]) => `${ALERT_LABELS[t as AlertType] ?? t}×${n}`)
        .join(", ");
      const bits = [
        `${c.alertCount} ${c.alertCount === 1 ? "alert" : "alerts"} (${types})`,
      ];
      // Absent when no lap carried zone data for this corner: not a zero.
      if (c.minSpeedKmh != null)
        bits.push(`min speed ${c.minSpeedKmh.toFixed(0)}km/h`);
      if (c.maxBrakePct != null)
        bits.push(`brake ${(c.maxBrakePct * 100).toFixed(0)}%`);
      if (c.maxSteerAbs != null)
        bits.push(`steer max ${(c.maxSteerAbs * 100).toFixed(0)}%`);
      if (c.steerDuringBrake > 0)
        bits.push(`steer in braking ${(c.steerDuringBrake * 100).toFixed(0)}%`);
      if (c.tcEvents > 0) bits.push(`TC ${c.tcEvents}ev/${c.tcMs}ms`);
      if (c.absEvents > 0) bits.push(`ABS ${c.absEvents}ev/${c.absMs}ms`);
      if (c.overlapMs > 0) bits.push(`overlap ${c.overlapMs}ms`);
      if (c.maxGLat != null) bits.push(`G lat ${c.maxGLat.toFixed(2)}g`);
      if (c.maxGLon != null) bits.push(`G lon ${c.maxGLon.toFixed(2)}g`);
      lines.push(`  - ${label}: ${bits.join(", ")}`);

      // Per-wheel line, same shape as the lap zones. brakeTempsC was computed
      // here and never printed either; a wheel with no sensor reads -1, and the
      // "-1 means ignore" rule only exists in the Level-2 system prompt.
      const perWheel: string[] = [];
      if (c.brakeTempsC?.some((v) => v > 0))
        perWheel.push(
          `brake temp. ${c.brakeTempsC.map((v) => (v > 0 ? v.toFixed(0) : "n/a")).join("/")} °C`,
        );
      const pu = pressureUnit(game);
      const tp = wheelQuartet(c.avgTyrePressure, pu.scale, pu.digits);
      if (tp) perWheel.push(`tyre press. ${tp} ${pu.label}`);
      const tt = wheelQuartet(c.avgTyreTempC, 1, 0);
      if (tt) perWheel.push(`tyre temp. ${tt} °C`);
      const sr = wheelQuartet(c.avgSlipRatio, 1, 3);
      if (sr) perWheel.push(`slip ratio ${sr}`);
      const sus = wheelQuartet(c.avgSuspTravel, 1000, 1);
      if (sus) perWheel.push(`susp. travel ${sus} mm`);
      if (perWheel.length > 0)
        lines.push(`    (${WHEEL_ORDER}) ${perWheel.join(" | ")}`);
    }
  }
  lines.push("");
  return lines.join("\n");
};

export type SessionPromptInput = {
  session: SessionRow;
  laps: LapRow[]; // ordered by lap_number asc
  setups: SessionSetupRow[]; // ordered by loaded_at asc
  priorAnalyses: SessionAnalysisRow[]; // ordered by version asc
  cornerNames: Map<number, string>;
  carName?: string;
  trackName?: string;
  layoutName?: string;
  alerts?: Alert[];
  leaderboardMode?: boolean;
  fixedSetup?: boolean;
  stats: SessionStats;
  // Level 2 only: the Level-1 output of the analysis being expanded. Not part of
  // priorAnalyses, which excludes the current version by design (beforeVersion).
  currentSynthesis?: string;
};

// Over the cap, the deep-dive keeps only its setup-comparison subsection (where
// the concrete proposals live, which later analyses must confirm or update); with
// no such subsection, the head of the text. A stored deep-dive may have been
// written in any language, so the heading is matched in all of them.
export const PRIOR_DETAIL_MAX_CHARS = 12000;
const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SETUP_SECTION = new RegExp(
  `^###\\s+(?:${LANGUAGES.map((l) => escapeRe(RESOURCES[l.code].translation.analysis.heading.setupCompare)).join("|")})[\\s\\S]*?(?=^###?\\s|(?![\\s\\S]))`,
  "m",
);
export const capPriorDetail = (detail: string): string => {
  if (detail.length <= PRIOR_DETAIL_MAX_CHARS) return detail;
  const setup = SETUP_SECTION.exec(detail)?.[0].trimEnd();
  const kept = setup ?? detail;
  return `${kept.slice(0, PRIOR_DETAIL_MAX_CHARS)}\n\n(in-depth analysis truncated)`;
};

/**
 * Push injected markdown below its wrapper heading. Analysis text carries its own
 * root headings (summary, in-depth analysis), and injecting it verbatim puts a
 * second copy of the exact headings the model is asked to produce at the
 * same level as its own output - so it either continues the wrong hierarchy or
 * treats the section as already written.
 */
export const nestHeadings = (md: string, levels: number): string =>
  md.replace(/^(#{1,6} )/gm, "#".repeat(levels) + "$1");

/** Shared data context for both analysis levels (no closing instruction). */
const buildSessionContext = (input: SessionPromptInput): string => {
  const {
    session,
    laps,
    setups,
    priorAnalyses,
    cornerNames,
    alerts,
    leaderboardMode,
    fixedSetup,
  } = input;
  const parts: string[] = [];

  parts.push(`## Session`);
  parts.push(`- Game: ${session.game.toUpperCase()}`);
  parts.push(`- Car: ${input.carName ?? session.car}`);
  parts.push(
    `- Track: ${input.trackName ?? session.track} (${input.layoutName ?? session.layout})`,
  );
  parts.push(`- Start: ${session.started_at}`);

  if (session.game === "r3e") {
    if (leaderboardMode) {
      parts.push(
        `- **Leaderboard mode active**: tyre temperatures and pressures fixed at 85°C, brake temperatures may not be meaningful - do not diagnose these values as problems. In the base setup pressures and camber are not assessable.`,
      );
    }
    if (fixedSetup) {
      parts.push(
        `- **Fixed Setup active**: the driver can change ONLY brake bias and brake pressure. The base setup judges only the brake bias; ducts and every other adjustment are not changeable.`,
      );
    }
  }
  if (session.ended_at) parts.push(`- End: ${session.ended_at}`);
  parts.push(`- Recorded laps: ${laps.length}`);
  if (session.best_lap != null)
    parts.push(`- Best lap: ${formatLapTime(session.best_lap)}`);
  parts.push("");

  // Explicit corner name whitelist - model must use ONLY these names
  parts.push(`## Authorised Corner Names (EXCLUSIVE SOURCE)`);
  parts.push(
    `ABSOLUTE RULE: use corner names EXCLUSIVELY from this list. Do NOT use names deduced from outside knowledge of the circuit. If a corner does not appear here, use ONLY the notation "@XXXm".`,
  );
  if (cornerNames.size > 0) {
    const sorted = [...cornerNames.entries()].sort(([a], [b]) => a - b);
    for (const [zone, name] of sorted)
      parts.push(`- @${zone * ZONE_SIZE_M}m: ${name}`);
  } else {
    parts.push(
      `- No corner name available for this circuit - use ONLY "@XXXm" for all positions.`,
    );
  }
  parts.push("");

  const setupNameById = new Map<number, string>(
    setups.map((s) => [s.id, s.setup.name ?? s.setup.carFound]),
  );

  // Laps missing any sector time cannot be valid - exclude them from analysis.
  const analyzableLaps = laps.filter(
    (l) => l.sector1 != null && l.sector2 != null && l.sector3 != null,
  );

  if (analyzableLaps.length > 0) {
    parts.push(`## Laps`);
    for (const lap of analyzableLaps) {
      const s1 = formatLapTime(lap.sector1!);
      const s2 = formatLapTime(lap.sector2!);
      const s3 = formatLapTime(lap.sector3!);
      const valid = lap.valid ? "✓" : "✗";
      const setupLabel =
        lap.setup_id != null ? setupNameById.get(lap.setup_id) : undefined;
      const setupTag = setupLabel != null ? ` [setup "${setupLabel}"]` : "";
      parts.push(
        `- Lap ${lap.lap_number}: ${formatLapTime(lap.lap_time)} [S1:${s1} S2:${s2} S3:${s3}] ${valid}${setupTag}`,
      );
      if (lap.zones_json) {
        try {
          const zones = JSON.parse(lap.zones_json) as ZoneData[];
          const z0 = zones[0];
          if (z0?.tcSetting !== undefined && z0.tcSetting > 0) {
            if (session.game === "r3e") {
              parts.push(
                `  TC preset: ${z0.tcSetting}/6 | ABS preset: ${z0.absSetting ?? "?"}/6 (inverse scale: 1=maximum, 6=minimum/absent)`,
              );
            } else {
              parts.push(
                `  TC: ${z0.tcSetting} | ABS: ${z0.absSetting ?? "?"}`,
              );
            }
          }
          const summary = summarizeLapZones(zones, cornerNames, session.game);
          if (summary.length > 0) parts.push(...summary);
          const btSummary = buildBrakeTempSummaryFromZones(zones);
          if (btSummary) parts.push(btSummary);
        } catch {
          // ignore malformed
        }
      }
    }
    const excluded = laps.length - analyzableLaps.length;
    if (excluded > 0)
      parts.push(
        `*(${excluded} lap(s) excluded because they lack a sector time)*`,
      );
    parts.push("");
  }

  if (setups.length > 0) {
    parts.push(`## Setups loaded in the session (chronological order)`);
    setups.forEach((s) => {
      const label = s.setup.name ?? s.setup.carFound;
      parts.push(`### Setup "${label}" (id=${s.id}, loaded ${s.loaded_at})`);
      parts.push(
        `- Car: ${s.setup.carFound}${s.setup.carVerified ? " (verified)" : " (not verified)"}`,
      );
      for (const p of s.setup.params) {
        parts.push(`- ${p.category} / ${p.parameter}: ${p.value}`);
      }
      parts.push("");
    });
    if (setups.length > 1) {
      parts.push(
        `Compare the setups listed above, highlighting the differences and the impact on the telemetry of the associated laps.`,
      );
      parts.push("");
    }
  } else {
    parts.push(
      `## Setup\nNo setup loaded in the session. Omit the setup proposals or limit yourself to generic suggestions.`,
    );
    parts.push("");
  }

  if (priorAnalyses.length > 0) {
    // The most recent prior analysis goes in whole (synthesis + deep-dive when
    // it exists), older ones stay as their 3-sentence voice summary. The system
    // prompts ask to "confirm/update the advice", and the concrete setup
    // proposals live in `detail`: a voice summary cannot carry them, so with
    // summaries alone the model re-derived or re-proposed them blind.
    // `detail` is capped (see capPriorDetail): a deep-dive that hit the
    // 32000-token ceiling would otherwise swell every later prompt.
    const latestVersion = priorAnalyses.at(-1)?.version;
    parts.push(`## Previous analyses`);
    for (const a of priorAnalyses) {
      const isLatest = a.version === latestVersion;
      parts.push(
        `### Analysis #${a.version} (${a.created_at})` +
          (isLatest ? ` — the most recent, full text` : ""),
      );
      if (isLatest) {
        parts.push(nestHeadings(a.synthesis, 2));
        if (a.detail) parts.push("", nestHeadings(capPriorDetail(a.detail), 2));
      } else if (a.summary) {
        parts.push(`Summary: ${a.summary}`);
      } else {
        // Fallback: first ~500 chars of the synthesis
        parts.push(a.synthesis.slice(0, 500));
      }
      if (a.comments && a.comments.length > 0) {
        parts.push(`Driver comments and additions on this analysis:`);
        for (const c of a.comments) {
          parts.push(`- Driver: ${c.comment}`);
          parts.push(`  Addition: ${c.response}`);
        }
      }
      parts.push("");
    }
    parts.push(
      `This is analysis #${priorAnalyses.length + 1}: take the previous ones into account, confirm or update the advice based on the new data.`,
    );
    parts.push("");
  }

  if (alerts && alerts.length > 0) {
    const PRIORITY_LABEL: Record<number, string> = {
      1: "P1",
      2: "P2",
      3: "P3",
    };
    parts.push(`## Alerts raised in the session (${alerts.length})`);
    for (const a of alerts) {
      const prio = PRIORITY_LABEL[a.priority] ?? `P${a.priority}`;
      parts.push(`- [${prio}] @${Math.round(a.dist)}m: ${a.message}`);
    }
    parts.push("");
  }

  parts.push(buildStatsBlock(input.stats, session.game));

  return parts.join("\n");
};

/** Level 2 (on-demand): full in-depth analysis. */
export const buildSessionPrompt = (input: SessionPromptInput): string => {
  const context = buildSessionContext(input);
  // Level 1 of THIS analysis. Without it the deep-dive is written blind to the
  // synthesis and the actions it must complement - while the closing instruction
  // below tells it not to repeat them, which it cannot honour unseen.
  const alreadyProduced = input.currentSynthesis
    ? `## Level 1 already produced for this analysis (do NOT repeat it)\n` +
      `${nestHeadings(input.currentSynthesis, 1)}\n\n`
    : "";
  return (
    context +
    "\n" +
    alreadyProduced +
    `Produce the in-depth analysis as the system prompt specifies, with the subsections ` +
    `"telemetry analysis", "problems identified" and "setup comparison". ` +
    `Omit "setup comparison" ONLY if no setup is loaded. ` +
    `Do NOT produce the synthesis nor the suggested actions (already generated separately). ` +
    `Cite the numbers from the "## Computed Data" block.`
  );
};

/** Level 1 (always): short summary + the "suggested actions" subsection + <sintesi-vocale>. */
export const buildSynthesisPrompt = (input: SessionPromptInput): string => {
  const context = buildSessionContext(input);
  return (
    context +
    "\n" +
    `Produce ONLY the summary section with the "suggested actions" subsection, ` +
    `followed by the <sintesi-vocale> block. No tables, no in-depth analysis. ` +
    `Cite the numbers from the "## Computed Data" block.`
  );
};

export type CommentPromptInput = {
  analysisText: string;
  priorComments: AnalysisComment[];
  comment: string;
  carName?: string;
  trackName?: string;
  game?: GameSource;
  stats?: SessionStats;
};

export const buildCommentPrompt = (input: CommentPromptInput): string => {
  const parts: string[] = [];
  parts.push(`## Context`);
  if (input.carName) parts.push(`- Car: ${input.carName}`);
  if (input.trackName) parts.push(`- Track: ${input.trackName}`);
  parts.push("");
  if (input.stats) {
    parts.push(buildStatsBlock(input.stats, input.game));
    parts.push("");
  }
  parts.push(`## Analysis the comment refers to`);
  parts.push(nestHeadings(input.analysisText, 1));
  parts.push("");
  if (input.priorComments.length > 0) {
    parts.push(`## Previous comments and additions on this analysis`);
    input.priorComments.forEach((c, i) => {
      parts.push(`### Comment ${i + 1}`);
      parts.push(`Driver: ${c.comment}`);
      parts.push(`Addition: ${c.response}`);
      parts.push("");
    });
  }
  parts.push(`## New driver comment`);
  parts.push(input.comment);
  parts.push("");
  parts.push(
    `Reply briefly and to the point to this comment, following the rules of the system prompt.`,
  );
  return parts.join("\n");
};
