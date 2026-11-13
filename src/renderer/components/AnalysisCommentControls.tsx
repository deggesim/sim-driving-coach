import { faComment, faMicrophone } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useRef, useState } from "react";
import { Button, Form, Modal, Spinner } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { convertToWav, pickMimeType } from "../lib/audio";
import { useIPCStore } from "../store/ipcStore";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";

/** Max recording duration in ms before auto-stopping. */
const MAX_RECORD_MS = 8000;

type Props = { analysisId: number };

const notifyError = (message: string): void =>
  useIPCStore.getState().setAppError(message);

const AnalysisCommentControls = ({ analysisId }: Props) => {
  const { t } = useTranslation();
  const commentAnalysis = useSessionStore((s) => s.commentAnalysis);
  const azureSpeechKey = useSettingsStore((s) => s.azureSpeechKey);
  const azureRegion = useSettingsStore((s) => s.azureRegion);
  const sttReady = azureSpeechKey.trim() !== "" && azureRegion.trim() !== "";

  const [showModal, setShowModal] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);

  const submit = async (value: string) => {
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    try {
      await commentAnalysis(analysisId, v);
    } finally {
      setBusy(false);
    }
  };

  const handleTextConfirm = () => {
    const v = text;
    setShowModal(false);
    setText("");
    void submit(v);
  };

  const stopRecording = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  };

  const startRecording = () => {
    if (busy || recording || !sttReady) return;
    const mimeType = pickMimeType();
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const recorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined,
        );
        recorderRef.current = recorder;
        const chunks: BlobPart[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          recorderRef.current = null;
          setRecording(false);

          const blob = new Blob(chunks, {
            type: mimeType || "audio/webm;codecs=opus",
          });
          if (blob.size === 0) return;

          setBusy(true);
          convertToWav(blob)
            .then((buf) => window.electronAPI.sttTranscribe(buf, "audio/wav"))
            .then((transcript) => {
              const trimmed = transcript.trim();
              if (trimmed) return commentAnalysis(analysisId, trimmed);
            })
            .catch((err: unknown) => {
              console.error("[CommentControls] STT error:", err);
              notifyError(t("comment.sttError"));
            })
            .finally(() => setBusy(false));
        };

        recorder.start();
        setRecording(true);
        setTimeout(() => {
          if (recorder.state !== "inactive") recorder.stop();
        }, MAX_RECORD_MS);
      })
      .catch((err: unknown) => {
        console.error("[CommentControls] mic error:", err);
        setRecording(false);
        notifyError(t("comment.micError"));
      });
  };

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="p-0 px-3 rounded-0"
        title={t("comment.add")}
        aria-label={t("comment.add")}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          setText("");
          setShowModal(true);
        }}
      >
        {busy ? (
          <Spinner size="sm" />
        ) : (
          <FontAwesomeIcon icon={faComment} aria-hidden />
        )}
      </Button>
      <Button
        type="button"
        variant={recording ? "danger" : "secondary"}
        size="sm"
        className="p-0 px-3 rounded-0"
        title={
          sttReady
            ? recording
              ? t("comment.stop")
              : t("comment.voice")
            : t("comment.sttOff")
        }
        aria-label={recording ? t("comment.stop") : t("comment.voice")}
        disabled={busy || !sttReady}
        onClick={(e) => {
          e.stopPropagation();
          if (recording) stopRecording();
          else startRecording();
        }}
      >
        <FontAwesomeIcon icon={faMicrophone} aria-hidden />
      </Button>

      <Modal show={showModal} onHide={() => setShowModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{t("comment.modalTitle")}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Control
            as="textarea"
            rows={4}
            value={text}
            autoFocus
            placeholder={t("comment.placeholder")}
            onChange={(e) => setText(e.target.value)}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowModal(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={handleTextConfirm}
            disabled={text.trim() === ""}
          >
            {t("comment.send")}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default AnalysisCommentControls;
