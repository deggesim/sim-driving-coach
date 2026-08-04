// CODE_STYLE.md compliance check — runs after every Write/Edit on .ts/.tsx files
import { readFileSync } from "fs";

const input = readFileSync(process.stdin.fd, "utf8");
const event = JSON.parse(input);
const filePath = event?.tool_input?.file_path ?? "";

if (!filePath || !/\.(ts|tsx)$/.test(filePath)) process.exit(0);

let lines;
try {
  lines = readFileSync(filePath, "utf8").split(/\r?\n/);
} catch {
  process.exit(0);
}

// import.meta.env is a Vite/renderer feature. Main and preload are Node and
// MUST use process.env, so that rule applies to renderer code only.
const isRenderer = /[\\/]src[\\/]renderer[\\/]/.test(filePath);

const violations = [];
let inBlockComment = false;

for (let i = 0; i < lines.length; i++) {
  const n = i + 1;
  const raw = lines[i];

  // Strip comments before matching: a JSDoc line that merely mentions
  // "function" or "class" is prose, not a violation.
  let stripped = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  if (inBlockComment) {
    const end = stripped.indexOf("*/");
    if (end === -1) continue;
    stripped = stripped.slice(end + 2);
    inBlockComment = false;
  }
  const open = stripped.lastIndexOf("/*");
  if (open !== -1) {
    inBlockComment = true;
    stripped = stripped.slice(0, open);
  }
  stripped = stripped.replace(/\/\/.*$/, "");

  if (/\bfunction\b/.test(stripped))
    violations.push(`L${n}: 'function' keyword — use arrow function instead`);

  // Require the declaration form (`class Foo`, `class {`). Bare /\bclass\b/
  // also matched `class="…"` inside HTML template strings, which made every
  // edit to pdf-generator.ts report a dozen phantom violations.
  if (/\bclass\s+[A-Za-z_$]|\bclass\s*\{/.test(stripped))
    violations.push(`L${n}: 'class' keyword — use factory function instead`);

  if (isRenderer && /process\.env\./.test(stripped))
    violations.push(`L${n}: 'process.env' — use 'import.meta.env'`);

  // Both quote styles: the original only matched single quotes, so in a repo
  // formatted with double quotes this rule could never fire.
  if (/import \* as .+from ['"]@fortawesome/.test(stripped))
    violations.push(`L${n}: FontAwesome wildcard import — import icons individually`);
}

if (violations.length > 0) {
  const fileName = filePath.split(/[\\/]/).at(-1);
  const msg = `CODE_STYLE.md check — ${fileName} — ${violations.length} violation(s):\n${violations.join("\n")}`;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: msg,
      },
    })
  );
}
