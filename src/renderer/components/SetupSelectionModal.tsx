import { Fragment, useEffect, useMemo, useState } from "react";
import { Badge, Button, Form, Modal, Spinner } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useTranslation } from "react-i18next";
import {
  faCamera,
  faCheck,
  faFileCode,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import type {
  GameSource,
  SessionSetupRow,
  SetupData,
} from "../../shared/types";
import { SetupDetailModal } from "./SetupDetailModal";
import { SetupNameEdit } from "./SetupNameEdit";
import { localeOf } from "../../shared/i18n";
import { rendererI18n } from "../i18n";
import { useIPCStore } from "../store/ipcStore";
import { useSettingsStore } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";

interface Props {
  show: boolean;
  car: string;
  track: string;
  layout: string;
  game: GameSource;
  /** Numero di giri a cui il setup scelto verrà assegnato; assente = flusso
   *  normale che cambia il setup in uso. Cambia solo il titolo del modal. */
  lapCount?: number;
  /** L'editor manuale è aperto sopra: nasconde questo modal e il dettaglio
   *  senza perdere il setup selezionato, così annullando l'editor si torna al
   *  dettaglio di partenza. Una sola modale a schermo per volta. */
  suspended?: boolean;
  onClose: () => void;
  onReuseSetup: (row: SessionSetupRow) => void;
  onJsonPicker: () => void;
  /** `takenNames`: i nomi già presenti in questo storico, per impedire
   *  all'editor di crearne un duplicato. */
  onDuplicateSetup: (setup: SetupData, takenNames: string[]) => void;
  /** `takenNames` esclude il nome del setup stesso, così salvare senza
   *  rinominare non viene rifiutato come duplicato. */
  onEditSetup: (row: SessionSetupRow, takenNames: string[]) => void;
}

const formatDate = (iso: string, locale: string): string => {
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T") + "Z";
  return new Date(normalized).toLocaleString(locale, {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const displayName = (row: SessionSetupRow): string =>
  row.setup.name ?? row.setup.carFound ?? `Setup #${row.id}`;

const isSameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const ACQUIRE_ICON: Record<GameSource, typeof faFileCode> = {
  r3e: faFileCode,
  ace: faFileCode,
  ams2: faCamera,
};

type DeleteState =
  | { phase: "idle" }
  | { phase: "confirm"; id: number }
  | { phase: "working"; id: number }
  | { phase: "error"; id: number; lapCount: number };

const SetupSelectionModal = ({
  show,
  car,
  track,
  layout,
  game,
  lapCount,
  suspended,
  onClose,
  onReuseSetup,
  onJsonPicker,
  onDuplicateSetup,
  onEditSetup,
}: Props) => {
  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  // Storico per la combinazione auto/circuito corrente — sempre caricato:
  // serve anche a validare i nomi quando si importa da un altro circuito.
  const [comboHistory, setComboHistory] = useState<SessionSetupRow[]>([]);
  // AMS2 only: storico per la stessa auto su tutti i circuiti, caricato solo
  // quando l'utente attiva il checkbox "tutti i circuiti".
  const [crossHistory, setCrossHistory] = useState<SessionSetupRow[]>([]);
  const [allTracks, setAllTracks] = useState(false);
  const [loading, setLoading] = useState(false);
  // A failed history load must not read as "no setups yet"; `reloadKey` re-runs the loads.
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState>({
    phase: "idle",
  });
  // Rinomina obbligatoria quando si importa un setup da un altro circuito
  // (AMS2): evita conflitti di nome con lo storico della combinazione
  // corrente. Proposta di default: il nome del setup importato.
  const [importState, setImportState] = useState<{
    row: SessionSetupRow;
    name: string;
  } | null>(null);
  const deleteSetup = useSessionStore((s) => s.deleteSetup);
  const renameSetup = useSessionStore((s) => s.renameSetup);

  // Reset the delete flow and the open detail whenever the modal opens or
  // closes. SessionPanel keeps this component mounted and only toggles `show`,
  // so it never remounts and the state has to be cleared explicitly — and the
  // detail modal lives outside `show`, so nothing else would close it. Done
  // during render (React's documented "adjust state when a prop changes"
  // pattern) rather than in the effect below: an effect would render the stale
  // phase once before clearing it.
  const [prevShow, setPrevShow] = useState(show);
  if (prevShow !== show) {
    setPrevShow(show);
    setDeleteState({ phase: "idle" });
    setSelectedId(null);
    setAllTracks(false);
    setImportState(null);
  }

  useEffect(() => {
    if (!show || !car || !track) return;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setLoading(true);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setLoadError(false);
    window.electronAPI
      .sessionGetSetupHistory({ car, track, layout, game })
      .then((rows) => {
        const seen = new Map<string, SessionSetupRow>();
        for (const row of rows) {
          const key = row.setup.name ?? row.setup.carFound ?? String(row.id);
          if (!seen.has(key)) seen.set(key, row);
        }
        setComboHistory(Array.from(seen.values()));
        // AMS2: nessuno storico per questa combinazione — cerca subito su
        // tutti i circuiti invece di richiedere il click sul checkbox, che
        // altrimenti nasconderebbe l'unico modo di importare un setup.
        if (game === "ams2" && rows.length === 0) setAllTracks(true);
      })
      .catch((e: unknown) => {
        console.error("[SetupSelectionModal] history load failed:", e);
        setComboHistory([]);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [show, car, track, layout, game, reloadKey]);

  useEffect(() => {
    if (!show || !car || !allTracks) return;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setLoading(true);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setLoadError(false);
    window.electronAPI
      .sessionGetSetupHistory({ car, game })
      .then((rows) => {
        // Chiave per circuito+nome: a differenza dello storico della singola
        // combinazione, nomi uguali su circuiti diversi sono legittimi (es.
        // un "Base" per ogni pista) e non vanno accorpati.
        const seen = new Map<string, SessionSetupRow>();
        for (const row of rows) {
          const key = `${row.track ?? ""}::${row.setup.name ?? row.setup.carFound ?? row.id}`;
          if (!seen.has(key)) seen.set(key, row);
        }
        setCrossHistory(Array.from(seen.values()));
      })
      .catch((e: unknown) => {
        console.error("[SetupSelectionModal] cross history load failed:", e);
        setCrossHistory([]);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [show, car, game, allTracks, reloadKey]);

  const history = allTracks ? crossHistory : comboHistory;

  const setupById = useMemo(
    () => new Map(history.map((r) => [r.id, r])),
    [history],
  );

  // Il nome è univoco per combinazione auto/circuito, non per auto: un nome
  // duplicato su un altro circuito (visibile solo con "tutti i circuiti") non
  // è un conflitto. `refTrack` è il circuito della riga di partenza — quello
  // della combinazione corrente per una creazione, quello della riga stessa
  // per una rinomina/modifica in-place.
  const namesTakenForTrack = (
    refTrack: string | null | undefined,
    excludeId?: number,
  ): string[] =>
    history
      .filter((r) => r.track === refTrack && r.id !== excludeId)
      .map(displayName);

  const updateRow = (
    id: number,
    fn: (row: SessionSetupRow) => SessionSetupRow,
  ): void => {
    setComboHistory((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));
    setCrossHistory((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));
  };

  const handleRename = (id: number, name: string): void => {
    const prevSetup = setupById.get(id)?.setup;
    updateRow(id, (r) => ({ ...r, setup: { ...r.setup, name } }));
    renameSetup(id, game, name).catch((e: unknown) => {
      console.error("[SetupSelectionModal] rename failed:", e);
      if (prevSetup) updateRow(id, (r) => ({ ...r, setup: prevSetup }));
      useIPCStore
        .getState()
        .setAppError(rendererI18n.t("setupSelect.renameError"));
    });
  };

  const handleDelete = async (id: number): Promise<void> => {
    setDeleteState({ phase: "working", id });
    const res = await deleteSetup(id, game);
    if (res.ok) {
      setComboHistory((prev) => prev.filter((r) => r.id !== id));
      setCrossHistory((prev) => prev.filter((r) => r.id !== id));
      setDeleteState({ phase: "idle" });
    } else {
      setDeleteState({ phase: "error", id, lapCount: res.lapCount });
    }
  };

  const importDuplicate =
    importState != null &&
    comboHistory.some((r) => isSameName(displayName(r), importState.name));

  return (
    <>
      <Modal show={show && !suspended} onHide={onClose} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: 15 }}>
            {lapCount != null
              ? t("setupSelect.assignTitle", {
                  laps: t(
                    lapCount === 1 ? "count.lap.one" : "count.lap.other",
                    { n: lapCount },
                  ),
                })
              : t("setupSelect.title")}
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          {game === "ams2" && (
            <Form.Check
              type="checkbox"
              id="setup-history-all-tracks"
              className="mb-2"
              label={t("setupSelect.allTracks")}
              checked={allTracks}
              onChange={(e) => setAllTracks(e.target.checked)}
            />
          )}
          {loading ? (
            <div className="text-center py-3">
              <Spinner size="sm" className="me-2" />
              {t("setupSelect.loading")}
            </div>
          ) : loadError ? (
            <p className="text-danger mb-3" role="alert">
              {t("setupSelect.loadError")}{" "}
              <Button
                variant="link"
                size="sm"
                className="p-0 align-baseline"
                onClick={() => setReloadKey((k) => k + 1)}
              >
                {t("setupCommon.retry")}
              </Button>
            </p>
          ) : history.length > 0 ? (
            <>
              <p className="text-muted mb-2" style={{ fontSize: 14 }}>
                {allTracks
                  ? t("setupSelect.listAll")
                  : t("setupSelect.listCombo")}
              </p>
              <table className="sh-table mb-3">
                <thead>
                  <tr>
                    <th>{t("setupSelect.colName")}</th>
                    {allTracks && (
                      <th style={{ width: 140 }}>
                        {t("setupSelect.colTrack")}
                      </th>
                    )}
                    <th style={{ width: 160 }}>{t("setupSelect.colDate")}</th>
                    <th style={{ width: 110 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => {
                    const isConfirm =
                      deleteState.phase === "confirm" &&
                      deleteState.id === row.id;
                    const isWorking =
                      deleteState.phase === "working" &&
                      deleteState.id === row.id;
                    const errorForRow =
                      deleteState.phase === "error" && deleteState.id === row.id
                        ? deleteState
                        : null;
                    const isActive = isConfirm || isWorking;
                    return (
                      <Fragment key={row.id}>
                        <tr
                          className="sh-row"
                          style={{ cursor: isActive ? "default" : "pointer" }}
                          onClick={
                            isActive ? undefined : () => setSelectedId(row.id)
                          }
                        >
                          <td>
                            <SetupNameEdit
                              name={displayName(row)}
                              takenNames={namesTakenForTrack(row.track, row.id)}
                              onRename={(name) => handleRename(row.id, name)}
                            />
                            {row.setup.carVerified && (
                              <Badge
                                bg="success"
                                className="ms-2"
                                style={{ fontSize: 11 }}
                              >
                                <FontAwesomeIcon
                                  icon={faCheck}
                                  className="me-1"
                                />
                                {t("setupSelect.verified")}
                              </Badge>
                            )}
                          </td>
                          {allTracks && (
                            <td className="text-muted">{row.track ?? "—"}</td>
                          )}
                          <td className="text-muted">
                            {formatDate(row.loaded_at, localeOf(language))}
                          </td>
                          <td
                            style={{ textAlign: "right", whiteSpace: "nowrap" }}
                          >
                            {isConfirm && (
                              <span className="d-flex gap-1 justify-content-end">
                                <Button
                                  size="sm"
                                  variant="danger"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleDelete(row.id);
                                  }}
                                >
                                  {t("common.delete")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteState({ phase: "idle" });
                                  }}
                                >
                                  {t("common.cancel")}
                                </Button>
                              </span>
                            )}
                            {isWorking && (
                              <span className="d-flex gap-1 justify-content-end">
                                <Button size="sm" variant="danger" disabled>
                                  <Spinner size="sm" />
                                </Button>
                                <Button size="sm" variant="secondary" disabled>
                                  {t("common.cancel")}
                                </Button>
                              </span>
                            )}
                            {!isActive && (
                              <Button
                                size="sm"
                                variant="outline-danger"
                                title={t("setupSelect.deleteTitle")}
                                aria-label={t("setupSelect.deleteTitle")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteState({
                                    phase: "confirm",
                                    id: row.id,
                                  });
                                }}
                              >
                                <FontAwesomeIcon icon={faTrash} />
                              </Button>
                            )}
                          </td>
                        </tr>
                        {errorForRow != null && (
                          <tr>
                            <td
                              colSpan={allTracks ? 4 : 3}
                              className="text-danger"
                              style={{
                                fontSize: 12,
                                paddingTop: 2,
                                paddingBottom: 6,
                              }}
                            >
                              {t(
                                errorForRow.lapCount === 1
                                  ? "setupSelect.blockedOne"
                                  : "setupSelect.blockedOther",
                                { n: errorForRow.lapCount },
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              <hr style={{ borderColor: "var(--border)" }} />
            </>
          ) : (
            <p className="text-muted mb-3" style={{ fontSize: 14 }}>
              {allTracks
                ? t("setupSelect.emptyAll")
                : t("setupSelect.emptyCombo")}{" "}
              {t(`setupSelect.hint.${game}`)}
            </p>
          )}

          <Button
            variant={history.length === 0 ? "primary" : "secondary"}
            onClick={onJsonPicker}
            className="w-100"
          >
            <FontAwesomeIcon icon={ACQUIRE_ICON[game]} className="me-2" />
            {t(`setupSelect.acquire.${game}`)}
          </Button>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("setupCommon.close")}
          </Button>
        </Modal.Footer>
      </Modal>

      <SetupDetailModal
        setupId={suspended || importState ? null : selectedId}
        setupById={setupById}
        game={game}
        onClose={() => setSelectedId(null)}
        takenNames={
          selectedId != null
            ? namesTakenForTrack(setupById.get(selectedId)?.track, selectedId)
            : []
        }
        onRename={(name) => {
          if (selectedId != null) handleRename(selectedId, name);
        }}
        onUse={() => {
          const row =
            selectedId != null ? setupById.get(selectedId) : undefined;
          if (!row) return;
          if (row.track != null && row.track !== track) {
            // Importazione da un altro circuito: passa dalla rinomina
            // obbligatoria invece di riusarlo direttamente.
            setImportState({ row, name: displayName(row) });
            return;
          }
          onReuseSetup(row);
          setSelectedId(null);
          onClose();
        }}
        onDuplicate={() => {
          const row =
            selectedId != null ? setupById.get(selectedId) : undefined;
          // Nessuna chiusura: il parent apre l'editor e ci sospende (`suspended`),
          // così annullando si torna a questo dettaglio. Chiude alla conferma.
          // Il nuovo setup nasce per la combinazione corrente (auto/circuito
          // di questo modal), non per quella della riga da cui è duplicato.
          if (row) onDuplicateSetup(row.setup, namesTakenForTrack(track));
        }}
        onEdit={() => {
          const row =
            selectedId != null ? setupById.get(selectedId) : undefined;
          if (row) onEditSetup(row, namesTakenForTrack(row.track, row.id));
        }}
      />

      {importState && (
        <Modal
          show={!suspended}
          onHide={() => setImportState(null)}
          centered
          className="setup-import-modal"
        >
          <Modal.Header closeButton>
            <Modal.Title style={{ fontSize: 15 }}>
              {t("setupSelect.importTitle", {
                track: importState.row.track ?? t("setupSelect.otherTrack"),
              })}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p className="text-muted" style={{ fontSize: 14 }}>
              {t("setupSelect.importHint")}
            </p>
            <Form.Group>
              <Form.Label className="text-muted" style={{ fontSize: 14 }}>
                {t("setupCommon.nameLabel")}{" "}
                <span className="text-danger">*</span>
              </Form.Label>
              <Form.Control
                size="sm"
                type="text"
                value={importState.name}
                onChange={(e) =>
                  setImportState((s) => s && { ...s, name: e.target.value })
                }
                autoFocus
              />
              {importDuplicate && (
                <Form.Text className="text-danger">
                  {t("setupCommon.nameTaken")}
                </Form.Text>
              )}
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setImportState(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!importState.name.trim() || importDuplicate}
              onClick={() => {
                const { row, name } = importState;
                onReuseSetup({
                  ...row,
                  setup: { ...row.setup, name: name.trim() },
                });
                setImportState(null);
                setSelectedId(null);
                onClose();
              }}
            >
              <FontAwesomeIcon icon={faCheck} className="me-1" />
              {t("setupSelect.import")}
            </Button>
          </Modal.Footer>
        </Modal>
      )}
    </>
  );
};

export default SetupSelectionModal;
