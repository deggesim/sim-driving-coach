import { localeOf, type Language } from "./i18n.js";

export const DEFAULT_AZURE_VOICE: Record<Language, string> = {
  de: "de-DE-KatjaNeural",
  en: "en-GB-SoniaNeural",
  es: "es-ES-ElviraNeural",
  fr: "fr-FR-DeniseNeural",
  it: "it-IT-ElsaNeural",
};

// A saved voice of another language (or none) falls back to the language default.
export const resolveVoice = (
  lang: Language,
  saved: string | undefined,
): string =>
  saved?.startsWith(localeOf(lang)) ? saved : DEFAULT_AZURE_VOICE[lang];

export const voiceConfigKey = (lang: Language): string =>
  `azureVoiceName_${lang}`;
