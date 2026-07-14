import { useEffect, useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";
import type { GameSource } from "../../shared/types";
import { useIPCStore } from "../store/ipcStore";
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
// Connection state comes from the live status (frame-recency) in ipcStore.
export const GamePickerModal = ({ show, onCancel, onConfirm }: Props) => {
  const status = useIPCStore((s) => s.status);
  const isLive = (g: GameSource): boolean =>
    g === "r3e"
      ? status.r3eConnected
      : g === "ace"
        ? status.aceConnected
        : status.ams2Connected;

  const [selected, setSelected] = useState<GameSource>("r3e");

  // On open, preselect the single live sim (or the currently-active one).
  useEffect(() => {
    if (!show) return;
    const live = GAMES.map((g) => g.game).filter(isLive);
    const next =
      live.length === 1
        ? live[0]
        : isLive(status.game)
          ? status.game
          : (live[0] ?? "r3e");
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setSelected(next);
    // Only recompute the default when the modal (re)opens.
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [show]);

  const selectedLive = isLive(selected);

  return (
    <Modal show={show} onHide={onCancel} centered>
      <Modal.Header closeButton>
        <Modal.Title>Nuova sessione</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted">Quale simulatore stai usando?</p>
        {GAMES.map(({ game, label }) => {
          const live = isLive(game);
          return (
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
                  <span className={live ? "text-success small" : "text-muted small"}>
                    · {live ? "attivo" : "non attivo"}
                  </span>
                </span>
              }
            />
          );
        })}
        {!selectedLive && (
          <p className="text-warning small mb-0">
            Il simulatore selezionato non risulta attivo. Avvialo ed entra in
            pista.
          </p>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>
          Annulla
        </Button>
        <Button
          variant="success"
          onClick={() => onConfirm(selected)}
          disabled={!selectedLive}
        >
          Apri sessione
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
