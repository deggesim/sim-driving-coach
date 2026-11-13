// Self-check: the voice command regexes used to live inline in main.ts with no
// test at all. They decide which simulator a spoken "apri sessione" starts, so a
// silent regression opens the wrong game.
import assert from "node:assert/strict";
import {
  classifyVoiceIntent,
  matchGame,
  GREETING_KEYS,
  type VoiceIntent,
  nextGreeting,
} from "./voice-intent.js";
import { setLanguage, tm } from "../i18n-main.js";
import type { Language } from "../../shared/i18n.js";

const NAME = "Robert";

// ── Game matching: every spoken form from the spec ─────────────────────────────
assert.equal(matchGame("raceroom", "it"), "r3e");
assert.equal(matchGame("Raceroom Racing Experience", "it"), "r3e");
assert.equal(matchGame("r3e", "it"), "r3e");
assert.equal(matchGame("R.3.E.", "it"), "r3e");
assert.equal(matchGame("r 3 e", "it"), "r3e");
assert.equal(matchGame("rre", "it"), "r3e");
assert.equal(matchGame("assetto corsa evo", "it"), "ace");
assert.equal(matchGame("ac evo", "it"), "ace");
assert.equal(matchGame("ace", "it"), "ace");
assert.equal(matchGame("evo", "it"), "ace");
assert.equal(matchGame("automobilista due", "it"), "ams2");
assert.equal(matchGame("automobilista 2", "it"), "ams2");
assert.equal(matchGame("ams2", "it"), "ams2");
assert.equal(matchGame("ams 2", "it"), "ams2");
// No game named, or two different ones: caller must ask instead of guessing
assert.equal(matchGame("apri una sessione", "it"), null);
assert.equal(matchGame("apri sessione su raceroom o evo", "it"), null);
// Long-form patterns need trailing word boundaries too, or they grab a prefix
// of a longer word/number instead of the whole spoken form
assert.equal(matchGame("che bella la terrace room", "it"), null);
assert.equal(matchGame("automobilista duecento euro", "it"), null);
assert.equal(
  matchGame("conosco un automobilista, 25enne, bravo pilota", "it"),
  null,
);

// ── newSession carries the game ───────────────────────────────────────────────
assert.deepEqual(classifyVoiceIntent("apri una sessione su ACE", NAME, "it"), {
  kind: "newSession",
  game: "ace",
});
assert.deepEqual(
  classifyVoiceIntent("nuova sessione automobilista due", NAME, "it"),
  {
    kind: "newSession",
    game: "ams2",
  },
);
assert.deepEqual(classifyVoiceIntent("apri una sessione", NAME, "it"), {
  kind: "newSession",
  game: null,
});

// ── Existing intents must not regress ─────────────────────────────────────────
assert.deepEqual(classifyVoiceIntent("chiudi la sessione", NAME, "it"), {
  kind: "closeSession",
});
assert.deepEqual(classifyVoiceIntent("analizza la sessione", NAME, "it"), {
  kind: "analyze",
});
assert.deepEqual(classifyVoiceIntent("analizza gli ultimi giri", NAME, "it"), {
  kind: "analyze",
});

