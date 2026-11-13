/**
 * Normalizza il nome di un setup dettato a voce (R3E e AMS2 lo chiedono a voce;
 * ACE prende il nome del file). Chi detta compita: "vu uno" deve diventare `v1`,
 * non "vu uno". Puro come voice-intent.ts, così `spoken-name.selfcheck.ts` lo
 * verifica senza microfono.
 *
 * Regole: lettere compitate nella lingua attiva -> il carattere, sempre
 * minuscolo; numeri a parole -> cifre; nomi di simboli ("trattino basso",
 * "underscore", "spazio") -> il simbolo. Italiano e inglese restano mescolati
 * sotto "it" (comportamento storico); le altre lingue riconoscono solo la propria.
 */

import type { Language } from "../../shared/i18n.js";

type Kind = "word" | "glyph" | "symbol" | "space";
type Piece = { kind: Kind; text: string; raw: string; soft?: boolean };

/** Everything the matcher needs for one language. `soft` marks letter names that
 *  are also common words: they convert only inside a spelled sequence. */
type Lexicon = {
  symbols: Record<string, string>;
  letters: Record<string, string>;
  numbers: Map<string, string>;
  soft: (key: string) => boolean;
};

/** Nomi dei simboli. Le chiavi multi-parola vincono sulle singole perché il match
 *  è greedy sul numero di token. */
const SYMBOLS_IT: Record<string, string> = {
  "trattino basso": "_",
  sottolineato: "_",
  trattino: "-",
  meno: "-",
  spazio: " ",
  punto: ".",
  virgola: ",",
  "due punti": ":",
  "punto e virgola": ";",
  barra: "/",
  "barra rovesciata": "\\",
  più: "+",
  piu: "+",
  uguale: "=",
  cancelletto: "#",
  diesis: "#",
  chiocciola: "@",
  asterisco: "*",
  apostrofo: "'",
  percento: "%",
  "e commerciale": "&",
  "parentesi aperta": "(",
  "parentesi chiusa": ")",
  "punto esclamativo": "!",
  "punto interrogativo": "?",
};

const SYMBOLS_EN: Record<string, string> = {
  underscore: "_",
  "under score": "_",
  minus: "-",
  dash: "-",
  hyphen: "-",
  space: " ",
  dot: ".",
  point: ".",
  period: ".",
  "full stop": ".",
  comma: ",",
  colon: ":",
  semicolon: ";",
  slash: "/",
  "forward slash": "/",
  backslash: "\\",
  "back slash": "\\",
  plus: "+",
  equals: "=",
  equal: "=",
  hash: "#",
  pound: "#",
  at: "@",
  asterisk: "*",
  star: "*",
  apostrophe: "'",
  percent: "%",
  ampersand: "&",
};

const SYMBOLS_DE: Record<string, string> = {
  unterstrich: "_",
  "unter strich": "_",
  underscore: "_",
  bindestrich: "-",
  gedankenstrich: "-",
  strich: "-",
  minus: "-",
  leerzeichen: " ",
  leertaste: " ",
  punkt: ".",
  komma: ",",
  doppelpunkt: ":",
  semikolon: ";",
  schrägstrich: "/",
  slash: "/",
  backslash: "\\",
  plus: "+",
  gleichheitszeichen: "=",
  raute: "#",
  hash: "#",
  klammeraffe: "@",
  stern: "*",
  apostroph: "'",
  prozent: "%",
  "klammer auf": "(",
  "klammer zu": ")",
  ausrufezeichen: "!",
  fragezeichen: "?",
};

const SYMBOLS_FR: Record<string, string> = {
  "tiret bas": "_",
  "tiret du bas": "_",
  "tiret du 8": "_",
  underscore: "_",
  tiret: "-",
  moins: "-",
  espace: " ",
  point: ".",
  virgule: ",",
  "deux points": ":",
  "point virgule": ";",
  slash: "/",
  "barre oblique": "/",
  antislash: "\\",
  égal: "=",
  égale: "=",
  dièse: "#",
  croisillon: "#",
  arobase: "@",
  astérisque: "*",
  apostrophe: "'",
  pourcent: "%",
  "pour cent": "%",
  esperluette: "&",
  "parenthèse ouverte": "(",
  "parenthèse fermée": ")",
};

