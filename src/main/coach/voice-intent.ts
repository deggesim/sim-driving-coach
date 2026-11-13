/**
 * Voice command classification: text in, intent out. Pure on purpose - no DB, no
 * IPC, no SDK - so `voice-intent.selfcheck.ts` can assert it without a simulator
 * or a microphone (same reason as voice-summary.ts). It used to be an inline
 * function in main.ts with no test.
 */

import type { TFunction } from "i18next";
import type { Language } from "../../shared/i18n.js";
import type { GameSource } from "../../shared/types.js";
import { LEXICONS } from "./voice-lexicon.js";

export type VoiceIntent =
  | { kind: "newSession"; game: GameSource | null }
  | { kind: "closeSession" }
  | { kind: "analyze" }
  | { kind: "acquireSetup" }
  | { kind: "greeting" }
  | { kind: "freeform"; question: string };

/** Locale keys of the ten answers to a bare wake call, in spec order.
 *  Gender-neutral: the assistant name is user-configurable, so no concorded participle. */
export const GREETING_KEYS = [
  "voice.greeting.0",
  "voice.greeting.1",
  "voice.greeting.2",
  "voice.greeting.3",
  "voice.greeting.4",
  "voice.greeting.5",
  "voice.greeting.6",
  "voice.greeting.7",
  "voice.greeting.8",
  "voice.greeting.9",
] as const;

/** Rotation by call count: deterministic so the selfcheck can assert it. */
export const nextGreeting = (count: number, t: TFunction): string =>
  t(GREETING_KEYS[count % GREETING_KEYS.length]);

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

export const matchGame = (text: string, lang: Language): GameSource | null => {
  const s = normalize(text);
  const hits = LEXICONS[lang].games
    .filter(([, patterns]) => patterns.some((p) => p.test(s)))
    .map(([game]) => game);
  // Two different games in one sentence: let the caller ask instead of guessing.
  return hits.length === 1 ? hits[0] : null;
};

/**
 * The name is only ever spoken by its first word ("Jarvis Prime" is called
 * "Jarvis"), so wake detection and prefix stripping must key off the same
 * token - two separate reads of `assistantName` previously drifted apart on
 * multi-word names.
 */
const wakeToken = (assistantName: string): string =>
  assistantName.trim().split(/\s+/)[0];

/**
 * True when the name opens the sentence, alone or after greeting words only.
 * ponytail: "dimmi tutto Robert" ends with the name but is a question, so a
 * bare "does it contain the name" test would eat it as a wake call.
 */
const hasLeadingName = (
  text: string,
  assistantName: string,
  lang: Language,
): boolean => {
  const name = normalize(wakeToken(assistantName));
  if (!name) return false;
  const tokens = normalize(text).split(" ");
  const i = tokens.indexOf(name);
  return (
    i >= 0 &&
    tokens.slice(0, i).every((t) => LEXICONS[lang].greetings.includes(t))
  );
};

/**
 * Everything after the assistant name, with leading punctuation removed. Works on
 * the ORIGINAL text, not the normalized one: the remainder is the question that
 * reaches Claude, and stripping its accents and punctuation would degrade it.
 */
const stripWakePrefix = (text: string, assistantName: string): string => {
  const token = wakeToken(assistantName);
  const i = text.toLowerCase().indexOf(token.toLowerCase());
  if (i < 0) return text;
  return text
    .slice(i + token.length)
    .replace(/^[\s,.;:!?-]+/, "")
    .trim();
};

const wordCount = (text: string): number => {
  const s = normalize(text);
  return s ? s.split(" ").length : 0;
};

/** Session/analysis commands. Returns null when the text is not a command. */
const classifyCommand = (s: string, lang: Language): VoiceIntent | null => {
  const lex = LEXICONS[lang];
  const hasSession = lex.session.test(s);
  if (hasSession && lex.open.test(s))
    return { kind: "newSession", game: matchGame(s, lang) };
  if (hasSession && lex.close.test(s)) return { kind: "closeSession" };
  if (lex.analyze.test(s)) return { kind: "analyze" };
  // The four spec triggers (acquire/load/fetch/new setup) plus the conjugations
  // that come up in speech. Last command branch on purpose: "new session" is not
  // a setup, and "evaluate the new setup" names a setup but asks for an analysis.
  if (lex.setup.test(s) && lex.acquire.test(s)) return { kind: "acquireSetup" };
  return null;
};

export const classifyVoiceIntent = (
  text: string,
  assistantName: string,
  lang: Language,
): VoiceIntent => {
  // Empty/whitespace-only transcript: no wake word, no command, nothing to ask.
  // `VoiceIntent` has no "ignore" variant (Task 3 consumes this union as-is), so
  // this is the deliberate answer rather than an accident of the checks below -
  // the production caller (useVoiceCoach.ts) already gates on `text.trim()`
  // before reaching here, but the module must not surprise a future caller that
  // doesn't.
  if (!text.trim()) return { kind: "freeform", question: "" };
  const wake = hasLeadingName(text, assistantName, lang);
  const body = wake ? stripWakePrefix(text, assistantName) : text;
  // Name and nothing else (at most one filler word left): just a wake call.
  if (wake && wordCount(body) <= 1) return { kind: "greeting" };
  return (
    classifyCommand(normalize(body), lang) ?? {
      kind: "freeform",
      question: body,
    }
  );
};
