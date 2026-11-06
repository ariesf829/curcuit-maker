import { create } from 'zustand';
import type { LcdView } from '../script/lcd';

interface LcdState {
  views: Record<string, LcdView>;
  show: (partId: string, view: LcdView | null) => void;
  clear: () => void;
}

/** What each LCD part currently shows while a sketch runs, keyed by part id. */
export const useLcd = create<LcdState>((set) => ({
  views: {},
  show: (partId, view) =>
    set((s) => {
      const views = { ...s.views };
      if (view) views[partId] = view;
      else delete views[partId];
      return { views };
    }),
  clear: () => set({ views: {} }),
}));
