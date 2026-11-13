import type { Language } from "../../shared/i18n.js";
import { LEXICONS } from "./voice-lexicon.js";
import { normalizeSpokenName } from "./spoken-name.js";

export type PendingNameDecision =
  { kind: "expired" } | { kind: "cancel" } | { kind: "name"; name: string };

/**
 * What the transcript that follows "come vuoi chiamare il setup?" means. Pure: the
 * decision depends on the clock, the text and the language it is read in. The
 * answer is transcribed in the language active when it arrives (which may differ
 * from the question's), so the caller passes the current one; the cancel words
 * ("annulla" and equivalents) are the dropout the driver has instead of dictating.
 */
export const decidePendingName = (
  question: string,
  askedAt: number,
  now: number,
  ttlMs: number,
  lang: Language,
): PendingNameDecision => {
  if (now - askedAt >= ttlMs) return { kind: "expired" };
  // Chi detta un nome lo compita ("vu uno" -> v1) e nomina i simboli
  // ("trattino basso" -> _): la trascrizione grezza non è mai il nome.
  const name = normalizeSpokenName(question, lang);
  return !name || LEXICONS[lang].cancel.test(name)
    ? { kind: "cancel" }
    : { kind: "name", name };
};
