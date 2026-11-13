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
  GameSource,
  LapRow,
  SessionAnalysisRow,
  SessionRow,
  ZoneData,
} from "../../shared/types.js";
import {
  buildCommentPrompt,
  buildSessionPrompt,
  buildStatsBlock,
  buildSynthesisPrompt,
  capPriorDetail,
  PRIOR_DETAIL_MAX_CHARS,
  sessionSystemPrompt,
  synthesisSystemPrompt,
  type SessionPromptInput,
} from "./prompt-builder.js";
import { computeSessionStats } from "./session-stats.js";
import type { SetupLadder } from "./setup-ladder.js";
import type { SetupOverview } from "./setup-overview.js";
import { decodeAlertCodes } from "../../shared/alert-types.js";
import { createI18n, LANGUAGES, RESOURCES } from "../../shared/i18n.js";
import { setLanguage } from "../i18n-main.js";
import { outputLanguageBlock } from "./output-language.js";

const SYNTHESIS_SYSTEM_PROMPT = synthesisSystemPrompt("en");
const SESSION_SYSTEM_PROMPT = sessionSystemPrompt("en");
const WHEEL_ORDER = "front left/front right/rear left/rear right";

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
assert.ok(l2.includes("the most recent, full text"));

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
assert.ok(withCurrent.includes("do NOT repeat it"));
assert.ok(
  !l2.includes("do NOT repeat it"),
  "block omitted when field is unset",
);

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

// A driver comment can ask about a computed fact (e.g. temperature/weather)
// that never made it into the rendered analysis text: the comment prompt must
// carry the same "Dati Calcolati" block, or the model has no way to answer it.
const commentWithStats = buildCommentPrompt({
  analysisText: "## Analisi sintetica\nCorpo.",
  priorComments: [],
  comment: "Come sono le temperature ambientale e del tracciato?",
  stats: computeSessionStats({
    laps: [],
    bestLap: null,
    setups: [],
    cornerNames: new Map(),
  }),
});
assert.ok(
  commentWithStats.includes("## Computed Data"),
  "stats block reaches the comment prompt when provided",
);
assert.ok(
  !commentPrompt.includes("## Computed Data"),
  "omitted when no stats given",
);

