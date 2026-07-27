/**
 * Self-check for the <sintesi-vocale> helpers (assert-only).
 *
 *   npx tsc --ignoreConfig --module NodeNext --moduleResolution NodeNext --target ES2022 \
 *     --strict --esModuleInterop --types node --outDir .selfcheck-out \
 *     src/main/coach/voice-summary.ts src/main/coach/voice-summary.selfcheck.ts
 *   node .selfcheck-out/voice-summary.selfcheck.js
 *   rm -rf .selfcheck-out
 */
import assert from "node:assert/strict";
import { extractVoiceSummary, stripVoiceTag } from "./voice-summary.js";

const withTag = `## Analisi sintetica
Corpo.

<sintesi-vocale>
Perdi due decimi in staccata alla Curva 1. Anticipa di dieci metri.
</sintesi-vocale>`;

assert.equal(
  extractVoiceSummary(withTag),
  "Perdi due decimi in staccata alla Curva 1. Anticipa di dieci metri.",
);
assert.equal(stripVoiceTag(withTag), "## Analisi sintetica\nCorpo.");
assert.ok(!stripVoiceTag(withTag).includes("sintesi-vocale"));

// No tag ⇒ empty summary, text unchanged (trimEnd only).
const noTag = "## Analisi sintetica\nCorpo.";
assert.equal(extractVoiceSummary(noTag), "");
assert.equal(stripVoiceTag(noTag), noTag);

// Truncated at max_tokens: opening tag with no closing tag. The summary is still
// recovered and the markup must not leak into the synthesis.
const truncated = `## Analisi sintetica
Corpo.

<sintesi-vocale>
Perdi due decimi alla Curva 1.`;
assert.equal(extractVoiceSummary(truncated), "Perdi due decimi alla Curva 1.");
assert.equal(stripVoiceTag(truncated), "## Analisi sintetica\nCorpo.");
assert.ok(!stripVoiceTag(truncated).includes("sintesi-vocale"));

console.log("voice-summary.selfcheck OK");
