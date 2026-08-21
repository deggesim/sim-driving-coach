/**
 * Alert and telemetry tuning constants.
 */

import type { AlertType } from "./types.js";

/**
 * AlertType code -> Italian label. The analysis text is rendered, exported to PDF
 * and read aloud by the TTS: a raw code must never reach it, neither through the
 * prompt nor through the model's output.
 */
export const ALERT_LABELS: Record<AlertType, string> = {
  BRAKE_TEMP_CRITICAL: "temperatura critica dei freni",
  TC_ANOMALY: "anomalia controllo di trazione",
  ABS_ANOMALY: "anomalia abs",
  LATE_BRAKE: "frenata tardiva",
  SLOW_THROTTLE: "accelerazione tardiva",
  TRAIL_BRAKING: "trail braking eccessivo",
  COASTING: "coasting",
  BRAKE_THROTTLE_OVERLAP: "sovrapposizione freno gas",
};

/**
 * Wheel position codes used by the per-wheel prompt lines, same rule.
 * Feminine ("ruota") also in the brake temp line: it is a position label, and a
 * second masculine map just for the brakes is not worth its weight.
 */
export const WHEEL_LABELS = {
  "ANT-SX": "anteriore sinistra",
  "ANT-DX": "anteriore destra",
  "POST-SX": "posteriore sinistra",
  "POST-DX": "posteriore destra",
} as const;

/** Wheel order legend, one source for every prompt line printing a quartet. */
export const WHEEL_ORDER = Object.values(WHEEL_LABELS).join("/");

const DECODE: Record<string, string> = { ...ALERT_LABELS, ...WHEEL_LABELS };
const CODE_RE = new RegExp(`\\b(?:${Object.keys(DECODE).join("|")})\\b`, "g");

/**
 * Safety net on the model output. The prompts no longer carry codes, but prior
 * analyses are injected verbatim into the next prompt: a row saved before this
 * change can still be copied forward.
 */
export const decodeAlertCodes = (text: string): string =>
  text.replace(CODE_RE, (m) => DECODE[m] ?? m);

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
