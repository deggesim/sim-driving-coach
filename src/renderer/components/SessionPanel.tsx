import { useState } from "react";
import { Alert } from "react-bootstrap";
import type { GameSource, SessionStartResult } from "../../shared/types";
import { useFlash } from "../hooks/useFlash";
import { useSetupPicker } from "../hooks/useSetupPicker";
import { useIPCStore } from "../store/ipcStore";
import { useSessionStore } from "../store/sessionStore";
import AceSetupPicker from "./AceSetupPicker";
import { Ams2SetupPicker } from "./Ams2SetupPicker";
import AnalysisHeader from "./AnalysisHeader";
import AnalysisList from "./AnalysisList";
import { GamePickerModal } from "./GamePickerModal";
import LapsTable from "./LapsTable";
import R3eSetupPicker from "./R3eSetupPicker";
import SetupSelectionModal from "./SetupSelectionModal";

type Props = {
  mode: "live" | "historical";
  onSessionClosed?: () => void;
  onBack?: () => void;
  onReopened?: () => void;
};

const SessionPanel = ({ mode, onSessionClosed, onBack, onReopened }: Props) => {
  const status = useIPCStore((s) => s.status);
  const session = useSessionStore((s) => s.session);
  const analyses = useSessionStore((s) => s.analyses);
  const working = useSessionStore((s) => s.working);
  const { flash, setFlash, showFlash } = useFlash();
  const {
    showPicker,
    setShowPicker,
    showSetupSelection,
    setShowSetupSelection,
    pickerLap,
    setPickerLap,
    setPendingLapId,
    setupById,
    handleSetupConfirm,
    handleReuseSetup,
    handleLapReuseSetup,
  } = useSetupPicker({ showFlash, explicit: mode === "historical" });

  const game = session?.game ?? (mode === "live" ? status.game : undefined);
  const currentCar =
    session?.car_name ??
    session?.car ??
    (mode === "live" ? status?.car : undefined) ??
    "";
  const currentTrack =
    session?.track_name ??
    session?.track ??
    (mode === "live" ? status?.track : undefined) ??
    "";
  const workingVersion = working?.sessionId === session?.id ? working : null;
  const sessionActive = !!session && !session.ended_at;
  const isLive = mode === "live";

  const [showGamePicker, setShowGamePicker] = useState(false);

  const handleStart = (): void => setShowGamePicker(true);

  // Speak the open outcome only when the app is not in the foreground (the user
  // has alt-tabbed to the sim). Routed through the TTS queue (respects mute/Azure).
  const announceOutcome = (res: SessionStartResult): void => {
    if (document.hasFocus()) return;
    useIPCStore
      .getState()
      .setAnnounce(
        res.ok
          ? `Sessione aperta: auto ${res.car}, circuito ${res.track}`
          : "Attenzione, impossibile aprire la sessione",
      );
  };

  const handleGamePicked = async (game: GameSource): Promise<void> => {
    setShowGamePicker(false);
    const res = await window.electronAPI.sessionStart(game);
    announceOutcome(res);
    if (!res.ok) {
      showFlash("danger", res.reason);
    } else {
      showFlash("success", "Sessione aperta.");
      if (game === "r3e") setShowSetupSelection(true);
    }
  };

  const handleEnd = async (): Promise<void> => {
    await window.electronAPI.sessionEnd();
    onSessionClosed?.();
  };

  const handleReopen = async (): Promise<void> => {
    if (!session) return;
    const res = await window.electronAPI.sessionReopen({
      id: session.id,
      game: session.game,
    });
    announceOutcome(res);
    if (!res.ok) {
      showFlash(
        "danger",
        (res as { ok: false; reason: string }).reason ??
          "Errore nella riapertura",
      );
      return;
    }
    onReopened?.();
  };

  const handleAnalyze = async (): Promise<void> => {
    if (!session) return;
    const res = await window.electronAPI.sessionAnalyze(
      mode === "historical"
        ? { sessionId: session.id, game: session.game }
        : undefined,
    );
    if (!res.ok) showFlash("danger", res.reason ?? "Errore durante l'analisi");
    else showFlash("info", "Analisi in corso…");
  };

  const handleExportPdf = async (): Promise<void> => {
    if (!session) return;
    const path = await window.electronAPI.sessionExportPdf({
      id: session.id,
      game: session.game,
    });
    if (path) showFlash("success", `PDF salvato: ${path}`);
  };

  return (
    <div className="d-flex flex-column h-100 overflow-hidden">
      <AnalysisHeader
        isLive={isLive}
        sessionActive={sessionActive}
        currentCar={currentCar}
        currentTrack={currentTrack}
        onStart={isLive ? handleStart : () => {}}
        onEnd={isLive ? handleEnd : () => {}}
        onAnalyze={handleAnalyze}
        onExportPdf={handleExportPdf}
        onOpenPicker={
          game === "r3e"
            ? () => setShowSetupSelection(true)
            : () => setShowPicker(true)
        }
        onBack={!isLive ? onBack : undefined}
        onReopen={!isLive && !sessionActive ? handleReopen : undefined}
      />

      {flash && (
        <Alert
          variant={flash.variant}
          onClose={() => setFlash(null)}
          dismissible
          className="mb-0"
        >
          {flash.text}
        </Alert>
      )}

      <div
        className="flex-grow-1 overflow-hidden p-3 d-flex flex-column"
        style={{ minHeight: 0 }}
      >
        <div className="flex-shrink-0">
          <LapsTable
            setupById={setupById}
            live={isLive}
            onPickSetup={setPickerLap}
          />
        </div>

        <div className="flex-grow-1 d-flex flex-column overflow-hidden mt-3 session-analyses-section">
          <h6 className="text-uppercase flex-shrink-0">Analisi</h6>
          {analyses.length === 0 && !workingVersion && (
            <p>Nessuna analisi ancora generata.</p>
          )}
          <AnalysisList workingVersion={workingVersion} startClosed={!isLive} />
        </div>
      </div>

      {/* Setup pickers */}
      {game === "ace" ? (
        <AceSetupPicker
          show={showPicker}
          expectedCar={currentCar}
          expectedTrack={currentTrack}
          onClose={() => setShowPicker(false)}
          onConfirm={handleSetupConfirm}
        />
      ) : game === "ams2" ? (
        <Ams2SetupPicker
          show={showPicker}
          expectedCar={currentCar}
          onClose={() => setShowPicker(false)}
          onConfirm={handleSetupConfirm}
        />
      ) : (
        <R3eSetupPicker
          show={showPicker}
          expectedCar={currentCar}
          onClose={() => setShowPicker(false)}
          onConfirm={handleSetupConfirm}
        />
      )}

      {session && (
        <SetupSelectionModal
          show={showSetupSelection}
          car={session.car}
          track={session.track}
          layout={session.layout}
          game={session.game}
          onClose={() => setShowSetupSelection(false)}
          onReuseSetup={handleReuseSetup}
          onJsonPicker={() => {
            setShowSetupSelection(false);
            setShowPicker(true);
          }}
        />
      )}

      {session && (
        <SetupSelectionModal
          show={pickerLap != null}
          car={session.car}
          track={session.track}
          layout={session.layout}
          game={session.game}
          onClose={() => setPickerLap(null)}
          onReuseSetup={handleLapReuseSetup}
          onJsonPicker={() => {
            setPendingLapId(pickerLap!.id);
            setPickerLap(null);
            setShowPicker(true);
          }}
        />
      )}

      {isLive && (
        <GamePickerModal
          show={showGamePicker}
          onCancel={() => setShowGamePicker(false)}
          onConfirm={handleGamePicked}
        />
      )}
    </div>
  );
};

export default SessionPanel;
