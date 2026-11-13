/**
 * AceSetupPicker - modal to select a .carsetup file for ACE.
 *
 * Step 1: choose car from D:\Salvataggi\ACE\Car Setups\ subdirs.
 * Step 2: choose track from {car}\ subdirs.
 * Step 3: choose .carsetup file.
 *
 * Validation badge warns when the selected car/track doesn't match the
 * expectedCar/expectedTrack supplied by the caller (lap row or live session).
 */

import {
  faCheck,
  faGear,
  faTriangleExclamation,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Form,
  ListGroup,
  Modal,
  Spinner,
} from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { localeOf } from "../../shared/i18n";
import type { SetupData } from "../../shared/types";
import { useSettingsStore } from "../store/settingsStore";

type SetupFileEntry = {
  filename: string;
  filePath: string;
  modifiedAt: string;
};

type Props = {
  show: boolean;
  expectedCar: string;
  expectedTrack: string;
  onClose: () => void;
  onConfirm: (setup: SetupData) => void;
};

// Message kind, not text: translated at render. `raw` is a main-process message.
type PickerError = {
  key: "cars" | "tracks" | "files" | "decode";
  raw?: string;
};

const formatDate = (iso: string, locale: string): string =>
  new Date(iso).toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const AceSetupPicker = ({
  show,
  expectedCar,
  expectedTrack,
  onClose,
  onConfirm,
}: Props) => {
  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const [cars, setCars] = useState<string[]>([]);
  const [tracks, setTracks] = useState<string[]>([]);
  const [files, setFiles] = useState<SetupFileEntry[]>([]);

  const [selectedCar, setSelectedCar] = useState(expectedCar);
  const [selectedTrack, setSelectedTrack] = useState(expectedTrack);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const [loadingCars, setLoadingCars] = useState(false);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [error, setError] = useState<PickerError | null>(null);

  const initializedRef = useRef(false);

  // Load car list when modal opens
  useEffect(() => {
    if (!show || initializedRef.current) return;
    initializedRef.current = true;
    let cancelled = false;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setLoadingCars(true);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setError(null);
    window.electronAPI
      .aceListSetupCars()
      .then((list) => {
        if (cancelled) return;
        setCars(list);
        // Pre-select expectedCar if present; otherwise first item
        const pre = list.includes(expectedCar) ? expectedCar : (list[0] ?? "");
        setSelectedCar(pre);
      })
      .catch(() => {
        if (!cancelled) setError({ key: "cars" });
      })
      .finally(() => {
        if (!cancelled) setLoadingCars(false);
      });
    return () => {
      cancelled = true;
    };
  }, [show, expectedCar]);

  // Load track list when selectedCar changes
  const selectedTrackRef = useRef(selectedTrack);
  useEffect(() => {
    selectedTrackRef.current = selectedTrack;
  }, [selectedTrack]);

  useEffect(() => {
    if (!selectedCar) return;
    let cancelled = false;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setTracks([]);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setFiles([]);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setSelectedFile(null);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setLoadingTracks(true);
    window.electronAPI
      .aceListSetupTracks({ car: selectedCar })
      .then((list) => {
        if (cancelled) return;
        setTracks(list);
        const pre = list.includes(selectedTrackRef.current)
          ? selectedTrackRef.current
          : (list[0] ?? "");
        setSelectedTrack(pre);
      })
      .catch(() => {
        if (!cancelled) setError({ key: "tracks" });
      })
      .finally(() => {
        if (!cancelled) setLoadingTracks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCar]);

  // Load file list when selectedTrack changes
  useEffect(() => {
    if (!selectedCar || !selectedTrack) return;
    let cancelled = false;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setFiles([]);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setSelectedFile(null);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setLoadingFiles(true);
    window.electronAPI
      .aceListSetupFiles({ car: selectedCar, track: selectedTrack })
      .then((list) => {
        if (!cancelled) setFiles(list);
      })
      .catch(() => {
        if (!cancelled) setError({ key: "files" });
      })
      .finally(() => {
        if (!cancelled) setLoadingFiles(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCar, selectedTrack]);

  const handleClose = (): void => {
    initializedRef.current = false;
    setCars([]);
    setTracks([]);
    setFiles([]);
    setSelectedCar("");
    setSelectedTrack("");
    setSelectedFile(null);
    setError(null);
    onClose();
  };

  const handleConfirm = async (): Promise<void> => {
    if (!selectedFile) return;
    setDecoding(true);
    setError(null);
    try {
      const setup = await window.electronAPI.aceReadSetup({
        filePath: selectedFile,
      });
      const filename =
        files.find((f) => f.filePath === selectedFile)?.filename ??
        selectedFile;
      const name = filename.replace(/\.carsetup$/i, "");
      onConfirm({ ...setup, name });
      handleClose();
    } catch (err) {
      setError({
        key: "decode",
        raw: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setDecoding(false);
    }
  };

  const mismatch =
    (selectedCar && expectedCar && selectedCar !== expectedCar) ||
    (selectedTrack && expectedTrack && selectedTrack !== expectedTrack);

  return (
    <Modal
      show={show}
      onHide={handleClose}
      size="lg"
      centered
      className="ace-setup-picker-modal"
    >
      <Modal.Header closeButton>
        <Modal.Title>
          <FontAwesomeIcon icon={faGear} className="me-2" />
          {t("acePicker.title")}
        </Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {error && (
          <div className="text-danger mb-3" role="alert">
            <FontAwesomeIcon icon={faXmark} className="me-1" />
            {error.raw ?? t(`acePicker.error.${error.key}`)}
          </div>
        )}

        {/* Car / Track selectors */}
        <div className="d-flex gap-3 mb-3 align-items-end">
          <Form.Group style={{ flex: 1 }}>
            <Form.Label className="mb-1">{t("acePicker.car")}</Form.Label>
            {loadingCars ? (
              <div className="d-flex align-items-center gap-2">
                <Spinner size="sm" /> {t("acePicker.loading")}
              </div>
            ) : (
              <Form.Select
                size="sm"
                value={selectedCar}
                onChange={(e) => setSelectedCar(e.target.value)}
              >
                {cars.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Form.Select>
            )}
          </Form.Group>

          <Form.Group style={{ flex: 1 }}>
            <Form.Label className="mb-1">{t("acePicker.track")}</Form.Label>
            {loadingTracks ? (
              <div className="d-flex align-items-center gap-2">
                <Spinner size="sm" /> {t("acePicker.loading")}
              </div>
            ) : (
              <Form.Select
                size="sm"
                value={selectedTrack}
                onChange={(e) => setSelectedTrack(e.target.value)}
                disabled={tracks.length === 0}
              >
                {tracks.map((tr) => (
                  <option key={tr} value={tr}>
                    {tr}
                  </option>
                ))}
              </Form.Select>
            )}
          </Form.Group>

          {/* Validation badge */}
          <div style={{ minWidth: 140 }}>
            {mismatch ? (
              <Badge
                bg="warning"
                text="dark"
                className="d-flex align-items-center gap-1"
                style={{ fontSize: 12 }}
              >
                <FontAwesomeIcon icon={faTriangleExclamation} />
                {t("acePicker.mismatch")}
              </Badge>
            ) : selectedCar && selectedTrack ? (
              <Badge
                bg="success"
                className="d-flex align-items-center gap-1"
                style={{ fontSize: 12 }}
              >
                <FontAwesomeIcon icon={faCheck} />
                {t("acePicker.match")}
              </Badge>
            ) : null}
          </div>
        </div>

        {!loadingCars && !error && cars.length === 0 && (
          <p className="text-secondary">{t("acePicker.noCars")}</p>
        )}

        {/* File list */}
        {loadingFiles && (
          <div className="d-flex justify-content-center py-3">
            <Spinner size="sm" className="me-2" />
            <span>{t("acePicker.loadingFiles")}</span>
          </div>
        )}

        {!loadingFiles &&
          files.length === 0 &&
          selectedCar &&
          selectedTrack && (
            <div className="text-secondary text-center py-3">
              {t("acePicker.noFiles")}
              <br />
              <code>
                {selectedCar} / {selectedTrack}
              </code>
            </div>
          )}

        {!loadingFiles && files.length > 0 && (
          <ListGroup>
            {files.map((f) => (
              <ListGroup.Item
                key={f.filePath}
                action
                active={selectedFile === f.filePath}
                onClick={() => setSelectedFile(f.filePath)}
                className="d-flex justify-content-between align-items-center"
              >
                <span className="fw-medium">{f.filename}</span>
                <span className="text-secondary">
                  {formatDate(f.modifiedAt, localeOf(language))}
                </span>
              </ListGroup.Item>
            ))}
          </ListGroup>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose} disabled={decoding}>
          <FontAwesomeIcon icon={faXmark} className="me-1" />
          {t("common.cancel")}
        </Button>
        <Button
          variant="primary"
          disabled={!selectedFile || decoding}
          onClick={handleConfirm}
        >
          {decoding ? (
            <Spinner size="sm" className="me-1" />
          ) : (
            <FontAwesomeIcon icon={faCheck} className="me-1" />
          )}
          {t("acePicker.load")}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default AceSetupPicker;
