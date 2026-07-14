/**
 * StatusBar - Always-visible bottom bar.
 * Shows: connection badge, car/track, calibration state, last alert (fade 5s).
 */

import { faMicrophone } from "@fortawesome/free-solid-svg-icons/faMicrophone";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { ReactNode } from "react";
import { Badge, Button } from "react-bootstrap";
import type { GameSource, GameStatus } from "../../shared/types";

type StatusBarProps = {
  status: GameStatus;
  onResetReader?: (game: GameSource) => void;
};

const StatusBar = ({ status, onResetReader }: StatusBarProps) => {
  const calibrationText: ReactNode = status.calibrating ? (
    `Calibrazione: ${status.lapsToCalibration} ${status.lapsToCalibration === 1 ? "giro rimanente" : "giri rimanenti"}`
  ) : (
    <>
      <FontAwesomeIcon icon={faMicrophone} /> Coach attivo
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
            title="Forza riconnessione R3E"
            onClick={() => onResetReader?.("r3e")}
          >
            R3E connesso
          </Button>
        ) : (
          <Badge bg="secondary" className="status-badge">
            R3E disconnesso
          </Badge>
        )}
        {status.aceConnected ? (
          <Button
            variant="success"
            size="sm"
            className="status-badge game-badge game-badge--ace ms-1"
            title="Forza riconnessione ACE"
            onClick={() => onResetReader?.("ace")}
          >
            ACE connesso
          </Button>
        ) : (
          <Badge bg="secondary" className="status-badge ms-1">
            ACE disconnesso
          </Badge>
        )}
        {status.ams2Connected ? (
          <Button
            variant="success"
            size="sm"
            className="status-badge game-badge game-badge--ams2 ms-1"
            title="Forza riconnessione AMS2"
            onClick={() => onResetReader?.("ams2")}
          >
            AMS2 connesso
          </Button>
        ) : (
          <Badge bg="secondary" className="status-badge ms-1">
            AMS2 disconnesso
          </Badge>
        )}
      </div>

      {/* Car / Track */}
      {status.car && (
        <div className="status-session">
          <span className="status-car">{status.car}</span>
          {status.track && (
            <>
              <span className="status-sep"> - </span>
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
