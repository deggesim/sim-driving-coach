// Commit-time lint gate (was a PostToolUse hook — ~15s on every single edit).
//
// lint-staged is used here only as a FILTER: "does this commit touch TypeScript
// at all?". The command it fires is the full-project lint, not a per-file one.
// Returning a string from the function is what stops lint-staged from appending
// the staged filenames to it.
//
// Full-project is deliberate: type-aware linting (parserOptions.projectService)
// rebuilds the whole TS program regardless, which is ~12.5s of a 25s run — so
// linting only the staged files saves little while adding real edge cases.
// lint-staged stashes unstaged changes first, so the lint sees the tree exactly
// as it will be committed even after a partial `git add -p`.
export default {
  "*.{ts,tsx}": () => "npm run lint",
};
