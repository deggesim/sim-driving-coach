# Comandi vocali: gioco nell'apertura sessione + richiamo per nome — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il comando vocale di apertura sessione riconosce quale simulatore aprire, e l'ingegnere di pista risponde quando lo si chiama per nome riaprendo il microfono per la domanda successiva.

**Architecture:** La classificazione degli intenti vocali esce da `main.ts` e diventa un modulo puro (`src/main/coach/voice-intent.ts`) con selfcheck, che riconosce anche il gioco citato e il richiamo per nome. `main.ts` consuma il modulo, aggiunge lo stato `pendingGame` per la domanda "quale gioco?" e un contatore per la rotazione dei saluti. Un unico meccanismo di riascolto (flag `listenAgain` sul payload di `coach:voiceDone`) serve sia la domanda sul gioco sia la risposta al richiamo.

**Tech Stack:** TypeScript strict, Electron (main + preload + renderer React), Azure STT/TTS, selfcheck assert-based (`npm run selfcheck`), nessun framework di test.

## Global Constraints

- Spec di riferimento: `docs/superpowers/specs/2026-08-04-comandi-vocali-gioco-e-richiamo-design.md`.
- Stile: TypeScript strict, `type` e non `interface`, **arrow function sempre** (mai `function`), nessuna `class`, named export, import relativi con estensione `.js` nei moduli main/shared.
- Commenti e nomi in **inglese**; ogni testo pronunciato o mostrato all'utente in **italiano**.
- Ogni frase che contiene il nome dell'assistente deve essere **neutra rispetto al genere** (il nome è configurabile, default "Aria"): nessun participio o articolo concordato.
- Le frasi di saluto sono esattamente le dieci elencate nello spec, nell'ordine dato, a rotazione deterministica (contatore modulo, **mai** `Math.random`).
- Forme vocali del gioco da riconoscere: `raceroom`, `raceroom racing experience`, `r3e`, `rre` → `r3e`; `assetto corsa evo`, `ac evo`, `ace`, `evo` → `ace`; `automobilista due`, `ams2` → `ams2`.
- Il richiamo per nome resta **opzionale**: premere il tasto e porre la domanda diretta deve continuare a funzionare come prima.
- Verifiche da far passare a ogni commit: `npm run selfcheck`, `npm run typecheck`, `npm run lint`, `npm run format:check`. Il pre-commit hook esegue già `npm run lint` sull'intero progetto quando lo staging contiene `.ts`/`.tsx`.
- Prettier è cablato: eseguire `npm run format` invece di allineare lo stile a mano. `docs/` è escluso dalla formattazione.

---

## File Structure

| File | Responsabilità |
| --- | --- |
| `src/main/coach/voice-intent.ts` | **Nuovo.** Testo → intento. Puro: nessun DB, IPC, SDK. Espone `VoiceIntent`, `classifyVoiceIntent`, `matchGame`, `GREETINGS`, `nextGreeting`. |
| `src/main/coach/voice-intent.selfcheck.ts` | **Nuovo.** Assert al momento dell'import sulla tabella frasi → intento atteso. |
| `src/shared/types.ts` | Payload di `onVoiceDone` con `listenAgain?: boolean` (riga 426). |
| `src/renderer/hooks/useVoiceCoach.ts` | Riascolto automatico alla fine della riproduzione, in entrambi i path TTS. |
| `src/main/main.ts` | Consuma il modulo; gioco/`pendingGame`/`greeting`; `speakText` con opzioni. Rimuove `classifyVoiceIntent` inline (righe 1830-1856). |
| `CLAUDE.md`, `src/main/CLAUDE.md`, `src/renderer/CLAUDE.md` | Elenco selfcheck, catalogo `coach/`, comportamento del riascolto. |

Il preload **non** va toccato: `onVoiceDone` inoltra `data: unknown` senza tipizzarlo (`src/preload/index.ts:45-49`).

---

## Task 1: Modulo `voice-intent.ts` con selfcheck

**Files:**
- Create: `src/main/coach/voice-intent.ts`
- Create: `src/main/coach/voice-intent.selfcheck.ts`
- Modify: `CLAUDE.md` (elenco dei selfcheck correnti), `src/main/CLAUDE.md` (catalogo `coach/`)

