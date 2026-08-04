// Self-check: markdown must never reach the TTS (Azure spells "**" out loud)
// nor the voice overlay, which renders the answer as plain text.
import assert from "node:assert/strict";
import { stripMarkdown, preprocessTTSText } from "./format.js";

assert.equal(
  stripMarkdown("sposta il **brake bias** da 52/48 a 50/50"),
  "sposta il brake bias da 52/48 a 50/50",
);
assert.equal(stripMarkdown("- primo punto\n- secondo"), "primo punto\nsecondo");
assert.equal(stripMarkdown("## Titolo\ntesto `x` *ok*"), "Titolo\ntesto x ok");
assert.equal(stripMarkdown("vedi [la guida](http://x)"), "vedi la guida");
// identifiers keep their underscores, only __bold__ pairs are stripped
assert.equal(stripMarkdown("ks_porsche_718 __ok__"), "ks_porsche_718 ok");
// mid-stream: an unclosed ** must not survive
assert.equal(stripMarkdown("sposta il **brake bi"), "sposta il brake bi");

// The it-IT voice reads a dot as the thousands separator, so any decimal reaching
// a synthesizer unexpanded ("55.020 secondi") becomes "cinquantacinquemilaventi
// secondi". Every decimal must leave the preprocessor either spelled out or with
// an Italian comma. Both TTS paths call this: Azure in main, Web Speech in the
// renderer (TTSManager, useVoiceCoach).
assert.equal(
  preprocessTTSText("da 55.020 secondi a 47.980 secondi"),
  "da cinquantacinque secondi e due centesimi a quarantasette secondi e novantotto centesimi",
);
assert.equal(
  preprocessTTSText("guadagnare circa 0.23 secondi"),
  "guadagnare circa ventitre centesimi",
);
assert.equal(
  preprocessTTSText("un margine di 1.0 secondo"),
  "un margine di un secondo",
);

// Abbreviated unit, ranges and distances keep working
assert.equal(
  preprocessTTSText("~0.35s/giro"),
  "trentacinque centesimi al giro",
);
assert.equal(preprocessTTSText("0.2-0.3 s"), "due o tre decimi");
assert.equal(preprocessTTSText("0.2–0.3 secondi"), "due o tre decimi");
assert.equal(
  preprocessTTSText("stacca a @450m"),
  "stacca a quattrocentocinquanta metri",
);

// Catch-all: decimals no unit rule claims must at least get an Italian comma
assert.equal(
  preprocessTTSText("delta del 9.5 percento"),
  "delta del 9,5 percento",
);
assert.equal(preprocessTTSText("gomme a 1.85 bar"), "gomme a 1,85 bar");

// Nothing to expand → text untouched
assert.equal(preprocessTTSText("delta del 9 percento"), "delta del 9 percento");

console.log("format.selfcheck OK");