// ── Wake word ─────────────────────────────────────────────────────────────────
assert.deepEqual(classifyVoiceIntent("Ciao Robert", NAME, "it"), {
  kind: "greeting",
});
assert.deepEqual(classifyVoiceIntent("Robert", NAME, "it"), {
  kind: "greeting",
});
assert.deepEqual(classifyVoiceIntent("Ehi Robert, ok", NAME, "it"), {
  kind: "greeting",
});
// Name + question in one breath: no wasted turn, prefix stripped
assert.deepEqual(
  classifyVoiceIntent(
    "Ciao Robert, a quanti metri devo frenare in curva 1?",
    NAME,
    "it",
  ),
  { kind: "freeform", question: "a quanti metri devo frenare in curva 1?" },
);
// Name + command in one breath
assert.deepEqual(
  classifyVoiceIntent("Ciao Robert, apri sessione su rre", NAME, "it"),
  {
    kind: "newSession",
    game: "r3e",
  },
);
// A trailing name is part of the question, not a wake prefix
assert.deepEqual(classifyVoiceIntent("dimmi tutto Robert", NAME, "it"), {
  kind: "freeform",
  question: "dimmi tutto Robert",
});
// A game name inside a question must not turn it into a session command
assert.deepEqual(classifyVoiceIntent("come vado con la evo?", NAME, "it"), {
  kind: "freeform",
  question: "come vado con la evo?",
});
// Another configured name must work, and the default one too
assert.deepEqual(classifyVoiceIntent("Ciao Aria", "Aria", "it"), {
  kind: "greeting",
});
// Empty configured name must never turn a question into a greeting
assert.deepEqual(classifyVoiceIntent("come vado?", "", "it"), {
  kind: "freeform",
  question: "come vado?",
});
// A multi-word name is spoken by its first word only: wake detection and
// prefix stripping must agree on that same token
assert.deepEqual(classifyVoiceIntent("Ciao Jarvis", "Jarvis Prime", "it"), {
  kind: "greeting",
});

// ── Freeform is the default, and keeps the original text ──────────────────────
assert.deepEqual(classifyVoiceIntent("Quanto perdo in curva 3?", NAME, "it"), {
  kind: "freeform",
  question: "Quanto perdo in curva 3?",
});

// ── Empty/whitespace transcript is a deliberate no-op, not a crash ────────────
// (the production caller already filters this out before reaching here, but
// the module must still answer deterministically for any future caller)
assert.deepEqual(classifyVoiceIntent("", NAME, "it"), {
  kind: "freeform",
  question: "",
});
assert.deepEqual(classifyVoiceIntent("   ", NAME, "it"), {
  kind: "freeform",
  question: "",
});

// ── Greeting rotation is deterministic ────────────────────────────────────────
assert.equal(GREETING_KEYS.length, 10);
setLanguage("it");
assert.equal(nextGreeting(0, tm), "Ciao, come posso essere utile?");
assert.equal(nextGreeting(3, tm), "Ti ascolto.");
assert.equal(nextGreeting(10, tm), nextGreeting(0, tm));
assert.equal(nextGreeting(13, tm), nextGreeting(3, tm));
// A switch applies to the very next greeting.
setLanguage("de");
assert.equal(nextGreeting(3, tm), "Ich höre.");
setLanguage("it");

// ── acquireSetup: quattro trigger equivalenti ────────────────────────────────
// Sono quattro modi di attivare la stessa funzionalità, non quattro varianti: se
// uno solo di questi smette di combaciare, il comando sparisce senza errori.
for (const phrase of [
  "acquisisci setup",
  "carica setup",
  "preleva setup",
  "nuovo setup",
]) {
  assert.deepEqual(
    classifyVoiceIntent(phrase, NAME, "it"),
    { kind: "acquireSetup" },
    `trigger non riconosciuto: ${phrase}`,
  );
}

// Con il richiamo per nome davanti, con l'articolo, e coniugati come capita
// parlando: la frase pronunciata non è mai quella della specifica.
assert.deepEqual(
  classifyVoiceIntent("Ciao Robert, acquisisci il setup", NAME, "it"),
  {
    kind: "acquireSetup",
  },
);
assert.deepEqual(classifyVoiceIntent("caricami il setup nuovo", NAME, "it"), {
  kind: "acquireSetup",
});
assert.deepEqual(classifyVoiceIntent("puoi prelevare il setup?", NAME, "it"), {
  kind: "acquireSetup",
});
// Azure STT scrive il prestito inglese anche staccato, imprevedibilmente.
assert.deepEqual(classifyVoiceIntent("acquisisci il set up", NAME, "it"), {
  kind: "acquireSetup",
});