const SYMBOLS_ES: Record<string, string> = {
  "guion bajo": "_",
  "guión bajo": "_",
  "barra baja": "_",
  underscore: "_",
  guion: "-",
  guión: "-",
  menos: "-",
  espacio: " ",
  punto: ".",
  coma: ",",
  "dos puntos": ":",
  "punto y coma": ";",
  barra: "/",
  slash: "/",
  "barra invertida": "\\",
  igual: "=",
  almohadilla: "#",
  numeral: "#",
  arroba: "@",
  asterisco: "*",
  apóstrofo: "'",
  porcentaje: "%",
  ampersand: "&",
  "paréntesis abierto": "(",
  "paréntesis cerrado": ")",
};

const LETTERS_IT: Record<string, string> = {
  a: "a",
  bi: "b",
  ci: "c",
  di: "d",
  e: "e",
  effe: "f",
  gi: "g",
  acca: "h",
  i: "i",
  "i lunga": "j",
  gei: "j",
  cappa: "k",
  ka: "k",
  elle: "l",
  emme: "m",
  enne: "n",
  o: "o",
  pi: "p",
  qu: "q",
  cu: "q",
  ku: "q",
  erre: "r",
  esse: "s",
  ti: "t",
  u: "u",
  vi: "v",
  vu: "v",
  "doppia vu": "w",
  "doppia vi": "w",
  "vu doppia": "w",
  ics: "x",
  ipsilon: "y",
  "i greca": "y",
  zeta: "z",
};

const LETTERS_EN: Record<string, string> = {
  ay: "a",
  bee: "b",
  cee: "c",
  see: "c",
  dee: "d",
  ee: "e",
  ef: "f",
  eff: "f",
  gee: "g",
  aitch: "h",
  eye: "i",
  jay: "j",
  kay: "k",
  el: "l",
  ell: "l",
  em: "m",
  en: "n",
  oh: "o",
  pee: "p",
  cue: "q",
  queue: "q",
  ar: "r",
  are: "r",
  ess: "s",
  tee: "t",
  tea: "t",
  you: "u",
  yu: "u",
  vee: "v",
  "double u": "w",
  "double you": "w",
  "double v": "w",
  ex: "x",
  why: "y",
  wye: "y",
  zed: "z",
  zee: "z",
};

const LETTERS_DE: Record<string, string> = {
  a: "a",
  be: "b",
  bee: "b",
  ce: "c",
  ze: "c",
  tse: "c",
  de: "d",
  e: "e",
  ef: "f",
  eff: "f",
  ge: "g",
  ha: "h",
  i: "i",
  jot: "j",
  ka: "k",
  el: "l",
  em: "m",
  en: "n",
  o: "o",
  pe: "p",
  ku: "q",
  er: "r",
  es: "s",
  te: "t",
  u: "u",
  fau: "v",
  vau: "v",
  we: "w",
  ix: "x",
  ypsilon: "y",
  zett: "z",
  // "ein" is also the article: converts only inside a spelled sequence
  ein: "1",
};

const LETTERS_FR: Record<string, string> = {
  a: "a",
  bé: "b",
  be: "b",
  cé: "c",
  ce: "c",
  sé: "c",
  dé: "d",
  de: "d",
  e: "e",
  eu: "e",
  ef: "f",
  èf: "f",
  effe: "f",
  gé: "g",
  ge: "g",
  jé: "g",
  ache: "h",
  hache: "h",
  ash: "h",
  i: "i",
  ji: "j",
  ka: "k",
  el: "l",
  èl: "l",
  elle: "l",
  em: "m",
  emme: "m",
  en: "n",
  enne: "n",
  o: "o",
  pé: "p",
  pe: "p",
  ku: "q",
  cu: "q",
  er: "r",
  èr: "r",
  erre: "r",
  es: "s",
  ès: "s",
  esse: "s",
  té: "t",
  te: "t",
  u: "u",
  vé: "v",
  ve: "v",
  "double v": "w",
  "double vé": "w",
  ix: "x",
  "i grec": "y",
  ygrec: "y",
  zède: "z",
  zed: "z",
  // "un" is also the article: converts only inside a spelled sequence
  un: "1",
};

