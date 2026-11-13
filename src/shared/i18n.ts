import i18next, { type i18n } from "i18next";
import de from "./locales/de.json" with { type: "json" };
import en from "./locales/en.json" with { type: "json" };
import es from "./locales/es.json" with { type: "json" };
import fr from "./locales/fr.json" with { type: "json" };
import it from "./locales/it.json" with { type: "json" };

export type Language = "de" | "en" | "es" | "fr" | "it";

// Dropdown order: native names, alphabetical.
export const LANGUAGES: readonly {
  code: Language;
  native: string;
  locale: string;
}[] = [
  { code: "de", native: "Deutsch", locale: "de-DE" },
  { code: "en", native: "English", locale: "en-GB" },
  { code: "es", native: "Español", locale: "es-ES" },
  { code: "fr", native: "Français", locale: "fr-FR" },
  { code: "it", native: "Italiano", locale: "it-IT" },
];

export const isLanguage = (v: unknown): v is Language =>
  LANGUAGES.some((l) => l.code === v);

export const localeOf = (lang: Language): string =>
  LANGUAGES.find((l) => l.code === lang)!.locale;

// First preferred entry whose 2-letter prefix is supported, else English.
export const resolveSystemLanguage = (preferred: readonly string[]): Language =>
  preferred.map((p) => p.slice(0, 2).toLowerCase()).find(isLanguage) ?? "en";

export const RESOURCES = {
  de: { translation: de },
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
  it: { translation: it },
};

export const createI18n = (lang: Language): i18n => {
  const instance = i18next.createInstance();
  void instance.init({
    resources: RESOURCES,
    lng: lang,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    initAsync: false, // resources are inline, so init completes synchronously
  });
  return instance;
};
