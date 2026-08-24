import { Button, Modal } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faCopy, faPen } from "@fortawesome/free-solid-svg-icons";
import type { GameSource, SessionSetupRow } from "../../shared/types";
import AceSetupTabs from "./AceSetupTabs";
import Ams2SetupTabs from "./Ams2SetupTabs";
import R3eSetupTabs from "./R3eSetupTabs";
import { SetupNameEdit } from "./SetupNameEdit";

export type SetupDetailModalProps = {
  setupId: number | null;
  setupById: Map<number, SessionSetupRow>;
  game?: GameSource;
  onClose: () => void;
  onUse?: () => void;
  onDuplicate?: () => void;
  onEdit?: () => void;
  /** Presente = il titolo diventa rinominabile. `takenNames` sono i nomi già
   *  in uso nello storico. */
  onRename?: (name: string) => void;
  takenNames?: string[];
};

export const SetupDetailModal = ({
  setupId,
  setupById,
  game,
  onClose,
  onUse,
  onDuplicate,
  onEdit,
  onRename,
  takenNames,
}: SetupDetailModalProps) => {
  if (setupId == null) return null;

  const row = setupById.get(setupId);
  if (!row) return null;

  const name = row.setup.name ?? `Setup #${setupId}`;

  return (
    <Modal
      show
      onHide={onClose}
      size="lg"
      dialogClassName="setup-detail-modal"
      centered
      contentClassName="setup-detail-content"
    >
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: 15 }}>
          {onRename ? (
            <SetupNameEdit
              name={name}
              takenNames={takenNames ?? []}
              onRename={onRename}
            />
          ) : (
            name
          )}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="setup-detail-body">
        {row.setup.params.length > 0 ? (
          game === "ace" ? (
            <AceSetupTabs params={row.setup.params} />
          ) : game === "ams2" ? (
            <Ams2SetupTabs params={row.setup.params} />
          ) : (
            <R3eSetupTabs params={row.setup.params} />
          )
        ) : (
          <p className="text-muted mb-0">Nessun parametro disponibile.</p>
        )}
      </Modal.Body>
      {(onUse || onDuplicate || onEdit) && (
        <Modal.Footer>
          {onEdit && (
            <Button size="sm" variant="secondary" onClick={onEdit}>
              <FontAwesomeIcon icon={faPen} className="me-1" />
              Modifica setup
            </Button>
          )}
          {onDuplicate && (
            <Button size="sm" variant="secondary" onClick={onDuplicate}>
              <FontAwesomeIcon icon={faCopy} className="me-1" />
              Crea setup da esistente
            </Button>
          )}
          {onUse && (
            <Button size="sm" variant="primary" onClick={onUse}>
              <FontAwesomeIcon icon={faCheck} className="me-1" />
              Usa questo setup
            </Button>
          )}
        </Modal.Footer>
      )}
    </Modal>
  );
};
