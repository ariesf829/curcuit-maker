import { useMemo } from 'react';
import { buildNets } from '../model/connectivity';
import { useCircuit } from '../state/circuitStore';
import { Inspector } from './Inspector';
import { IssuesPanel } from './IssuesPanel';
import { LessonPanel } from './LessonPanel';
import { Results } from './Results';

export function NetPanel() {
  const parts = useCircuit((s) => s.parts);
  const wires = useCircuit((s) => s.wires);
  const selection = useCircuit((s) => s.selection);
  const removeSelected = useCircuit((s) => s.removeSelected);
  const rotateSelected = useCircuit((s) => s.rotateSelected);
  const clearAll = useCircuit((s) => s.clearAll);
  const orthogonal = useCircuit((s) => s.orthogonal);
  const setOrthogonal = useCircuit((s) => s.setOrthogonal);
  const wireLimitMa = useCircuit((s) => s.wireLimitMa);
  const setWireLimitMa = useCircuit((s) => s.setWireLimitMa);

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
      <LessonPanel />
      <div className="buttons">
        <button onClick={rotateSelected} disabled={selection?.kind !== 'part'}>
          Rotate (R)
        </button>
        <button onClick={removeSelected} disabled={!selection}>
          Delete (Del)
        </button>
        <button onClick={clearAll}>Clear</button>
        <button onClick={() => setOrthogonal(!orthogonal)} title="Route wires with right-angle bends">
          Right-angle wires: {orthogonal ? 'On' : 'Off'}
        </button>
      </div>
      <label className="field">
        <span>
          Wire current limit <em>(mA)</em>
        </span>
        <input
          type="number"
          min={1}
          step="any"
          value={wireLimitMa}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n)) setWireLimitMa(n);
          }}
        />
      </label>
      <Inspector />
      <Results />
      <IssuesPanel />
      <h3>Connections ({nets.length})</h3>
      {nets.length === 0 && <p className="hint">No connected parts yet. Plug parts into the breadboard or draw wires between pins.</p>}
      <ul>
        {nets.map((net, i) => (
          <li key={i}>{net.join('  ↔  ')}</li>
        ))}
      </ul>
      <h3>Help</h3>
      <ul className="hint">
        <li>Click a pin to start a wire, click empty space to add bends, click another pin to finish.</li>
        <li>Backspace removes the last bend while drawing; Esc cancels.</li>
        <li>Select a wire to drag its yellow bend handles; double-click a handle to remove it.</li>
        <li>Parts plugged into a breadboard move and rotate with it.</li>
        <li>Moving white dots show current direction; faster and thicker means more current. Select a wire to see its value.</li>
        <li>Parts snap to the breadboard holes and connect automatically.</li>
        <li>Wheel = zoom, drag background = pan.</li>
      </ul>
    </aside>
  );
}
