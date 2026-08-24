/**
 * sessionStore - Zustand store for the active or selected session.
 * Subscribes to session:* IPC push channels and exposes helpers.
 */

import { create } from "zustand";
import { useIPCStore } from "./ipcStore";
import type {
  GameSource,
  LapRow,
  SessionAnalysisRow,
  SessionDetail,
  SessionRow,
  SessionSetupRow,
  SetupData,
} from "../../shared/types";

export type ViewMode = "live" | "historical";

/** The analysis version currently being worked on (either level). No text: neither
 *  level streams, so this only drives the spinner. */
type Working = { sessionId: number; version: number } | null;

type State = {
  mode: ViewMode;
  session: SessionRow | null;
  laps: LapRow[];
  setups: SessionSetupRow[];
  analyses: SessionAnalysisRow[];
  /** Setup attivo della sessione live: quello che verrà agganciato ai prossimi giri. */
  activeSetupId: number | null;
  working: Working;
  loading: boolean;
  error: string | null;

  loadCurrent: () => Promise<void>;
  loadById: (id: number, game: GameSource) => Promise<void>;
  reset: () => void;
  setDetail: (detail: SessionDetail | null, mode: ViewMode) => void;
  deleteAnalysis: (id: number) => Promise<void>;
  commentAnalysis: (id: number, comment: string) => Promise<void>;
  // Fires the Level-2 deep-dive. Resolves as soon as main accepts the request:
  // the text arrives through the analysisStart/analysisDone push channels.
  expandAnalysis: (id: number) => Promise<void>;
  deleteSetup: (
    id: number,
    game: GameSource,
  ) => Promise<{ ok: true } | { ok: false; lapCount: number }>;
  // `id` può appartenere a un'altra sessione (lo storico setup è per
  // auto/circuito): in quel caso aggiorna solo il DB.
  renameSetup: (id: number, game: GameSource, name: string) => Promise<void>;
  updateSetup: (
    id: number,
    game: GameSource,
    setup: SetupData,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  assignLapSetup: (lapId: number, setupId: number | null) => Promise<void>;
  setActiveSetup: (id: number | null) => void;
  deleteLap: (lapId: number) => Promise<void>;
  _applyLapAdded: (payload: {
    sessionId: number;
    game: GameSource;
    lap: LapRow;
  }) => void;
  _applySetupLoaded: (payload: {
    sessionId: number;
    game: GameSource;
    setup: SessionSetupRow;
    // false: the setup was only stored (re-tagging old laps), the active one
    // must not change.
    activate?: boolean;
  }) => void;
  _applyAnalysisStart: (payload: {
    sessionId: number;
    version: number;
  }) => void;
  // analysis === null: the attempt failed, just release the spinner.
  // speak === false: the analysis was requested by voice, so the voice path
  // already speaks the summary - announcing it here would double it.
  _applyAnalysisDone: (payload: {
    sessionId: number;
    analysis: SessionAnalysisRow | null;
    speak?: boolean;
  }) => void;
  _applySessionStarted: (session: SessionRow) => void;
  _applySessionClosed: (payload: { id: number; game: GameSource }) => void;
};

export const useSessionStore = create<State>((set, get) => ({
  mode: "live",
  session: null,
  laps: [],
  setups: [],
  analyses: [],
  activeSetupId: null,
  working: null,
  loading: false,
  error: null,

  setDetail: (detail, mode) => {
    if (!detail) {
      set({
        session: null,
        laps: [],
        setups: [],
        analyses: [],
        activeSetupId: null,
        mode,
        working: null,
      });
      return;
    }
    set({
      session: detail.session,
      laps: detail.laps,
      setups: detail.setups,
      analyses: detail.analyses,
      activeSetupId: detail.activeSetupId ?? null,
      mode,
      working: null,
    });
  },

  loadCurrent: async () => {
    set({ loading: true, error: null });
    try {
      const detail =
        (await window.electronAPI.sessionGetCurrent()) as SessionDetail | null;
      get().setDetail(detail, "live");
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ loading: false });
    }
  },

  loadById: async (id, game) => {
    set({ loading: true, error: null, mode: "historical" });
    try {
      const detail = (await window.electronAPI.sessionGetDetail({
        id,
        game,
      })) as SessionDetail | null;
      get().setDetail(detail, "historical");
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ loading: false });
    }
  },

  reset: () =>
    set({
      mode: "live",
      session: null,
      laps: [],
      setups: [],
      analyses: [],
      activeSetupId: null,
      working: null,
      error: null,
    }),

  deleteAnalysis: async (id) => {
    const s = get();
    if (!s.session) return;
    await window.electronAPI.sessionDeleteAnalysis({
      id,
      game: s.session.game,
    });
    set({ analyses: s.analyses.filter((a) => a.id !== id) });
  },

  commentAnalysis: async (id, comment) => {
    const s = get();
    if (!s.session) return;
    const res = await window.electronAPI.sessionCommentAnalysis({
      id,
      game: s.session.game,
      comment,
    });
    if (res.ok && res.analysis) {
      const updated = res.analysis;
      set({
        analyses: get().analyses.map((a) =>
          a.id === updated.id ? updated : a,
        ),
      });
    } else {
      set({
        error: res.reason ?? "Errore durante l'integrazione del commento.",
      });
    }
  },

  expandAnalysis: async (id) => {
    const s = get();
    if (!s.session) return;
    // Optimistic: the spinner must replace the button on click, not one IPC
    // round-trip + prompt build later. analysisStart then confirms the same key.
    const version = s.analyses.find((a) => a.id === id)?.version;
    if (version != null) set({ working: { sessionId: s.session.id, version } });
    const res = await window.electronAPI.sessionExpandAnalysis({
      analysisId: id,
      game: s.session.game,
    });
    if (!res.ok) {
      set({
        working: null,
        error: res.reason ?? "Errore durante l'approfondimento.",
      });
    }
  },

  deleteSetup: async (id, game) => {
    const res = await window.electronAPI.sessionDeleteSetup({ id, game });
    if (res.ok) {
      const s = get();
      set({
        setups: s.setups.filter((x) => x.id !== id),
        activeSetupId: s.activeSetupId === id ? null : s.activeSetupId,
      });
    }
    return res;
  },

  renameSetup: async (id, game, name) => {
    await window.electronAPI.sessionRenameSetup({ id, game, name });
    set({
      setups: get().setups.map((row) =>
        row.id === id ? { ...row, setup: { ...row.setup, name } } : row,
      ),
    });
  },

  updateSetup: async (id, game, setup) => {
    const res = await window.electronAPI.sessionUpdateSetup({
      id,
      game,
      setup,
    });
    if (res.ok) {
      set({
        setups: get().setups.map((row) => (row.id === id ? res.row : row)),
      });
    }
    return res;
  },

  assignLapSetup: async (lapId, setupId) => {
    const s = get();
    if (!s.session) return;
    await window.electronAPI.lapAssignSetup({
      lapId,
      setupId,
      game: s.session.game,
    });
    set({
      laps: s.laps.map((l) =>
        l.id === lapId ? { ...l, setup_id: setupId } : l,
      ),
    });
  },

  setActiveSetup: (id) => set({ activeSetupId: id }),

  deleteLap: async (lapId) => {
    const s = get();
    if (!s.session) return;
    await window.electronAPI.lapDelete({ id: lapId, game: s.session.game });
    set({ laps: s.laps.filter((l) => l.id !== lapId) });
  },

  _applyLapAdded: ({ sessionId, lap }) => {
    const s = get();
    if (!s.session || s.session.id !== sessionId) return;
    // Avoid duplicates
    if (s.laps.some((l) => l.id === lap.id)) return;
    set({ laps: [...s.laps, lap] });
  },

  _applySetupLoaded: ({ sessionId, setup, activate }) => {
    const s = get();
    if (!s.session || s.session.id !== sessionId) return;
    set({
      setups: [...s.setups, setup],
      activeSetupId: activate === false ? s.activeSetupId : setup.id,
    });
  },

  _applyAnalysisStart: ({ sessionId, version }) => {
    if (get().session?.id !== sessionId) return;
    set({ working: { sessionId, version } });
  },

  _applyAnalysisDone: ({ sessionId, analysis, speak }) => {
    const s = get();
    if (!s.session || s.session.id !== sessionId) return;
    if (!analysis) {
      set({ working: null });
      return;
    }
    // Replace or append analysis
    const others = s.analyses.filter((a) => a.version !== analysis.version);
    // Level 1 only: same length ⇒ nothing was filtered out ⇒ this version is new.
    // A Level-2 expand replaces an existing version and carries the same
    // `summary`, which was already spoken when Level 1 landed.
    if (
      speak !== false &&
      others.length === s.analyses.length &&
      analysis.summary
    ) {
      useIPCStore.getState().setAnnounce(analysis.summary);
    }
    set({
      analyses: [...others, analysis].sort((a, b) => a.version - b.version),
      working: null,
    });
  },

  _applySessionStarted: (session) => {
    const current = get();
    // If same session is being reopened, preserve existing laps/setups/analyses.
    // For a truly new session (different ID), reset everything.
    const isSameSession = current.session?.id === session.id;
    set({
      mode: "live",
      session,
      laps: isSameSession ? current.laps : [],
      setups: isSameSession ? current.setups : [],
      analyses: isSameSession ? current.analyses : [],
      activeSetupId: isSameSession ? current.activeSetupId : null,
      working: null,
      error: null,
    });
  },

  _applySessionClosed: ({ id }) => {
    const s = get();
    if (!s.session || s.session.id !== id) return;
    set({
      session: s.session
        ? { ...s.session, ended_at: new Date().toISOString() }
        : null,
    });
  },
}));

