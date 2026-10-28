// `npm run dev` with the channel log on (SDC_CHANNEL_LOG=1), echoed to the
// console and saved to logs/sdc-YYYYMMDD-HHmm.txt (ANSI colours stripped) to
// share after a session. A Node script because npm runs scripts in cmd.exe,
// which has no tee, and Windows PowerShell 5.1 would write the file in UTF-16.
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";

const d = new Date();
const p = (n) => String(n).padStart(2, "0");
const file = `logs/sdc-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.txt`;
mkdirSync("logs", { recursive: true });
const out = createWriteStream(file);
console.log(`[dev:debug] log in ${file}`);

const child = spawn("electron-vite dev", {
  shell: true,
  stdio: ["inherit", "pipe", "pipe"],
  env: { ...process.env, SDC_CHANNEL_LOG: "1" },
});
const tee = (to) => (chunk) => {
  to.write(chunk);
  out.write(chunk.toString().replace(/\x1b\[[0-9;]*[A-Za-z]/g, ""));
};
child.stdout.on("data", tee(process.stdout));
child.stderr.on("data", tee(process.stderr));
child.on("exit", (code) => out.end(() => process.exit(code ?? 0)));
