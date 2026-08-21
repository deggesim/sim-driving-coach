/**
 * Self-check for what the two prompt levels inherit from earlier analyses
 * (assert-only). Guards a silent failure mode: these branches decide what the
 * model can see, and a regression here produces a plausible-looking analysis
 * built on missing context - invisible in typecheck, lint and the UI.
 *
 *   npm run selfcheck
 */
import assert from "node:assert/strict";
import type {
  Alert,
  LapRow,
  SessionAnalysisRow,
  SessionRow,
  ZoneData,
} from "../../shared/types.js";
import {
  buildCommentPrompt,
  buildSessionPrompt,
  buildSynthesisPrompt,
  SESSION_SYSTEM_PROMPT,
  SYNTHESIS_SYSTEM_PROMPT,
  type SessionPromptInput,
} from "./prompt-builder.js";
import { computeSessionStats } from "./session-stats.js";
import { decodeAlertCodes, WHEEL_ORDER } from "../../shared/alert-types.js";

const session: SessionRow = {
  id: 1,
  game: "ace",
  car: "ks_porsche_718_gt4",
  track: "monza",
  layout: "monza",
  session_type: "practice",
  started_at: "2026-07-29T09:30:00.000Z",
  ended_at: null,
  best_lap: 95.14,
  lap_count: 0,
};

const analysis = (
  version: number,
  over: Partial<SessionAnalysisRow> = {},
): SessionAnalysisRow => ({
  id: version,
  session_id: 1,
  version,
  synthesis: `SINTESI-V${version} testo completo del livello 1.`,
  detail: `APPROFONDITA-V${version} con Setup attuale vs proposto.`,
  summary: `VOCALE-V${version} tre frasi.`,
  created_at: `2026-07-29T10:0${version}:00.000Z`,
  comments: [],
  ...over,
});

const input: SessionPromptInput = {
  session,
  laps: [],
  setups: [],
  priorAnalyses: [analysis(1), analysis(2)],
  cornerNames: new Map(),
  stats: computeSessionStats({
    laps: [],
    bestLap: session.best_lap,
    setups: [],
    cornerNames: new Map(),
  }),
};

// The most recent prior analysis goes in whole: full synthesis AND deep-dive.
const l2 = buildSessionPrompt(input);
assert.ok(l2.includes("SINTESI-V2"), "latest prior synthesis must be injected");
assert.ok(
  l2.includes("APPROFONDITA-V2"),
  "latest prior detail must be injected",
);
assert.ok(l2.includes("la più recente, testo integrale"));

// Older ones stay as their voice summary - their deep-dive must NOT be injected,
// otherwise a long session grows the prompt by one full deep-dive per analysis.
assert.ok(l2.includes("VOCALE-V1"), "older prior summary must be injected");
assert.ok(
  !l2.includes("APPROFONDITA-V1"),
  "older prior detail must be skipped",
);
assert.ok(
  !l2.includes("SINTESI-V1"),
  "older prior full synthesis must be skipped",
);

// summary === null falls back to the first 500 chars of the synthesis.
const noSummary = buildSessionPrompt({
  ...input,
  priorAnalyses: [analysis(1, { summary: null }), analysis(2)],
});
assert.ok(
  noSummary.includes("SINTESI-V1"),
  "fallback to synthesis when no summary",
);

// A single prior analysis is itself the most recent one.
const single = buildSessionPrompt({ ...input, priorAnalyses: [analysis(1)] });
assert.ok(single.includes("APPROFONDITA-V1"));

// Level 2 sees the Level-1 output of the analysis it is expanding, which
// priorAnalyses deliberately excludes (loadSessionBundle passes beforeVersion).
const withCurrent = buildSessionPrompt({
  ...input,
  currentSynthesis: "SINTESI-CORRENTE del livello 1.",
});
assert.ok(withCurrent.includes("SINTESI-CORRENTE"));
assert.ok(withCurrent.includes("NON ripeterlo"));
assert.ok(!l2.includes("NON ripeterlo"), "block omitted when field is unset");

