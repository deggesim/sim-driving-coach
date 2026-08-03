// Self-check: markdown must never reach the TTS (Azure spells "**" out loud)
// nor the voice overlay, which renders the answer as plain text.
import assert from "node:assert/strict";
import { stripMarkdown } from "./format.js";

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

console.log("format.selfcheck OK");
