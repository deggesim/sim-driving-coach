import { useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";
import type { GameSource } from "../../shared/types";
import { GameBadge } from "./GameBadge";

const GAMES: { game: GameSource; label: string }[] = [
  { game: "r3e", label: "RaceRoom Racing Experience" },
  { game: "ace", label: "Assetto Corsa EVO" },
  { game: "ams2", label: "Automobilista 2" },
];

type Props = {
  show: boolean;
  onCancel: () => void;
  onConfirm: (game: GameSource) => void;
};

// Modal shown on "Nuova sessione": the user declares which sim is running.
// No live autodetect — readers stay idle until a session starts. The chosen sim
// is validated in the main process (it starts that reader on demand and waits
// for data); a "non connesso / entra in pista" error comes back via the start
// result and is surfaced by the caller.
export const GamePickerModal = ({ show, onCancel, onConfirm }: Props) => {
  const [selected, setSelected] = useState<GameSource>("r3e");

  return (
    <Modal show={show} onHide={onCancel} centered dialogClassName="game-picker-modal">
      <Modal.Header closeButton>
        <Modal.Title>Nuova sessione</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted">
          Quale simulatore stai usando? Avvialo ed entra in pista prima di
          confermare.
        </p>
        {GAMES.map(({ game, label }) => (
          <Form.Check
            key={game}
            type="radio"
            name="game-picker"
            id={`game-picker-${game}`}
            checked={selected === game}
            onChange={() => setSelected(game)}
            className="game-picker-option mb-2"
            label={
              <span className="d-inline-flex align-items-center gap-2">
                <GameBadge game={game} />
                <span>{label}</span>
              </span>
            }
          />
        ))}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>
          Annulla
        </Button>
        <Button variant="success" onClick={() => onConfirm(selected)}>
          Apri sessione
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