// ── Nessuna collisione con gli intent già esistenti ──────────────────────────
// "nuova sessione" contiene un verbo di acquisizione ma non è un setup.
assert.equal(
  classifyVoiceIntent("apri una nuova sessione", NAME, "it").kind,
  "newSession",
);
// I rami di sessione vengono prima: una frase che nomina entrambi apre la sessione.
assert.equal(
  classifyVoiceIntent("nuova sessione e carica il setup", NAME, "it").kind,
  "newSession",
);
// "valuta il nuovo setup" è una richiesta di analisi, non di acquisizione: il
// ramo analyze precede acquireSetup proprio per questo.
assert.equal(
  classifyVoiceIntent("valuta il nuovo setup", NAME, "it").kind,
  "analyze",
);
// Una domanda sul setup resta una domanda.
assert.equal(
  classifyVoiceIntent("com'è il setup adesso?", NAME, "it").kind,
  "freeform",
);
assert.equal(
  classifyVoiceIntent("quanto pesa il setup sul sottosterzo?", NAME, "it").kind,
  "freeform",
);

// ── Per-language tables: only the active language is recognised ──────────────
type Case = readonly [string, VoiceIntent];
const ff = (question: string): VoiceIntent => ({ kind: "freeform", question });
const PER_LANG: Record<Exclude<Language, "it">, readonly Case[]> = {
  en: [
    ["open a session on R three E", { kind: "newSession", game: "r3e" }],
    [
      "start a new session on Automobilista two",
      { kind: "newSession", game: "ams2" },
    ],
    ["new session on assetto corsa evo", { kind: "newSession", game: "ace" }],
    ["open a session", { kind: "newSession", game: null }],
    ["close the session", { kind: "closeSession" }],
    ["analyze the session", { kind: "analyze" }],
    ["acquire setup", { kind: "acquireSetup" }],
    ["load the setup", { kind: "acquireSetup" }],
    ["can you fetch the setup?", { kind: "acquireSetup" }],
    ["new setup", { kind: "acquireSetup" }],
    ["evaluate the new setup", { kind: "analyze" }],
    ["Hey Robert", { kind: "greeting" }],
    ["how am I doing with the evo?", ff("how am I doing with the evo?")],
    ["how is the setup now?", ff("how is the setup now?")],
  ],
  de: [
    ["Öffne eine Sitzung auf R drei E", { kind: "newSession", game: "r3e" }],
    [
      "Starte eine neue Sitzung Automobilista zwei",
      { kind: "newSession", game: "ams2" },
    ],
    ["neue Sitzung Assetto Corsa EVO", { kind: "newSession", game: "ace" }],
    ["Öffne eine Sitzung", { kind: "newSession", game: null }],
    ["Schließe die Sitzung", { kind: "closeSession" }],
    ["Analysiere die Sitzung", { kind: "analyze" }],
    ["Setup erfassen", { kind: "acquireSetup" }],
    ["Lade das Setup", { kind: "acquireSetup" }],
    ["Hole das Setup", { kind: "acquireSetup" }],
    ["neues Setup", { kind: "acquireSetup" }],
    ["Bewerte das neue Setup", { kind: "analyze" }],
    ["Hallo Robert", { kind: "greeting" }],
    ["wie fahre ich mit der evo?", ff("wie fahre ich mit der evo?")],
    ["wie ist das Setup jetzt?", ff("wie ist das Setup jetzt?")],
  ],
  fr: [
    ["Ouvre une session sur R trois E", { kind: "newSession", game: "r3e" }],
    [
      "Démarre une nouvelle session Automobilista deux",
      { kind: "newSession", game: "ams2" },
    ],
    ["nouvelle session assetto corsa evo", { kind: "newSession", game: "ace" }],
    ["Ouvre une session", { kind: "newSession", game: null }],
    ["Ferme la session", { kind: "closeSession" }],
    ["Analyse la session", { kind: "analyze" }],
    ["Acquiers le setup", { kind: "acquireSetup" }],
    ["Charge le setup", { kind: "acquireSetup" }],
    ["Récupère le setup", { kind: "acquireSetup" }],
    ["nouveau setup", { kind: "acquireSetup" }],
    ["Évalue le nouveau setup", { kind: "analyze" }],
    ["Salut Robert", { kind: "greeting" }],
    ["comment je vais avec la evo ?", ff("comment je vais avec la evo ?")],
    [
      "comment est le setup maintenant ?",
      ff("comment est le setup maintenant ?"),
    ],
  ],
  es: [
    ["Abre una sesión en R tres E", { kind: "newSession", game: "r3e" }],
    [
      "Inicia una nueva sesión Automobilista dos",
      { kind: "newSession", game: "ams2" },
    ],
    ["nueva sesión assetto corsa evo", { kind: "newSession", game: "ace" }],
    ["Abre una sesión", { kind: "newSession", game: null }],
    ["Cierra la sesión", { kind: "closeSession" }],
    ["Analiza la sesión", { kind: "analyze" }],
    ["Adquiere el setup", { kind: "acquireSetup" }],
    ["Carga el setup", { kind: "acquireSetup" }],
    ["Recupera el setup", { kind: "acquireSetup" }],
    ["nuevo setup", { kind: "acquireSetup" }],
    ["Evalúa el nuevo setup", { kind: "analyze" }],
    ["Hola Robert", { kind: "greeting" }],
    ["¿cómo voy con la evo?", ff("¿cómo voy con la evo?")],
    ["¿cómo está el setup ahora?", ff("¿cómo está el setup ahora?")],
  ],
};
for (const [lang, cases] of Object.entries(PER_LANG) as [
  Exclude<Language, "it">,
  readonly Case[],
][])
  for (const [phrase, expected] of cases)
    assert.deepEqual(
      classifyVoiceIntent(phrase, NAME, lang),
      expected,
      `${lang}: "${phrase}"`,
    );
