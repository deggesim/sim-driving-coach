/**
 * Normalizza il nome di un setup dettato a voce (R3E e AMS2 lo chiedono a voce;
 * ACE prende il nome del file). Chi detta compita: "vu uno" deve diventare `v1`,
 * non "vu uno". Puro come voice-intent.ts, così `spoken-name.selfcheck.ts` lo
 * verifica senza microfono.
 *
 * Regole: lettere compitate in italiano o inglese -> il carattere, sempre
 * minuscolo; numeri a parole -> cifre; nomi di simboli ("trattino basso",
 * "underscore", "spazio") -> il simbolo.
 */

type Kind = "word" | "glyph" | "symbol" | "space";
type Piece = { kind: Kind; text: string; raw: string; soft?: boolean };

/** Nomi dei simboli, italiano e inglese. Le chiavi multi-parola vincono sulle
 *  singole perché il match è greedy sul numero di token. */
const SYMBOLS: Record<string, string> = {
  "trattino basso": "_",
  underscore: "_",
  "under score": "_",
  sottolineato: "_",
  trattino: "-",
  meno: "-",
  minus: "-",
  dash: "-",
  hyphen: "-",
  spazio: " ",
  space: " ",
  punto: ".",
  dot: ".",
  point: ".",
  period: ".",
  "full stop": ".",
  virgola: ",",
  comma: ",",
  "due punti": ":",
  colon: ":",
  "punto e virgola": ";",
  semicolon: ";",
  slash: "/",
  barra: "/",
  "forward slash": "/",
  backslash: "\\",
  "back slash": "\\",
  "barra rovesciata": "\\",
  più: "+",
  piu: "+",
  plus: "+",
  uguale: "=",
  equals: "=",
  equal: "=",
  cancelletto: "#",
  diesis: "#",
  hash: "#",
  pound: "#",
  chiocciola: "@",
  at: "@",
  asterisco: "*",
  asterisk: "*",
  star: "*",
  apostrofo: "'",
  apostrophe: "'",
  percento: "%",
  percent: "%",
  "e commerciale": "&",
  ampersand: "&",
  "parentesi aperta": "(",
  "parentesi chiusa": ")",
  "punto esclamativo": "!",
  "punto interrogativo": "?",
};

/** Nomi delle lettere. L'inglese sta nella stessa mappa: una frase può mescolare
 *  le due lingue ("emme one") e distinguere non servirebbe a nulla. */
const LETTERS: Record<string, string> = {
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

/** Nomi di lettera che sono anche parole comuni: "setup di gara" non è "setup d
 *  gara". Queste diventano lettere solo dentro una sequenza compitata (vedi
 *  `soft` più sotto); le altre ("emme", "effe", "ipsilon") convertono sempre. */
const AMBIGUOUS_LETTERS = new Set([
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

const isAmbiguous = (key: string): boolean =>
  key.length <= 2 || AMBIGUOUS_LETTERS.has(key);

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

/** 0-99 generati invece che elencati. ponytail: oltre il 99 nessuno detta un
 *  nome di setup, "cento" a parte. */
const NUMBERS = new Map<string, string>();
IT_UNITS.forEach((w, i) => NUMBERS.set(w, String(i)));
IT_TEENS.forEach((w, i) => NUMBERS.set(w, String(10 + i)));
EN_UNITS.forEach((w, i) => NUMBERS.set(w, String(i)));
EN_TEENS.forEach((w, i) => NUMBERS.set(w, String(10 + i)));
for (let t = 2; t <= 9; t++) {
  NUMBERS.set(IT_TENS[t], String(t * 10));
  NUMBERS.set(EN_TENS[t], String(t * 10));
  for (let u = 1; u <= 9; u++) {
    const value = String(t * 10 + u);
    // ventuno/ventotto elidono la vocale delle decine, ventitré porta l'accento
    const stem = u === 1 || u === 8 ? IT_TENS[t].slice(0, -1) : IT_TENS[t];
    NUMBERS.set(stem + (u === 3 ? "tre" : IT_UNITS[u]), value);
    if (u === 3) NUMBERS.set(stem + "tré", value);
    // "twenty one" e "twenty-one": il tokenizer stacca il trattino
    NUMBERS.set(`${EN_TENS[t]} ${EN_UNITS[u]}`, value);
    NUMBERS.set(`${EN_TENS[t]} - ${EN_UNITS[u]}`, value);
  }
}
NUMBERS.set("cento", "100");
NUMBERS.set("hundred", "100");

const MAX_PHRASE = 3;

const toPiece = (key: string, raw: string): Piece | null => {
  const symbol = SYMBOLS[key];
  if (symbol)
    return { kind: symbol === " " ? "space" : "symbol", text: symbol, raw };
  const digits = NUMBERS.get(key);
  if (digits) return { kind: "glyph", text: digits, raw };
  const letter = LETTERS[key];
  if (letter)
    return { kind: "glyph", text: letter, raw, soft: isAmbiguous(key) };
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

export const normalizeSpokenName = (text: string): string => {
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
      const slice = tokens.slice(i, i + n);
      matched = toPiece(slice.join(" "), slice.join(" "));
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
