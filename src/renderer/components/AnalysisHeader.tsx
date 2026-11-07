import { useState, useEffect } from "react";
import { Badge, Button, Form } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlay,
  faStop,
  faGear,
  faChartLine,
  faFilePdf,
  faArrowLeft,
  faRotateRight,
} from "@fortawesome/free-solid-svg-icons";
import { formatLapTime } from "../../shared/format";
import { useIPCStore } from "../store/ipcStore";
import { useSessionStore } from "../store/sessionStore";
import { GameBadge } from "./GameBadge";

type Props = {
  isLive: boolean;
  sessionActive: boolean;
  currentCar: string;
  currentTrack: string;
  onStart: () => void;
  onEnd: () => void;
  onAnalyze: () => void;
  onExportPdf: () => void;
  onOpenPicker: () => void;
  onBack?: () => void;
  onReopen?: () => void;
};

const AnalysisHeader = ({
  isLive,
  sessionActive,
  currentCar,
  currentTrack,
  onStart,
  onEnd,
  onAnalyze,
  onExportPdf,
  onOpenPicker,
  onBack,
  onReopen,
}: Props) => {
  const session = useSessionStore((s) => s.session);
  const laps = useSessionStore((s) => s.laps);
  const setups = useSessionStore((s) => s.setups);
  const analyses = useSessionStore((s) => s.analyses);
  const activeSetupId = useSessionStore((s) => s.activeSetupId);

  const [leaderboardMode, setLeaderboardMode] = useState(
    session?.leaderboard_mode !== 0,
  );
  const [fixedSetup, setFixedSetup] = useState(session?.fixed_setup !== 0);

  useEffect(() => {
    if (!session) return;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setLeaderboardMode(session.leaderboard_mode !== 0);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setFixedSetup(session.fixed_setup !== 0);
    // Solo al cambio di sessione, non ad ogni aggiornamento dell'oggetto
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [session?.id]);

  const isR3E = session?.game === "r3e";

  // Solo in live con sessione attiva: per una sessione storica o chiusa non c'è
  // un setup "in uso" (activeSetupId arriva solo da session:getCurrent).
  const activeSetupName =
    isLive && sessionActive && activeSetupId != null
      ? (setups.find((row) => row.id === activeSetupId)?.setup.name ??
        `#${activeSetupId}`)
      : null;

  const canAnalyze = !!session && !(isLive && laps.length === 0);
  const showStart = isLive && !sessionActive;

  const updateFlags = (next: {
    leaderboardMode: boolean;
    fixedSetup: boolean;
  }) => {
    if (!session) return;
    window.electronAPI
      .sessionUpdateFlags({
        sessionId: session.id,
        game: session.game,
        ...next,
      })
      .catch((e: unknown) => {
        console.error("[AnalysisHeader] sessionUpdateFlags failed:", e);
        setLeaderboardMode(session.leaderboard_mode !== 0);
        setFixedSetup(session.fixed_setup !== 0);
        useIPCStore
          .getState()
          .setAppError("Impossibile salvare le opzioni della sessione.");
      });
  };

  return (
    <section
      aria-label="Intestazione sessione"
      className="debriefing-header flex-shrink-0"
    >
      <div className="deb-top">
        <div className="deb-identity">
          {session ? (
            <>
              <span className="deb-car fw-bold">{currentCar}</span>
              <span className="text-muted" aria-hidden="true">
                ·
              </span>
              <span className="text-muted">
                {currentTrack} {session.layout_name ?? session.layout}
              </span>
              <GameBadge game={session.game} />
              <Badge bg={sessionActive ? "success" : "secondary"}>
                {sessionActive ? "Attiva" : "Chiusa"}
              </Badge>
            </>
          ) : (
            <span className="text-muted fst-italic">
              {isLive
                ? "Nessuna sessione aperta: scegli il gioco con «Nuova sessione» per registrare i giri."
                : "Caricamento sessione…"}
            </span>
          )}
        </div>

        <div className="deb-actions">
          {showStart && (
            <Button size="sm" variant="primary" onClick={onStart}>
              <FontAwesomeIcon icon={faPlay} className="me-1" /> Nuova sessione
            </Button>
          )}
          <Button
            size="sm"
            variant={canAnalyze && !showStart ? "primary" : "secondary"}
            onClick={() => onAnalyze()}
            disabled={!canAnalyze}
            title="Chiama l'API Claude: genera una nuova versione dell'analisi sintetica."
            aria-describedby="analyze-hint"
          >
            <FontAwesomeIcon icon={faChartLine} className="me-1" /> Esegui
            analisi
          </Button>
          <span id="analyze-hint" className="visually-hidden">
            Chiama l&apos;API Claude: genera una nuova versione
            dell&apos;analisi sintetica.
          </span>
          <div className="deb-actions-secondary">
            {session && (isLive ? sessionActive : true) && (
              <Button size="sm" variant="secondary" onClick={onOpenPicker}>
                <FontAwesomeIcon icon={faGear} className="me-1" /> Gestione
                setup
                {setups.length > 0 && ` (${setups.length})`}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={onExportPdf}
              disabled={!session || analyses.length === 0}
            >
              <FontAwesomeIcon icon={faFilePdf} className="me-1" /> Esporta PDF
            </Button>
            {!isLive && session && !sessionActive && onReopen && (
              <Button size="sm" variant="secondary" onClick={onReopen}>
                <FontAwesomeIcon icon={faRotateRight} className="me-1" />
                Riapri sessione
              </Button>
            )}
            {!isLive && onBack && (
              <Button size="sm" variant="secondary" onClick={onBack}>
                <FontAwesomeIcon icon={faArrowLeft} className="me-1" />
                Indietro
              </Button>
            )}
            {isLive && sessionActive && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onEnd}
                title="Chiude la sessione in corso: i giri registrati restano nello storico"
                aria-label="Chiudi sessione in corso"
              >
                <FontAwesomeIcon icon={faStop} className="me-1" /> Chiudi
                sessione
              </Button>
            )}
          </div>
        </div>
      </div>

      {session && (
        <div className="deb-bottom">
          <dl className="deb-metrics">
            <div className="deb-metric">
              <dt>Giri</dt>
              <dd>{laps.length}</dd>
            </div>
            <div className="deb-metric">
              <dt>Miglior giro</dt>
              <dd className="deb-time">
                {session.best_lap != null
                  ? formatLapTime(session.best_lap)
                  : "—"}
              </dd>
            </div>
            {activeSetupName && (
              <div className="deb-metric">
                <dt>Setup</dt>
                <dd className="deb-setup">{activeSetupName}</dd>
              </div>
            )}
          </dl>

          {isR3E && (
            <div className="deb-flags">
              <div>
                <Form.Check
                  type="switch"
                  id="leaderboard-mode"
                  label="Leaderboard"
                  checked={leaderboardMode}
                  aria-describedby="leaderboard-mode-hint"
                  onChange={(e) => {
                    const val = e.target.checked;
                    setLeaderboardMode(val);
                    updateFlags({ leaderboardMode: val, fixedSetup });
                  }}
                />
                <Form.Text id="leaderboard-mode-hint" className="deb-hint">
                  Gomme fisse a 85 °C: pressioni e campanatura non valutabili.
                </Form.Text>
              </div>
              <div>
                <Form.Check
                  type="switch"
                  id="fixed-setup"
                  label="Setup fisso"
                  checked={fixedSetup}
                  aria-describedby="fixed-setup-hint"
                  onChange={(e) => {
                    const val = e.target.checked;
                    setFixedSetup(val);
                    updateFlags({ leaderboardMode, fixedSetup: val });
                  }}
                />
                <Form.Text id="fixed-setup-hint" className="deb-hint">
                  Si valutano solo condotti e bilanciamento freni; i condotti
                  non vengono proposti.
                </Form.Text>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default AnalysisHeader;