// Injected analysis text must not carry root-level headings: the model is asked
// to produce "## Analisi approfondita" itself, so a verbatim copy of that heading
// in the context is an instruction collision, not just cosmetics.
const withHeadings = buildSessionPrompt({
  ...input,
  priorAnalyses: [
    analysis(2, {
      synthesis: "## Analisi sintetica\nCorpo.",
      detail: "## Analisi approfondita\n### Analisi telemetria\nCorpo.",
    }),
  ],
  currentSynthesis: "## Analisi sintetica\nCorpo corrente.",
});
assert.ok(withHeadings.includes("#### Analisi sintetica"), "prior nested by 2");
assert.ok(withHeadings.includes("#### Analisi approfondita"));
assert.ok(withHeadings.includes("##### Analisi telemetria"));
assert.ok(withHeadings.includes("### Analisi sintetica\nCorpo corrente."));
// Exactly one root "## Analisi approfondita" may exist: the one the closing
// instruction asks for.
assert.equal(
  withHeadings.split(/^## Analisi approfondita$/gm).length - 1,
  0,
  "no root-level Analisi approfondita in the context",
);

// currentSynthesis is Level-2 only: Level 1 is the one producing it.
const l1 = buildSynthesisPrompt({
  ...input,
  currentSynthesis: "SINTESI-CORRENTE del livello 1.",
});
assert.ok(!l1.includes("SINTESI-CORRENTE"));
assert.ok(
  l1.includes("<sintesi-vocale>"),
  "Level 1 still asks for the TTS block",
);

// The comment engine sees both levels: a driver pushing back on a setup proposal
// is pushing back on something that exists only in the deep-dive.
const commentPrompt = buildCommentPrompt({
  analysisText:
    "## Analisi sintetica\nCorpo.\n\n## Analisi approfondita\nARB post: 4 → 3.",
  priorComments: [],
  comment: "L'ARB posteriore non è regolabile su questa auto.",
});
assert.ok(commentPrompt.includes("ARB post: 4 → 3"), "deep-dive must reach it");
assert.ok(commentPrompt.includes("### Analisi approfondita"), "nested by 1");
assert.ok(!/^## Analisi approfondita$/m.test(commentPrompt));

// Heading hierarchy: "Analisi sintetica" and "Analisi approfondita" are the ONLY
// root "##" sections, everything else nests under them. The UI and the PDF style
// h2 differently from h3+, and nestHeadings shifts by a fixed amount, so a prompt
// that promotes a subsection back to "##" silently breaks both.
const roots = (prompt: string): string[] =>
  prompt.match(/^## .+$/gm)?.map((h) => h.slice(3)) ?? [];

assert.deepEqual(roots(SYNTHESIS_SYSTEM_PROMPT), ["Analisi sintetica"]);
assert.ok(SYNTHESIS_SYSTEM_PROMPT.includes("### Azioni suggerite"));
assert.ok(l1.includes(`"### Azioni suggerite"`), "L1 closing instruction");

assert.deepEqual(roots(SESSION_SYSTEM_PROMPT), [
  "FORMATO OBBLIGATORIO",
  "Regole Generali",
]);
for (const sub of [
  "Analisi telemetria",
  "Problemi identificati",
  "Setup attuale vs proposto",
]) {
  assert.ok(SESSION_SYSTEM_PROMPT.includes(`### ${sub}`), sub);
}

// Extended channels reach the prompt. All of these are computed by lap-recorder
// and used to be dropped here, which left the braking channels as the only data
// a setup proposal could be anchored to - so every proposal was a brake lever.
const zone = (over: Partial<ZoneData> = {}): ZoneData => ({
  zone: 3,
  dist: 150,
  avgSpeedKmh: 120,
  minSpeedKmh: 90,
  maxBrakePct: 0.8,
  avgThrottlePct: 0.1,
  maxSteerAbs: 0.42,
  steerDuringBrake: 0.21,
  brakeFrames: 20,
  throttleFrames: 5,
  coastFrames: 2,
  overlapFrames: 0,
  tcActivations: 0,
  absActivations: 0,
  brakeStartDist: 140,
  brakeEndDist: 190,
  throttlePickupDist: 195,
  ...over,
});

const lapWith = (zones: ZoneData[]): LapRow => ({
  id: 1,
  session_id: 1,
  setup_id: null,
  lap_number: 1,
  lap_time: 95.14,
  sector1: 30,
  sector2: 30,
  sector3: 35.14,
  valid: true,
  zones_json: JSON.stringify(zones),
  recorded_at: "2026-07-29T09:35:00.000Z",
});

const aceLap = buildSynthesisPrompt({
  ...input,
  laps: [
    lapWith([
      zone({
        maxGLat: 1.85,
        maxGLon: 1.4,
        avgTyrePressure: [27.4, 27.6, 26.8, 26.9],
        avgSlipRatio: [0.02, 0.03, 0.12, 0.11],
        avgSuspTravel: [0.031, 0.032, 0.048, 0.047],
        avgTyreTempC: [88, 90, 85, 84],
      }),
    ]),
  ],
});
assert.ok(aceLap.includes("sterzo max 42%"), "steer must reach the prompt");
assert.ok(aceLap.includes("sterzo in frenata 21%"));
assert.ok(aceLap.includes("G lat 1.85g"));
assert.ok(aceLap.includes("G lon 1.40g"));
assert.ok(aceLap.includes("press. gomme 27.4/27.6/26.8/26.9 PSI"));
assert.ok(aceLap.includes("slip ratio 0.020/0.030/0.120/0.110"));
assert.ok(aceLap.includes("corsa sosp. 31.0/32.0/48.0/47.0 mm"));
assert.ok(aceLap.includes("temp. gomme 88/90/85/84 °C"));

// AMS2 has rpm, which is what switches lap-recorder's extended block on, but no
// per-wheel channels: they arrive as [0,0,0,0] and must be omitted rather than
// printed as a measured zero.
const ams2Lap = buildSynthesisPrompt({
  ...input,
  laps: [
    lapWith([
      zone({
        avgRpm: 6500,
        avgTyrePressure: [0, 0, 0, 0],
        avgSlipRatio: [0, 0, 0, 0],
        avgSuspTravel: [0, 0, 0, 0],
        avgTyreTempC: [0, 0, 0, 0],
      }),
    ]),
  ],
});
assert.ok(ams2Lap.includes("sterzo max 42%"), "steer is game-independent");
assert.ok(
  !ams2Lap.includes("press. gomme"),
  "all-zero quartet must be omitted",
);
assert.ok(!ams2Lap.includes("slip ratio"));
assert.ok(!ams2Lap.includes("corsa sosp."));
assert.ok(!ams2Lap.includes("temp. gomme"));

// Both levels must ask for varied levers and know what the channels mean: the
// point of shipping them is that a proposal can be anchored to something else.
assert.ok(SYNTHESIS_SYSTEM_PROMPT.includes("NON concentrare tutte le azioni"));
assert.ok(SESSION_SYSTEM_PROMPT.includes("NON limitarti ai freni"));
for (const p of [SYNTHESIS_SYSTEM_PROMPT, SESSION_SYSTEM_PROMPT]) {
  assert.ok(p.includes("slip ratio"), "channel units documented");
  assert.ok(p.includes("temp. gomme"), "tyre temp units documented");
  assert.ok(p.includes(WHEEL_ORDER), "wheel order");
  assert.ok(!p.includes("ANT-SX"), "no raw wheel code in the prompt");
}

// The "Dati Calcolati" block carries the same channels. It is the block both
// system prompts tell the model to cite verbatim, so a channel present only in
// the lap zones above is one the model is told not to trust.
const statsIn = {
  laps: [
    lapWith([
      zone({
        maxGLat: 1.85,
        avgBrakeTempC: [612, 604, -1, -1] as [number, number, number, number],
        avgTyrePressure: [27.4, 27.6, 26.8, 26.9] as [
          number,
          number,
          number,
          number,
        ],
        avgSlipRatio: [0.02, 0.03, 0.12, 0.11] as [
          number,
          number,
          number,
          number,
        ],
        avgSuspTravel: [0.031, 0.032, 0.048, 0.047] as [
          number,
          number,
          number,
          number,
        ],
        avgTyreTempC: [88, 90, 85, 84] as [number, number, number, number],
      }),
    ]),
  ],
  bestLap: 95.14,
  setups: [],
  alerts: [
    {
      type: "LATE_BRAKE",
      priority: 3,
      zone: 3,
      dist: 150,
      lap: 1,
      message: "x",
      immediate: false,
      timestamp: 0,
    } satisfies Alert,
  ],
  cornerNames: new Map<number, string>(),
};

const statsBlock = buildSynthesisPrompt({
  ...input,
  laps: statsIn.laps,
  alerts: statsIn.alerts,
  stats: computeSessionStats(statsIn),
});
const calc = statsBlock.slice(statsBlock.indexOf("## Dati Calcolati"));

assert.ok(calc.includes("Zona 3 @150m: 1 alert"), "critical corner rendered");
assert.ok(calc.includes("sterzo max 42%"), "steer in the authoritative block");
assert.ok(calc.includes("sterzo in frenata 21%"));
assert.ok(calc.includes("G lat 1.85g"));
assert.ok(!calc.includes("G lon"), "absent channel omitted, not zeroed");
// A wheel with no brake sensor reads -1: the "-1 means ignore" rule lives only
// in the Level-2 prompt, so it must never reach Level 1 as a number.
assert.ok(calc.includes("temp. freni 612/604/n.d./n.d. °C"), "no raw -1");
assert.ok(calc.includes("press. gomme 27.4/27.6/26.8/26.9 PSI"));
assert.ok(calc.includes("slip ratio 0.020/0.030/0.120/0.110"));
assert.ok(calc.includes("corsa sosp. 31.0/32.0/48.0/47.0 mm"));
assert.ok(calc.includes("temp. gomme 88/90/85/84 °C"));

// Alert codes never reach the prompt: the analysis text is rendered, exported to
// PDF and read aloud, and "LATE_BRAKE" is unpronounceable in an Italian sentence.
assert.ok(calc.includes("1 alert (frenata tardiva×1)"), "alert type decoded");
assert.ok(!calc.includes("LATE_BRAKE"), "no raw alert code in the prompt");

// Safety net on the model output: prior analyses saved before this change are
// injected verbatim into the next prompt and can be copied forward.
assert.equal(
  decodeAlertCodes("2 (LATE_BRAKE) su ANT-SX, TC_ANOMALY a POST-DX"),
  "2 (frenata tardiva) su anteriore sinistra, anomalia controllo di trazione a posteriore destra",
);
assert.equal(decodeAlertCodes("nessun codice"), "nessun codice");

console.log("prompt-builder.selfcheck OK");
