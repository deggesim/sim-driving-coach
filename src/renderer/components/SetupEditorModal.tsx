/**
 * SetupEditorModal — crea un nuovo setup partendo da uno esistente, modificando
 * i valori a mano. I valori di SetupParam sono stringhe libere ("24.5 kPa",
 * "58/42%", "Soft"): l'editor non parsa né valida nulla, quello che scrivi è
 * quello che finisce nel setup.
 */

import { faCheck, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";
import type { SetupData, SetupParam } from "../../shared/types";

type Props = {
  base: SetupData;
  onClose: () => void;
  onConfirm: (setup: SetupData) => void;
};

export const SetupEditorModal = ({ base, onClose, onConfirm }: Props) => {
  const [name, setName] = useState("");
  const [params, setParams] = useState<SetupParam[]>(() =>
    base.params.map((p) => ({ ...p })),
  );

  const setValue = (index: number, value: string): void =>
    setParams((prev) =>
      prev.map((p, i) => (i === index ? { ...p, value } : p)),
    );

  // ponytail: raggruppamento O(n²) su qualche decina di parametri, una Map non
  // si ripaga. L'ordine delle categorie segue quello di apparizione.
  const groups = [...new Set(params.map((p) => p.category))].map(
    (category) => ({
      category,
      items: params
        .map((p, index) => ({ p, index }))
        .filter((e) => e.p.category === category),
    }),
  );

  const handleConfirm = (): void => {
    if (!name.trim()) return;
    onConfirm({
      name: name.trim(),
      carVerified: true,
      carFound: base.carFound,
      setupText: base.setupText,
      params,
      // Il setup manuale non deve marcare come "già scansionati" gli screenshot
      // del setup di origine.
      screenshots: [],
    });
  };

  return (
    <Modal show onHide={onClose} size="xl" className="screenshot-picker-modal">
      <Modal.Header className="picker-header">
        <Modal.Title className="picker-title">
          Crea setup da esistente
          <span className="picker-subtitle">
            {" "}
            · {base.name ?? base.carFound}
          </span>
        </Modal.Title>
        <Button variant="link" className="picker-close" onClick={onClose}>
          <FontAwesomeIcon icon={faXmark} />
        </Button>
      </Modal.Header>

      <Modal.Body className="picker-body">
        <Form.Group className="mb-3" style={{ maxWidth: 360 }}>
          <Form.Label className="text-muted" style={{ fontSize: 14 }}>
            Nome setup <span className="text-danger">*</span>
          </Form.Label>
          <Form.Control
            size="sm"
            type="text"
            placeholder="es. Qualifica Interlagos rev2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Form.Group>

        <div className="picker-params">
          {groups.map((g) => (
            <div key={g.category} className="setup-editor-section">
              <div className="setup-subsection-title">{g.category}</div>
              {g.items.map(({ p, index }) => (
                <div
                  key={`${p.category}|${p.parameter}`}
                  className="setup-editor-row"
                >
                  <span className="text-muted">{p.parameter}</span>
                  <Form.Control
                    size="sm"
                    type="text"
                    value={p.value}
                    onChange={(e) => setValue(index, e.target.value)}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </Modal.Body>

      <Modal.Footer className="picker-footer">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Annulla
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={!name.trim()}
          onClick={handleConfirm}
        >
          <FontAwesomeIcon icon={faCheck} className="me-1" />
          Salva setup
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
