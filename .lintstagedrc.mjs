// Commit-time lint + dead-code gate (was a PostToolUse hook — ~15s on every single edit).
//
// lint-staged is used here only as a FILTER: "does this commit touch TypeScript
// at all?". The commands it fires are full-project (lint, then fallow's dead-code
// analysis), not per-file. Returning an array of plain command strings (not one
// string joined with "&&") is what stops lint-staged from appending the staged
// filenames to them — lint-staged runs each via execa without a shell, so "&&"
// inside a single string is passed through literally as an argv token instead
// of being interpreted (that broke eslint: it saw "&&" as a glob pattern).
//
// Full-project is deliberate: type-aware linting (parserOptions.projectService)
// rebuilds the whole TS program regardless, which is ~12.5s of a 25s run, and
// fallow's unused-export/import-graph analysis is inherently whole-project too —
// so linting/analyzing only the staged files saves little while adding real edge
// cases. lint-staged stashes unstaged changes first, so both commands see the
// tree exactly as it will be committed even after a partial `git add -p`.
export default {
  "*.{ts,tsx}": () => ["npm run lint", "npm run fallow:check"],
};
