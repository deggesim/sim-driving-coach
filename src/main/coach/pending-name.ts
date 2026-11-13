import { normalizeSpokenName } from "./spoken-name.js";

/** Parole con cui il pilota rinuncia invece di dettare un nome. Senza questa
 *  via d'uscita uno STT confuso persiste una riga session_setups_* con un nome
 *  spazzatura, cancellabile solo dalla UI. */
const CANCEL_WORDS =
  /^(annulla|annullo|lascia stare|lascia perdere|niente|no)$/i;

export type PendingNameDecision =
  { kind: "expired" } | { kind: "cancel" } | { kind: "name"; name: string };

/**
 * What the transcript that follows "come vuoi chiamare il setup?" means. Pure and
 * language-agnostic on purpose: the decision depends on the clock and the text,
 * never on the UI language, so a language switch between question and answer
 * still reads the answer as a name (the next spoken line is built later, with
 * the then-active language).
 */
export const decidePendingName = (
  question: string,
  askedAt: number,
  now: number,
  ttlMs: number,
): PendingNameDecision => {
  if (now - askedAt >= ttlMs) return { kind: "expired" };
  // Chi detta un nome lo compita ("vu uno" -> v1) e nomina i simboli
  // ("trattino basso" -> _): la trascrizione grezza non è mai il nome.
  const name = normalizeSpokenName(question);
  return !name || CANCEL_WORDS.test(name)
    ? { kind: "cancel" }
    : { kind: "name", name };
};
