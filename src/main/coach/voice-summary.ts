/**
 * Extract / strip the <sintesi-vocale> block that the Level-1 output appends.
 * Pure module (no deps) so it stays self-checkable without the Anthropic SDK.
 */

// The closing tag is optional: a Level-1 response truncated at max_tokens can
// open the tag and never close it. Falling back to end-of-text keeps the TTS
// summary usable and prevents raw tag markup leaking into the rendered synthesis.
const VOICE_TAG = /<sintesi-vocale>([\s\S]*?)(?:<\/sintesi-vocale>|$)/i;

export const extractVoiceSummary = (text: string): string =>
  VOICE_TAG.exec(text)?.[1]?.trim() ?? "";

export const stripVoiceTag = (text: string): string =>
  text.replace(VOICE_TAG, "").trimEnd();
