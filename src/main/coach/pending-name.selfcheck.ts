// Self-check (Review Focus 1): a pending setup-name prompt must still consume the
// next transcript as a NAME after a language switch, and the line spoken next
// must come out in the new language.
import assert from "node:assert/strict";
import { setLanguage, tm } from "../i18n-main.js";
import { decidePendingName } from "./pending-name.js";

const TTL = 60_000;
setLanguage("it");
assert.equal(tm("voice.askSetupName"), "Come vuoi chiamare il setup?");

// The question was asked in Italian; the user switches to French before answering.
setLanguage("fr");
const answer = decidePendingName("vu uno", 1_000, 5_000, TTL);
assert.deepEqual(answer, { kind: "name", name: "v1" });
assert.equal(
  tm("voice.setupSaved", { name: "v1" }),
  "Setup enregistré sous le nom v1.",
);

// Cancel and expiry do not depend on the language either.
assert.deepEqual(decidePendingName("annulla", 0, 1, TTL), { kind: "cancel" });
assert.deepEqual(decidePendingName("   ", 0, 1, TTL), { kind: "cancel" });
assert.deepEqual(decidePendingName("v1", 0, TTL, TTL), { kind: "expired" });
assert.equal(tm("voice.acquireCancelled"), "Acquisition annulée.");

setLanguage("it");
console.log("pending-name selfcheck OK");
