// Model prices (USD per million tokens), read once at startup from Anthropic's
// pricing page and kept in memory until the app exits: nothing is stored, so a
// repricing or a new model needs no release. Offline, `cost` stays null and the
// UI simply shows no cost.
import {
  costUsd,
  parsePricingMarkdown,
  type PriceEntry,
} from "../../shared/pricing.js";

const PRICING_URL =
  "https://platform.claude.com/docs/en/about-claude/pricing.md";
const FETCH_TIMEOUT_MS = 10_000;

export type PriceBook = {
  cost: (
    model: string,
    inputTokens: number,
    outputTokens: number,
  ) => number | null;
  /** Fetches the prices; never throws. Call once at startup, without awaiting. */
  load: () => Promise<void>;
};

export const createPriceBook = (): PriceBook => {
  let models: PriceEntry[] = [];

  return {
    cost: (model, inputTokens, outputTokens) =>
      costUsd(models, model, inputTokens, outputTokens),
    load: async () => {
      try {
        const res = await fetch(PRICING_URL, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parsePricingMarkdown(await res.text());
        if (!parsed) throw new Error("pricing table not found or malformed");
        models = parsed;
      } catch (err) {
        console.warn("[PriceBook] prices unavailable, costs hidden:", err);
      }
    },
  };
};
