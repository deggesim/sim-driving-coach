// Prices (USD per million tokens) are not kept in the source: the main process reads
// them from Anthropic's pricing page at startup (main/coach/price-book.ts).
export type PriceEntry = { prefix: string; input: number; output: number };

const cells = (line: string): string[] =>
  line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
const dollars = (cell: string | undefined): number =>
  Number(/\$([\d.]+)/.exec(cell ?? "")?.[1]);

/** Parses the "Model pricing" table of the pricing page (markdown export). The
 *  columns are found by header name. `null` when the table is missing or a row
 *  does not parse: a half-read table is never used. */
export const parsePricingMarkdown = (md: string): PriceEntry[] | null => {
  const lines = md.split("\n");
  const h = lines.findIndex((l) =>
    /^\|\s*Model\s*\|.*Base input.*Output/.test(l),
  );
  if (h < 0) return null;
  const head = cells(lines[h]);
  const inCol = head.findIndex((c) => c.startsWith("Base input"));
  const outCol = head.findIndex((c) => c.startsWith("Output"));

  const entries = new Map<string, PriceEntry>();
  for (const line of lines.slice(h + 2)) {
    if (!line.startsWith("|")) break;
    const c = cells(line);
    // A second row prices prompts over 100K tokens: keep the standard rate.
    if (/over\s+[\d,]+\s+tokens/.test(c[0])) continue;
    const prefix = c[0]
      .replace(/\s*\(.*$/, "")
      .toLowerCase()
      .replace(/[\s.]+/g, "-");
    const input = dollars(c[inCol]);
    const output = dollars(c[outCol]);
    if (!/^claude-[a-z0-9-]+$/.test(prefix) || !(input >= 0) || !(output >= 0))
      return null;
    if (!entries.has(prefix)) entries.set(prefix, { prefix, input, output });
  }
  return entries.size ? [...entries.values()] : null;
};

/** Cost in USD of one call, or `null` for a model with no price. The longest
 *  matching prefix wins, so "claude-sonnet-5-5" can override "claude-sonnet-5". */
export const costUsd = (
  models: PriceEntry[],
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null => {
  const p = models
    .filter((e) => model.startsWith(e.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return p ? (inputTokens * p.input + outputTokens * p.output) / 1e6 : null;
};

export const formatCost = (usd: number): string =>
  `$${usd.toFixed(usd < 0.01 ? 4 : 3)}`;
