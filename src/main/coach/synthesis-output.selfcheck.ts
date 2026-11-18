/**
 * Self-check for the Level-1 structured output (assert-only).
 */

import assert from "node:assert/strict";
import {
  COMPLETE_LAPS,
  MAX_ACTIONS,
  NO_ADJUSTMENT,
  allowedSetupAdjustments,
  parseSynthesis,
  renderSynthesis,
  synthesisSchema,
} from "./synthesis-output.js";
import type { SetupLadder } from "./setup-ladder.js";
import type { SetupOverview } from "./setup-overview.js";

const ladder = (over: object): SetupLadder =>
  ({
    current: null,
    lapsMissing: 0,
    steps: [
      { n: 1, label: "brake ducts" },
      { n: 2, label: "brake bias" },
    ],
    ...over,
  }) as unknown as SetupLadder;
const overview = (current: number | null): SetupOverview =>
  ({
    current,
    areas: [{ n: 1, label: "springs" }],
  }) as unknown as SetupOverview;
const allowed = (l: SetupLadder | null, o: SetupOverview | null): string[] =>
  allowedSetupAdjustments({ setupLadder: l, setupOverview: o });

// Same order as the system prompt: ladder step, then "complete laps", then overview.
assert.deepEqual(allowed(ladder({ current: 2 }), overview(1)), ["brake bias"]);
assert.deepEqual(allowed(ladder({ current: 1, lapsMissing: 2 }), null), [
  "brake ducts",
]);
assert.deepEqual(allowed(ladder({ lapsMissing: 2 }), overview(null)), [
  COMPLETE_LAPS,
]);
assert.deepEqual(allowed(ladder({}), overview(1)), ["springs"]);
assert.deepEqual(allowed(ladder({}), overview(null)), []);
assert.deepEqual(allowed(null, null), []);

// The schema pins the adjustment to the allowed values plus "none".
const schema = synthesisSchema(["brake bias"]) as {
  properties: {
    actions: {
      items: { properties: { adjustment: { enum: string[] } } };
    };
  };
};
assert.deepEqual(schema.properties.actions.items.properties.adjustment.enum, [
  "brake bias",
  NO_ADJUSTMENT,
]);

const action = (kind: string, adjustment: string, text = "t") => ({
  kind,
  adjustment,
  text,
});
const answer = (actions: object[]) =>
  JSON.stringify({ summary: "S", actions, voice: "V" });

// A second setup action, or one on another adjustment, is dropped; the rest stays.
const ok = parseSynthesis(
  answer([
    action("driving", NO_ADJUSTMENT, "d1"),
    action("setup", "brake bias", "s1"),
    action("setup", "brake bias", "s2"),
    action("setup", "springs", "s3"),
    action("driving", NO_ADJUSTMENT, "d2"),
    action("driving", NO_ADJUSTMENT, "d3"),
  ]),
  ["brake bias"],
)!;
assert.deepEqual(
  ok.out.actions.map((a) => a.text),
  ["d1", "s1", "d2"],
);
assert.deepEqual(ok.dropped, ["brake bias", "springs"]);
assert.ok(ok.out.actions.length <= MAX_ACTIONS);

// No allowed adjustment: every setup action goes.
assert.deepEqual(
  parseSynthesis(answer([action("setup", "brake bias")]), [])!.out.actions,
  [],
);

// Truncated or malformed JSON is null, never a partial object.
assert.equal(parseSynthesis('{"summary":"S","actions":[', []), null);
assert.equal(parseSynthesis('{"summary":"S"}', []), null);

// Headings come from the caller; with no actions the actions heading is omitted.
const headings = { synthesis: "Summary", actions: "Actions" };
assert.equal(
  renderSynthesis(
    {
      summary: "S",
      voice: "V",
      actions: [
        { kind: "driving", adjustment: NO_ADJUSTMENT, text: "a" },
        { kind: "driving", adjustment: NO_ADJUSTMENT, text: "b" },
      ],
    },
    headings,
  ),
  "## Summary\n\nS\n\n### Actions\n\n1. a\n2. b",
);
assert.equal(
  renderSynthesis({ summary: "S", voice: "V", actions: [] }, headings),
  "## Summary\n\nS",
);
