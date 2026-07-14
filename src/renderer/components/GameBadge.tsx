import type { CSSProperties } from "react";
import { Badge } from "react-bootstrap";
import type { GameSource } from "../../shared/types";

const LABELS: Record<GameSource, string> = {
  r3e: "R3E",
  ace: "ACE",
  ams2: "AMS2",
};

type Props = {
  game: GameSource;
  className?: string;
  style?: CSSProperties;
};

// Game-identity badge with the per-game colours (see .game-badge--* in global.css).
export const GameBadge = ({ game, className, style }: Props) => (
  <Badge
    bg="secondary"
    className={`game-badge game-badge--${game}${className ? ` ${className}` : ""}`}
    style={style}
  >
    {LABELS[game]}
  </Badge>
);
