import assert from "node:assert/strict";
import type { Alert, GameFrame } from "../../shared/types.js";
import type { AdaptiveBaseline } from "./adaptive-baseline.js";
import { createAlertDispatcher, createRuleEngine } from "./rule-engine.js";

const dispatcher = createAlertDispatcher();
const alerts: Alert[] = [];
dispatcher.on("alert", (a) => alerts.push(a));
const baseline = { isReady: () => false } as unknown as AdaptiveBaseline;
const engine = createRuleEngine(dispatcher, baseline, () => null);

const frame = (fl: number, fr = 500): GameFrame => ({
  lapDistance: 2050,
  tcActive: 0,
  absActive: 0,
  brakeTempFL: fl,
  brakeTempFR: fr,
  brakeTempRL: 400,
  brakeTempRR: -1,
});

// One episode = one alert, however many samples stay above the threshold.
[690, 700, 713, 705].forEach((t) => engine.processFrame(frame(t), 1));
assert.equal(alerts.length, 1, "one alert for one hot episode");
// Hovering just under the threshold does not re-arm it.
[680, 690].forEach((t) => engine.processFrame(frame(t), 1));
assert.equal(alerts.length, 1, "no re-arm within 20 °C of the threshold");
// Cooling 20 °C below re-arms; the next crossing is a new episode.
[660, 695].forEach((t) => engine.processFrame(frame(t), 2));
assert.equal(alerts.length, 2, "a new episode after cooling down");
// Wheels are independent; -1 (unavailable) never fires.
engine.processFrame(frame(695, 700), 2);
assert.equal(alerts.length, 3, "the other front wheel has its own episode");
assert.ok(alerts.every((a) => a.type === "BRAKE_TEMP_CRITICAL"));

console.log("rule-engine.selfcheck OK");
