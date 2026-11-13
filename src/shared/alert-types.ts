/**
 * Alert and telemetry tuning constants.
 */

import type { TFunction } from "i18next";
import { createI18n } from "./i18n.js";
import { localizeCorner } from "./setup-labels.js";
import type { AlertType } from "./types.js";

// i18next keys are typed against it.json; the alert keys are built at run time.
type Lookup = (key: string, opts?: Record<string, unknown>) => string;
const lookup = (t: TFunction): Lookup => t as unknown as Lookup;

/**
 * AlertType code -> label in the language of `t`. The analysis text is rendered,
 * exported to PDF and read aloud by the TTS: a raw code must never reach it,
 * neither through the prompt nor through the model's output.
 */
export const alertLabel = (t: TFunction, type: AlertType): string =>
  t(`alert.label.${type}`);

/** Prompt side: one English instance for every active language. */
export const englishT: TFunction = createI18n("en").t;

export type MessageVars = Record<string, string | number>;

/**
 * Alert or deviation text from its language-neutral key + vars. `wheel` is a
 * wheel code, `m` (+ optional `corner`) the track position. A deviation key
 * with a position is wrapped as "<position>: <text>", one without stays bare.
 */
export const renderMessage = (
  t: TFunction,
  key: string,
  vars: MessageVars,
): string => {
  const tr = lookup(t);
  const v: MessageVars = { ...vars };
  if (typeof vars.wheel === "string")
    v.wheel = tr(`alert.brakeWheel.${vars.wheel}`);
  if (vars.m !== undefined) {
    const corner =
      typeof vars.corner === "string" ? localizeCorner(t, vars.corner) : null;
    v.location = corner
      ? tr("alert.atCorner", { corner, m: vars.m })
      : tr("alert.atMeter", { m: vars.m });
  }
  const text = tr(key, v);
  return key.startsWith("alert.dev.") && v.location
    ? tr("alert.located", { location: v.location, text })
    : text;
};

// Wheel codes of the old per-wheel prompt lines; the model can still copy them.
const WHEEL_CODES: Record<string, string> = {
  "ANT-SX": "FL",
  "ANT-DX": "FR",
  "POST-SX": "RL",
  "POST-DX": "RR",
};
const ALERT_TYPES = [
  "BRAKE_TEMP_CRITICAL",
  "TC_ANOMALY",
  "ABS_ANOMALY",
  "LATE_BRAKE",
  "SLOW_THROTTLE",
  "TRAIL_BRAKING",
  "COASTING",
  "BRAKE_THROTTLE_OVERLAP",
] as const satisfies readonly AlertType[];
const CODE_RE = new RegExp(
  `\\b(?:${[...ALERT_TYPES, ...Object.keys(WHEEL_CODES)].join("|")})\\b`,
  "g",
);

/**
 * Safety net on the model output, decoded in the active language (the text is
 * shown and spoken). The prompts no longer carry codes, but prior analyses are
 * injected verbatim into the next prompt: a saved row can still copy one forward.
 */
export const decodeAlertCodes = (t: TFunction, text: string): string =>
  text.replace(CODE_RE, (m) =>
    m in WHEEL_CODES
      ? lookup(t)(`alert.wheel.${WHEEL_CODES[m]}`)
      : alertLabel(t, m as AlertType),
  );

/** Brake temp ideal window (Celsius) */
export const BRAKE_TEMP = {
  ideal: 550,
  tolerance: 137.5,
  min: 412.5, // 550 - 137.5
  max: 687.5, // 550 + 137.5
  unavailable: -1,
} as const;

/** Zone size in meters */
export const ZONE_SIZE_M = 50;

/** Calibration laps before baseline is ready */
export const CALIBRATION_LAPS = 2;

/** Polling interval for R3E shared memory (ms) */
export const POLL_INTERVAL_MS = 16;

/** Reconnect interval when R3E is not running (ms) */
export const RECONNECT_INTERVAL_MS = 2000;

/** EMA alpha for adaptive baseline */
export const BASELINE_EMA_ALPHA = 0.3;

/** Deviation thresholds */
export const DEVIATION_THRESHOLDS = {
  lateBrakeMeters: 15,
  slowThrottleMeters: 12,
  trailBrakingSteerDelta: 0.08,
  coastingExtraFrames: 8,
  overlapExtraFrames: 5,
} as const;
