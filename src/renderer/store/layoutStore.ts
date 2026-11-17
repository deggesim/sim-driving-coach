/**
 * layoutStore - how SessionPanel arranges Laps and Analysis: side by side
 * ("columns") or stacked ("rows"), plus the share of the first panel.
 * Persisted in localStorage: a pure UI preference, no IPC or DB involved.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PanelLayout = "columns" | "rows";

export const MIN_SPLIT = 0.2;
export const MAX_SPLIT = 0.8;

type LayoutStore = {
  layout: PanelLayout;
  split: number; // share of the first panel (Laps), MIN_SPLIT..MAX_SPLIT
  setLayout: (layout: PanelLayout) => void;
  setSplit: (split: number) => void;
};

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set) => ({
      layout: "columns",
      split: 0.5,
      setLayout: (layout) => set({ layout }),
      setSplit: (split) =>
        set({ split: Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, split)) }),
    }),
    { name: "sdc-panel-layout" },
  ),
);
