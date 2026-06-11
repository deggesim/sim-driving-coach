import { useEffect } from "react";
import { useSessionStore } from "../store/sessionStore";
import SessionPanel from "./SessionPanel";

const RealtimeAnalysis = ({
  onSessionClosed,
}: {
  onSessionClosed?: () => void;
}) => {
  const loadCurrent = useSessionStore((s) => s.loadCurrent);

  useEffect(() => {
    void loadCurrent();
  }, [loadCurrent]);

  return <SessionPanel mode="live" onSessionClosed={onSessionClosed} />;
};

export default RealtimeAnalysis;
