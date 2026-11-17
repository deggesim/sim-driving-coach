/**
 * updateStore - the app update on offer: `version` stays set until installed
 * (the status-bar button reads it), `asking` opens the "new version" prompt.
 */

import { create } from "zustand";

type UpdateStore = {
  version: string | null;
  asking: boolean;
  offer: (version: string) => void;
  ask: () => void;
  dismiss: () => void;
  clear: () => void;
};

export const useUpdateStore = create<UpdateStore>((set) => ({
  version: null,
  asking: false,
  offer: (version) => set({ version, asking: true }),
  ask: () => set({ asking: true }),
  dismiss: () => set({ asking: false }),
  clear: () => set({ version: null, asking: false }),
}));