**Interfaces:**
- Consumes: `GameSource` da `../../shared/types.js` (valori `"r3e" | "ace" | "ams2"`).
- Produces:
  - `type VoiceIntent = { kind: "newSession"; game: GameSource | null } | { kind: "closeSession" } | { kind: "analyze" } | { kind: "greeting" } | { kind: "freeform"; question: string }`
  - `classifyVoiceIntent(text: string, assistantName: string): VoiceIntent`
  - `matchGame(text: string): GameSource | null`
  - `GREETINGS: readonly string[]` (dieci frasi)
  - `nextGreeting(count: number): string`

- [ ] **Step 1: Scrivi il selfcheck che fallisce**

Crea `src/main/coach/voice-intent.selfcheck.ts`:

```ts
// Self-check: the voice command regexes used to live inline in main.ts with no
// test at all. They decide which simulator a spoken "apri sessione" starts, so a
// silent regression opens the wrong game.
import assert from "node:assert/strict";
import {
  classifyVoiceIntent,
  matchGame,
  GREETINGS,
  nextGreeting,
} from "./voice-intent.js";

const NAME = "Robert";

// ── Game matching: every spoken form from the spec ─────────────────────────────
assert.equal(matchGame("raceroom"), "r3e");
assert.equal(matchGame("Raceroom Racing Experience"), "r3e");
assert.equal(matchGame("r3e"), "r3e");
assert.equal(matchGame("R.3.E."), "r3e");
assert.equal(matchGame("r 3 e"), "r3e");
assert.equal(matchGame("rre"), "r3e");
assert.equal(matchGame("assetto corsa evo"), "ace");
assert.equal(matchGame("ac evo"), "ace");
assert.equal(matchGame("ace"), "ace");
assert.equal(matchGame("evo"), "ace");
assert.equal(matchGame("automobilista due"), "ams2");
assert.equal(matchGame("automobilista 2"), "ams2");
assert.equal(matchGame("ams2"), "ams2");
assert.equal(matchGame("ams 2"), "ams2");
// No game named, or two different ones: caller must ask instead of guessing
assert.equal(matchGame("apri una sessione"), null);
assert.equal(matchGame("apri sessione su raceroom o evo"), null);

// ── newSession carries the game ───────────────────────────────────────────────
assert.deepEqual(classifyVoiceIntent("apri una sessione su ACE", NAME), {
  kind: "newSession",
  game: "ace",
});
assert.deepEqual(classifyVoiceIntent("nuova sessione automobilista due", NAME), {
  kind: "newSession",
  game: "ams2",
});
assert.deepEqual(classifyVoiceIntent("apri una sessione", NAME), {
  kind: "newSession",
  game: null,
});

// ── Existing intents must not regress ─────────────────────────────────────────
assert.deepEqual(classifyVoiceIntent("chiudi la sessione", NAME), {
  kind: "closeSession",
});
assert.deepEqual(classifyVoiceIntent("analizza la sessione", NAME), {
  kind: "analyze",
});
assert.deepEqual(classifyVoiceIntent("analizza gli ultimi giri", NAME), {
  kind: "analyze",
});

// ── Wake word ─────────────────────────────────────────────────────────────────
assert.deepEqual(classifyVoiceIntent("Ciao Robert", NAME), { kind: "greeting" });
assert.deepEqual(classifyVoiceIntent("Robert", NAME), { kind: "greeting" });
assert.deepEqual(classifyVoiceIntent("Ehi Robert, ok", NAME), {
  kind: "greeting",
});
// Name + question in one breath: no wasted turn, prefix stripped
assert.deepEqual(
  classifyVoiceIntent(
    "Ciao Robert, a quanti metri devo frenare in curva 1?",
    NAME,
  ),
  { kind: "freeform", question: "a quanti metri devo frenare in curva 1?" },
);
// Name + command in one breath
assert.deepEqual(classifyVoiceIntent("Ciao Robert, apri sessione su rre", NAME), {
  kind: "newSession",
  game: "r3e",
});
// A trailing name is part of the question, not a wake prefix
assert.deepEqual(classifyVoiceIntent("dimmi tutto Robert", NAME), {
  kind: "freeform",
  question: "dimmi tutto Robert",
});
// A game name inside a question must not turn it into a session command
assert.deepEqual(classifyVoiceIntent("come vado con la evo?", NAME), {
  kind: "freeform",
  question: "come vado con la evo?",
});
// Another configured name must work, and the default one too
assert.deepEqual(classifyVoiceIntent("Ciao Aria", "Aria"), { kind: "greeting" });
// Empty configured name must never turn a question into a greeting
assert.deepEqual(classifyVoiceIntent("come vado?", ""), {
  kind: "freeform",
  question: "come vado?",
});

// ── Freeform is the default, and keeps the original text ──────────────────────
assert.deepEqual(classifyVoiceIntent("Quanto perdo in curva 3?", NAME), {
  kind: "freeform",
  question: "Quanto perdo in curva 3?",
});

// ── Greeting rotation is deterministic ────────────────────────────────────────
assert.equal(GREETINGS.length, 10);
assert.equal(nextGreeting(0), GREETINGS[0]);
assert.equal(nextGreeting(3), GREETINGS[3]);
assert.equal(nextGreeting(10), GREETINGS[0]);
assert.equal(nextGreeting(13), GREETINGS[3]);

console.log("voice-intent.selfcheck OK");
```