const LETTERS_ES: Record<string, string> = {
  a: "a",
  be: "b",
  ce: "c",
  de: "d",
  e: "e",
  efe: "f",
  ge: "g",
  hache: "h",
  i: "i",
  jota: "j",
  ka: "k",
  ele: "l",
  eme: "m",
  ene: "n",
  o: "o",
  pe: "p",
  cu: "q",
  erre: "r",
  ese: "s",
  te: "t",
  u: "u",
  uve: "v",
  "doble uve": "w",
  "uve doble": "w",
  "doble ve": "w",
  equis: "x",
  "i griega": "y",
  ye: "y",
  zeta: "z",
  // "un" is also the article: converts only inside a spelled sequence
  un: "1",
};

/** Italian and English letter names also double as common words ("setup di
 *  gara"): short ones and a few longer ones only count inside a spelled sequence. */
const AMBIGUOUS_EN = new Set([
  "see",
  "are",
  "tea",
  "tee",
  "you",
  "why",
  "cue",
  "queue",
  "eye",
  "oh",
  "ay",
  "ess",
]);
const softByLength = (key: string): boolean =>
  key.length <= 2 || AMBIGUOUS_EN.has(key);

/** de/fr/es: an explicit list instead, so accented names ("vé", "bé") stay hard. */
const softIn =
  (...keys: string[]) =>
  (key: string): boolean =>
    keys.includes(key);

const IT_UNITS = [
  "zero",
  "uno",
  "due",
  "tre",
  "quattro",
  "cinque",
  "sei",
  "sette",
  "otto",
  "nove",
];
const IT_TEENS = [
  "dieci",
  "undici",
  "dodici",
  "tredici",
  "quattordici",
  "quindici",
  "sedici",
  "diciassette",
  "diciotto",
  "diciannove",
];
const IT_TENS = [
  "",
  "",
  "venti",
  "trenta",
  "quaranta",
  "cinquanta",
  "sessanta",
  "settanta",
  "ottanta",
  "novanta",
];
const EN_UNITS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];
const EN_TEENS = [
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const EN_TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];
const DE_UNITS = [
  "null",
  "eins",
  "zwei",
  "drei",
  "vier",
  "fünf",
  "sechs",
  "sieben",
  "acht",
  "neun",
];
const DE_TEENS = [
  "zehn",
  "elf",
  "zwölf",
  "dreizehn",
  "vierzehn",
  "fünfzehn",
  "sechzehn",
  "siebzehn",
  "achtzehn",
  "neunzehn",
];
const DE_TENS = [
  "",
  "",
  "zwanzig",
  "dreißig",
  "vierzig",
  "fünfzig",
  "sechzig",
  "siebzig",
  "achtzig",
  "neunzig",
];
const FR_UNITS = [
  "zéro",
  "un",
  "deux",
  "trois",
  "quatre",
  "cinq",
  "six",
  "sept",
  "huit",
  "neuf",
];
const FR_TEENS = [
  "dix",
  "onze",
  "douze",
  "treize",
  "quatorze",
  "quinze",
  "seize",
  "dix sept",
  "dix huit",
  "dix neuf",
];
const FR_TENS = [
  "",
  "",
  "vingt",
  "trente",
  "quarante",
  "cinquante",
  "soixante",
];
const ES_UNITS = [
  "cero",
  "uno",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
];
const ES_TEENS = [
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciséis",
  "diecisiete",
  "dieciocho",
  "diecinueve",
];
const ES_TENS = [
  "",
  "",
  "veinte",
  "treinta",
  "cuarenta",
  "cincuenta",
  "sesenta",
  "setenta",
  "ochenta",
  "noventa",
];

/** 0-99 generati invece che elencati. ponytail: oltre il 99 nessuno detta un
 *  nome di setup, "cento" a parte; in francese si arriva a 69 (70-99 sono
 *  composti additivi: aggiungerli solo se qualcuno li detta). */
