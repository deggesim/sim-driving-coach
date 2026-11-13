// Self-check: every locale has exactly the keys and {{variables}} of it.json.
import assert from "node:assert/strict";
import { RESOURCES } from "./i18n.js";

const flatten = (o: object, prefix = ""): Record<string, string> =>
  Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return Object.assign(
      acc,
      typeof v === "string" ? { [key]: v } : flatten(v as object, key),
    );
  }, {});
const vars = (s: string) =>
  [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

const ref = flatten(RESOURCES.it.translation);
for (const lang of ["de", "en", "es", "fr"] as const) {
  const cur = flatten(RESOURCES[lang].translation);
  const missing = Object.keys(ref).filter((k) => !(k in cur));
  const extra = Object.keys(cur).filter((k) => !(k in ref));
  assert.deepEqual(
    { missing, extra },
    { missing: [], extra: [] },
    `${lang} keys`,
  );
  for (const k of Object.keys(ref))
    assert.deepEqual(vars(cur[k]), vars(ref[k]), `${lang}.${k} variables`);
}