// Questions that merely mention a command word stay free questions
for (const [lang, q] of [
  ["en", "how do I stop losing time this session"],
  ["en", "why does the car lose grip before the end of the session"],
  ["en", "what did the analysis say"],
  ["de", "wie höre ich auf, in dieser Sitzung Zeit zu verlieren"],
  ["fr", "comment arrêter de perdre du temps dans cette session"],
  ["es", "¿cómo dejo de perder tiempo en esta sesión? termina"],
  ["it", "come evito di perdere tempo in questa sessione, fine"],
] as const)
  assert.deepEqual(
    classifyVoiceIntent(q, NAME, lang),
    ff(q),
    `${lang}: "${q}"`,
  );
// Game names spoken in each language
assert.equal(matchGame("R drei E", "de"), "r3e");
assert.equal(matchGame("automobilista zwei", "de"), "ams2");
assert.equal(matchGame("R trois E", "fr"), "r3e");
assert.equal(matchGame("automobilista deux", "fr"), "ams2");
assert.equal(matchGame("R tres E", "es"), "r3e");
assert.equal(matchGame("automobilista dos", "es"), "ams2");
assert.equal(matchGame("race room", "en"), "r3e");
assert.equal(matchGame("automobilista 2", "en"), "ams2");
// An Italian command under another language is not a command (and vice versa)
for (const lang of ["de", "en", "es", "fr"] as const) {
  assert.equal(
    classifyVoiceIntent("chiudi la sessione", NAME, lang).kind,
    "freeform",
  );
  assert.equal(
    classifyVoiceIntent("acquisisci setup", NAME, lang).kind,
    "freeform",
  );
}
assert.equal(matchGame("automobilista due", "de"), null);
assert.equal(
  classifyVoiceIntent("close the session", NAME, "it").kind,
  "freeform",
);

console.log("voice-intent.selfcheck OK");
