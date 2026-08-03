import { faTrash } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { marked } from "marked";
import {
  startTransition,
  use,
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Accordion,
  AccordionContext,
  Button,
  Modal,
  Spinner,
  useAccordionButton,
} from "react-bootstrap";
import { useSessionStore } from "../store/sessionStore";
import AnalysisCommentControls from "./AnalysisCommentControls";

type WorkingVersion = { sessionId: number; version: number };
type PendingDelete = { id: number; version: number } | null;

const AnalysisAccordionHeader = ({
  eventKey,
  analysisId,
  version,
  createdAt,
  onDelete,
}: {
  eventKey: string;
  analysisId: number;
  version: number;
  createdAt: string;
  onDelete: (e: React.MouseEvent) => void;
}) => {
  const { activeEventKey } = use(AccordionContext);
  const handleToggle = useAccordionButton(eventKey);
  const isOpen = Array.isArray(activeEventKey)
    ? activeEventKey.includes(eventKey)
    : activeEventKey === eventKey;

  return (
    <h2 className="accordion-header dark-header d-flex align-items-stretch">
      <AnalysisCommentControls analysisId={analysisId} />
      <Button
        type="button"
        variant="danger"
        size="sm"
        className="p-0 px-3 rounded-0"
        title="Elimina analisi"
        onClick={onDelete}
      >
        <FontAwesomeIcon icon={faTrash} />
      </Button>
      <button
        type="button"
        className={`accordion-button flex-grow-1${isOpen ? "" : " collapsed"}`}
        onClick={handleToggle}
      >
        <span className="flex-grow-1">
          Analisi #{version}
          <span className="ms-2">
            {new Date(createdAt).toLocaleString("it-IT")}
          </span>
        </span>
      </button>
    </h2>
  );
};

/** Level-2 trigger. `blocked` non-null disables it and states why. */
const ExpandButton = ({
  blocked,
  onExpand,
}: {
  blocked: string | null;
  onExpand: () => void;
}) => (
  <>
    <Button
      variant="outline-light"
      size="sm"
      className="mt-2"
      disabled={blocked !== null}
      onClick={onExpand}
    >
      Mostra analisi approfondita
    </Button>
    {blocked && <div className="analysis-detail-blocked mt-1">{blocked}</div>}
  </>
);

type Props = {
  workingVersion: WorkingVersion | null;
  startClosed?: boolean;
};

const renderMd = (md: string): string =>
  marked.parse(md, { async: false }) as string;

