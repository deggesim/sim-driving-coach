import assert from "node:assert/strict";
import { costUsd, formatCost, parsePricingMarkdown } from "./pricing.js";

const md = `intro
| Model | Base input tokens | 5m cache writes | Output tokens |
| :--- | :--- | :--- | :--- |
| Claude Sonnet 5 | $2 / MTok<sup>3</sup> | $2.50 / MTok | $10 / MTok |
| Claude Sonnet 5.5 | $1 / MTok | $2.50 / MTok | $4 / MTok |
| Claude Haiku 4.5 ([retired](https://x.y/z)) | $1 / MTok | $1.25 / MTok | $5 / MTok |
| Claude Haiku 5.5 (for prompts up to 100,000 tokens) | $0.10 / MTok | $0.125 / MTok | $0.50 / MTok |
| Claude Haiku 5.5 (for prompts over 100,000 tokens) | $0.50 / MTok | $0.625 / MTok | $2.50 / MTok |

after the table`;
const models = parsePricingMarkdown(md);
assert.ok(models);
assert.equal(models.length, 4);
assert.equal(costUsd(models, "claude-haiku-4-5-20251001", 1e6, 1e6), 6);
assert.equal(costUsd(models, "claude-haiku-5-5", 1e6, 1e6), 0.6);
assert.equal(costUsd(models, "claude-sonnet-5", 1e6, 0), 2);
// Longest prefix wins, whatever the order in the table.
assert.equal(costUsd(models, "claude-sonnet-5-5", 1e6, 0), 1);
assert.equal(costUsd(models, "unknown-model", 1, 1), null);

// A table that does not parse must be rejected whole, never half-applied.
assert.equal(parsePricingMarkdown("no table here"), null);
assert.equal(
  parsePricingMarkdown(
    "| Model | Base input tokens | Output tokens |\n| - | - | - |\n| Claude X 1 | free | $5 / MTok |",
  ),
  null,
);

assert.equal(formatCost(0.00456), "$0.0046");
assert.equal(formatCost(0.1234), "$0.123");