- [ ] **Step 2: Esegui il selfcheck e verifica che fallisca**

Run: `npm run selfcheck`
Expected: FAIL in fase di `tsc` con `TS2307: Cannot find module './voice-intent.js'`.

- [ ] **Step 3: Implementa il modulo**

Crea `src/main/coach/voice-intent.ts`:

```ts
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
  return classifyCommand(normalize(body)) ?? { kind: "freeform", question: body };
};
```

- [ ] **Step 4: Esegui il selfcheck e verifica che passi**

Run: `npm run selfcheck`
Expected: PASS, con `voice-intent.selfcheck OK` nell'output e il totale che sale a 6 selfcheck.

- [ ] **Step 5: Verifica stile e tipi**

Run: `npm run typecheck && npm run lint && npm run format:check`
Expected: tutti e tre senza output di errore. Se Prettier segnala i file nuovi, esegui `npm run format`.

- [ ] **Step 6: Aggiorna la documentazione**

In `CLAUDE.md`, nella riga "Adding a self-check", aggiungi `voice-intent` all'elenco alfabetico dei selfcheck correnti (diventa: `ams2-struct`, `format`, `prompt-builder`, `session-stats`, `voice-intent`, `voice-summary`).

In `src/main/CLAUDE.md`, sezione `coach/`, aggiungi la voce (in ordine alfabetico, prima di `voice-summary.ts`):

```markdown
- **voice-intent.ts** — Classifies a transcribed voice command: `classifyVoiceIntent(text, assistantName)` → `newSession` (with the game named in the phrase, `null` if absent or ambiguous) / `closeSession` / `analyze` / `greeting` (wake call by name) / `freeform` (question with the wake prefix stripped). Also exports `matchGame()` and the ten `GREETINGS` with `nextGreeting(count)`. Dependency-free on purpose (no DB, no IPC, no SDK) so `voice-intent.selfcheck.ts` can assert it without a simulator — the regexes used to live inline in `main.ts` untested
```

- [ ] **Step 7: Commit**

```bash
git add src/main/coach/voice-intent.ts src/main/coach/voice-intent.selfcheck.ts CLAUDE.md src/main/CLAUDE.md
git commit -m "feat(voice): modulo voice-intent con riconoscimento gioco e richiamo per nome"
```

---

## Task 2: Riascolto automatico (payload IPC + renderer)

Dopo questo task il renderer sa riaprire il microfono quando il main lo chiede. Nessuno alza ancora il flag, quindi il comportamento resta identico: è infrastruttura inerte e verificabile con `typecheck`/`lint`.

