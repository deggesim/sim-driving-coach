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
} from "../../shared/types";

export type ViewMode = "live" | "historical";

type Streaming = {
  sessionId: number;
  version: number;
  text: string;
} | null;

type State = {
  mode: ViewMode;
  session: SessionRow | null;
  laps: LapRow[];
  setups: SessionSetupRow[];
  analyses: SessionAnalysisRow[];
  streaming: Streaming;
  loading: boolean;
  error: string | null;

  loadCurrent: () => Promise<void>;
  loadById: (id: number, game: GameSource) => Promise<void>;
  reset: () => void;
  setDetail: (detail: SessionDetail | null, mode: ViewMode) => void;
  deleteAnalysis: (id: number) => Promise<void>;
  commentAnalysis: (id: number, comment: string) => Promise<void>;
  // Fires the Level-2 deep-dive. Resolves as soon as main accepts the request:
  // the text arrives through the analysisChunk/analysisDone push channels.
  expandAnalysis: (id: number) => Promise<void>;
  deleteSetup: (
    id: number,
    game: GameSource,
  ) => Promise<{ ok: true } | { ok: false; lapCount: number }>;
  assignLapSetup: (lapId: number, setupId: number | null) => Promise<void>;
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
  }) => void;
  _applyAnalysisChunk: (payload: {
    sessionId: number;
    version: number;
    token: string;
  }) => void;
  // analysis === null: the attempt failed, just release the spinner.
  _applyAnalysisDone: (payload: {
    sessionId: number;
    analysis: SessionAnalysisRow | null;
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
  streaming: null,
  loading: false,
  error: null,

  setDetail: (detail, mode) => {
    if (!detail) {
      set({
        session: null,
        laps: [],
        setups: [],
        analyses: [],
        mode,
        streaming: null,
      });
      return;
    }
    set({
      session: detail.session,
      laps: detail.laps,
      setups: detail.setups,
      analyses: detail.analyses,
      mode,
      streaming: null,
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
      streaming: null,
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
    const res = await window.electronAPI.sessionExpandAnalysis({
      analysisId: id,
      game: s.session.game,
    });
    if (!res.ok) {
      set({ error: res.reason ?? "Errore durante l'approfondimento." });
    }
  },

  deleteSetup: async (id, game) => {
    const res = await window.electronAPI.sessionDeleteSetup({ id, game });
    if (res.ok) {
      set({ setups: get().setups.filter((s) => s.id !== id) });
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

  _applySetupLoaded: ({ sessionId, setup }) => {
    const s = get();
    if (!s.session || s.session.id !== sessionId) return;
    set({ setups: [...s.setups, setup] });
  },

  _applyAnalysisChunk: ({ sessionId, version, token }) => {
    const s = get();
    if (!s.session || s.session.id !== sessionId) return;
    const current = s.streaming;
    if (
      !current ||
      current.sessionId !== sessionId ||
      current.version !== version
    ) {
      set({ streaming: { sessionId, version, text: token } });
    } else {
      set({ streaming: { ...current, text: current.text + token } });
    }
  },

  _applyAnalysisDone: ({ sessionId, analysis }) => {
    const s = get();
    if (!s.session || s.session.id !== sessionId) return;
    if (!analysis) {
      set({ streaming: null });
      return;
    }
    // Replace or append analysis
    const others = s.analyses.filter((a) => a.version !== analysis.version);
    // Level 1 only: same length ⇒ nothing was filtered out ⇒ this version is new.
    // A Level-2 expand replaces an existing version and carries the same
    // `summary`, which was already spoken when Level 1 landed.
    if (others.length === s.analyses.length && analysis.summary) {
      useIPCStore.getState().setAnnounce(analysis.summary);
    }
    set({
      analyses: [...others, analysis].sort((a, b) => a.version - b.version),
      streaming: null,
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
      streaming: null,
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
      d as { sessionId: number; game: GameSource; setup: SessionSetupRow },
    ),
  );
  window.electronAPI.onSessionAnalysisChunk((d) =>
    store()._applyAnalysisChunk(
      d as { sessionId: number; version: number; token: string },
    ),
  );
  window.electronAPI.onSessionAnalysisDone((d) =>
    store()._applyAnalysisDone(
      d as { sessionId: number; analysis: SessionAnalysisRow | null },
    ),
  );
};
