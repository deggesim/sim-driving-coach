/**
 * Voice command classification: text in, intent out. Pure on purpose - no DB, no
 * IPC, no SDK - so `voice-intent.selfcheck.ts` can assert it without a simulator
 * or a microphone (same reason as voice-summary.ts). It used to be an inline
 * function in main.ts with no test.
 */

import type { GameSource } from "../../shared/types.js";

export type VoiceIntent =
  | { kind: "newSession"; game: GameSource | null }
  | { kind: "closeSession" }
  | { kind: "analyze" }
  | { kind: "greeting" }
  | { kind: "freeform"; question: string };

/** The ten answers to a bare wake call, in spec order. Gender-neutral: the
 *  assistant name is user-configurable, so no concorded participle. */
export const GREETINGS: readonly string[] = [
  "Ciao, come posso essere utile?",
  "Ciao, chiedi e ti darò suggerimenti di guida.",
  "Sono qui, dimmi.",
  "Ti ascolto.",
  "Dimmi pure, sono in linea.",
  "Presente. Cosa ti serve?",
  "Eccomi, che problema hai?",
  "In ascolto. Dimmi tutto.",
  "Ci sono. Che ti serve?",
  "Eccomi. Su cosa lavoriamo?",
];

/** Rotation by call count: deterministic so the selfcheck can assert it. */
export const nextGreeting = (count: number): string =>
  GREETINGS[count % GREETINGS.length];

/**
 * Lowercase, drop punctuation, collapse whitespace. Azure STT punctuates and
 * spaces acronyms unpredictably ("R.3.E.", "ams 2"), so every match runs on this.
 */
const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Long forms first, acronyms after: order does not matter for correctness here
 *  (a sentence naming two different games returns null anyway) but keeps it readable. */
const GAME_PATTERNS: ReadonlyArray<readonly [GameSource, readonly RegExp[]]> = [
  ["r3e", [/race ?room/, /\br ?3 ?e\b/, /\brre\b/, /\berre ?(tre|3) ?e\b/]],
  ["ace", [/assetto corsa evo/, /\bac ?evo\b/, /\bace\b/, /\bevo\b/]],
  ["ams2", [/automobilista ?(2|due)/, /\bams ?(2|due)\b/]],
];

export const matchGame = (text: string): GameSource | null => {
  const s = normalize(text);
  const hits = GAME_PATTERNS.filter(([, patterns]) =>
    patterns.some((p) => p.test(s)),
  ).map(([game]) => game);
  // Two different games in one sentence: let the caller ask instead of guessing.
  return hits.length === 1 ? hits[0] : null;
};

/** Words that may precede the assistant name in a wake call. Accented as the
 *  normalizer leaves them: it strips punctuation, not diacritics. */
const GREETING_WORDS = [
  "ciao",
  "ehi",
  "hey",
  "ehilà",
  "senti",
  "ok",
  "salve",
  "buongiorno",
  "buonasera",
];

/**
 * True when the name opens the sentence, alone or after greeting words only.
 * ponytail: "dimmi tutto Robert" ends with the name but is a question, so a
 * bare "does it contain the name" test would eat it as a wake call.
 */
const hasLeadingName = (text: string, assistantName: string): boolean => {
  const name = normalize(assistantName).split(" ")[0];
  if (!name) return false;
  const tokens = normalize(text).split(" ");
  const i = tokens.indexOf(name);
  return i >= 0 && tokens.slice(0, i).every((t) => GREETING_WORDS.includes(t));
};

/**
 * Everything after the assistant name, with leading punctuation removed. Works on
 * the ORIGINAL text, not the normalized one: the remainder is the question that
 * reaches Claude, and stripping its accents and punctuation would degrade it.
 */
const stripWakePrefix = (text: string, assistantName: string): string => {
  const i = text.toLowerCase().indexOf(assistantName.toLowerCase());
  if (i < 0) return text;
  return text
    .slice(i + assistantName.length)
    .replace(/^[\s,.;:!?-]+/, "")
    .trim();
};

const wordCount = (text: string): number => {
  const s = normalize(text);
  return s ? s.split(" ").length : 0;
};

/** Session/analysis commands. Returns null when the text is not a command. */
const classifyCommand = (s: string): VoiceIntent | null => {
  const hasSession = /\bsession/.test(s);
  if (
    hasSession &&
    /\b(nuova|apri|inizia|inizio|avvia|avvio|comincia|crea|start|apre|partenza|parti)\b/.test(
      s,
    )
  )
    return { kind: "newSession", game: matchGame(s) };
  if (
    hasSession &&
    /\b(chiudi|termina|fine|ferma|concludi|stop|finisci|chiude)\b/.test(s)
  )
    return { kind: "closeSession" };
  // The original had three alternatives for this branch; the broadest one made
  // the other two redundant, so only it survives - same behaviour, less regex.
  if (/\b(analizza|analisi|valuta|valutazione|esegui analisi)\b/.test(s))
    return { kind: "analyze" };
  return null;
};

export const classifyVoiceIntent = (
  text: string,
  assistantName: string,
): VoiceIntent => {
  const wake = hasLeadingName(text, assistantName);
  const body = wake ? stripWakePrefix(text, assistantName) : text;
  // Name and nothing else (at most one filler word left): just a wake call.
  if (wake && wordCount(body) <= 1) return { kind: "greeting" };
  return (
    classifyCommand(normalize(body)) ?? { kind: "freeform", question: body }
  );
};
