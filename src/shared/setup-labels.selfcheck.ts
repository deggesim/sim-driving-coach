// Self-check: localized setup parameter/category names and corner names.
import assert from "node:assert/strict";
import { createI18n } from "./i18n.js";
import { localizeCorner, localizeSetupName } from "./setup-labels.js";

const it = createI18n("it");
const de = createI18n("de");

assert.equal(localizeSetupName(it.t, "Camber FL"), "Campanatura FL");
assert.equal(localizeSetupName(it.t, "Tyre Pressure RR"), "Pressione RR");
assert.equal(
  localizeSetupName(de.t, "Springs Front Left"),
  "Federn Vorne links",
);
assert.equal(localizeSetupName(it.t, "Brakes"), "Freni");
assert.equal(localizeSetupName(it.t, "Mystery Param FL"), "Mystery Param FL");
assert.equal(localizeSetupName(it.t, "Unknown"), "Unknown");

// Names with i18next separators must neither throw nor split the key.
it.addResource("it", "translation", "setup.param.Test_Dot", "Prova");
assert.equal(localizeSetupName(it.t, "Test.Dot"), "Prova");
assert.equal(localizeSetupName(it.t, "A:B.C FL"), "A:B.C FL");

assert.equal(localizeCorner(de.t, "Turn 4"), "Kurve 4");
assert.equal(localizeCorner(de.t, "Eau Rouge"), "Eau Rouge");
