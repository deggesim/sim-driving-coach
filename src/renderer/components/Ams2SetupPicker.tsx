/**
 * Ams2SetupPicker — modal to select Steam screenshots (AMS2) for setup decoding.
 * Shows thumbnails, multi-select, then Claude Vision decode. Warns on already-used shots.
 */

import {
  faArrowLeft,
  faCheck,
  faCircleNotch,
  faExclamationTriangle,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Form, Modal, Spinner } from "react-bootstrap";
import { Trans, useTranslation } from "react-i18next";
import { localeOf } from "../../shared/i18n";
import type { SetupData } from "../../shared/types";
import { useSettingsStore } from "../store/settingsStore";
import Ams2SetupTabs from "./Ams2SetupTabs";

type AlreadyUsedInfo = {
  setupName: string;
  loadedAt: string;
  sessionId: number;
};
type ScreenshotEntry = {
  name: string;
  thumbnailB64: string;
  alreadyUsed?: AlreadyUsedInfo;
};

type Props = {
  show: boolean;
  expectedCar: string;
  onClose: () => void;
  onConfirm: (setup: SetupData) => void;
};

type Phase = "pick" | "confirm-duplicates" | "decoding" | "verify";

export const Ams2SetupPicker = ({
  show,
  expectedCar,
  onClose,
  onConfirm,
}: Props) => {
  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const [screenshots, setScreenshots] = useState<ScreenshotEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [phase, setPhase] = useState<Phase>("pick");
  const [decodedSetup, setDecodedSetup] = useState<SetupData | null>(null);
  const [setupName, setSetupName] = useState("");
  // Main-process message; "" = no message, show the generic translated one.
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const loadedRef = useRef(false);

  /* eslint-disable @eslint-react/set-state-in-effect -- load() runs from the one-time effect below and from "Riprova" */
  const load = useCallback((): void => {
    setLoading(true);
    setLoadError(false);
    window.electronAPI
      .listScreenshots()
      .then((list) => {
        setScreenshots(list);
        setLoading(false);
      })
      .catch((e: unknown) => {
        console.error("[Ams2SetupPicker] listScreenshots failed:", e);
        setLoadError(true);
        setLoading(false);
      });
  }, []);
  /* eslint-enable @eslint-react/set-state-in-effect */

  useEffect(() => {
    if (!show || loadedRef.current) return;
    loadedRef.current = true;
    load();
  }, [show, load]);

  const toggle = (name: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const screenshotMap = new Map(screenshots.map((s) => [s.name, s]));
  const selectedDuplicates = Array.from(selected).filter(
    (name) => screenshotMap.get(name)?.alreadyUsed !== undefined,
  );

  const startDecode = async (): Promise<void> => {
    setPhase("decoding");
    setError(null);
    try {
      const result = await window.electronAPI.decodeSetup({
        filenames: Array.from(selected),
        expectedCar,
      });
      setDecodedSetup(result);
      setPhase("verify");
    } catch (e) {
      setError(e instanceof Error ? e.message : "");
      setPhase("pick");
    }
  };

  const handleDecodeRequest = (): void => {
    if (selected.size === 0) return;
    if (selectedDuplicates.length > 0) setPhase("confirm-duplicates");
    else void startDecode();
  };

  const handleConfirm = (): void => {
    if (decodedSetup && setupName.trim()) {
      onConfirm({ ...decodedSetup, name: setupName.trim() });
      handleClose();
    }
  };

  const handleClose = (): void => {
    loadedRef.current = false;
    setPhase("pick");
    setSelected(new Set());
    setDecodedSetup(null);
    setSetupName("");
    setError(null);
    onClose();
  };

  const formatDate = (iso: string): string => {
    try {
      return new Date(iso).toLocaleDateString(localeOf(language), {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return iso;
    }
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
          {t("ams2Picker.title")}
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
        {phase === "pick" && (
          <>
            {error !== null && (
              <div className="picker-error mb-3" role="alert">
                {error || t("ams2Picker.decodeError")}
              </div>
            )}
            {loading ? (
              <div className="picker-loading">
                <Spinner size="sm" /> {t("ams2Picker.loading")}
              </div>
            ) : loadError ? (
              <div className="picker-error" role="alert">
                {t("ams2Picker.readError")}{" "}
                <Button variant="link" size="sm" className="p-0" onClick={load}>
                  {t("setupCommon.retry")}
                </Button>
              </div>
            ) : screenshots.length === 0 ? (
              <p className="text-secondary">
                <Trans
                  i18nKey="ams2Picker.empty"
                  components={{
                    retry: (
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        onClick={load}
                      />
                    ),
                  }}
                />
              </p>
            ) : (
              <div className="picker-grid">
                {screenshots.map((s) => (
                  <div
                    key={s.name}
                    className={`picker-thumb ${selected.has(s.name) ? "selected" : ""} ${s.alreadyUsed ? "already-used" : ""}`}
                    role="checkbox"
                    aria-checked={selected.has(s.name)}
                    aria-label={s.name}
                    tabIndex={0}
                    onClick={() => toggle(s.name)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      toggle(s.name);
                    }}
                    title={
                      s.alreadyUsed
                        ? t("ams2Picker.usedTitle", {
                            name:
                              s.alreadyUsed.setupName ||
                              t("ams2Picker.unnamed"),
                            date: formatDate(s.alreadyUsed.loadedAt),
                          })
                        : undefined
                    }
                  >
                    <img
                      src={`data:image/jpeg;base64,${s.thumbnailB64}`}
                      alt={s.name}
                      className="picker-img"
                    />
                    {selected.has(s.name) && (
                      <div className="picker-check">
                        <FontAwesomeIcon icon={faCheck} />
                      </div>
                    )}
                    {s.alreadyUsed && (
                      <div className="picker-used-badge">
                        <FontAwesomeIcon
                          icon={faExclamationTriangle}
                          className="me-1"
                        />
                        {t("ams2Picker.alreadyScanned")}
                      </div>
                    )}
                    <div className="picker-name">
                      {s.name.replace(/_1\.jpg$/, "")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {phase === "confirm-duplicates" && (
          <div className="picker-confirm">
            <div className="picker-confirm-icon">
              <FontAwesomeIcon icon={faExclamationTriangle} />
            </div>
            <h6 className="picker-confirm-title">{t("ams2Picker.dupTitle")}</h6>
            <p className="picker-confirm-text">
              {selectedDuplicates.length === 1
                ? t("ams2Picker.dupOne")
                : t("ams2Picker.dupOther", { n: selectedDuplicates.length })}
            </p>
            <ul className="picker-confirm-list">
              {selectedDuplicates.map((name) => {
                const info = screenshotMap.get(name)!.alreadyUsed!;
                return (
                  <li key={name}>
                    <span className="picker-confirm-filename">
                      {name.replace(/_1\.jpg$/, "")}
                    </span>
                    {" — "}
                    <span className="text-dim">
                      {t("ams2Picker.dupItem", {
                        name: info.setupName || t("ams2Picker.unnamed"),
                        date: formatDate(info.loadedAt),
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="picker-confirm-question">
              {t("ams2Picker.dupQuestion")}
            </p>
          </div>
        )}

        {phase === "decoding" && (
          <div className="picker-loading">
            <FontAwesomeIcon icon={faCircleNotch} spin />
            <span>{t("ams2Picker.decoding")}</span>
          </div>
        )}

        {phase === "verify" && decodedSetup && (
          <div className="picker-verify">
            <div className="picker-car-check mb-3">
              {decodedSetup.carVerified ? (
                <Badge bg="success">
                  <FontAwesomeIcon icon={faCheck} className="me-1" />
                  {t("ams2Picker.carOk", { car: decodedSetup.carFound })}
                </Badge>
              ) : (
                <Badge bg="warning" text="dark">
                  {t("ams2Picker.carWarn", {
                    found: decodedSetup.carFound,
                    expected: expectedCar,
                  })}
                </Badge>
              )}
            </div>

            <Form.Group className="mb-3" style={{ maxWidth: 360 }}>
              <Form.Label className="text-dim" style={{ fontSize: 13 }}>
                {t("setupCommon.nameLabel")}{" "}
                <span className="text-danger">*</span>
              </Form.Label>
              <Form.Control
                size="sm"
                type="text"
                placeholder={t("ams2Picker.namePlaceholder")}
                value={setupName}
                onChange={(e) => setSetupName(e.target.value)}
                autoFocus
              />
            </Form.Group>

            {decodedSetup.params.length > 0 && (
              <div className="picker-params">
                <Ams2SetupTabs params={decodedSetup.params} />
              </div>
            )}
          </div>
        )}
      </Modal.Body>

      <Modal.Footer className="picker-footer">
        {phase === "pick" && (
          <>
            <span className="text-secondary me-auto">
              {selected.size > 0
                ? selectedDuplicates.length > 0
                  ? t("ams2Picker.selectedDup", {
                      n: selected.size,
                      dup: selectedDuplicates.length,
                    })
                  : t("ams2Picker.selected", { n: selected.size })
                : t("ams2Picker.prompt")}
            </span>
            <Button variant="secondary" size="sm" onClick={handleClose}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={selected.size === 0}
              onClick={handleDecodeRequest}
            >
              {t("ams2Picker.decode")}
            </Button>
          </>
        )}

        {phase === "confirm-duplicates" && (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPhase("pick")}
            >
              <FontAwesomeIcon icon={faArrowLeft} className="me-1" />
              {t("ams2Picker.back")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void startDecode()}
            >
              {t("ams2Picker.proceed")}
            </Button>
          </>
        )}

        {phase === "verify" && decodedSetup && (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPhase("pick");
                setSetupName("");
              }}
            >
              <FontAwesomeIcon icon={faArrowLeft} className="me-1" />
              {t("ams2Picker.reselect")}
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