/**
 * Subscribe once to all session:* push channels. Call from the app root.
 * Guard prevents duplicate registration (e.g. React Strict Mode double-mount).
 */
let ipcSubscribed = false;

export const subscribeSessionIPC = (): void => {
  if (!window.electronAPI || ipcSubscribed) return;
  ipcSubscribed = true;

  const store = () => useSessionStore.getState();
  window.electronAPI.onSessionStarted((d) =>
    store()._applySessionStarted(d as SessionRow),
  );
  window.electronAPI.onSessionClosed((d) =>
    store()._applySessionClosed(d as { id: number; game: GameSource }),
  );
  window.electronAPI.onSessionLapAdded((d) =>
    store()._applyLapAdded(
      d as { sessionId: number; game: GameSource; lap: LapRow },
    ),
  );
  window.electronAPI.onSessionSetupLoaded((d) =>
    store()._applySetupLoaded(
      d as {
        sessionId: number;
        game: GameSource;
        setup: SessionSetupRow;
        activate?: boolean;
      },
    ),
  );
  window.electronAPI.onSessionAnalysisStart((d) =>
    store()._applyAnalysisStart(d as { sessionId: number; version: number }),
  );
  window.electronAPI.onSessionAnalysisDone((d) =>
    store()._applyAnalysisDone(
      d as {
        sessionId: number;
        analysis: SessionAnalysisRow | null;
        speak?: boolean;
      },
    ),
  );
};
