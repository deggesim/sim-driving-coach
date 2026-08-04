// Runs every compiled *.selfcheck.js under .selfcheck-out (see `npm run selfcheck`).
// A file rather than a list of paths in package.json so that adding a self-check
// gets it picked up automatically instead of silently skipped — which is the
// exact reason the self-checks went unrun until now.
import { globSync } from "node:fs";
import { pathToFileURL } from "node:url";

const files = globSync(".selfcheck-out/**/*.selfcheck.js").sort();

if (files.length === 0) {
  console.error(
    "No compiled self-checks found in .selfcheck-out — did tsc -p tsconfig.selfcheck.json run?",
  );
  process.exit(1);
}

// Each self-check asserts at import time and throws on failure, which exits non-zero.
for (const file of files) await import(pathToFileURL(file).href);

console.log(`\n${files.length} self-check(s) passed`);
