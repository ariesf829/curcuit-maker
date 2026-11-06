import { beforeEach, describe, expect, it } from 'vitest';
import { attachedParts, pinWorld } from '../model/connectivity';
import { PART_DEFS } from '../model/parts';
import { useCircuit } from './circuitStore';

function setup() {
  useCircuit.getState().clearAll();
  const st = useCircuit.getState();
  const bb = st.parts[0];
  st.addPart('resistor', 0, 0);
  st.addPart('resistor', 0, 0);
  const [, plugged, loose] = useCircuit.getState().parts;
  const hole = pinWorld(bb, PART_DEFS.breadboard.pins[45].name);
  const pin = PART_DEFS.resistor.pins[0];
  useCircuit.getState().movePart(plugged.id, hole.x - pin.x, hole.y - pin.y);
  useCircuit.getState().movePart(loose.id, 1000, 1000);
  return { bbId: bb.id, pluggedId: plugged.id, looseId: loose.id };
}

const get = (id: string) => useCircuit.getState().parts.find((q) => q.id === id)!;

describe('breadboard parenting', () => {
  let ids: ReturnType<typeof setup>;
  beforeEach(() => {
    ids = setup();
  });

  it('detects only parts that are plugged in', () => {
    const bb = get(ids.bbId);
    expect(attachedParts(useCircuit.getState().parts, bb).map((q) => q.id)).toEqual([ids.pluggedId]);
  });

  it('moves plugged parts with the board and keeps them plugged in', () => {
    const before = { ...get(ids.pluggedId) };
    const loose = { ...get(ids.looseId) };
    const bb = get(ids.bbId);
    useCircuit.getState().movePart(ids.bbId, bb.x + 100, bb.y + 60);
    expect(get(ids.pluggedId).x).toBe(before.x + 100);
    expect(get(ids.pluggedId).y).toBe(before.y + 60);
    expect(get(ids.looseId)).toEqual(loose);
    expect(attachedParts(useCircuit.getState().parts, get(ids.bbId)).map((q) => q.id)).toEqual([ids.pluggedId]);
  });

  it('rotates plugged parts with the board and keeps them plugged in', () => {
    useCircuit.getState().select({ kind: 'part', id: ids.bbId });
    for (let i = 0; i < 4; i++) {
      const before = { ...get(ids.pluggedId) };
      useCircuit.getState().rotateSelected();
      expect(get(ids.pluggedId).rot).toBe((before.rot + 1) & 3);
      expect(attachedParts(useCircuit.getState().parts, get(ids.bbId)).map((q) => q.id)).toEqual([ids.pluggedId]);
    }
    expect(get(ids.pluggedId).rot).toBe(0);
  });
});
