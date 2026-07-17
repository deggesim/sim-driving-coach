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

export type IPCStore = {
  frame: R3EFrame | null;
  lastLap: LapRecord | null;
  status: GameStatus;
  announce: string | null;
  setFrame: (frame: R3EFrame) => void;
  setLastLap: (lap: LapRecord) => void;
  setStatus: (status: GameStatus) => void;
  setAnnounce: (text: string | null) => void;
};

export const useIPCStore = create<IPCStore>((set) => ({
  frame: null,
  lastLap: null,
  status: DEFAULT_STATUS,
  announce: null,
  setFrame: (frame) => set({ frame }),
  setLastLap: (lastLap) => set({ lastLap }),
  setStatus: (status) => set({ status }),
  setAnnounce: (announce) => set({ announce }),
}));