**Files:**
- Modify: `src/shared/types.ts:426` (payload di `onVoiceDone`)
- Modify: `src/renderer/hooks/useVoiceCoach.ts` (`resetToIdle` ~riga 138, `handleDone` ~riga 264, `handleAudio` ~riga 288, deps dell'`useEffect` ~riga 324)
- Modify: `src/renderer/CLAUDE.md` (voce `useVoiceCoach.ts`)

**Interfaces:**
- Consumes: nulla dal Task 1.
- Produces: il canale `coach:voiceDone` accetta `{ answer: string; listenAgain?: boolean }`. Il Task 3 alza `listenAgain` dal main.

- [ ] **Step 1: Estendi il tipo del payload**

In `src/shared/types.ts`, riga 426, sostituisci:

```ts
  onVoiceDone: (callback: (data: { answer: string }) => void) => () => void;
```

con:

```ts
  // listenAgain: the main process is waiting for a follow-up (answer to "quale
  // gioco?", or a question after a wake call) - the renderer re-arms the mic.
  onVoiceDone: (
    callback: (data: { answer: string; listenAgain?: boolean }) => void,
  ) => () => void;
```

Il preload non va toccato: inoltra il payload come `unknown`.

- [ ] **Step 2: Aggiungi il ref e azzeralo in `resetToIdle`**

In `src/renderer/hooks/useVoiceCoach.ts`, dopo `const recorderRef = useRef<MediaRecorder | null>(null);` aggiungi:

```ts
  // Set by handleDone when main asks for a follow-up; consumed before re-arming
  // the mic so a reply can never trigger an endless listen loop.
  const listenAgainRef = useRef(false);
```

e in `resetToIdle`, come prima istruzione del corpo:

```ts
  const resetToIdle = useCallback(() => {
    listenAgainRef.current = false;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
```

- [ ] **Step 3: Aggiungi `finishSpeaking`**

Subito **dopo** la definizione di `triggerListening` (che termina con `}, [enabled]);`), aggiungi:

```ts
  /**
   * End of playback: either re-arm the mic for a follow-up or go back to idle.
   * stateRef is written by hand because the useEffect that mirrors `state` into
   * it has not run yet at this point, and triggerListening bails out unless the
   * ref already reads "idle".
   */
  const finishSpeaking = useCallback(() => {
    if (!listenAgainRef.current) {
      resetToIdle();
      return;
    }
    listenAgainRef.current = false;
    setState("idle");
    stateRef.current = "idle";
    triggerListening();
  }, [resetToIdle, triggerListening]);
```

- [ ] **Step 4: Consuma il flag nei due path TTS**

In `handleDone`, come prima istruzione:

```ts
    const handleDone = (data: unknown) => {
      const { answer: fullAnswer, listenAgain } = data as {
        answer: string;
        listenAgain?: boolean;
      };
      listenAgainRef.current = listenAgain === true;
```

Nello stesso `handleDone`, nel ramo Web Speech, sostituisci `utterance.onend = resetToIdle;` con `utterance.onend = finishSpeaking;` e **lascia** `utterance.onerror = resetToIdle;` (dopo un errore audio non si riapre il microfono; `resetToIdle` azzera il flag).

In `handleAudio`, sostituisci nel `source.onended`:

```ts
        source.onended = () => {
          ctx.close();
          audioCtxRef.current = null;
          finishSpeaking();
        };
```

e lascia `resetToIdle()` nel `catch`.

- [ ] **Step 5: Aggiorna le dipendenze dell'`useEffect`**

L'`useEffect` che registra i tre listener termina con `}, [enabled, azureTtsEnabled, resetToIdle]);`. Diventa:

```ts
  }, [enabled, azureTtsEnabled, resetToIdle, finishSpeaking]);
```

- [ ] **Step 6: Verifica tipi e lint**

Run: `npm run typecheck && npm run lint && npm run format:check`
Expected: nessun errore. In particolare `react-hooks/exhaustive-deps` non deve segnalare l'`useEffect` modificato.

- [ ] **Step 7: Aggiorna la documentazione**

In `src/renderer/CLAUDE.md`, alla voce `useVoiceCoach.ts`, aggiungi in coda:

```markdown
Quando `coach:voiceDone` arriva con `listenAgain: true` (domanda "quale gioco?" o risposta al richiamo per nome), alla fine della riproduzione riapre il microfono da sé invece di tornare in idle: il flag viene consumato prima di riarmare, e un errore di riproduzione lo azzera senza riascoltare.
```

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/renderer/hooks/useVoiceCoach.ts src/renderer/CLAUDE.md
git commit -m "feat(voice): riascolto automatico del microfono su richiesta del main"
```

---

## Task 3: `main.ts` — gioco, `pendingGame`, saluto

**Files:**
- Modify: `src/main/main.ts` — import (~riga 35), stato di sessione (~riga 395), `classifyVoiceIntent` inline da **rimuovere** (righe 1830-1856), `speakText` (~riga 1858), handler `coach:voiceQuery` (~riga 1874)

**Interfaces:**
- Consumes dal Task 1: `classifyVoiceIntent(text, assistantName)`, `matchGame(text)`, `nextGreeting(count)`, `type VoiceIntent`.
- Consumes dal Task 2: il payload `{ answer, listenAgain }` di `coach:voiceDone`.
- Consumes da `main.ts` (già esistenti): `isLive(g: GameSource): boolean` (riga 387), `gameLabel(game: GameSource): string` (riga 736), `startSession(game: GameSource): Promise<SessionStartResult>` (riga 1095), `resolveNames(...)`, `getConfig(key)`, `pushToRenderer(channel, data)`.
- Produces: nulla per task successivi.

- [ ] **Step 1: Importa il modulo**

In `src/main/main.ts`, accanto all'import di `assistantIntro` (`import { assistantIntro } from "../shared/format.js";`), aggiungi:

```ts
import {
  classifyVoiceIntent,
  matchGame,
  nextGreeting,
} from "./coach/voice-intent.js";
```

- [ ] **Step 2: Rimuovi la classificazione inline**

Cancella l'intera arrow function `classifyVoiceIntent` locale (righe 1830-1856, dall'apertura `const classifyVoiceIntent = (` fino alla `};` che chiude il corpo, commento di sezione escluso). Il modulo del Task 1 la sostituisce.

- [ ] **Step 3: Aggiungi lo stato per gioco e saluti**

Accanto a `let currentSessionId: number | null = null;` (riga 395) aggiungi:

```ts
  // Set when the voice command asked for a session without naming the game and
  // more than one (or no) simulator is live: the next transcript is read as the
  // answer. ponytail: consumed by the very next query whatever it is, so a
  // different command spoken during the wait is reported as "gioco non capito"
  // and must be repeated - the alternative is falling back to the full
  // classifier when matchGame returns null.
  let pendingGame = false;
  let greetCount = 0;
```

- [ ] **Step 4: Aggiungi l'opzione `listenAgain` a `speakText`**

Sostituisci la firma e la prima istruzione di `speakText` (riga 1858):

```ts
  const speakText = async (
    text: string,
    opts?: { listenAgain?: boolean },
  ): Promise<void> => {
    pushToRenderer("coach:voiceDone", {
      answer: text,
      listenAgain: opts?.listenAgain === true,
    });
```

Il resto del corpo (sintesi Azure e push di `coach:voiceAudio`) resta invariato.

- [ ] **Step 5: Aggiungi i due helper di apertura sessione**

Subito **dopo** la chiusura di `speakText` (riga 1872, `};`) e prima di `ipcMain.handle("coach:voiceQuery", …)` aggiungi:

```ts
  const ALL_GAMES: readonly GameSource[] = ["r3e", "ace", "ams2"];

  /** The only simulator currently emitting frames, or null if zero or several. */
  const soleLiveGame = (): GameSource | null => {
    const live = ALL_GAMES.filter(isLive);
    return live.length === 1 ? live[0] : null;
  };

  const openSessionByVoice = async (game: GameSource): Promise<void> => {
    const res = await startSession(game);
    if (!res.ok) {
      await speakText(`Impossibile aprire la sessione. ${res.reason}`);
      return;
    }
    const names = resolveNames(game, currentCar, currentTrack, currentLayout);
    const car = names.carName || "auto sconosciuta";
    const track = names.trackName || "circuito sconosciuto";
    const layout =
      names.layoutName && names.layoutName !== track
        ? `, ${names.layoutName}`
        : "";
    await speakText(
      `Sessione aperta su ${gameLabel(game)}. ${car} - ${track}${layout}.`,
    );
  };
```

`openSessionByVoice` è il ramo `newSession` attuale (righe 1879-1902) spostato in una funzione, con due differenze: il gioco è un parametro invece di `activeGame`, e il messaggio nomina il simulatore aperto. Il commento «No picker over voice: retry the last known game» che apriva quel ramo va cancellato: descrive esattamente il comportamento che questo lavoro rimuove.

- [ ] **Step 6: Gestisci la risposta alla domanda sul gioco**

Nell'handler `ipcMain.handle("coach:voiceQuery", ...)`, subito dopo il `console.log` della domanda e **prima** della classificazione:

```ts
    // A pending "quale gioco?" swallows the next transcript: it is an answer,
    // not a new command.
    if (pendingGame) {
      pendingGame = false;
      const answered = matchGame(question);
      if (!answered) {
        await speakText(
          "Non ho capito quale gioco. Ripeti il comando indicando il gioco.",
        );
        return;
      }
      await openSessionByVoice(answered);
      return;
    }
```

- [ ] **Step 7: Passa il nome dell'assistente al classificatore**

Sostituisci le due righe della classificazione:

```ts
    const assistantName = getConfig("assistantName") ?? "Aria";
    const intent = classifyVoiceIntent(question, assistantName);
    console.log("[VoiceCoach] intent:", intent);
```

- [ ] **Step 8: Riscrivi i rami dell'handler**

Il ramo `newSession` (che confrontava `intent === "newSession"`) diventa:

```ts
    if (intent.kind === "newSession") {
      const game = intent.game ?? soleLiveGame();
      if (!game) {
        pendingGame = true;
        await speakText(
          "Quale gioco? Raceroom, Assetto Corsa Evo o Automobilista 2.",
          { listenAgain: true },
        );
        return;
      }
      await openSessionByVoice(game);
      return;
    }

    if (intent.kind === "greeting") {
      await speakText(nextGreeting(greetCount++), { listenAgain: true });
      return;
    }
```

Aggiorna i confronti dei rami restanti da `intent === "closeSession"` a `intent.kind === "closeSession"` e da `intent === "analyze"` a `intent.kind === "analyze"`; il loro corpo non cambia.

Nel ramo finale (freeform) la domanda passata al coach diventa quella senza prefisso di richiamo. Cerca la chiamata `coach.handleVoiceQuery(question, ...)` e sostituisci l'argomento con `intent.question`.

- [ ] **Step 9: Verifica tipi, selfcheck e lint**

Run: `npm run selfcheck && npm run typecheck && npm run lint && npm run format:check`
Expected: 6 selfcheck passati, nessun errore di tipo, nessun errore ESLint. In particolare TypeScript deve accettare `intent.question` solo dentro il ramo `freeform` (narrowing sulla discriminated union): se segnala un errore, un `intent.kind` di un ramo precedente è rimasto un confronto sulla stringa.

- [ ] **Step 10: Commit**

```bash
git add src/main/main.ts
git commit -m "feat(voice): apertura sessione col gioco dettato e risposta al richiamo per nome"
```

---

## Task 4: Verifica manuale end-to-end

Nessun codice: è il gate che copre ciò che i selfcheck non possono toccare (microfono, Azure STT/TTS, memoria condivisa dei simulatori). Serve almeno un simulatore avviato e in pista, `azureSpeechKey`/`azureRegion`/`azureVoiceName` configurati e la shortcut vocale impostata.

**Files:** nessuno.

- [ ] **Step 1: Avvia l'app in sviluppo**

Run: `npm run dev`
Expected: nessun errore TypeScript in console. Se ne compaiono, ferma e lancia `npm run typecheck` per la lista completa.

- [ ] **Step 2: Richiamo per nome**

Premi la shortcut e di' solo "Ciao <nome configurato>".
Expected: l'ingegnere risponde con una delle dieci frasi, poi **il beep di attivazione suona da solo** e il microfono resta aperto ~5 s. Poni la domanda senza premere nulla: arriva la risposta normale.

- [ ] **Step 3: Rotazione dei saluti**

Ripeti il richiamo tre volte.
Expected: tre frasi diverse, nell'ordine dell'elenco in `GREETINGS`.

- [ ] **Step 4: Richiamo e domanda nella stessa frase**

Di' "Ciao <nome>, a quanti metri devo frenare in curva 1?".
Expected: nessun saluto e nessun turno perso — risposta diretta alla domanda. In console `[VoiceCoach] intent:` mostra `{ kind: 'freeform', question: 'a quanti metri…' }`, senza il prefisso.

- [ ] **Step 5: Apertura sessione col gioco dettato**

Con la sessione chiusa, di' "apri una sessione su <gioco avviato>".
Expected: la sessione si apre su quel simulatore e la conferma vocale ne dice il nome ("Sessione aperta su Automobilista 2. …"). Ripeti nominando un simulatore **non** avviato: risposta "Impossibile aprire la sessione. <gioco> non è connesso…".

- [ ] **Step 6: Apertura senza nominare il gioco**

Con un solo simulatore avviato, di' "apri una sessione".
Expected: si apre quello, senza domande.

- [ ] **Step 7: Apertura senza gioco e senza sim live**

Chiudi tutti i simulatori e di' "apri una sessione".
Expected: "Quale gioco? Raceroom, Assetto Corsa Evo o Automobilista 2." seguito dal beep e dal microfono riaperto. Rispondi "raceroom": arriva il messaggio di simulatore non connesso (non un errore silenzioso). Ripeti e rispondi qualcosa senza nome di gioco: "Non ho capito quale gioco…" e nessun secondo ascolto.

- [ ] **Step 8: Nessuna regressione sui comandi esistenti**

Con una sessione aperta, prova "chiudi la sessione", poi riaprila e prova "analizza la sessione" e una domanda diretta senza richiamo per nome.
Expected: comportamento identico a prima di questo lavoro.

- [ ] **Step 9: Riporta l'esito**

Annota quali step sono passati e quali no. Un fallimento negli step 2, 6 o 7 va diagnosticato prima di considerare il lavoro completo: sono i tre comportamenti nuovi che i selfcheck non coprono.
