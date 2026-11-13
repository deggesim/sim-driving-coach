// Self-check: language resolution and synchronous i18next init.
import assert from "node:assert/strict";
import { LANGUAGES, createI18n, resolveSystemLanguage } from "./i18n.js";

assert.equal(resolveSystemLanguage(["it-CH"]), "it");
assert.equal(resolveSystemLanguage(["de-AT", "en-US"]), "de");
assert.equal(resolveSystemLanguage(["pt-BR"]), "en");
assert.equal(resolveSystemLanguage([]), "en");
assert.deepEqual(
  LANGUAGES.map((l) => l.native),
  ["Deutsch", "English", "Español", "Français", "Italiano"],
);
assert.equal(createI18n("de").t("corner", { n: 3 }), "Kurve 3");
