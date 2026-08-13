import { Fragment, useEffect, useMemo, useState } from "react";
import { Badge, Button, Modal, Spinner } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
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
}

const formatDate = (iso: string): string => {
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T") + "Z";
  return new Date(normalized).toLocaleString("it-IT", {
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

const ACQUIRE: Record<GameSource, { label: string; icon: typeof faFileCode }> =
  {
    r3e: { label: "Carica da JSON", icon: faFileCode },
    ace: { label: "Seleziona file", icon: faFileCode },
    ams2: { label: "Acquisisci screenshot", icon: faCamera },
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
}: Props) => {
  const [history, setHistory] = useState<SessionSetupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState>({
    phase: "idle",
  });
  const deleteSetup = useSessionStore((s) => s.deleteSetup);

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
  }

  useEffect(() => {
    if (!show || !car || !track) return;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setLoading(true);
    window.electronAPI
      .sessionGetSetupHistory({ car, track, layout, game })
      .then((rows) => {
        const seen = new Map<string, SessionSetupRow>();
        for (const row of rows) {
          const key = row.setup.name ?? row.setup.carFound ?? String(row.id);
          if (!seen.has(key)) seen.set(key, row);
        }
        setHistory(Array.from(seen.values()));
      })
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [show, car, track, layout, game]);

  const setupById = useMemo(
    () => new Map(history.map((r) => [r.id, r])),
    [history],
  );

  const handleDelete = async (id: number): Promise<void> => {
    setDeleteState({ phase: "working", id });
    const res = await deleteSetup(id, game);
    if (res.ok) {
      setHistory((prev) => prev.filter((r) => r.id !== id));
      setDeleteState({ phase: "idle" });
    } else {
      setDeleteState({ phase: "error", id, lapCount: res.lapCount });
    }
  };

  return (
    <>
      <Modal
        show={show && !suspended}
        onHide={onClose}
        centered
        size="lg"
        className="setup-selection-modal"
      >
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: 16 }}>
            {lapCount != null
              ? `Assegna setup a ${lapCount} ${lapCount === 1 ? "giro" : "giri"}`
              : "Gestione setup"}
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          {loading ? (
            <div className="text-center py-3">
              <Spinner size="sm" className="me-2" />
              Caricamento setup precedenti…
            </div>
          ) : history.length > 0 ? (
            <>
              <p className="text-muted mb-2" style={{ fontSize: 14 }}>
                Setup già caricati per questa combinazione auto/circuito:
              </p>
              <table className="sh-table mb-3">
                <thead>
                  <tr>
                    <th>Nome setup</th>
                    <th style={{ width: 160 }}>Data caricamento</th>
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
                            {displayName(row)}
                            {row.setup.carVerified && (
                              <Badge
                                bg="success"
                                className="ms-2"
                                style={{ fontSize: 10 }}
                              >
                                <FontAwesomeIcon
                                  icon={faCheck}
                                  className="me-1"
                                />
                                verificato
                              </Badge>
                            )}
                          </td>
                          <td className="text-muted">
                            {formatDate(row.loaded_at)}
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
                                  Elimina
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteState({ phase: "idle" });
                                  }}
                                >
                                  Annulla
                                </Button>
                              </span>
                            )}
                            {isWorking && (
                              <span className="d-flex gap-1 justify-content-end">
                                <Button size="sm" variant="danger" disabled>
                                  <Spinner size="sm" />
                                </Button>
                                <Button size="sm" variant="secondary" disabled>
                                  Annulla
                                </Button>
                              </span>
                            )}
                            {!isActive && (
                              <Button
                                size="sm"
                                variant="outline-danger"
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
                              colSpan={3}
                              className="text-danger"
                              style={{
                                fontSize: 12,
                                paddingTop: 2,
                                paddingBottom: 6,
                              }}
                            >
                              Impossibile eliminare: {errorForRow.lapCount}{" "}
                              {errorForRow.lapCount === 1
                                ? "giro usa"
                                : "giri usano"}{" "}
                              questo setup
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
              Nessun setup precedente trovato per questa combinazione
              auto/circuito.
            </p>
          )}

          <Button variant="secondary" onClick={onJsonPicker} className="w-100">
            <FontAwesomeIcon icon={ACQUIRE[game].icon} className="me-2" />
            {ACQUIRE[game].label}
          </Button>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Chiudi
          </Button>
        </Modal.Footer>
      </Modal>

      <SetupDetailModal
        setupId={suspended ? null : selectedId}
        setupById={setupById}
        game={game}
        onClose={() => setSelectedId(null)}
        onUse={() => {
          const row =
            selectedId != null ? setupById.get(selectedId) : undefined;
          if (row) onReuseSetup(row);
          setSelectedId(null);
          onClose();
        }}
        onDuplicate={() => {
          const row =
            selectedId != null ? setupById.get(selectedId) : undefined;
          // Nessuna chiusura: il parent apre l'editor e ci sospende (`suspended`),
          // così annullando si torna a questo dettaglio. Chiude alla conferma.
          if (row) onDuplicateSetup(row.setup, history.map(displayName));
        }}
      />
    </>
  );
};

export default SetupSelectionModal;
