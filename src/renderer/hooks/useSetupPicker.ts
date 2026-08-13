import { useMemo, useState } from "react";
import type { SessionSetupRow, SetupData } from "../../shared/types";
import { useSessionStore } from "../store/sessionStore";

type Options = {
  showFlash: (variant: string, text: string) => void;
  /** When true, passes sessionId+game explicitly to sessionLoadSetup (used in SessionDetail) */
  explicit?: boolean;
};

const lapsLabel = (n: number): string => `${n} ${n === 1 ? "giro" : "giri"}`;

export const useSetupPicker = ({ showFlash, explicit }: Options) => {
  const session = useSessionStore((s) => s.session);
  const laps = useSessionStore((s) => s.laps);
  const setups = useSessionStore((s) => s.setups);
  const assignLapSetup = useSessionStore((s) => s.assignLapSetup);
  const setActiveSetup = useSessionStore((s) => s.setActiveSetup);
  const [showPicker, setShowPicker] = useState(false);
  const [showSetupSelection, setShowSetupSelection] = useState(false);
  /** Giri a cui assegnare il setup scelto dal modal; null = modal chiuso. */
  const [pickerLapIds, setPickerLapIds] = useState<number[] | null>(null);
  /** Giri in attesa del setup che sta per essere creato dal picker/editor. */
  const [pendingLapIds, setPendingLapIds] = useState<number[] | null>(null);
  /** Setup di partenza dell'editor manuale, con i nomi già in uso nello storico
   *  da cui e' stato aperto; null = editor chiuso. */
  const [editorBase, setEditorBase] = useState<{
    setup: SetupData;
    takenNames: string[];
  } | null>(null);

  const setupById = useMemo(() => {
    const m = new Map<number, SessionSetupRow>();
    setups.forEach((s) => m.set(s.id, s));
    return m;
  }, [setups]);

  /** Solo i giri ancora presenti nella sessione corrente: la lista puo' essere
   *  sopravvissuta a un giro eliminato o a una chiusura di sessione. */
  const stillPresent = (ids: number[]): number[] =>
    ids.filter((id) => laps.some((l) => l.id === id));

  const handleSetupConfirm = async (setup: SetupData): Promise<void> => {
    setShowPicker(false);
    if (explicit) setShowSetupSelection(false);
    if (explicit && !session) return;
    try {
      const named: SetupData = setup.name
        ? setup
        : { ...setup, name: setup.carFound || "Setup" };
      const params =
        explicit && session
          ? { setup: named, sessionId: session.id, game: session.game }
          : { setup: named };
      const { setupId } = await window.electronAPI.sessionLoadSetup(params);
      if (pendingLapIds != null) {
        const targets = stillPresent(pendingLapIds);
        // Azzerata prima del loop: un errore a metà non deve lasciare in giro
        // id che il prossimo caricamento riassegnerebbe in silenzio.
        setPendingLapIds(null);
        // ponytail: un update per giro, sono decine non migliaia - niente IPC bulk
        for (const lapId of targets) await assignLapSetup(lapId, setupId);
        showFlash(
          "success",
          targets.length
            ? `Setup ${named.name} caricato e assegnato a ${lapsLabel(targets.length)}.`
            : `Setup caricato: ${named.name}`,
        );
      } else {
        showFlash("success", `Setup caricato: ${named.name}`);
      }
    } catch (err) {
      // Anche il caricamento fallito consuma la lista: restare valorizzata
      // significherebbe riassegnare quei giri al prossimo setup caricato.
      setPendingLapIds(null);
      showFlash("danger", String(err));
    }
  };

  const handleReuseSetup = async (row: SessionSetupRow): Promise<void> => {
    setShowSetupSelection(false);
    try {
      if (explicit && session) {
        if (setupById.has(row.id)) {
          showFlash("success", "Setup già presente nella sessione.");
          return;
        }
        const named: SetupData = row.setup.name
          ? row.setup
          : { ...row.setup, name: row.setup.carFound || "Setup" };
        await window.electronAPI.sessionLoadSetup({
          setup: named,
          sessionId: session.id,
          game: session.game,
        });
        showFlash("success", `Setup caricato: ${named.name}`);
      } else if (!explicit) {
        let targetSetupId = row.id;
        if (!setupById.has(row.id)) {
          // Setup from another session: copy it to the current session so the counter
          // reflects it and future laps link to a row owned by this session.
          const named: SetupData = row.setup.name
            ? row.setup
            : { ...row.setup, name: row.setup.carFound || "Setup" };
          const result = await window.electronAPI.sessionLoadSetup({
            setup: named,
          });
          targetSetupId = result.setupId;
        }
        await window.electronAPI.sessionReuseSetup({ setupId: targetSetupId });
        setActiveSetup(targetSetupId);
        showFlash("success", "Setup attivo aggiornato.");
      }
    } catch (err) {
      showFlash("danger", String(err));
    }
  };

  const handleLapReuseSetup = async (row: SessionSetupRow): Promise<void> => {
    const lapIds = stillPresent(pickerLapIds ?? []);
    if (!lapIds.length) return;
    try {
      let targetSetupId = row.id;
      // If the setup is not in the current session, copy it first so setup_id
      // resolves correctly in setupById and persists on reload.
      if (!setupById.has(row.id)) {
        const named: SetupData = row.setup.name
          ? row.setup
          : { ...row.setup, name: row.setup.carFound || "Setup" };
        // activate: false — ritaggare vecchi giri non deve cambiare il setup in
        // uso, altrimenti anche i giri successivi finirebbero su questa copia.
        const params =
          explicit && session
            ? {
                setup: named,
                sessionId: session.id,
                game: session.game,
                activate: false,
              }
            : { setup: named, activate: false };
        const result = await window.electronAPI.sessionLoadSetup(params);
        targetSetupId = result.setupId;
      }
      for (const lapId of lapIds) await assignLapSetup(lapId, targetSetupId);
      showFlash("success", `Setup assegnato a ${lapsLabel(lapIds.length)}.`);
    } catch (err) {
      showFlash("danger", String(err));
    }
  };

  return {
    showPicker,
    setShowPicker,
    showSetupSelection,
    setShowSetupSelection,
    pickerLapIds,
    setPickerLapIds,
    setPendingLapIds,
    editorBase,
    setEditorBase,
    setupById,
    handleSetupConfirm,
    handleReuseSetup,
    handleLapReuseSetup,
  };
};
