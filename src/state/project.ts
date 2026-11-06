import { create } from 'zustand';
import type { Example } from '../examples';
import { parseCircuit, serializeCircuit } from '../model/serialize';
import { useCircuit } from './circuitStore';
import { useScript } from './scriptStore';

interface LessonState {
  lesson: Pick<Example, 'title' | 'summary' | 'steps'> | null;
  setLesson: (l: LessonState['lesson']) => void;
}

export const useLesson = create<LessonState>((set) => ({ lesson: null, setLesson: (lesson) => set({ lesson }) }));

export function loadExample(ex: Example) {
  useScript.getState().stop();
  const copy = structuredClone({ parts: ex.parts, wires: ex.wires });
  useCircuit.getState().loadCircuit(copy.parts, copy.wires, useCircuit.getState().wireLimitMa);
  useScript.getState().setSource(ex.source);
  useScript.getState().clearOutput();
  useLesson.getState().setLesson({ title: ex.title, summary: ex.summary, steps: ex.steps });
}

/** Loads a saved file's text. Throws an Error with a readable message if it is invalid. */
export function openProject(text: string) {
  const file = parseCircuit(text);
  useScript.getState().stop();
  useCircuit.getState().loadCircuit(file.parts, file.wires, file.wireLimitMa);
  useScript.getState().setSource(file.source);
  useScript.getState().clearOutput();
  useLesson.getState().setLesson(null);
}

export function projectJson(): string {
  const { parts, wires, wireLimitMa } = useCircuit.getState();
  return serializeCircuit({ parts, wires, wireLimitMa, source: useScript.getState().source });
}
