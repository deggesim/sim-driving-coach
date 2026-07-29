import js from "@eslint/js";
import globals from "globals";
import eslintReact from "@eslint-react/eslint-plugin";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  // Build outputs. Compiled .js carries the sources' inline eslint-disable
  // comments for TS-only rules, which then error as "rule not found" — so
  // linting them fails the run. Kept in sync with .gitignore.
  globalIgnores(["dist", "out", "release", ".selfcheck-out"]),
  {
    files: ["**/*.{ts,tsx}"],

    // Extend recommended rule sets from:
    // 1. ESLint JS's recommended rules
    // 2. TypeScript ESLint recommended rules
    // 3. ESLint React's recommended-typescript rules
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      eslintReact.configs["recommended-typescript"],
      reactRefresh.configs.vite,
    ],
    // Configure language/parsing options
    languageOptions: {
      // Use TypeScript ESLint parser for TypeScript files
      parser: tseslint.parser,
      parserOptions: {
        // Enable project service for better TypeScript integration
        projectService: {
          allowDefaultProject: ['vite.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      ecmaVersion: 2024,
      globals: globals.browser,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);
