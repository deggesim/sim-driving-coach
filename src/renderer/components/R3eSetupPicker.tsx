import { useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const [jsonText, setJsonText] = useState("");
  const [setupName, setSetupName] = useState("");
  const [params, setParams] = useState<SetupParam[] | null>(null);
  // Kind, not text: the message is translated at render.
  const [error, setError] = useState<"invalid" | "format" | null>(null);

  const handleParse = (): void => {
    setError(null);
    try {
      setParams(parseR3eSetupJson(jsonText));
    } catch (e) {
      setError(e instanceof SyntaxError ? "invalid" : "format");
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
          {t("r3ePicker.title")}
          <span className="picker-subtitle"> · {expectedCar}</span>
        </Modal.Title>
        <Button
          variant="link"
          className="picker-close"
          title={t("setupCommon.close")}
          aria-label={t("setupCommon.close")}
          onClick={handleClose}
        >
          <FontAwesomeIcon icon={faXmark} aria-hidden />
        </Button>
      </Modal.Header>

      <Modal.Body className="picker-body">
        {error && (
          <div className="picker-error mb-3">
            {t(
              error === "invalid"
                ? "r3ePicker.errInvalid"
                : "r3ePicker.errFormat",
            )}
          </div>
        )}

        {!params ? (
          <Form.Group>
            <Form.Label className="text-muted" style={{ fontSize: 14 }}>
              {t("r3ePicker.pasteLabel")}
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
                {t("setupCommon.nameLabel")}{" "}
                <span className="text-danger">*</span>
              </Form.Label>
              <Form.Control
                size="sm"
                type="text"
                placeholder={t("r3ePicker.namePlaceholder")}
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
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!jsonText.trim()}
              onClick={handleParse}
            >
              {t("r3ePicker.parse")}
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
              {t("r3ePicker.editJson")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!setupName.trim()}
              onClick={handleConfirm}
            >
              <FontAwesomeIcon icon={faCheck} className="me-1" />
              {t("setupCommon.save")}
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default R3eSetupPicker;