const AnalysisList = ({ workingVersion, startClosed = false }: Props) => {
  const analyses = useSessionStore((s) => s.analyses);
  const deleteAnalysis = useSessionStore((s) => s.deleteAnalysis);
  const expandAnalysis = useSessionStore((s) => s.expandAnalysis);

  const renderedAnalyses = useMemo(
    () => analyses.map((a) => ({ id: a.id, html: renderMd(a.synthesis) })),
    [analyses],
  );
  const renderedById = useMemo(
    () => new Map(renderedAnalyses.map((r) => [r.id, r.html])),
    [renderedAnalyses],
  );
  const renderedDetailById = useMemo(
    () =>
      new Map(
        analyses
          .filter((a) => a.detail)
          .map((a) => [a.id, renderMd(a.detail!)]),
      ),
    [analyses],
  );

  // Both levels signal work on the same (sessionId, version) key, but they mean
  // different things: a NEW version is a Level-1 analysis and gets its own
  // placeholder item, while a version already in the list is a Level-2 expand
  // and must show its spinner inside that item's body instead of duplicating
  // its header.
  const expandingVersion = useMemo(
    () =>
      workingVersion &&
      analyses.some((a) => a.version === workingVersion.version)
        ? workingVersion.version
        : null,
    [workingVersion, analyses],
  );

  // User-controlled open key (persisted across working transitions).
  // The in-flight key is NOT stored here - it's computed at render time (see effectiveActiveKey).
  const [userActiveKey, setUserActiveKey] = useState<string | null>(() => {
    if (startClosed || analyses.length === 0) return null;
    return `v${analyses[analyses.length - 1].version}`;
  });

  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);

  // Track the last known in-flight version number so we know which completed
  // accordion panel to open when the analysis finishes.
  const lastWorkingVersionRef = useRef<number | null>(
    workingVersion?.version ?? null,
  );

  // When work transitions from active → null, open the completed panel.
  // We only need to track the version number (no analyses array comparison needed).
  useEffect(() => {
    const prev = lastWorkingVersionRef.current;
    lastWorkingVersionRef.current = workingVersion?.version ?? null;

    if (workingVersion !== null || prev === null) return;

    // Version `prev` just finished - open its completed accordion key.
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setUserActiveKey(`v${prev}`);
  }, [workingVersion]);

  // Merge user-controlled key with the in-flight key (derived, never stored in state).
  // The working panel takes priority while active; otherwise use the user-selected key.
  const effectiveActiveKey = useMemo<string | null>(() => {
    if (!workingVersion) return userActiveKey;
    // An expand must keep the existing item open: forcing the placeholder key
    // here would collapse the very panel the deep-dive lands in.
    if (expandingVersion !== null) return `v${expandingVersion}`;
    return `working-${workingVersion.version}`;
  }, [userActiveKey, workingVersion, expandingVersion]);

  // useActionState for delete: manages async lifecycle (pending state for free)
  // and keeps the action co-located with the confirmation UI.
  const [, deleteAction, isDeleting] = useActionState(
    async (_prev: null, payload: PendingDelete): Promise<null> => {
      if (!payload) return null;
      await deleteAnalysis(payload.id);
      setUserActiveKey((k) => (k === `v${payload.version}` ? null : k));
      return null;
    },
    null,
  );

  const handleDeleteClick = (
    e: React.MouseEvent,
    id: number,
    version: number,
  ) => {
    e.stopPropagation();
    setPendingDelete({ id, version });
  };

  const handleDeleteConfirm = () => {
    const payload = pendingDelete;
    setPendingDelete(null);
    startTransition(() => {
      deleteAction(payload);
    });
  };

  const handleSelect = (key: string | string[] | null | undefined) => {
    const k = Array.isArray(key) ? (key[0] ?? null) : (key ?? null);
    setUserActiveKey(k);
  };

  return (
    <>
      <Accordion
        activeKey={effectiveActiveKey}
        onSelect={handleSelect}
        className="analysis-accordion"
      >
        {analyses.map((a) => (
          <Accordion.Item key={a.id} eventKey={`v${a.version}`}>
            <AnalysisAccordionHeader
              eventKey={`v${a.version}`}
              analysisId={a.id}
              version={a.version}
              createdAt={a.created_at}
              onDelete={(e) => handleDeleteClick(e, a.id, a.version)}
            />
            <Accordion.Body className="overflow-y-auto">
              <div
                className="deb-content"
                // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
                dangerouslySetInnerHTML={{
                  __html: renderedById.get(a.id) ?? "",
                }}
              />
              {renderedDetailById.has(a.id) ? (
                // No wrapper label: the deep-dive text opens with its own
                // "## Analisi approfondita" heading, so any label here duplicates it.
                <div
                  className="analysis-detail deb-content"
                  // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
                  dangerouslySetInnerHTML={{
                    __html: renderedDetailById.get(a.id) ?? "",
                  }}
                />
              ) : expandingVersion === a.version ? (
                <div className="analysis-detail analysis-detail-label">
                  <Spinner size="sm" className="me-2" />
                  Analisi approfondita in corso…
                </div>
              ) : (
                <ExpandButton
                  // Negative ids are mockHistoryMode rows: they exist only in
                  // mockData.ts, so the IPC handler's lookup would fail with
                  // "Analisi non trovata." The store keeps a single in-flight
                  // slot, so a second concurrent expand would overwrite the one
                  // in flight. Both reasons are shown, not just enforced —
                  // Bootstrap sets pointer-events:none on a disabled .btn, so a
                  // title tooltip would never appear.
                  blocked={
                    a.id < 0
                      ? "Non disponibile in mock mode: questa analisi non esiste nel database."
                      : workingVersion !== null
                        ? "Attendi il completamento dell'analisi in corso."
                        : null
                  }
                  onExpand={() => expandAnalysis(a.id)}
                />
              )}
              {a.comments.length > 0 && (
                <div className="analysis-comments">
                  {a.comments.map((c) => (
                    <div key={c.created_at} className="analysis-comment">
                      <div className="analysis-comment-label">Commento</div>
                      <div className="analysis-comment-text">{c.comment}</div>
                      <div
                        className="analysis-comment-response deb-content"
                        // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
                        dangerouslySetInnerHTML={{
                          __html: renderMd(c.response),
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </Accordion.Body>
          </Accordion.Item>
        ))}
        {workingVersion && expandingVersion === null && (
          <Accordion.Item eventKey={`working-${workingVersion.version}`}>
            <Accordion.Header>
              <Spinner size="sm" className="me-2" />
              Analisi #{workingVersion.version} (in corso…)
            </Accordion.Header>
            <Accordion.Body className="overflow-y-auto">
              <div style={{ color: "var(--text-dim)" }}>
                Elaborazione in corso…
              </div>
            </Accordion.Body>
          </Accordion.Item>
        )}
      </Accordion>

      <Modal
        show={pendingDelete !== null}
        onHide={() => setPendingDelete(null)}
        centered
        className="delete-confirm-modal"
      >
        <Modal.Header closeButton>
          <Modal.Title>Elimina analisi</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Eliminare l&apos;analisi #{pendingDelete?.version}? L&apos;operazione
          è irreversibile.
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setPendingDelete(null)}
            disabled={isDeleting}
          >
            Annulla
          </Button>
          <Button
            variant="danger"
            onClick={handleDeleteConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? <Spinner size="sm" className="me-1" /> : null}
            Elimina
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default AnalysisList;