// Heading hierarchy: "Analisi sintetica" and "Analisi approfondita" are the ONLY
// root "##" sections, everything else nests under them. The UI and the PDF style
// h2 differently from h3+, and nestHeadings shifts by a fixed amount, so a prompt
// that promotes a subsection back to "##" silently breaks both.
const roots = (prompt: string): string[] =>
  prompt.match(/^## .+$/gm)?.map((h) => h.slice(3)) ?? [];

// The English body is one text for every language; only the Output language
// block changes, and it carries that language's headings at the right levels.
const OUTPUT_TAIL = "\n\n# Output language";
const bodyOf = (prompt: string): string =>
  prompt.slice(0, prompt.indexOf(OUTPUT_TAIL));
const headingsOf = (lang: (typeof LANGUAGES)[number]["code"]) =>
  RESOURCES[lang].translation.analysis.heading;
for (const { code } of LANGUAGES) {
  const h = headingsOf(code);
  const syn = synthesisSystemPrompt(code);
  const det = sessionSystemPrompt(code);
  assert.deepEqual(roots(syn), [h.synthesis], `${code} synthesis roots`);
  assert.ok(syn.includes(`### ${h.actions}`), `${code} actions`);
  assert.ok(syn.includes(`## ${h.synthesis}\n### ${h.actions}`), code);
  assert.deepEqual(
    roots(det),
    ["REQUIRED FORMAT", "General Rules", h.detail],
    `${code} detail roots`,
  );
  for (const sub of [h.telemetry, h.problems, h.setupCompare, h.chassis])
    assert.ok(det.includes(`### ${sub}`), `${code} ${sub}`);
  // Same body, byte for byte, in every language.
  assert.equal(bodyOf(syn), bodyOf(SYNTHESIS_SYSTEM_PROMPT), code);
  assert.equal(bodyOf(det), bodyOf(SESSION_SYSTEM_PROMPT), code);
  // The block names this language's forbidden procedure words and glossary.
  const t = RESOURCES[code].translation.analysis;
  for (const kind of ["synthesis", "detail", "comment"] as const)
    assert.ok(outputLanguageBlock(code, kind).includes(t.forbidden), code);
  for (const kind of ["synthesis", "detail", "comment", "voice"] as const)
    assert.ok(outputLanguageBlock(code, kind).includes(t.glossary), code);
}
assert.ok(l1.includes(`the "suggested actions" subsection`), "L1 closing");

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
assert.ok(aceLap.includes("steer max 42%"), "steer must reach the prompt");
assert.ok(aceLap.includes("steer in braking 21%"));
assert.ok(aceLap.includes("G lat 1.85g"));
assert.ok(aceLap.includes("G lon 1.40g"));
assert.ok(aceLap.includes("tyre press. 27.4/27.6/26.8/26.9 PSI"));
assert.ok(aceLap.includes("slip ratio 0.020/0.030/0.120/0.110"));
assert.ok(aceLap.includes("susp. travel 31.0/32.0/48.0/47.0 mm"));
assert.ok(aceLap.includes("tyre temp. 88/90/85/84 °C"));

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
assert.ok(ams2Lap.includes("steer max 42%"), "steer is game-independent");
assert.ok(!ams2Lap.includes("tyre press."), "all-zero quartet must be omitted");
assert.ok(!ams2Lap.includes("slip ratio"));
assert.ok(!ams2Lap.includes("susp. travel"));
assert.ok(!ams2Lap.includes("tyre temp."));

// AMS2's in-game HUD shows bar, unlike R3E/ACE (PSI) - the stored `tp` channel
// stays PSI (see src/main/CLAUDE.md), only this game's prompt display converts.
const ams2Session: SessionRow = { ...session, game: "ams2" };
const ams2PressureLap = buildSynthesisPrompt({
  ...input,
  session: ams2Session,
  laps: [lapWith([zone({ avgTyrePressure: [27.4, 27.6, 26.8, 26.9] })])],
  stats: computeSessionStats({
    laps: [],
    bestLap: ams2Session.best_lap,
    setups: [],
    cornerNames: new Map(),
  }),
});
assert.ok(
  ams2PressureLap.includes("tyre press. 1.89/1.90/1.85/1.85 bar"),
  "AMS2 tyre pressure converted from PSI to bar",
);
assert.ok(!ams2PressureLap.includes("PSI"), "no PSI label for AMS2");

// Setup proposals follow the ladder: one lever, on the current step. The old
// "cover every area" wording must be gone from both levels.
assert.ok(SYNTHESIS_SYSTEM_PROMPT.includes('ONLY on the row marked "do now"'));
assert.ok(SESSION_SYSTEM_PROMPT.includes("concern ONLY that adjustment"));
// Level 2 only: the restriction holds WHILE a current step exists (spec); with
// every step ok / non valutabile it may propose on the other areas again.
assert.ok(
  SESSION_SYSTEM_PROMPT.includes(
    'If no "Base setup" row is marked "do now", the proposals on the other adjustments belong in the chassis-setup subsection, not here.',
  ),
  "Level 2: without a current step the other areas live in the chassis setup",
);
assert.ok(
  !SESSION_SYSTEM_PROMPT.includes(
    "you may give numbered proposals on the other areas too",
  ),
  "old Level 2 sentence replaced",
);
assert.ok(
  !SESSION_SYSTEM_PROMPT.includes("every step ok or not assessable"),
  "old Level 2 sentence replaced",
);
assert.ok(
  !SYNTHESIS_SYSTEM_PROMPT.includes("on the other areas too"),
  "Level 1 rule unchanged",
);
assert.ok(
  !SYNTHESIS_SYSTEM_PROMPT.includes("do NOT concentrate all the actions"),
);
assert.ok(!SESSION_SYSTEM_PROMPT.includes("Cover every area"));
assert.ok(
  !SESSION_SYSTEM_PROMPT.includes("do NOT limit yourself to the brakes"),
);

// Both levels must know what the channels mean.
for (const p of [SYNTHESIS_SYSTEM_PROMPT, SESSION_SYSTEM_PROMPT]) {
  assert.ok(p.includes("slip ratio"), "channel units documented");
  assert.ok(p.includes("tyre temp."), "tyre temp units documented");
  assert.ok(p.includes(WHEEL_ORDER), "wheel order");
  assert.ok(!p.includes("ANT-SX"), "no raw wheel code in the prompt");
  assert.ok(!/[àèéìòù]/i.test(p), "the body is English");
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
        avgAirTempC: 22,
        avgRoadTempC: 28,
        avgRainDensity: 0.3,
        avgWindSpeed: 5.2,
        avgCloudBrightness: 0.6,
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
      messageKey: "alert.dev.lateBrake",
      messageVars: { delta: 18, m: 150 },
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
const calc = statsBlock.slice(statsBlock.indexOf("## Computed Data"));

assert.ok(calc.includes("  - @150m: 1 alert"), "critical corner rendered");
// Internal zone ids are not a race engineer's vocabulary: the model copied
// "zona 18" into a real Level-1 analysis.
assert.ok(!/\bzona \d/i.test(statsBlock), "no zone ids in the prompt");
assert.ok(calc.includes("steer max 42%"), "steer in the authoritative block");
assert.ok(calc.includes("steer in braking 21%"));
assert.ok(calc.includes("G lat 1.85g"));
assert.ok(!calc.includes("G lon"), "absent channel omitted, not zeroed");
// A wheel with no brake sensor reads -1: the "-1 means ignore" rule lives only
// in the Level-2 prompt, so it must never reach Level 1 as a number.
assert.ok(calc.includes("brake temp. 612/604/n/a/n/a °C"), "no raw -1");
assert.ok(calc.includes("tyre press. 27.4/27.6/26.8/26.9 PSI"));
assert.ok(calc.includes("slip ratio 0.020/0.030/0.120/0.110"));
assert.ok(calc.includes("susp. travel 31.0/32.0/48.0/47.0 mm"));
assert.ok(calc.includes("tyre temp. 88/90/85/84 °C"));
assert.ok(
  calc.includes(
    "Conditions: air 22°C, track 28°C, rain 30%, wind 5.2 m/s, cloud cover 60%",
  ),
  "ambient conditions in the authoritative block",
);

// The setup ladder block (Task 5 output) reaches the prompt as written, with the
// current step marked and the steps after it flagged as provisional.
const ladderFixture: SetupLadder = {
  setupLabel: "Gara B",
  firstJudgedLap: 4,
  lastJudgedLap: 9,
  judgedLaps: 6,
  lapsMissing: 0,
  ductsLaps: 4,
  current: 4,
  steps: [
    {
      n: 1,
      label: "brake ducts",
      status: "ok",
      reason: "front 612 °C, rear 548 °C, imbalance 10 %",
      proposable: true,
    },
    {
      n: 2,
      label: "brake bias",
      status: "na",
      reason: "slip missing",
      proposable: true,
    },
    {
      n: 4,
      label: "tyre pressures",
      status: "fix",
      reason: "Δ front left +2.1 °C → lower",
      proposable: true,
    },
    {
      n: 5,
      label: "camber",
      status: "ok",
      reason: "…",
      proposable: true,
    },
  ],
  tyres: [
    {
      setupLabel: "Gara B",
      judgedLaps: 6,
      hotPressurePsi: [29.6, 29.4, 28.3, 28.1],
      deltaC: [2.1, 1.8, 0.3, -0.2],
      innerMinusOuterC: [5, 6, 4, 4],
      pressureState: ["high", "high", "ok", "ok"],
      driftPsi: null,
      coldWheels: [],
      notWarm: null,
    },
  ],
};
const baseStats = computeSessionStats({
  laps: [],
  bestLap: null,
  setups: [],
  cornerNames: new Map(),
});
const ladderBlock = (
  over: Partial<SetupLadder> | null,
  game: GameSource = "ams2",
) =>
  buildStatsBlock(
    {
      ...baseStats,
      setupLadder: over && { ...ladderFixture, ...over },
    },
    game,
  );

const lb = ladderBlock({});
for (const s of [
  `Base setup, in order (setup "Gara B", laps 4-9, 6 judged)`,
  "- brake bias: not assessable — slip missing",
  "- brake ducts: ok — front 612 °C",
  "- tyre pressures: to fix ← do now — Δ front left +2.1 °C → lower",
  "- camber: ok (review later: tyre pressures)",
  `Tyres, setup "Gara B" (6 judged laps) (${WHEEL_ORDER})`,
  "hot press. 2.04/2.03/1.95/1.94 bar",
  "state high/high/ok/ok",
  "inner-outer 5.0/6.0/4.0/4.0 °C",
]) {
  assert.ok(lb.includes(s), s);
}
assert.ok(!lb.includes("drift"), "null drift is omitted");
assert.ok(
  !lb.includes("1 brake ducts: ok (review"),
  "steps before the current one are not provisional",
);
assert.ok(
  ladderBlock({
    tyres: [{ ...ladderFixture.tyres[0], driftPsi: [1.2, 0, 0, -0.3] }],
  }).includes("drift"),
);
assert.ok(
  ladderBlock({}, "ace").includes("hot press. 29.6/29.4/28.3/28.1 PSI"),
  "PSI on ACE",
);
// R3E shows kPa in its setup screen and export: the prompt follows it.
assert.ok(
  ladderBlock({}, "r3e").includes("hot press. 204/203/195/194 kPa"),
  "kPa on R3E",
);
assert.ok(!ladderBlock({}, "r3e").includes("PSI"), "no PSI label for R3E");
const missing = ladderBlock({ lapsMissing: 3, steps: [], current: null });
assert.ok(
  missing.includes(`Base setup: complete 3 more laps with setup "Gara B"`),
);
// Right after a setup change the earlier segments' tyre lines are the useful
// comparison: they are kept next to the "completa ancora" line.
assert.ok(
  missing.includes(`Tyres, setup "Gara B" (6 judged laps)`),
  "earlier tyre lines survive a short last segment",
);
// Step 1 already current while steps 2-6 still wait for judged laps.
const earlyDucts = ladderBlock({
  lapsMissing: 2,
  ductsLaps: 2,
  current: 1,
  steps: [{ ...ladderFixture.steps[0], status: "fix" }],
});
assert.ok(
  earlyDucts.includes(
    `- Base setup: brake ducts judged on 2 laps after the first; for the other adjustments complete 2 more laps with setup "Gara B"
  - brake ducts: to fix ← do now`,
  ),
  earlyDucts,
);
assert.ok(
  SYNTHESIS_SYSTEM_PROMPT.includes(
    `If the "Base setup" asks to complete laps and has no row marked "do now", the setup action is`,
  ),
);
assert.ok(
  SESSION_SYSTEM_PROMPT.includes(
    'With the request "complete N more laps" and no row marked "do now", no numbered proposals.',
  ),
);
const notEditable = ladderBlock({
  steps: [{ ...ladderFixture.steps[0], status: "fix", proposable: false }],
  current: null,
});
assert.ok(notEditable.includes("(not changeable with Fixed Setup)"));
assert.ok(!ladderBlock(null).includes("Base setup"), "no ladder, no row");

// Level 2: the ladder table is mandatory whenever the "Base setup" row
// exists, loaded setup or not; the parameter table and A → B need a setup.
const setupSub = SESSION_SYSTEM_PROMPT.slice(
  SESSION_SYSTEM_PROMPT.indexOf("Subsection: setup comparison"),
  SESSION_SYSTEM_PROMPT.indexOf("Subsection: chassis setup"),
);
for (const s of [
  `MANDATORY even with no setup loaded`,
  `table "Adjustment | State | Data"`,
  `ONLY with a loaded setup: the table "Parameter | Value | Assessment"`,
  `Without a loaded setup: no parameter table and no "A → B" values`,
  `give only the direction`,
  `If the "Base setup" row is missing and no setup is loaded, OMIT`,
  `If it is missing but a setup is loaded, no adjustments table and no numbered proposals`,
]) {
  assert.ok(setupSub.includes(s), s);
}
assert.ok(
  !setupSub.includes("Subsection: setup comparison (OMIT"),
  "the subsection is not unconditionally omittable",
);
assert.ok(
  SESSION_SYSTEM_PROMPT.includes(
    `omittable ONLY if the "Base setup" row is missing and no setup is loaded`,
  ),
  "closing sentence matches the rule",
);
assert.ok(
  SESSION_SYSTEM_PROMPT.includes(
    'and the chassis setup one, omittable ONLY if the "Chassis setup" row is missing.',
  ),
  "chassis setup is omittable only without its row",
);

// Quadro assetto (Task 9): the overview reaches the stats block and both prompts.
assert.ok(
  SYNTHESIS_SYSTEM_PROMPT.includes(
    'the only setup action is the row marked "do now" of the "Chassis setup"',
  ),
  "Level 1 acts on the current area",
);
assert.ok(
  SYNTHESIS_SYSTEM_PROMPT.includes(
    'With no row marked "do now", or without a "Base setup" row',
  ),
);
assert.ok(
  !SYNTHESIS_SYSTEM_PROMPT.includes(
    'Without a current step, or without a "Setup ladder" row, no setup action.',
  ),
  "old Level 1 sentence replaced",
);
// Level 1 on the current area: the row's value wins, the front bar, the first direction.
for (const s of [
  "if the row gives the value (springs), B is that value",
  "for the anti-roll bars propose the front bar",
  "if the row gives several directions, use the first",
]) {
  assert.ok(SYNTHESIS_SYSTEM_PROMPT.includes(s), s);
}
assert.ok(
  !SYNTHESIS_SYSTEM_PROMPT.includes(
    "same rules on A → B and on the minimum step",
  ),
  "Level 1 no longer overrides the computed spring value",
);
// Level 2 Quadro: no proposal on a Fixed Setup area.
assert.ok(
  SESSION_SYSTEM_PROMPT.includes(
    'No proposal for the rows marked "not changeable with Fixed Setup".',
  ),
);
assert.deepEqual(roots(SESSION_SYSTEM_PROMPT), [
  "REQUIRED FORMAT",
  "General Rules",
  "In-depth analysis",
]); // no new root
const overviewFixture: SetupOverview = {
  areas: [
    {
      n: 1,
      label: "springs",
      status: "fix",
      reason: "spring ratio 1.00, weights 1.28 → rear springs 289 N/mm",
      proposable: true,
    },
    {
      n: 2,
      label: "ride heights and rake",
      status: "ok",
      reason: "min 12 mm",
      proposable: true,
    },
    {
      n: 3,
      label: "bumpstop",
      status: "na",
      reason: "no contact measured",
      proposable: false,
    },
  ],
  current: 1,
  afterLadder: false,
  weight: {
    known: true,
    frontPct: 43.8,
    source: "AMS2 table",
    aeroFrontPct: null,
    fuelL: null,
  },
  tyreLine: "front−rear +6.2 °C, left−right −1.0 °C",
};
const ovBlock = (
  over: Partial<SetupOverview> | null,
  ladder: Partial<SetupLadder> = {},
  game: GameSource = "ams2",
) =>
  buildStatsBlock(
    {
      ...baseStats,
      setupLadder: { ...ladderFixture, current: null, ...ladder },
      setupOverview: over && { ...overviewFixture, ...over },
    },
    game,
  );
const ov = ovBlock({});
for (const x of [
  "- Chassis setup, in order (weights front 43.8 % from AMS2 table):",
  "- springs: to fix ← do now — spring ratio 1.00, weights 1.28 → rear springs 289 N/mm",
  "- ride heights and rake: ok — min 12 mm",
  "- bumpstop: not assessable — no contact measured (not changeable with Fixed Setup)",
  "Tyre heat: front−rear +6.2 °C, left−right −1.0 °C",
]) {
  assert.ok(ov.includes(x), x);
}
assert.ok(
  ov.indexOf("Base setup") < ov.indexOf("Chassis setup"),
  "overview follows the ladder",
);
const ovAfter = ovBlock({ afterLadder: true, current: null });
assert.ok(
  ovAfter.includes(
    "- ride heights and rake: ok — min 12 mm (review after the base setup)",
  ),
);
assert.ok(!ovAfter.includes("do now"));
assert.ok(
  ovBlock({
    weight: {
      known: true,
      frontPct: 47.2,
      source: "measured",
      aeroFrontPct: 38.4871,
      fuelL: 40.3,
    },
  }).includes(
    "(weights front 47.2 % measured, mean fuel 40 L, front aero load 38.5 %)",
  ),
);
assert.ok(
  ovBlock({
    weight: { known: false, reason: "wheel load not available" },
  }).includes("(weights unknown: wheel load not available)"),
);
assert.ok(!ovBlock({ tyreLine: null }).includes("Tyre heat"));
assert.ok(
  !ovBlock(null, {}, "r3e").includes("Chassis setup"),
  "no overview, no row",
);
// Controller ruling: while the ladder still asks for laps, the overview is not printed.
assert.ok(
  !ovBlock({}, { lapsMissing: 2, steps: [], current: null }).includes(
    "Chassis setup",
  ),
  "no overview while laps are missing",
);

// The asymmetry lines no longer point at a lever: the ladder owns that call.
const asym = buildStatsBlock({
  ...baseStats,
  suspAsymFrontMm: 3,
  slipAsymFrontThrottle: 0.05,
  slipAsymFrontRelease: 0.04,
});
assert.ok(asym.includes("Suspension travel asymmetry"));
assert.ok(!asym.includes("check camber"));
assert.ok(!asym.includes("check differential"));

// Fixed Setup: the ladder shows steps 1-2 only, and the context says so.
const fixedCtx = buildSessionPrompt({
  ...input,
  session: { ...session, game: "r3e" },
  fixedSetup: true,
});
assert.ok(
  fixedCtx.includes("The base setup judges only the brake bias"),
  "fixed setup wording",
);

// Alert codes never reach the prompt: the analysis text is rendered, exported to
// PDF and read aloud, and "LATE_BRAKE" is unpronounceable in a spoken sentence.
assert.ok(calc.includes("1 alert (late braking×1)"), "alert type decoded");
assert.ok(!calc.includes("LATE_BRAKE"), "no raw alert code in the prompt");

// Safety net on the model output: prior analyses saved before this change are
// injected verbatim into the next prompt and can be copied forward.
const itT = createI18n("it").t;
assert.equal(
  decodeAlertCodes(itT, "2 (LATE_BRAKE) su ANT-SX, TC_ANOMALY a POST-DX"),
  "2 (frenata tardiva) su anteriore sinistra, anomalia controllo di trazione a posteriore destra",
);
assert.equal(decodeAlertCodes(itT, "nessun codice"), "nessun codice");
assert.equal(
  decodeAlertCodes(createI18n("de").t, "LATE_BRAKE su ANT-DX"),
  "zu spätes Bremsen su vorne rechts",
);

// The prompt is English whatever the active language: alert text is rendered
// from key + vars, not from the spoken `message`.
setLanguage("de");
const deAlerts = buildSessionPrompt({
  ...input,
  alerts: [
    {
      type: "BRAKE_TEMP_CRITICAL",
      priority: 1,
      zone: 3,
      dist: 150,
      lap: 1,
      message: "Bremse vorne links bei 700 Grad - kritischer Bereich",
      messageKey: "alert.brakeTemp",
      messageVars: { wheel: "FL", temp: 700 },
      immediate: true,
      timestamp: 0,
    },
    {
      type: "LATE_BRAKE",
      priority: 3,
      zone: 3,
      dist: 150,
      lap: 1,
      message: "Kurve 4, Meter 150: 18 Meter nach der Referenz gebremst",
      messageKey: "alert.dev.lateBrake",
      messageVars: { delta: 18, corner: "Turn 4", m: 150 },
      immediate: false,
      timestamp: 0,
    },
  ],
});
assert.ok(
  deAlerts.includes(
    "[P1] @150m: Brake front left at 700 degrees - critical zone",
  ),
);
assert.ok(
  deAlerts.includes(
    "[P3] @150m: Turn 4, meter 150: braked 18 meters after the reference",
  ),
);
assert.ok(!deAlerts.includes("Bremse") && !deAlerts.includes("Kurve"));
setLanguage("en");

// --- capPriorDetail: short text untouched, long text keeps the setup section ---
const shortDetail = "### Analisi telemetria\nbreve";
assert.equal(capPriorDetail(shortDetail), shortDetail);
const filler = "x".repeat(PRIOR_DETAIL_MAX_CHARS);
const longDetail = [
  "### Analisi telemetria",
  filler,
  "### Current vs proposed setup",
  "Pressione FL: 160 -> 158 kPa",
  "#### Dettaglio",
  "altro",
  "### Problemi identificati",
  "da scartare",
].join("\n");
const capped = capPriorDetail(longDetail);
assert.ok(
  capped.startsWith("### Current vs proposed setup"),
  capped.slice(0, 40),
);
assert.ok(capped.includes("Pressione FL: 160 -> 158 kPa"));
assert.ok(capped.includes("#### Dettaglio"));
assert.ok(!capped.includes("da scartare") && !capped.includes("xxx"));
// A deep-dive written in another language is recognised by its own heading.
const cappedDe = capPriorDetail(
  longDetail.replace(
    "Current vs proposed setup",
    "Setup aktuell vs. vorgeschlagen",
  ),
);
assert.ok(cappedDe.startsWith("### Setup aktuell vs. vorgeschlagen"));
assert.ok(cappedDe.includes("Pressione FL: 160 -> 158 kPa"));
// No setup subsection: the head of the text, bounded.
assert.ok(capPriorDetail(filler + filler).length < PRIOR_DETAIL_MAX_CHARS + 40);

console.log("prompt-builder.selfcheck OK");

// The data the model writes from carries none of the procedure's jargon: a
// race engineer never says "ladder", "sequence", "overview", "step N", "area N".
const JARGON =
  /ladder|sequence|overview|current step|current area|\bsteps? \d|\barea \d|see area|Frezza/i;
for (const block of [lb, earlyDucts, ov, ovAfter])
  assert.ok(!JARGON.test(block), block.match(JARGON)?.[0]);

// No shouting either: states and markers reach the model in lower case, so it
// never copies an all-caps label into the analysis; both prompts forbid it.
const SHOUT = /\b(TO FIX|NOT ASSESSABLE|DO NOW|ACTIVE)\b/;
for (const block of [lb, earlyDucts, ov, ovAfter, fixedCtx])
  assert.ok(!SHOUT.test(block), block.match(SHOUT)?.[0]);
for (const p of [SYNTHESIS_SYSTEM_PROMPT, SESSION_SYSTEM_PROMPT])
  assert.ok(p.includes("Never whole words or sentences in capitals"));

// The ban is limited to the procedure, so a forbidden word the prompt itself
// needs (zone, table, order, area) must not sit in a language's list.
for (const p of [SYNTHESIS_SYSTEM_PROMPT, SESSION_SYSTEM_PROMPT])
  assert.ok(
    p.includes("when referring to the setup-adjustment procedure itself"),
  );
const listed = (lang: (typeof LANGUAGES)[number]["code"]) =>
  RESOURCES[lang].translation.analysis.forbidden.split(", ");
for (const w of ["zone", "tableau"]) assert.ok(!listed("fr").includes(w), w);
for (const w of ["Reihenfolge", "Bereich"])
  assert.ok(!listed("de").includes(w), w);
assert.ok(
  outputLanguageBlock("en", "detail").includes(
    "omit the optional ones only as the rules above allow",
  ),
);
