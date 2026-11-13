/**
 * StatusBar - Always-visible bottom bar.
 * Shows: connection badge, car/track, calibration state, last alert (fade 5s).
 */

import { faMicrophone } from "@fortawesome/free-solid-svg-icons/faMicrophone";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { ReactNode } from "react";
import { Badge, Button } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import type { GameSource, GameStatus } from "../../shared/types";

type StatusBarProps = {
  status: GameStatus;
  onResetReader?: (game: GameSource) => void;
};

const StatusBar = ({ status, onResetReader }: StatusBarProps) => {
  const { t } = useTranslation();
  const calibrationText: ReactNode = status.calibrating ? (
    t(
      status.lapsToCalibration === 1
        ? "status.calibratingOne"
        : "status.calibratingMany",
      { n: status.lapsToCalibration },
    )
  ) : (
    <>
      <FontAwesomeIcon icon={faMicrophone} /> {t("status.coachActive")}
    </>
  );

  return (
    <div className="status-bar">
      {/* Connection - one badge per game */}
      <div className="d-flex align-items-center gap-1">
        {status.r3eConnected ? (
          <Button
            variant="success"
            size="sm"
            className="status-badge game-badge game-badge--r3e"
            title={t("status.forceReconnect", { game: "R3E" })}
            onClick={() => onResetReader?.("r3e")}
          >
            {t("status.connected", { game: "R3E" })}
          </Button>
        ) : (
          <Badge bg="secondary" className="status-badge">
            {t("status.disconnected", { game: "R3E" })}
          </Badge>
        )}
        {status.aceConnected ? (
          <Button
            variant="success"
            size="sm"
            className="status-badge game-badge game-badge--ace ms-1"
            title={t("status.forceReconnect", { game: "ACE" })}
            onClick={() => onResetReader?.("ace")}
          >
            {t("status.connected", { game: "ACE" })}
          </Button>
        ) : (
          <Badge bg="secondary" className="status-badge ms-1">
            {t("status.disconnected", { game: "ACE" })}
          </Badge>
        )}
        {status.ams2Connected ? (
          <Button
            variant="success"
            size="sm"
            className="status-badge game-badge game-badge--ams2 ms-1"
            title={t("status.forceReconnect", { game: "AMS2" })}
            onClick={() => onResetReader?.("ams2")}
          >
            {t("status.connected", { game: "AMS2" })}
          </Button>
        ) : (
          <Badge bg="secondary" className="status-badge ms-1">
            {t("status.disconnected", { game: "AMS2" })}
          </Badge>
        )}
      </div>

      {/* Car / Track */}
      {status.car && (
        <div className="status-session">
          <span className="status-car">{status.car}</span>
          {status.track && (
            <>
              <span className="status-sep"> · </span>
              <span className="status-track">
                {status.track}
                {status.layout ? ` (${status.layout})` : ""}
              </span>
            </>
          )}
        </div>
      )}

      {/* Calibration / Active */}
      <div className="status-calibration">
        {status.connected ? calibrationText : "—"}
      </div>
    </div>
  );
};

export default StatusBar;
