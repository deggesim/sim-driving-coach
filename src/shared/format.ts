/**
 * Drop markdown marks from voice-coach text: Azure TTS reads `**` as
 * "asterisco asterisco", and the overlay renders the answer as plain text.
 * `_` is only stripped as a `__bold__` pair, so identifiers like ks_porsche survive.
 * Safe on a partial stream (marks are removed one char at a time, unpaired is fine).
 */
export const stripMarkdown = (text: string): string =>
  text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // headings
    .replace(/^\s*[-*+]\s+/gm, "") // list bullets
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links
    .replace(/__([^_]+)__/g, "$1")
    .replace(/[*`]/g, ""); // emphasis / code marks

export const formatLapTime = (seconds: number | null): string => {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0
    ? `${mins}:${secs.toFixed(3).padStart(6, "0")}`
    : `${secs.toFixed(3)}s`;
};
