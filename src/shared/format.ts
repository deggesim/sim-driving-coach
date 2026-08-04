/**
 * Drop markdown marks from voice-coach text: Azure TTS reads `**` as
 * "asterisco asterisco", and the overlay renders the answer as plain text.
 * `_` is only stripped as a `__bold__` pair, so identifiers like ks_porsche survive.
 * Safe on a partial stream (marks are removed one char at a time, unpaired is fine).
 */
export const stripMarkdown = (text: string): string =>
  text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // headings
    .replace(/^\s*[-*+]\s+/gm, "") // list bullets
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links
    .replace(/__([^_]+)__/g, "$1")
    .replace(/[*`]/g, ""); // emphasis / code marks

export const formatLapTime = (seconds: number | null): string => {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0
    ? `${mins}:${secs.toFixed(3).padStart(6, "0")}`
    : `${secs.toFixed(3)}s`;
};

// ---------------------------------------------------------------------------
// Italian TTS text preprocessing
// ---------------------------------------------------------------------------

/** Convert an integer (0-9999) to Italian words. */
const numberToItalian = (n: number): string => {
  if (n === 0) return "zero";

  const ones = [
    "",
    "uno",
    "due",
    "tre",
    "quattro",
    "cinque",
    "sei",
    "sette",
    "otto",
    "nove",
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
  const tens = [
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

  if (n < 20) return ones[n];

  if (n < 100) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    // Italian rule: drop final vowel of tens word before 1 or 8 (ventuno, ventotto…)
    const tensWord = u === 1 || u === 8 ? tens[t].slice(0, -1) : tens[t];
    return tensWord + (u > 0 ? ones[u] : "");
  }

  if (n < 1000) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    const hundredsWord = h === 1 ? "cento" : ones[h] + "cento";
    return hundredsWord + (rest > 0 ? numberToItalian(rest) : "");
  }

  // 1000-9999
  const th = Math.floor(n / 1000);
  const rest = n % 1000;
  const thousandsWord = th === 1 ? "mille" : numberToItalian(th) + "mila";
  return thousandsWord + (rest > 0 ? numberToItalian(rest) : "");
};

/**
 * Parse a decimal string (e.g. "20", "34", "567") into its Italian unit info.
 * Trailing zeros are stripped first to determine the natural unit:
 *   "20" → "2" → decimi, "34" → "34" → centesimi, "567" → "567" → millesimi
 */
const decPartInfo = (
  decStr: string | undefined,
): {
  numStr: string;
  unit: string;
  unitPlural: string;
  digits: number;
} | null => {
  if (!decStr) return null;
  const trimmed = decStr.replace(/0+$/, "");
  if (!trimmed) return null;
  const val = parseInt(trimmed, 10);
  let unit: string;
  let unitPlural: string;
  if (trimmed.length === 1) {
    unit = val === 1 ? "decimo" : "decimi";
    unitPlural = "decimi";
  } else if (trimmed.length === 2) {
    unit = val === 1 ? "centesimo" : "centesimi";
    unitPlural = "centesimi";
  } else {
    unit = val === 1 ? "millesimo" : "millesimi";
    unitPlural = "millesimi";
  }
  return {
    numStr: numberToItalian(val),
    unit,
    unitPlural,
    digits: trimmed.length,
  };
};

/** Format a generic duration in seconds to Italian (no "al giro" suffix). */
const singleSecondsPhrase = (
  secStr: string,
  decStr: string | undefined,
): string => {
  const sec = parseInt(secStr, 10);
  const dec = decPartInfo(decStr);
  if (!dec) {
    return sec === 1 ? "un secondo" : `${numberToItalian(sec)} secondi`;
  }
  if (sec === 0) return `${dec.numStr} ${dec.unit}`;
  const secPhrase =
    sec === 1 ? "un secondo" : `${numberToItalian(sec)} secondi`;
  return `${secPhrase} e ${dec.numStr} ${dec.unit}`;
};

/** Format a range "X.Y–X.Z s" to Italian using "o" as conjunction. */
const rangeSecondsPhrase = (
  sec1Str: string,
  dec1Str: string | undefined,
  sec2Str: string,
  dec2Str: string | undefined,
): string => {
  const sec1 = parseInt(sec1Str, 10);
  const sec2 = parseInt(sec2Str, 10);
  const dec1 = decPartInfo(dec1Str);
  const dec2 = decPartInfo(dec2Str);

  // Both sub-second, same decimal precision → "due o tre decimi"
  if (sec1 === 0 && sec2 === 0 && dec1 && dec2 && dec1.digits === dec2.digits) {
    return `${dec1.numStr} o ${dec2.numStr} ${dec2.unit}`;
  }

  return `${singleSecondsPhrase(sec1Str, dec1Str)} o ${singleSecondsPhrase(sec2Str, dec2Str)}`;
};

/** Convert a single "Xs/giro" or "X.Ys/giro" to Italian with "al giro". */
const singleLapDeltaPhrase = (
  secStr: string,
  decStr: string | undefined,
): string => {
  const sec = parseInt(secStr, 10);
  const dec = decPartInfo(decStr);
  if (!dec) {
    return sec === 1
      ? "un secondo al giro"
      : `${numberToItalian(sec)} secondi al giro`;
  }
  if (sec === 0) {
    return `${dec.numStr} ${dec.unit} al giro`;
  }
  const secPhrase =
    sec === 1 ? "un secondo" : `${numberToItalian(sec)} secondi`;
  return `${secPhrase} e ${dec.numStr} ${dec.unit} al giro`;
};

/** Convert a range "X.Ys–X.Zs/giro" (en-dash or hyphen) to Italian. */
const rangeLapDeltaPhrase = (
  sec1Str: string,
  dec1Str: string | undefined,
  sec2Str: string,
  dec2Str: string | undefined,
): string => {
  const sec1 = parseInt(sec1Str, 10);
  const sec2 = parseInt(sec2Str, 10);
  const dec1 = decPartInfo(dec1Str);
  const dec2 = decPartInfo(dec2Str);

  // Both sub-second, same decimal precision → "tra N1 e N2 unit al giro"
  if (sec1 === 0 && sec2 === 0 && dec1 && dec2 && dec1.digits === dec2.digits) {
    return `tra ${dec1.numStr} e ${dec2.numStr} ${dec2.unitPlural} al giro`;
  }

  // General: format each independently and join
  const phrase1 = singleLapDeltaPhrase(sec1Str, dec1Str).replace(
    / al giro$/,
    "",
  );
  const phrase2 = singleLapDeltaPhrase(sec2Str, dec2Str).replace(
    / al giro$/,
    "",
  );
  return `tra ${phrase1} e ${phrase2} al giro`;
};

/** Convert a parsed lap time to spoken Italian. Minutes omitted when zero. */
const lapTimeToItalian = (
  minutes: number,
  seconds: number,
  millis: number,
): string => {
  const parts: string[] = [];

  if (minutes > 0) {
    parts.push(
      minutes === 1 ? "un minuto" : `${numberToItalian(minutes)} minuti`,
    );
  }

  parts.push(
    seconds === 1 ? "un secondo" : `${numberToItalian(seconds)} secondi`,
  );

  if (millis > 0) {
    parts.push(`${numberToItalian(millis)} millesimi`);
  }

  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} e ${parts[1]}`;
  return `${parts[0]}, ${parts[1]} e ${parts[2]}`;
};

/**
 * Expand track-position markers and lap-time deltas into spoken Italian.
 *
 * Rules applied (before XML escaping):
 *   @1352m      →  "milletrecentocinquantadue metri"
 *   1:16.322    →  "un minuto, sedici secondi e trecentoventidue millesimi"
 *   58.322s     →  "cinquantotto secondi e trecentoventidue millesimi"
 *   0.2s        →  "due decimi"          (sub-second delta)
 *   1.3s        →  "un secondo e tre decimi"
 *   2.0s        →  "due secondi"
 *   55.020 secondi → "cinquantacinque secondi e due centesimi"
 *
 * Shared because both TTS paths need it: `synthesizeAzure` applies it before SSML
 * escaping, `TTSManager` before handing the text to the Web Speech fallback.
 */
export const preprocessTTSText = (text: string): string => {
  // Claude answers in markdown even when told not to; the TTS would spell the marks out
  text = stripMarkdown(text);

  // Track position: @<meters>m
  text = text.replace(/@(\d+)m\b/g, (_m, digits) => {
    return numberToItalian(parseInt(digits, 10)) + " metri";
  });

  // Bare meters: 450m (without @ prefix, e.g. from voice coach responses)
  // Negative lookahead excludes compound units like m/h, m/s, m²
  text = text.replace(/\b(\d+)\s*m\b(?!\/|²)/g, (_m, digits) => {
    return numberToItalian(parseInt(digits, 10)) + " metri";
  });

  // Lap time with minutes: M:SS.mmm (e.g., 1:16.322)
  text = text.replace(
    /\b(\d+):(\d{2})\.(\d{3})\b/g,
    (_m, mStr, sStr, msStr) => {
      return lapTimeToItalian(
        parseInt(mStr, 10),
        parseInt(sStr, 10),
        parseInt(msStr, 10),
      );
    },
  );

  // Lap delta range with /giro: ~?X.Ys–X.Zs/giro (en-dash or hyphen)
  text = text.replace(
    /~?(\d+)(?:\.(\d+))?(?:–|-)(\d+)(?:\.(\d+))?s\/giro/g,
    (_m, s1, d1, s2, d2) => rangeLapDeltaPhrase(s1, d1, s2, d2),
  );

  // Lap delta single with /giro: ~?Xs/giro or ~?X.Ys/giro
  text = text.replace(/~?(\d+)(?:\.(\d+))?s\/giro/g, (_m, s, d) =>
    singleLapDeltaPhrase(s, d),
  );

  // Generic range with s suffix: X.Y–X.Z s (e.g., "0.2-0.3 s" → "due o tre decimi")
  text = text.replace(
    /~?(\d+)(?:\.(\d+))?\s*[-–]\s*(\d+)(?:\.(\d+))?\s*(?:second[io]|s)\b/g,
    (_m, s1, d1, s2, d2) => rangeSecondsPhrase(s1, d1, s2, d2),
  );

  // Generic seconds: 1–3 decimal digits, unit abbreviated ("47.980 s") or spelled
  // out ("47.980 secondi") — the prompts authorise both forms.
  text = text.replace(
    /\b(\d+)\.(\d{1,3})\s*(?:second[io]|s)\b/g,
    (_m, secStr, decStr) => singleSecondsPhrase(secStr, decStr),
  );

  // Leftover decimals no unit rule above claimed (percentuali, °C, PSI, bar): the
  // it-IT voice reads "9.5" as a thousands group, "9,5" as "nove virgola cinque".
  text = text.replace(/(\d)\.(\d)/g, "$1,$2");

  return text;
};
