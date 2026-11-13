import { createI18n, type Language } from "../shared/i18n.js";

// Placeholder until setupPipeline reads the stored language.
export const mainI18n = createI18n("en");

export const getLanguage = (): Language => mainI18n.language as Language;

export const setLanguage = (lang: Language): void => {
  void mainI18n.changeLanguage(lang);
};

export const tm = mainI18n.t.bind(mainI18n);
