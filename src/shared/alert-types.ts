/**
 * Alert and telemetry tuning constants.
 */

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
