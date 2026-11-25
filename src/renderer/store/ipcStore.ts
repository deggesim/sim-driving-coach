/**
 * ipcStore - Zustand store for Electron IPC push state.
 */

import { create } from "zustand";
import type { R3EFrame, LapRecord, GameStatus } from "../../shared/types";

const DEFAULT_STATUS: GameStatus = {
  connected: false,
  r3eConnected: false,
  aceConnected: false,
  ams2Connected: false,
  calibrating: false,
  lapsToCalibration: 2,
  car: null,
  track: null,
  layout: null,
  game: "r3e",
};

export type Toast = { id: number; variant: string; text: string };

let toastId = 0;

export type IPCStore = {
  frame: R3EFrame | null;
  lastLap: LapRecord | null;
  status: GameStatus;
  announce: string | null;
  toast: Toast | null;
  setFrame: (frame: R3EFrame) => void;
  setLastLap: (lap: LapRecord) => void;
  setStatus: (status: GameStatus) => void;
  setAnnounce: (text: string | null) => void;
  setToast: (variant: string, text: string) => void;
  clearToast: () => void;
  setAppError: (message: string) => void;
};

export const useIPCStore = create<IPCStore>((set) => ({
  frame: null,
  lastLap: null,
  status: DEFAULT_STATUS,
  announce: null,
  toast: null,
  setFrame: (frame) => set({ frame }),
  setLastLap: (lastLap) => set({ lastLap }),
  setStatus: (status) => set({ status }),
  setAnnounce: (announce) => set({ announce }),
  // New id on every call: AppToast remounts, so the auto-hide timer restarts.
  setToast: (variant, text) => set({ toast: { id: ++toastId, variant, text } }),
  clearToast: () => set({ toast: null }),
  setAppError: (text) =>
    set({ toast: { id: ++toastId, variant: "danger", text } }),
}));
