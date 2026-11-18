/**
 * Level-1 structured output: the JSON schema sent to the API, the check of the
 * parsed answer against the setup ladder / chassis overview, and the markdown
 * the rest of the app stores and renders. Pure (type-only imports) so
 * synthesis-output.selfcheck.ts runs without the SDK.
 */

import type { SessionStats } from "./session-stats.js";

export const NO_ADJUSTMENT = "none";
export const COMPLETE_LAPS = "complete laps";
export const MAX_ACTIONS = 3;

export type SynthesisAction = {
  kind: "setup" | "driving";
  adjustment: string;
  text: string;
};
export type SynthesisOutput = {
  summary: string;
  actions: SynthesisAction[];
  voice: string;
};

/**
 * The one adjustment a setup action may act on: the ladder's current step, else
 * "complete laps" while the ladder lacks laps, else the overview's current
 * area. Empty = no setup action at all. Same order as the system prompt.
 */
export const allowedSetupAdjustments = ({
  setupLadder: l,
  setupOverview: o,
}: Pick<SessionStats, "setupLadder" | "setupOverview">): string[] => {
  if (l?.current != null)
    return l.steps.flatMap((s) => (s.n === l.current ? [s.label] : []));
  if (l && l.lapsMissing > 0) return [COMPLETE_LAPS];
  return o?.current != null
    ? o.areas.flatMap((a) => (a.n === o.current ? [a.label] : []))
    : [];
};

// The API grammar guarantees shape and enums, not counts: MAX_ACTIONS and "one
// setup action" are enforced by parseSynthesis.
export const synthesisSchema = (
  allowed: string[],
): Record<string, unknown> => ({
  type: "object",
  properties: {
    summary: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["setup", "driving"] },
          adjustment: { type: "string", enum: [...allowed, NO_ADJUSTMENT] },
          text: { type: "string" },
        },
        required: ["kind", "adjustment", "text"],
        additionalProperties: false,
      },
    },
    voice: { type: "string" },
  },
  required: ["summary", "actions", "voice"],
  additionalProperties: false,
});

const isAction = (a: Partial<SynthesisAction>): a is SynthesisAction =>
  typeof a.text === "string" &&
  typeof a.adjustment === "string" &&
  (a.kind === "setup" || a.kind === "driving");

/**
 * Parses the model's JSON; null when it is not the expected object (a response
 * cut at max_tokens). Keeps the first setup action that targets the allowed
 * adjustment and drops the other setup actions (listed in `dropped`).
 */
export const parseSynthesis = (
  text: string,
  allowed: string[],
): { out: SynthesisOutput; dropped: string[] } | null => {
  let raw: { summary?: unknown; voice?: unknown; actions?: unknown } | null;
  try {
    raw = JSON.parse(text) as typeof raw;
  } catch {
    return null;
  }
  if (
    typeof raw?.summary !== "string" ||
    typeof raw.voice !== "string" ||
    !Array.isArray(raw.actions)
  )
    return null;
  const dropped: string[] = [];
  let setupSeen = false;
  const actions = (raw.actions as Partial<SynthesisAction>[])
    .filter(isAction)
    .filter((a) => {
      if (a.kind !== "setup") return true;
      const ok = !setupSeen && allowed.includes(a.adjustment);
      if (ok) setupSeen = true;
      else dropped.push(a.adjustment);
      return ok;
    })
    .slice(0, MAX_ACTIONS);
  return { out: { summary: raw.summary, actions, voice: raw.voice }, dropped };
};

/** The synthesis markdown stored in `synthesis`: headings come from the locale, not the model. */
export const renderSynthesis = (
  o: SynthesisOutput,
  headings: { synthesis: string; actions: string },
): string =>
  [
    `## ${headings.synthesis}`,
    o.summary,
    ...(o.actions.length > 0
      ? [
          `### ${headings.actions}`,
          o.actions.map((a, i) => `${i + 1}. ${a.text}`).join("\n"),
        ]
      : []),
  ].join("\n\n");
