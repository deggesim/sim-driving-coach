import {
  faCheck,
  faChevronRight,
  faEye,
  faEyeSlash,
  faGear,
  faPen,
  faTrash,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Fragment, useEffect, useState } from "react";
import { Badge, Button, Form, Modal, Table } from "react-bootstrap";
import { formatLapTime } from "../../shared/format";
import type { LapRow, SessionSetupRow } from "../../shared/types";
import { useSessionStore } from "../store/sessionStore";
import LapTelemetryCharts from "./LapTelemetryCharts";

const buildPageWindow = (current: number, total: number): (number | "…")[] => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "…")[] = [];
  const addPage = (n: number) => {
    if (pages[pages.length - 1] !== n) pages.push(n);
  };
  addPage(1);
  if (current > 3) pages.push("…");
  for (
    let p = Math.max(2, current - 1);
    p <= Math.min(total - 1, current + 1);
    p++
  )
    addPage(p);
  if (current < total - 2) pages.push("…");
  addPage(total);
  return pages;
};

const PAGE_SIZE = 5;

// Renderer-side cell text: drops the "s" suffix and unifies the placeholder so
// "m:ss.mmm" and "ss.mmm" end on the same decimal column (right-aligned mono).
const lapTimeText = (seconds: number | null): string => {
  const t = formatLapTime(seconds);
  return t === "--:--" ? "—" : t.replace(/s$/, "");
};

type LapsTableProps = {
  setupById: Map<number, SessionSetupRow>;
  live?: boolean;
  onPickSetup?: (lap: LapRow) => void;
  onAssignSetup?: (lapIds: number[]) => void;
};

