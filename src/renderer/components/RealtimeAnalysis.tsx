import { useEffect } from "react";
import type { GameSource } from "../../shared/types";
import { useSessionStore } from "../store/sessionStore";
import SessionPanel from "./SessionPanel";

const RealtimeAnalysis = ({
  onSessionClosed,
  onOpenSettings,
}: {
  onSessionClosed?: (closed: { id: number; game: GameSource }) => void;
  onOpenSettings?: () => void;
}) => {
  const loadCurrent = useSessionStore((s) => s.loadCurrent);

  useEffect(() => {
    void loadCurrent();
  }, [loadCurrent]);

  return (
    <SessionPanel
      mode="live"
      onSessionClosed={onSessionClosed}
      onOpenSettings={onOpenSettings}
    />
  );
};

export default RealtimeAnalysis;
