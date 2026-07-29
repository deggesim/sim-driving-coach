/**
 * Self-check for what the two prompt levels inherit from earlier analyses
 * (assert-only). Guards a silent failure mode: these branches decide what the
 * model can see, and a regression here produces a plausible-looking analysis
 * built on missing context - invisible in typecheck, lint and the UI.
 *
 *   npm run selfcheck
 */
import assert from "node:assert/strict";
import type { SessionAnalysisRow, SessionRow } from "../../shared/types.js";
import {
  buildSessionPrompt,
  buildSynthesisPrompt,
  type SessionPromptInput,
} from "./prompt-builder.js";
import { computeSessionStats } from "./session-stats.js";

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
assert.ok(l2.includes("APPROFONDITA-V2"), "latest prior detail must be injected");
assert.ok(l2.includes("la più recente, testo integrale"));

// Older ones stay as their voice summary - their deep-dive must NOT be injected,
// otherwise a long session grows the prompt by one full deep-dive per analysis.
assert.ok(l2.includes("VOCALE-V1"), "older prior summary must be injected");
assert.ok(!l2.includes("APPROFONDITA-V1"), "older prior detail must be skipped");
assert.ok(!l2.includes("SINTESI-V1"), "older prior full synthesis must be skipped");

// summary === null falls back to the first 500 chars of the synthesis.
const noSummary = buildSessionPrompt({
  ...input,
  priorAnalyses: [analysis(1, { summary: null }), analysis(2)],
});
assert.ok(noSummary.includes("SINTESI-V1"), "fallback to synthesis when no summary");

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
assert.ok(l1.includes("<sintesi-vocale>"), "Level 1 still asks for the TTS block");

console.log("prompt-builder.selfcheck OK");
