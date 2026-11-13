/**
 * Per-language command vocabulary for voice-intent.ts. Only the active language is
 * recognised: an Italian command under "de" is a free question. Matching runs on
 * the normalized text (lowercase, punctuation stripped, accents kept).
 */

import type { Language } from "../../shared/i18n.js";
import type { GameSource } from "../../shared/types.js";

export type VoiceLexicon = {
  /** Tokens allowed before the assistant name in a wake call. */
  greetings: readonly string[];
  games: ReadonlyArray<readonly [GameSource, readonly RegExp[]]>;
  /** Word stem of "session" (prefix match: sessione, sessioni, ...). */
  session: RegExp;
  open: RegExp;
  close: RegExp;
  analyze: RegExp;
  /** The word "setup" as Azure STT writes it (attached or detached). */
  setup: RegExp;
  /** Verbs/adjectives of the four acquire triggers (acquire/load/fetch/new setup). */
  acquire: RegExp;
  /** Question words opening the sentence: the text is a question, never a command. */
  question: RegExp;
  /** Words that drop a pending setup-name prompt. Matched on the normalized name. */
  cancel: RegExp;
};

// \b is ASCII-only: "öffne" or "démarre" need Unicode-aware boundaries.
const NB = "(?<![\\p{L}\\p{N}])";
const NA = "(?![\\p{L}\\p{N}])";
const words = (alts: string): RegExp =>
  new RegExp(`${NB}(?:${alts})${NA}`, "u");
const stem = (alts: string): RegExp => new RegExp(`${NB}(?:${alts})`, "u");
const opening = (alts: string): RegExp => new RegExp(`^(?:${alts})${NA}`, "u");
const cancel = (alts: string): RegExp => new RegExp(`^(?:${alts})$`, "iu");
const games = (
  r3e: string[],
  ace: string[],
  ams2: string[],
): VoiceLexicon["games"] => [
  ["r3e", r3e.map(words)],
  ["ace", ace.map(words)],
  ["ams2", ams2.map(words)],
];

// Long forms first, acronyms after; a sentence naming two games returns null anyway.
const ACE = ["assetto corsa evo", "ac ?evo", "ace", "evo"];