const LapsTable = ({
  setupById,
  live = false,
  onPickSetup,
  onAssignSetup,
}: LapsTableProps) => {
  const laps = useSessionStore((s) => s.laps);
  const deleteLap = useSessionStore((s) => s.deleteLap);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hideInvalid, setHideInvalid] = useState(true);
  const [trackedLapCount, setTrackedLapCount] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());

  const parseLocalDate = (s: string) =>
    new Date(s.includes("T") ? s : s.replace(" ", "T"));

  const sortedLaps = live
    ? laps
    : [...laps].sort(
        (a, b) =>
          parseLocalDate(a.recorded_at).getTime() -
          parseLocalDate(b.recorded_at).getTime(),
      );
  const visibleLaps = hideInvalid
    ? sortedLaps.filter((l) => l.valid)
    : sortedLaps;
  const pageCount = Math.max(1, Math.ceil(visibleLaps.length / PAGE_SIZE));

  // La selezione effettiva è l'intersezione con i giri visibili: così filtro
  // validi ed eliminazione di un giro la ripuliscono da soli, senza effetti né
  // reset espliciti. Il cambio sessione invece non basta intercettarlo qui (gli
  // id dei giri sono per gioco e possono coincidere): lo copre la `key` che il
  // parent passa al componente, che lo rimonta da zero. Persiste al cambio
  // pagina, che è esattamente il caso d'uso dell'assegnazione in blocco.
  // ponytail: O(n²) su qualche decina di giri
  const selectedIds = visibleLaps
    .filter((l) => selected.has(l.id))
    .map((l) => l.id);
  const allSelected =
    visibleLaps.length > 0 && selectedIds.length === visibleLaps.length;

  const toggleSelected = (id: number): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = (): void =>
    setSelected(
      allSelected ? new Set() : new Set(visibleLaps.map((l) => l.id)),
    );

  const bestLapId = laps.reduce<number | null>((best, l) => {
    if (!l.valid || l.lap_time == null) return best;
    if (best === null) return l.id;
    const bestLap = laps.find((x) => x.id === best);
    return bestLap && l.lap_time < bestLap.lap_time ? l.id : best;
  }, null);

  // Auto-advance to last page when new laps arrive (live session only).
  useEffect(() => {
    if (!live || visibleLaps.length <= trackedLapCount) return;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setTrackedLapCount(visibleLaps.length);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setPage(pageCount);
  }, [live, visibleLaps.length, trackedLapCount, pageCount]);

  // Close expanded row when changing page.
  const goToPage = (p: number) => {
    setPage(p);
    setExpandedId(null);
    setConfirmDeleteId(null);
    setShowDeleteModal(false);
  };

  const toggleHideInvalid = () => {
    setHideInvalid((v) => !v);
    setPage(1);
    setExpandedId(null);
    setConfirmDeleteId(null);
    setShowDeleteModal(false);
  };

  const handleDeleteClick = (e: React.MouseEvent, lapId: number) => {
    e.stopPropagation();
    setConfirmDeleteId(lapId);
    setDeleteError(null);
    setShowDeleteModal(true);
    setExpandedId(null);
  };

  const handleDeleteConfirm = async () => {
    if (confirmDeleteId === null) return;
    try {
      await deleteLap(confirmDeleteId);
    } catch (err) {
      console.error("[LapsTable] deleteLap failed:", err);
      setDeleteError("Impossibile eliminare il giro. Riprova.");
      return;
    }
    setShowDeleteModal(false);
    setConfirmDeleteId(null);
  };

  const handleDeleteCancel = () => {
    setShowDeleteModal(false);
    setConfirmDeleteId(null);
  };

  const pageLaps = visibleLaps.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggle = (id: number, valid: boolean) => {
    if (!valid) return;
    setExpandedId((cur) => (cur === id ? null : id));
  };

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-1">
        <h6 className="text-uppercase mb-1">Giri</h6>
        <div className="d-flex gap-2">
          {selectedIds.length > 0 && (
            <Button
              variant="primary"
              onClick={() => {
                onAssignSetup?.(selectedIds);
                setSelected(new Set());
              }}
              size="sm"
            >
              <FontAwesomeIcon icon={faGear} className="me-1" />
              Assegna setup ({selectedIds.length})
            </Button>
          )}
          {laps.length > 0 && (
            <Button variant="secondary" onClick={toggleHideInvalid} size="sm">
              <FontAwesomeIcon
                icon={hideInvalid ? faEye : faEyeSlash}
                className="me-1"
              />
              {hideInvalid ? "Mostra non validi" : "Nascondi non validi"}
            </Button>
          )}
        </div>
      </div>

      <Table
        striped
        size="sm"
        variant="dark"
        className="align-middle laps-table mb-1"
      >
        <thead>
          <tr>
            <th className="laps-select-cell">
              <Form.Check.Input
                type="checkbox"
                checked={allSelected}
                ref={(el: HTMLInputElement | null) => {
                  if (el)
                    el.indeterminate =
                      selectedIds.length > 0 &&
                      selectedIds.length < visibleLaps.length;
                }}
                onChange={toggleAll}
                title="Seleziona tutti i giri visibili"
                aria-label="Seleziona tutti i giri"
              />
            </th>
            <th className="col-icon"></th>
            <th>#</th>
            <th className="laps-time">Tempo</th>
            <th className="laps-time">S1</th>
            <th className="laps-time">S2</th>
            <th className="laps-time">S3</th>
            <th>Valido</th>
            <th>Setup</th>
            <th>Data</th>
            <th className="col-actions"></th>
          </tr>
        </thead>
        <tbody>
          {laps.length === 0 && (
            <tr>
              <td colSpan={11} className="text-center text-muted">
                {live
                  ? "Nessun giro. Compaiono qui a ogni passaggio sul traguardo."
                  : "Nessun giro registrato in questa sessione."}
              </td>
            </tr>
          )}
          {laps.length > 0 && visibleLaps.length === 0 && (
            <tr>
              <td colSpan={11} className="text-center text-muted">
                Tutti i giri sono non validi: mostrali con «Mostra non validi».
              </td>
            </tr>
          )}
          {pageLaps.map((l) => {
            const expanded = expandedId === l.id;
            const clickable = !!l.valid;
            const isBest = l.id === bestLapId;
            const iconCellClass = isBest ? "laps-cell-best" : "laps-cell-dim";
            const dataCellClass = isBest ? "laps-cell-best" : "";
            return (
              <Fragment key={l.id}>
                <tr
                  onClick={() => toggle(l.id, l.valid)}
                  tabIndex={clickable ? 0 : undefined}
                  aria-expanded={clickable ? expanded : undefined}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    toggle(l.id, l.valid);
                  }}
                  className={[
                    clickable ? "laps-row-clickable" : "",
                    expanded ? "laps-row-expanded" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  title={clickable ? "Mostra telemetria" : "Giro non valido"}
                >
                  <td
                    className="laps-select-cell"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Form.Check.Input
                      type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={() => toggleSelected(l.id)}
                      title="Seleziona giro"
                      aria-label={`Seleziona giro ${l.lap_number}`}
                    />
                  </td>
                  <td className={iconCellClass}>
                    {clickable && (
                      <FontAwesomeIcon
                        icon={faChevronRight}
                        className={`laps-chevron${expanded ? " open" : ""}`}
                      />
                    )}
                  </td>
                  <td className={dataCellClass}>
                    {l.lap_number}
                    {isBest && (
                      <span className="visually-hidden"> (miglior giro)</span>
                    )}
                  </td>
                  <td className={`laps-time ${dataCellClass}`}>
                    {lapTimeText(l.lap_time)}
                  </td>
                  <td className={`laps-time ${dataCellClass}`}>
                    {lapTimeText(l.sector1)}
                  </td>
                  <td className={`laps-time ${dataCellClass}`}>
                    {lapTimeText(l.sector2)}
                  </td>
                  <td className={`laps-time ${dataCellClass}`}>
                    {lapTimeText(l.sector3)}
                  </td>
                  <td>
                    {l.valid ? (
                      <FontAwesomeIcon
                        icon={faCheck}
                        className="text-success"
                      />
                    ) : (
                      <FontAwesomeIcon icon={faXmark} className="text-danger" />
                    )}
                    <span className="visually-hidden">
                      {l.valid ? "Giro valido" : "Giro non valido"}
                    </span>
                  </td>
                  <td>
                    {l.setup_id != null && setupById.has(l.setup_id) ? (
                      <Badge
                        bg="info"
                        as="button"
                        className="laps-setup-badge"
                        title="Cambia setup"
                        aria-label={`Cambia setup: ${setupById.get(l.setup_id)!.setup.name ?? `#${l.setup_id}`}`}
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          onPickSetup?.(l);
                        }}
                      >
                        {setupById.get(l.setup_id)!.setup.name ??
                          `#${l.setup_id}`}
                      </Badge>
                    ) : (
                      <Button
                        variant="link"
                        size="sm"
                        className="text-muted p-0 laps-setup-edit-btn"
                        title="Modifica setup del giro"
                        aria-label="Modifica setup del giro"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPickSetup?.(l);
                        }}
                      >
                        <FontAwesomeIcon
                          icon={faPen}
                          className="laps-pen-icon"
                        />
                      </Button>
                    )}
                  </td>
                  <td className={dataCellClass}>
                    {parseLocalDate(l.recorded_at).toLocaleString("it-IT")}
                  </td>
                  <td
                    onClick={(e) => e.stopPropagation()}
                    className="laps-td-actions"
                  >
                    <Button
                      variant="link"
                      size="sm"
                      className="text-danger"
                      title="Elimina giro"
                      aria-label={`Elimina giro ${l.lap_number}`}
                      onClick={(e) => handleDeleteClick(e, l.id)}
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </Button>
                  </td>
                </tr>
                <tr className="lap-telemetry-row">
                  <td colSpan={11} className="laps-td-telemetry">
                    <div
                      className={`lap-telemetry-wrapper${expanded ? " open" : ""}`}
                      aria-hidden={!expanded}
                    >
                      <div className="lap-telemetry-inner">
                        {expanded && <LapTelemetryCharts lap={l} />}
                      </div>
                    </div>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </Table>

      <Modal
        show={showDeleteModal}
        onHide={handleDeleteCancel}
        centered
        size="sm"
        className="delete-confirm-modal"
      >
        <Modal.Header closeButton>
          <Modal.Title className="laps-modal-title">
            Conferma eliminazione
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-0">
            Stai per eliminare il giro{" "}
            <strong>
              #
              {confirmDeleteId !== null
                ? (laps.find((l) => l.id === confirmDeleteId)?.lap_number ??
                  "—")
                : "—"}
            </strong>
            .
            <br />
            <span className="text-danger">L'operazione è irreversibile.</span>
          </p>
          {deleteError && (
            <p className="text-danger mt-2 mb-0" role="alert">
              {deleteError}
            </p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={handleDeleteCancel}>
            Annulla
          </Button>
          <Button variant="danger" size="sm" onClick={handleDeleteConfirm}>
            Elimina
          </Button>
        </Modal.Footer>
      </Modal>

      <div className="sh-pagination d-flex align-items-center gap-2 px-0 py-1">
        <span className="sh-page-count text-secondary laps-page-count">
          {visibleLaps.length === 0
            ? "0 giri"
            : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, visibleLaps.length)} di ${visibleLaps.length}`}
        </span>
        {pageCount > 1 && (
          <>
            <Button
              variant="link"
              size="sm"
              className="sh-page-btn ms-auto"
              disabled={page === 1}
              onClick={() => goToPage(page - 1)}
            >
              ‹ Prec
            </Button>
            <div className="d-flex gap-1">
              {buildPageWindow(page, pageCount).map((entry, i, arr) =>
                entry === "…" ? (
                  <span
                    key={`ellipsis-${arr[i - 1] ?? 0}-${arr[i + 1] ?? 0}`}
                    className="sh-page-ellipsis"
                  >
                    …
                  </span>
                ) : (
                  <Button
                    key={entry}
                    className={`sh-page-num ${entry === page ? "active" : ""}`}
                    onClick={() => goToPage(entry as number)}
                    variant="link"
                  >
                    {entry}
                  </Button>
                ),
              )}
            </div>
            <Button
              variant="link"
              size="sm"
              className="sh-page-btn"
              disabled={page === pageCount}
              onClick={() => goToPage(page + 1)}
            >
              Succ ›
            </Button>
          </>
        )}
      </div>
    </>
  );
};

export default LapsTable;
