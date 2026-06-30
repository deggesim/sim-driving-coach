import { faComment, faMicrophone } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useRef, useState } from "react";
import { Button, Form, Modal, Spinner } from "react-bootstrap";
import { convertToWav, pickMimeType } from "../lib/audio";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";

/** Max recording duration in ms before auto-stopping. */
const MAX_RECORD_MS = 8000;

type Props = { analysisId: number };

const AnalysisCommentControls = ({ analysisId }: Props) => {
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
            .catch((err: unknown) =>
              console.error("[CommentControls] STT error:", err),
            )
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
      });
  };

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="p-0 px-3 rounded-0"
        title="Commenta l'analisi"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          setShowModal(true);
        }}
      >
        {busy ? <Spinner size="sm" /> : <FontAwesomeIcon icon={faComment} />}
      </Button>
      <Button
        type="button"
        variant={recording ? "danger" : "secondary"}
        size="sm"
        className="p-0 px-3 rounded-0"
        title={
          sttReady
            ? recording
              ? "Ferma registrazione"
              : "Commento vocale"
            : "Azure STT non configurato"
        }
        disabled={busy || !sttReady}
        onClick={(e) => {
          e.stopPropagation();
          if (recording) stopRecording();
          else startRecording();
        }}
      >
        <FontAwesomeIcon icon={faMicrophone} />
      </Button>

      <Modal
        show={showModal}
        onHide={() => setShowModal(false)}
        centered
        className="delete-confirm-modal"
      >
        <Modal.Header closeButton>
          <Modal.Title>Commenta l&apos;analisi</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Control
            as="textarea"
            rows={4}
            value={text}
            autoFocus
            placeholder="Suggerisci una modifica o correggi una valutazione…"
            onChange={(e) => setText(e.target.value)}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowModal(false)}>
            Annulla
          </Button>
          <Button
            variant="primary"
            onClick={handleTextConfirm}
            disabled={text.trim() === ""}
          >
            Invia
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default AnalysisCommentControls;
