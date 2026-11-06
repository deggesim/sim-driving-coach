/**
 * App - Root component.
 * Layout: custom title bar (frameless Electron), main content area, bottom StatusBar.
 * TTSManager and VoiceCoachOverlay are headless/overlay - mounted globally.
 */

import { Suspense, use, useEffect, useState } from "react";
import { Spinner, Toast, ToastContainer } from "react-bootstrap";
import RealtimeAnalysis from "./components/RealtimeAnalysis";
import SessionHistory from "./components/SessionHistory";
import SettingsPanel from "./components/SettingsPanel";
import StatusBar from "./components/StatusBar";
import TitleBar from "./components/TitleBar";
import TTSManager from "./components/TTSManager";
import VoiceCoachOverlay from "./components/VoiceCoachOverlay";
import { useIPC } from "./hooks/useIPC";
import { useVoiceCoach } from "./hooks/useVoiceCoach";
import { useIPCStore } from "./store/ipcStore";
import { subscribeSessionIPC, useSessionStore } from "./store/sessionStore";
import { useSettingsStore } from "./store/settingsStore";
import { settingsLoaderPromise } from "./loaders/settingsLoader";

type Tab = "current-session" | "session-list" | "settings";

const App = () => {
  // Bootstrap IPC subscriptions (writes to ipcStore)
  useIPC();

  // Subscribe once to session:* push channels
  useEffect(() => {
    subscribeSessionIPC();
  }, []);

  // Suspend until all settings are loaded from SQLite via IPC.
  // settingsLoaderPromise is a stable module-level Promise - safe to pass to use().
  // The parent <Suspense> boundary in main.tsx handles the loading state.
  use(settingsLoaderPromise);

  // Read IPC state from store
  const status = useIPCStore((s) => s.status);

  // Settings state from Zustand store (populated by settingsLoaderPromise above)
  const {
    assistantName,
    gamepadButton,
    capturingVoiceInput,
    ttsEnabled,
    azureTtsEnabled,
    settingsLoaded,
  } = useSettingsStore();

  const [tab, setTab] = useState<Tab>("current-session");
  // Set when the user closes a session from the button: the history opens on it.
  const [openClosed, setOpenClosed] = useState(false);
  const loadSessionById = useSessionStore((s) => s.loadById);
  const changeTab = (next: Tab) => {
    setOpenClosed(false);
    setTab(next);
  };
  // Shared by main-process errors and renderer failures (`setAppError`).
  const appError = useIPCStore((s) => s.appError);
  const setAppError = useIPCStore((s) => s.setAppError);

  useEffect(() => {
    return window.electronAPI.onAppError(({ message }) => setAppError(message));
  }, [setAppError]);

  // Voice coach hook
  const {
    state: voiceState,
    transcript,
    answer,
  } = useVoiceCoach({
    triggerButtonIndex: gamepadButton,
    enabled: ttsEnabled && !capturingVoiceInput,
    azureTtsEnabled,
  });

  return (
    <div className="app">
      {/* Headless TTS */}
      <TTSManager
        enabled={ttsEnabled}
        azureEnabled={azureTtsEnabled}
        assistantName={assistantName}
        settingsLoaded={settingsLoaded}
      />

      {/* Voice coach overlay */}
      <VoiceCoachOverlay
        state={voiceState}
        transcript={transcript}
        answer={answer}
      />

      {/* Title bar (frameless Electron drag area) */}
      <TitleBar tab={tab} onTabChange={changeTab} />

      {/* Global error toast - main-process errors (Azure TTS/Claude quota) and renderer failures; above modals (z-index 1055) */}
      <ToastContainer
        position="top-end"
        className="p-3"
        style={{ position: "fixed", zIndex: 1100 }}
      >
        <Toast show={!!appError} onClose={() => setAppError(null)} bg="danger">
          <Toast.Header
            closeButton
            closeVariant="white"
            className="text-white bg-transparent border-0"
          >
            <strong className="me-auto">Sim Coach</strong>
          </Toast.Header>
          <Toast.Body className="text-white pt-0">{appError}</Toast.Body>
        </Toast>
      </ToastContainer>

      {/* Main content */}
      <div className="main-content">
        {tab === "current-session" && (
          <Suspense
            fallback={
              <div className="flex-grow-1 d-flex align-items-center justify-content-center">
                <Spinner animation="border" variant="secondary" />
              </div>
            }
          >
            <RealtimeAnalysis
              onSessionClosed={({ id, game }) => {
                void loadSessionById(id, game);
                setOpenClosed(true);
                setTab("session-list");
              }}
              onOpenSettings={() => changeTab("settings")}
            />
          </Suspense>
        )}
        {tab === "session-list" && (
          <SessionHistory
            startInDetail={openClosed}
            onSwitchToLive={() => changeTab("current-session")}
          />
        )}
        {tab === "settings" && <SettingsPanel />}
      </div>

      {/* Status bar */}
      <StatusBar
        status={status}
        onResetReader={(game) => window.electronAPI.readerReset(game)}
      />
    </div>
  );
};

export default App;