const fill = (
  m: Map<string, string>,
  units: string[],
  teens: string[],
  tens: string[],
  compound: (t: number, u: number, out: (key: string) => void) => void,
  maxTens = 9,
) => {
  units.forEach((w, i) => m.set(w, String(i)));
  teens.forEach((w, i) => m.set(w, String(10 + i)));
  for (let t = 2; t <= maxTens; t++) {
    m.set(tens[t], String(t * 10));
    for (let u = 1; u <= 9; u++)
      compound(t, u, (key) => m.set(key, String(t * 10 + u)));
  }
};

const numbersIt = (m: Map<string, string>) => {
  fill(m, IT_UNITS, IT_TEENS, IT_TENS, (t, u, out) => {
    // ventuno/ventotto elidono la vocale delle decine, ventitré porta l'accento
    const stem = u === 1 || u === 8 ? IT_TENS[t].slice(0, -1) : IT_TENS[t];
    out(stem + (u === 3 ? "tre" : IT_UNITS[u]));
    if (u === 3) out(stem + "tré");
  });
  m.set("cento", "100");
};

const numbersEn = (m: Map<string, string>) => {
  fill(m, EN_UNITS, EN_TEENS, EN_TENS, (t, u, out) => {
    // "twenty one" e "twenty-one": il tokenizer stacca il trattino
    out(`${EN_TENS[t]} ${EN_UNITS[u]}`);
    out(`${EN_TENS[t]} - ${EN_UNITS[u]}`);
  });
  m.set("hundred", "100");
};

const numbersDe = (m: Map<string, string>) => {
  fill(m, DE_UNITS, DE_TEENS, DE_TENS, (t, u, out) => {
    const unit = u === 1 ? "ein" : DE_UNITS[u];
    out(`${unit}und${DE_TENS[t]}`);
    if (DE_TENS[t].includes("ß"))
      out(`${unit}und${DE_TENS[t].replace("ß", "ss")}`);
  });
  m.set("zwo", "2");
  m.set("hundert", "100");
};

const numbersFr = (m: Map<string, string>) => {
  fill(
    m,
    FR_UNITS,
    FR_TEENS,
    FR_TENS,
    (t, u, out) => {
      const words = u === 1 ? "et un" : FR_UNITS[u];
      out(`${FR_TENS[t]} ${words}`);
      out(`${FR_TENS[t]} - ${words.replaceAll(" ", " - ")}`);
    },
    6,
  );
  // "un" is also the article: it is a soft letter instead, see LETTERS_FR
  m.delete("un");
  m.set("cent", "100");
};

const numbersEs = (m: Map<string, string>) => {
  fill(m, ES_UNITS, ES_TEENS, ES_TENS, (t, u, out) => {
    if (t === 2) {
      const accented: Record<number, string> = {
        1: "ún",
        2: "dós",
        3: "trés",
        6: "séis",
      };
      out(`veinti${ES_UNITS[u]}`);
      if (accented[u]) out(`veinti${accented[u]}`);
    } else out(`${ES_TENS[t]} y ${ES_UNITS[u]}`);
  });
  m.set("cien", "100");
};

const build = (
  symbols: Record<string, string>,
  letters: Record<string, string>,
  numbers: ((m: Map<string, string>) => void)[],
  soft: (key: string) => boolean,
): Lexicon => {
  const map = new Map<string, string>();
  numbers.forEach((f) => f(map));
  return { symbols, letters, numbers: map, soft };
};

const LEXICONS: Record<Language, Lexicon> = {
  it: build(
    { ...SYMBOLS_IT, ...SYMBOLS_EN },
    { ...LETTERS_IT, ...LETTERS_EN },
    [numbersIt, numbersEn],
    softByLength,
  ),
  en: build(SYMBOLS_EN, LETTERS_EN, [numbersEn], softByLength),
  de: build(
    SYMBOLS_DE,
    LETTERS_DE,
    [numbersDe],
    softIn("a", "e", "i", "o", "u", "er", "es", "ein", "ha", "en", "el", "em"),
  ),
  fr: build(
    SYMBOLS_FR,
    LETTERS_FR,
    [numbersFr],
    softIn(
      "a",
      "e",
      "i",
      "o",
      "u",
      "de",
      "te",
      "ce",
      "es",
      "en",
      "el",
      "er",
      "un",
      "elle",
      "ache",
      "hache",
    ),
  ),
  es: build(
    SYMBOLS_ES,
    LETTERS_ES,
    [numbersEs],
    softIn("a", "e", "i", "o", "u", "y", "de", "te", "un", "ese"),
  ),
};