export const LEXICONS: Record<Language, VoiceLexicon> = {
  it: {
    greetings: [
      "ciao",
      "ehi",
      "hey",
      "ehilà",
      "senti",
      "ok",
      "salve",
      "buongiorno",
      "buonasera",
    ],
    games: games(["race ?room", "r ?3 ?e", "rre", "erre ?(tre|3) ?e"], ACE, [
      "automobilista ?(2|due)",
      "ams ?(2|due)",
    ]),
    session: stem("session"),
    open: words(
      "nuova|apri|inizia|inizio|avvia|avvio|comincia|crea|start|apre|partenza|parti",
    ),
    close: words("chiudi|termina|fine|ferma|concludi|stop|finisci|chiude"),
    analyze: words("analizza|analisi|valuta|valutazione|esegui analisi"),
    setup: words("set ?up"),
    acquire: words(
      "acquisisci|acquisire|acquisisce|carica|caricare|caricami|preleva|prelevare|nuovo|nuova",
    ),
    question: opening(
      "come|cosa|che|perché|perche|quando|dove|quale|quali|devo|posso|è|chi",
    ),
    cancel: cancel("annulla|annullo|lascia stare|lascia perdere|niente|no"),
  },
  en: {
    greetings: [
      "hey",
      "hi",
      "hello",
      "ok",
      "okay",
      "yo",
      "good",
      "morning",
      "evening",
      "afternoon",
    ],
    games: games(["race ?room", "(r|are) ?(3|three) ?e"], ACE, [
      "automobilista ?(2|two)",
      "ams ?(2|two)",
    ]),
    session: stem("session"),
    open: words("new|open|start|begin|create|launch"),
    close: words("close|end|stop|finish|terminate|quit"),
    analyze: words("analy[sz]e|analysis|evaluate|evaluation|assess"),
    setup: words("set ?up"),
    acquire: words("acquire|load|fetch|retrieve|import|new"),
    question: opening(
      "how|what|why|when|where|which|who|should|do|does|is|are",
    ),
    cancel: cancel(
      "cancel|never ?mind|forget it|forget about it|nothing|no|skip",
    ),
  },
  de: {
    greetings: [
      "hallo",
      "hey",
      "hi",
      "ok",
      "okay",
      "servus",
      "moin",
      "guten",
      "morgen",
      "tag",
      "abend",
    ],
    games: games(["race ?room", "(r|er) ?(3|drei) ?e"], ACE, [
      "automobilista ?(2|zwei)",
      "ams ?(2|zwei)",
    ]),
    session: stem("sitzung|session"),
    open: words(
      "neue|neu|öffne|öffnen|eröffne|eröffnen|starte|starten|beginne|beginnen|erstelle|erstellen",
    ),
    close: words(
      "schließe|schließen|schliesse|schliessen|beende|beenden|stoppe|stopp|abschließen",
    ),
    analyze: words(
      "analysiere|analysieren|analyse|auswerten|auswertung|bewerte|bewerten",
    ),
    setup: words("set ?up"),
    acquire: words(
      "erfasse|erfassen|lade|laden|hole|holen|abrufen|rufe ab|importiere|neues|neuen|neue",
    ),
    question: opening(
      "wie|was|warum|wann|wo|welche|welcher|welches|soll|kann|ist|wer",
    ),
    cancel: cancel(
      "abbrechen|abbruch|abbrechen bitte|vergiss es|lass es|lass gut sein|nichts|nein|egal",
    ),
  },
  fr: {
    greetings: [
      "salut",
      "bonjour",
      "bonsoir",
      "hé",
      "hey",
      "ok",
      "dis",
      "coucou",
      "allô",
    ],
    games: games(["race ?room", "r ?(3|trois) ?e"], ACE, [
      "automobilista ?(2|deux)",
      "ams ?(2|deux)",
    ]),
    session: stem("session"),
    open: words(
      "nouvelle|nouveau|ouvre|ouvrir|ouvrez|démarre|démarrer|démarrez|lance|lancer|commence|commencer|crée|créer",
    ),
    close: words(
      "ferme|fermer|fermez|termine|terminer|clôture|clôturer|arrête|arrêter|finis|fin|stoppe|stop",
    ),
    analyze: words("analyse|analyser|analysez|évalue|évaluer|évaluation"),
    setup: words("set ?up"),
    acquire: words(
      "acquiers|acquérir|acquière|charge|charger|chargez|récupère|récupérer|importe|nouveau|nouvelle",
    ),
    question: opening(
      "comment|que|qu|quoi|pourquoi|quand|où|quel|quelle|quels|est ce|dois|peux|qui",
    ),
    cancel: cancel(
      "annuler|annule|annulez|laisse tomber|laisse|oublie|oublie ça|rien|non|peu importe",
    ),
  },
  es: {
    greetings: [
      "hola",
      "oye",
      "ok",
      "vale",
      "buenos",
      "buenas",
      "buen",
      "días",
      "dias",
      "día",
      "dia",
      "tardes",
      "noches",
    ],
    games: games(["race ?room", "r ?(3|tres) ?e"], ACE, [
      "automobilista ?(2|dos)",
      "ams ?(2|dos)",
    ]),
    session: stem("sesi[oó]n"),
    open: words(
      "nueva|nuevo|abre|abrir|inicia|iniciar|empieza|empezar|arranca|crea|crear|comienza|comenzar|lanza",
    ),
    close: words(
      "cierra|cerrar|termina|terminar|finaliza|finalizar|detén|deten|detener|acaba",
    ),
    analyze: words(
      "analiza|analizar|análisis|analisis|evalúa|evalua|evaluar|evaluación",
    ),
    setup: words("set ?up"),
    acquire: words(
      "adquiere|adquirir|carga|cargar|cárgame|recupera|recuperar|importa|nuevo|nueva",
    ),
    question: opening(
      "cómo|como|qué|que|por qué|cuándo|dónde|cuál|cuáles|debo|puedo|es|quién",
    ),
    cancel: cancel(
      "cancelar|cancela|olvídalo|olvidalo|déjalo|dejalo|nada|no|da igual",
    ),
  },
};
