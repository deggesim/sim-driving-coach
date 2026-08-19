import { useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { SetupData, SetupParam } from "../../shared/types";
import { parseR3eSetupJson } from "../../shared/r3e-setup-parse";
import R3eSetupTabs from "./R3eSetupTabs";

type Props = {
  show: boolean;
  expectedCar: string;
  onClose: () => void;
  onConfirm: (setup: SetupData) => void;
};

const R3eSetupPicker = ({ show, expectedCar, onClose, onConfirm }: Props) => {
  const [jsonText, setJsonText] = useState("");
  const [setupName, setSetupName] = useState("");
  const [params, setParams] = useState<SetupParam[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleParse = (): void => {
    setError(null);
    try {
      setParams(parseR3eSetupJson(jsonText));
    } catch (e) {
      setError(e instanceof Error ? e.message : "JSON non valido");
      setParams(null);
    }
  };

  const handleConfirm = (): void => {
    if (!params || !setupName.trim()) return;
    onConfirm({
      name: setupName.trim(),
      carVerified: true,
      carFound: expectedCar,
      setupText: "",
      params,
      screenshots: [],
    });
    handleClose();
  };

  const handleClose = (): void => {
    setJsonText("");
    setSetupName("");
    setParams(null);
    setError(null);
    onClose();
  };

  return (
    <Modal
      show={show}
      onHide={handleClose}
      size="xl"
      className="screenshot-picker-modal"
    >
      <Modal.Header className="picker-header">
        <Modal.Title className="picker-title">
          Incolla JSON setup
          <span className="picker-subtitle"> · {expectedCar}</span>
        </Modal.Title>
        <Button variant="link" className="picker-close" onClick={handleClose}>
          <FontAwesomeIcon icon={faXmark} />
        </Button>
      </Modal.Header>

      <Modal.Body className="picker-body">
        {error && <div className="picker-error mb-3">{error}</div>}

        {!params ? (
          <Form.Group>
            <Form.Label className="text-muted" style={{ fontSize: 14 }}>
              Incolla il JSON esportato da RaceRoom (CTRL+C nella schermata del
              setup)
            </Form.Label>
            <Form.Control
              as="textarea"
              rows={14}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder={
                '{\n  "values": [...],\n  "action": "setCarSetupValues"\n}'
              }
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                background: "var(--bg2)",
                color: "var(--text)",
                borderColor: "var(--border)",
              }}
            />
          </Form.Group>
        ) : (
          <>
            <Form.Group className="mb-3" style={{ maxWidth: 360 }}>
              <Form.Label className="text-muted" style={{ fontSize: 14 }}>
                Nome setup <span className="text-danger">*</span>
              </Form.Label>
              <Form.Control
                size="sm"
                type="text"
                placeholder="es. Qualifica Monza baseline"
                value={setupName}
                onChange={(e) => setSetupName(e.target.value)}
                autoFocus
              />
            </Form.Group>

            <div className="picker-params">
              <R3eSetupTabs params={params} />
            </div>
          </>
        )}
      </Modal.Body>

      <Modal.Footer className="picker-footer">
        {!params ? (
          <>
            <Button variant="secondary" size="sm" onClick={handleClose}>
              Annulla
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!jsonText.trim()}
              onClick={handleParse}
            >
              Analizza JSON
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setParams(null);
                setSetupName("");
              }}
            >
              Modifica JSON
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!setupName.trim()}
              onClick={handleConfirm}
            >
              <FontAwesomeIcon icon={faCheck} className="me-1" />
              Salva setup
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default R3eSetupPicker;