const MAX_PHRASE = 3;

const toPiece = (lex: Lexicon, key: string): Piece | null => {
  const raw = key;
  const symbol = lex.symbols[key];
  if (symbol)
    return { kind: symbol === " " ? "space" : "symbol", text: symbol, raw };
  const digits = lex.numbers.get(key);
  if (digits) return { kind: "glyph", text: digits, raw };
  const letter = lex.letters[key];
  if (letter) return { kind: "glyph", text: letter, raw, soft: lex.soft(key) };
  // Già una cifra o una lettera singola nella trascrizione ("v 1" -> "v1")
  if (/^\d+$/.test(key)) return { kind: "glyph", text: key, raw };
  if (/^\p{L}$/u.test(key))
    return { kind: "glyph", text: key, raw, soft: true };
  return null;
};

/** Un pezzo "duro" (cifra, lettera certa, simbolo) rivela una sequenza compitata
 *  e sblocca le lettere ambigue accanto. La propagazione è transitiva - in
 *  "gi pi due" solo "due" è duro, ma sblocca "pi" che a sua volta sblocca "gi" -
 *  quindi una passata avanti e una indietro, non un singolo confronto. */
const resolveSoft = (pieces: Piece[]): boolean[] => {
  const hard = pieces.map((p) => p.kind !== "word" && p.soft !== true);
  const unlock = (i: number) => {
    if (pieces[i].soft && (hard[i - 1] || hard[i + 1])) hard[i] = true;
  };
  for (let i = 0; i < pieces.length; i++) unlock(i);
  for (let i = pieces.length - 1; i >= 0; i--) unlock(i);
  return hard;
};

export const normalizeSpokenName = (text: string, lang: Language): string => {
  const lex = LEXICONS[lang];
  // Azure STT chiude con un punto una frase isolata: senza toglierlo il setup si
  // chiamerebbe "qualifica monza.". Va fatto prima del match, o "punto" parlato
  // e punto scritto diventano indistinguibili.
  const clean = text
    .toLowerCase()
    .trim()
    .replace(/[.!?]+$/, "");
  const tokens = clean.match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];

  const pieces: Piece[] = [];
  for (let i = 0; i < tokens.length;) {
    let matched: Piece | null = null;
    let size = 0;
    for (let n = Math.min(MAX_PHRASE, tokens.length - i); n >= 1; n--) {
      matched = toPiece(lex, tokens.slice(i, i + n).join(" "));
      if (matched) {
        size = n;
        break;
      }
    }
    if (matched) {
      pieces.push(matched);
      i += size;
      continue;
    }
    const raw = tokens[i];
    // Punteggiatura già scritta dallo STT: incolla come un simbolo parlato
    pieces.push({
      kind: /[\p{L}\p{N}]/u.test(raw) ? "word" : "symbol",
      text: raw,
      raw,
    });
    i += 1;
  }

  const hard = resolveSoft(pieces);
  const resolved = pieces.map((p, i) =>
    p.soft && !hard[i] ? { ...p, kind: "word" as const, text: p.raw } : p,
  );

  let out = "";
  let prev: Kind | null = null;
  for (const p of resolved) {
    if (p.kind === "space") {
      out += " ";
      prev = "space";
      continue;
    }
    const glue =
      out === "" ||
      out.endsWith(" ") ||
      p.kind === "symbol" ||
      prev === "symbol" ||
      (prev === "glyph" && p.kind === "glyph");
    out += (glue ? "" : " ") + p.text;
    prev = p.kind;
  }
  return out.replace(/\s+/g, " ").trim();
};
