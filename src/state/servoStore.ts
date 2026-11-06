import { create } from 'zustand';

interface ServoState {
  /** Commanded horn angle (0-180) per servo part id, while a sketch is running. */
  angles: Record<string, number>;
  show: (partId: string, angle: number | null) => void;
  clear: () => void;
}

export const useServo = create<ServoState>((set) => ({
  angles: {},
  show: (partId, angle) =>
    set((s) => {
      const angles = { ...s.angles };
      if (angle === null) delete angles[partId];
      else angles[partId] = angle;
      return { angles };
    }),
  clear: () => set({ angles: {} }),
}));
