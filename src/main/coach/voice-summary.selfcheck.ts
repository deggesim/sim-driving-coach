/**
 * Self-check for the <sintesi-vocale> helpers (assert-only).
 *
 *   npm run selfcheck
 */
import assert from "node:assert/strict";
import { decodeAlertCodes } from "../../shared/alert-types.js";
import { createI18n } from "../../shared/i18n.js";
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

// Codes are decoded in the active language before the tag is read: the spoken
// summary comes out pronounceable and the extraction is unaffected.
const coded = `Corpo.

<sintesi-vocale>
Frenata tardiva: LATE_BRAKE alla Curva 1.
</sintesi-vocale>`;
const decoded = decodeAlertCodes(createI18n("it").t, coded);
assert.equal(
  extractVoiceSummary(decoded),
  "Frenata tardiva: frenata tardiva alla Curva 1.",
);
assert.equal(stripVoiceTag(decoded), "Corpo.");

console.log("voice-summary.selfcheck OK");
