/**
 * AlertDispatcher + RuleEngine
 *
 * AlertDispatcher: Emits every alert immediately (no spam filtering) - alerts
 * are consumed by the analysis pipeline and must not be dropped.
 * RuleEngine: Frame-level P1/P2, post-lap P3 from AdaptiveBaseline deviations.
 */

import { EventEmitter } from "events";
import {
  BRAKE_TEMP,
  renderMessage,
  type MessageVars,
} from "../../shared/alert-types.js";
import { tm } from "../i18n-main.js";
import type {
  Alert,
  AlertType,
  Deviation,
  GameFrame,
} from "../../shared/types.js";
import type { AdaptiveBaseline } from "./adaptive-baseline.js";

// --- AlertDispatcher ---

export type AlertDispatcher = {
  dispatch: (alert: Alert) => void;
  on: (event: "alert", listener: (alert: Alert) => void) => void;
};

export const createAlertDispatcher = (): AlertDispatcher => {
  const emitter = new EventEmitter();

  return {
    dispatch: (alert) => {
      emitter.emit("alert", alert);
    },

    on: (event, listener) => emitter.on(event, listener),
  };
};

// --- RuleEngine ---

// Language-neutral track position: the corner as stored plus the metre.
const position = (corner: string | null, dist: number): MessageVars => ({
  ...(corner ? { corner } : {}),
  m: Math.round(dist),
});

type GetCornerNameFn = (dist: number) => string | null;

export type RuleEngine = {
  processFrame: (frame: GameFrame, currentLap: number) => void;
  processLapDeviations: (deviations: Deviation[], lap: number) => void;
};

export const createRuleEngine = (
  dispatcher: AlertDispatcher,
  baseline: AdaptiveBaseline,
  getCornerName: GetCornerNameFn,
): RuleEngine => {
  // One alert per episode: a wheel fires when it crosses BRAKE_TEMP.max and
  // re-arms only once it cools REARM_C below it, so a hot brake does not emit
  // one alert per sample (500+ per stint, the session buffer's whole capacity).
  const REARM_C = 20;
  const brakeHot = [false, false, false, false];

  const checkBrakeTemp = (
    frame: GameFrame,
    zone: number,
    lap: number,
  ): void => {
    const temps = [
      { label: "FL", value: frame.brakeTempFL },
      { label: "FR", value: frame.brakeTempFR },
      { label: "RL", value: frame.brakeTempRL },
      { label: "RR", value: frame.brakeTempRR },
    ];

    temps.forEach((t, i) => {
      if (t.value === BRAKE_TEMP.unavailable) return;
      if (brakeHot[i]) {
        if (t.value < BRAKE_TEMP.max - REARM_C) brakeHot[i] = false;
        return;
      }
      if (t.value > BRAKE_TEMP.max) {
        brakeHot[i] = true;
        const messageVars = { wheel: t.label, temp: Math.round(t.value) };
        dispatcher.dispatch({
          type: "BRAKE_TEMP_CRITICAL",
          priority: 1,
          zone,
          dist: frame.lapDistance,
          lap,
          message: renderMessage(tm, "alert.brakeTemp", messageVars),
          messageKey: "alert.brakeTemp",
          messageVars,
          immediate: true,
          data: { temp: t.value, wheel: t.label },
          timestamp: Date.now(),
        });
      }
    });
  };

  const checkTcAbsAnomaly = (
    frame: GameFrame,
    zone: number,
    where: MessageVars,
    lap: number,
  ): void => {
    const check = baseline.checkZoneRealtime({
      zone,
      tcActive: frame.tcActive > 0,
      absActive: frame.absActive > 0,
    });

    if (check.tcAnomaly) {
      dispatcher.dispatch({
        type: "TC_ANOMALY",
        priority: 2,
        zone,
        dist: frame.lapDistance,
        lap,
        message: renderMessage(tm, "alert.tcAnomaly", where),
        messageKey: "alert.tcAnomaly",
        messageVars: where,
        immediate: true,
        timestamp: Date.now(),
      });
    }

    if (check.absAnomaly) {
      dispatcher.dispatch({
        type: "ABS_ANOMALY",
        priority: 2,
        zone,
        dist: frame.lapDistance,
        lap,
        message: renderMessage(tm, "alert.absAnomaly", where),
        messageKey: "alert.absAnomaly",
        messageVars: where,
        immediate: true,
        timestamp: Date.now(),
      });
    }
  };

  return {
    processFrame: (frame: GameFrame, currentLap: number) => {
      const zone = Math.floor(frame.lapDistance / 50);
      const cornerName = getCornerName(frame.lapDistance);
      const where = position(cornerName, frame.lapDistance);

      checkBrakeTemp(frame, zone, currentLap);
      if (baseline.isReady()) checkTcAbsAnomaly(frame, zone, where, currentLap);
    },

    processLapDeviations: (deviations, lap) => {
      for (const dev of deviations) {
        const cornerName = getCornerName(dev.dist);
        const messageVars = {
          ...dev.messageVars,
          ...position(cornerName, dev.dist),
        };

        dispatcher.dispatch({
          type: dev.type as AlertType,
          priority: 3,
          zone: dev.zone,
          dist: dev.dist,
          lap,
          message: renderMessage(tm, dev.messageKey, messageVars),
          messageKey: dev.messageKey,
          messageVars,
          immediate: false,
          data: { delta: dev.delta },
          timestamp: Date.now(),
        });
      }
    },
  };
};
