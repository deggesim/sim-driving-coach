// Self-check (Review Focus 1): a pending setup-name prompt must still consume the
// next transcript as a NAME after a language switch, and the line spoken next
// must come out in the new language.
import assert from "node:assert/strict";
import { setLanguage, tm } from "../i18n-main.js";
import { decidePendingName } from "./pending-name.js";

const TTL = 60_000;
setLanguage("it");
assert.equal(tm("voice.askSetupName"), "Come vuoi chiamare il setup?");

// The question was asked in Italian; the user switches to French before answering:
// the answer is transcribed, and read here, in the language active now.
setLanguage("fr");
assert.deepEqual(decidePendingName("vé deux", 1_000, 5_000, TTL, "fr"), {
  kind: "name",
  name: "v2",
});
assert.deepEqual(decidePendingName("vu uno", 1_000, 5_000, TTL, "it"), {
  kind: "name",
  name: "v1",
});
assert.equal(
  tm("voice.setupSaved", { name: "v1" }),
  "Setup enregistré sous le nom v1.",
);

// Cancel words per language; expiry does not depend on the language.
for (const [lang, word] of [
  ["it", "annulla"],
  ["it", "lascia stare"],
  ["en", "cancel"],
  ["en", "never mind"],
  ["de", "abbrechen"],
  ["de", "vergiss es"],
  ["es", "cancelar"],
  ["es", "olvídalo"],
  ["fr", "annuler"],
  ["fr", "laisse tomber"],
] as const)
  assert.deepEqual(
    decidePendingName(word, 0, 1, TTL, lang),
    { kind: "cancel" },
    `${lang}: ${word}`,
  );
// A cancel word of another language is just a name
assert.deepEqual(decidePendingName("annulla", 0, 1, TTL, "de"), {
  kind: "name",
  name: "annulla",
});
assert.deepEqual(decidePendingName("   ", 0, 1, TTL, "en"), { kind: "cancel" });
assert.deepEqual(decidePendingName("v1", 0, TTL, TTL, "en"), {
  kind: "expired",
});
assert.equal(tm("voice.acquireCancelled"), "Acquisition annulée.");

setLanguage("it");
console.log("pending-name selfcheck OK");
