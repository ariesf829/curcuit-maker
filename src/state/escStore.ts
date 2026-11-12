import { create } from 'zustand';

export interface EscState {
  throttle: number;
  armed: boolean;
}

interface EscStore {
  states: Record<string, EscState>;
  show: (partId: string, throttle: number | null, armed?: boolean) => void;
  clear: () => void;
}

export const useEsc = create<EscStore>((set) => ({
  states: {},
  show: (partId, throttle, armed = false) =>
    set((s) => {
      const current = s.states[partId];
      if (throttle !== null && current?.throttle === throttle && current.armed === armed) return s;
      const states = { ...s.states };
      if (throttle === null) delete states[partId];
      else states[partId] = { throttle, armed };
      return { states };
    }),
  clear: () => set({ states: {} }),
}));
