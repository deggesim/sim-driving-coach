/**
 * The per-language tail of every Claude system prompt. The prompts themselves are
 * one English text for all languages; only this block changes, so the model
 * answers in the chosen language with the required headings already translated,
 * the setup-procedure words it must not use, and a minimal pit-wall glossary.
 */

import { createI18n, LANGUAGES, type Language } from "../../shared/i18n.js";

export type OutputKind = "synthesis" | "detail" | "comment" | "voice";

const ENGLISH_NAME: Record<Language, string> = {
  de: "German",
  en: "English",
  es: "Spanish",
  fr: "French",
  it: "Italian",
};

const instances = new Map<Language, ReturnType<typeof createI18n>>();
const tOf = (lang: Language) => {
  const i18n = instances.get(lang) ?? createI18n(lang);
  instances.set(lang, i18n);
  return i18n.t.bind(i18n);
};

// Headings per kind, with their markdown level (## root, ### subsection).
const HEADINGS = {
  synthesis: [
    ["##", "synthesis"],
    ["###", "actions"],
  ],
  detail: [
    ["##", "detail"],
    ["###", "telemetry"],
    ["###", "problems"],
    ["###", "setupCompare"],
    ["###", "chassis"],
  ],
  comment: [],
  voice: [],
} as const;

const ALL_HEADINGS = [
  "synthesis",
  "actions",
  "detail",
  "telemetry",
  "problems",
  "setupCompare",
  "chassis",
] as const;

export const outputLanguageBlock = (
  lang: Language,
  kind: OutputKind,
): string => {
  const t = tOf(lang);
  const native = LANGUAGES.find((l) => l.code === lang)!.native;
  const lines = [
    "# Output language",
    `Write the whole answer in ${ENGLISH_NAME[lang]} (${native}), whatever the language of the data below.`,
  ];
  if (kind === "synthesis" || kind === "detail") {
    lines.push(
      'Use exactly these headings, in this order and at these levels (omit the optional ones only as the rules above allow), and no other "##" heading:',
      ...HEADINGS[kind].map(
        ([level, key]) => `${level} ${t(`analysis.heading.${key}`)}`,
      ),
    );
  }
  if (kind === "comment") {
    lines.push(
      `Do not use the analysis section headings: ${ALL_HEADINGS.map((k) => `"${t(`analysis.heading.${k}`)}"`).join(", ")}.`,
    );
  }
  if (kind !== "voice") {
    lines.push(
      "Translate every quoted data-block label, state and table header into this language, and keep every number, unit and symbol exactly as given.",
      `Words you must never use about the setup procedure itself, in this language: ${t("analysis.forbidden")}. The English labels "Base setup", "Chassis setup" and "do now" are forbidden as well. A one-click increment may still be called a minimum step.${HEADINGS[kind].length ? " The section headings listed above are the only exception." : ""}`,
    );
  } else {
    lines.push("Keep every number, unit and symbol exactly as given.");
  }
  lines.push(`Pit-wall glossary, use these terms: ${t("analysis.glossary")}.`);
  return lines.join("\n");
};
