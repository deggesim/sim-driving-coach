import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "path";

const { version } = JSON.parse(readFileSync("package.json", "utf-8")) as {
  version: string;
};

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // Chiave "main" → output: out/main/main.js (allineato con "main" in package.json)
        input: { main: resolve(__dirname, "src/main/main.ts") },
        // electron must not be bundled: its CJS index.js uses __dirname to locate path.txt
        // Native modules must not be bundled: bindings resolves .node files relative to __dirname
        external: ["electron", /^electron\/.+/, "better-sqlite3", "koffi"],
      },
    },
    resolve: {
      alias: { "@shared": resolve(__dirname, "src/shared") },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
        // electron must not be bundled in preload either
        external: ["electron", /^electron\/.+/],
        // Preload with sandbox:true requires CJS (ESM not supported in sandboxed context)
        output: { format: "cjs" },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    plugins: [react()],
    define: { __APP_VERSION__: JSON.stringify(version) },
    resolve: {
      alias: { "@shared": resolve(__dirname, "src/shared") },
    },
  },
});
