import { useEffect, useRef, useState } from "react";
import { Button, Modal, ProgressBar } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import type { UpdateProgress } from "../../shared/types";

type Phase = "idle" | "ask" | "downloading";

// Dispatched by the Settings test button to rehearse the flow without a release.
export const UPDATE_MOCK_EVENT = "update:mock";
const MOCK_TOTAL = 80 * 1048576;

// Startup update flow: "new version" prompt → download modal with progress.
// When the download ends the main process quits the app and launches the setup.
export const UpdateModals = () => {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [version, setVersion] = useState("");
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mockRef = useRef(false);

  useEffect(() => {
    const api = window.electronAPI;
    const offer = (v: string) => {
      setVersion(v);
      setPhase("ask");
    };
    // The check may have resolved before this component mounted.
    void api.updatePending().then((v) => v && offer(v));
    const onMock = () => {
      mockRef.current = true;
      offer("9.9.9");
    };
    window.addEventListener(UPDATE_MOCK_EVENT, onMock);
    const offs = [
      api.onUpdateAvailable(({ version: v }) => offer(v)),
      api.onUpdateProgress(setProgress),
      api.onUpdateError(({ message }) => {
        setError(message);
        setPhase("idle");
      }),
    ];
    return () => {
      window.removeEventListener(UPDATE_MOCK_EVENT, onMock);
      offs.forEach((off) => off());
    };
  }, []);

  const dismiss = () => {
    mockRef.current = false;
    setPhase("idle");
    setError(null);
  };

  const download = () => {
    setProgress(null);
    setError(null);
    setPhase("downloading");
    if (mockRef.current) {
      mockRef.current = false;
      // Simulated download: ~3s, then close and do nothing else.
      let pct = 0;
      const timer = setInterval(() => {
        pct = Math.min(100, pct + 4);
        setProgress({
          percent: pct,
          transferred: (MOCK_TOTAL * pct) / 100,
          total: MOCK_TOTAL,
        });
        if (pct === 100) {
          clearInterval(timer);
          setTimeout(() => setPhase("idle"), 400);
        }
      }, 120);
      return;
    }
    window.electronAPI.updateDownload().catch(() => setPhase("idle"));
  };

  const percent = Math.round(progress?.percent ?? 0);
  const mb = (n: number) => (n / 1048576).toFixed(1);

  return (
    <>
      <Modal show={phase === "ask" || !!error} onHide={dismiss} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {error ? t("update.failedTitle") : t("update.newTitle")}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {error ? (
            <p className="text-danger mb-0">{error}</p>
          ) : (
            <p className="mb-0">{t("update.body", { version })}</p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={dismiss}>
            {error ? t("update.close") : t("update.later")}
          </Button>
          {!error && (
            <Button variant="primary" onClick={download}>
              {t("update.install")}
            </Button>
          )}
        </Modal.Footer>
      </Modal>

      <Modal
        show={phase === "downloading"}
        backdrop="static"
        keyboard={false}
        centered
      >
        <Modal.Header>
          <Modal.Title>{t("update.downloading")}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <ProgressBar now={percent} label={`${percent}%`} animated />
          {progress && (
            <p className="text-muted small mt-2 mb-0">
              {mb(progress.transferred)} / {mb(progress.total)} MB
            </p>
          )}
        </Modal.Body>
      </Modal>
    </>
  );
};
