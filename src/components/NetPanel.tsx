import { useMemo } from 'react';
import { buildNets } from '../model/connectivity';
import { useCircuit } from '../state/circuitStore';

export function NetPanel() {
  const parts = useCircuit((s) => s.parts);
  const wires = useCircuit((s) => s.wires);
  const selection = useCircuit((s) => s.selection);
  const removeSelected = useCircuit((s) => s.removeSelected);
  const rotateSelected = useCircuit((s) => s.rotateSelected);
  const clearAll = useCircuit((s) => s.clearAll);

  const names = useMemo(() => new Map(parts.map((q) => [q.id, q.name])), [parts]);
  const nets = useMemo(() => {
    const boardIds = new Set(parts.filter((q) => q.type === 'breadboard').map((q) => q.id));
    return buildNets(parts, wires)
      .nets.map((net) =>
        net
          .filter((k) => !boardIds.has(k.split(':')[0]))
          .map((k) => {
            const [id, pin] = k.split(':');
            return `${names.get(id)}.${pin.replace(/^(GND|3V3|5V)(\d|b)+$/, '$1')}`;
          }),
      )
      .filter((n) => n.length >= 2);
  }, [parts, wires, names]);

  return (
    <aside className="netpanel">
      <h2>Circuit</h2>
      <div className="buttons">
        <button onClick={rotateSelected} disabled={selection?.kind !== 'part'}>
          Rotate (R)
        </button>
        <button onClick={removeSelected} disabled={!selection}>
          Delete (Del)
        </button>
        <button onClick={clearAll}>Clear</button>
      </div>
      <h3>Connections ({nets.length})</h3>
      {nets.length === 0 && <p className="hint">No connected parts yet. Plug parts into the breadboard or draw wires between pins.</p>}
      <ul>
        {nets.map((net, i) => (
          <li key={i}>{net.join('  ↔  ')}</li>
        ))}
      </ul>
      <h3>Help</h3>
      <ul className="hint">
        <li>Click a pin, then another pin to draw a wire.</li>
        <li>Parts snap to the breadboard holes and connect automatically.</li>
        <li>Wheel = zoom, drag background = pan.</li>
        <li>Esc cancels a wire.</li>
      </ul>
    </aside>
  );
}
