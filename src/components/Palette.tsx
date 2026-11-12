import { PART_LIST, type PartType } from '../model/parts';
import { useCircuit } from '../state/circuitStore';

export const DRAG_MIME = 'application/x-circuit-part';

const categories = [...new Set(PART_LIST.map((d) => d.category))];

export function Palette() {
  const addPart = useCircuit((s) => s.addPart);
  return (
    <aside className="palette">
      <h2>Parts</h2>
      <p className="hint">Drag onto the canvas, or double-click to add.</p>
      {categories.map((cat) => (
        <section key={cat}>
          <h3>{cat}</h3>
          {PART_LIST.filter((d) => d.category === cat).map((d) => (
            <div
              key={d.type}
              className="palette-item"
              draggable
              onDragStart={(e) => e.dataTransfer.setData(DRAG_MIME, d.type satisfies PartType)}
              onDoubleClick={() =>
                addPart(d.type, 240 + Math.random() * 80, d.type === 'motion-sensor' || d.type === 'solenoid-lock' ? 200 : 80 + Math.random() * 40)
              }
            >
              <span className="swatch" style={{ background: d.color }} />
              {d.label}
            </div>
          ))}
        </section>
      ))}
    </aside>
  );
}
