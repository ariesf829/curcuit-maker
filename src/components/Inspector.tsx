import { BOARDS, isBoardType, PIN_MODE_LABEL, pinRole } from '../model/boards';
import { PARAMS } from '../model/params';
import { PART_DEFS } from '../model/parts';
import { WIRE_COLORS } from '../model/serialize';
import { useCircuit } from '../state/circuitStore';

function WireInspector({ id }: { id: string }) {
  const wire = useCircuit((s) => s.wires.find((w) => w.id === id));
  const defaultColor = useCircuit((s) => s.wireColor);
  const setWireColor = useCircuit((s) => s.setWireColor);
  const setDefault = useCircuit((s) => s.setDefaultWireColor);
  if (!wire) return null;
  const color = (wire.color ?? WIRE_COLORS[0].value).toLowerCase();
  return (
    <section>
      <h3>Wire</h3>
      <div className="swatches">
        {WIRE_COLORS.map((c) => (
          <button
            key={c.value}
            className={`color-swatch${color === c.value ? ' on' : ''}`}
            style={{ background: c.value }}
            title={c.name}
            aria-label={c.name}
            onClick={() => setWireColor(id, c.value)}
          />
        ))}
        <input type="color" value={color} aria-label="Custom wire colour" onChange={(e) => setWireColor(id, e.target.value)} />
      </div>
      <p className="hint">
        New wires use <span className="chip" style={{ background: defaultColor }} /> the colour you picked last.{' '}
        <button className="link" onClick={() => setDefault(WIRE_COLORS[0].value)}>
          Reset
        </button>
      </p>
      <p className="hint">While a wire is selected it shows yellow, and it blinks red or orange if there is a problem.</p>
    </section>
  );
}

export function Inspector() {
  const selection = useCircuit((s) => s.selection);
  const part = useCircuit((s) => (s.selection?.kind === 'part' ? s.parts.find((q) => q.id === s.selection!.id) : undefined));
  const setParam = useCircuit((s) => s.setParam);
  if (selection?.kind === 'wire') return <WireInspector id={selection.id} />;
  if (selection?.kind !== 'part' || !part) return null;
  const active = Object.entries(part.pinModes ?? {}).filter(([, m]) => m !== 'in');

  const defs = PARAMS[part.type] ?? [];
  const gpios = isBoardType(part.type)
    ? PART_DEFS[part.type].pins.filter((p) => pinRole(BOARDS[part.type as keyof typeof BOARDS], p.name).kind === 'gpio')
    : [];
  return (
    <section>
      <h3>
        {part.name} · {PART_DEFS[part.type].label}
      </h3>
      {defs.length === 0 && gpios.length === 0 && <p className="hint">No adjustable values.</p>}
      {part.type === 'esc' && (
        <p className="hint">Connect BAT+/- to a 6-25.2 V battery, SIG to an ESP32 pin, and GND to ESP32 GND. Hold Servo.write(0) for 1 second to arm, then use 0-180 for throttle. The red lead provides a simulated 5 V BEC.</p>
      )}
      {part.type === 'brushless-motor' && <p className="hint">Connect A/B/C to the ESC's three motor outputs. Rotor speed follows the ESC throttle; phase current is not modeled.</p>}
      {part.type === 'buck' && <p className="hint">Input range: 3.2–35 V. Adjustable output: 1.25–35 V, with at least 1 V input headroom required to regulate.</p>}
      {part.type === 'motion-sensor' && <p className="hint">HC-SR501 PIR: power VCC from 4.5–20 V, connect GND, and read OUT (3.3 V when motion is detected). Click the sensor lens on the canvas to toggle motion.</p>}
      {part.type === 'solenoid-lock' && <p className="hint">Yes—control it from ESP32 through a logic-level N-MOSFET; never connect the coil directly to a GPIO. Wire an external supply + to COIL+, COIL− to MOSFET D, MOSFET S to supply −, and ESP32 GPIO to MOSFET G. Join ESP32 GND to supply −. Add a flyback diode (rated for coil current) across the coil, cathode to COIL+. Normally closed unlocks when energized; normally open locks when energized.</p>}
      {defs.map((d) => {
        const value = part.params?.[d.key] ?? d.default;
        return (
          <label key={d.key} className="field">
            <span>
              {d.label} {d.unit && <em>({d.unit})</em>}
            </span>
            {d.bool ? (
              <input type="checkbox" checked={value === 1} onChange={(e) => setParam(part.id, d.key, e.target.checked ? 1 : 0)} />
            ) : (
              <input
                type="number"
                value={value}
                min={d.min}
                max={d.max}
                step="any"
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  if (Number.isFinite(n)) setParam(part.id, d.key, n);
                }}
              />
            )}
          </label>
        );
      })}
      {gpios.length > 0 && (
        <>
          <h4>GPIO modes</h4>
          <p className="hint">Pins start as INPUT. Your code sets them with pinMode().</p>
          {active.map(([pin, mode]) => (
            <div key={pin} className="field">
              <span>{pin}</span>
              <em>
                {PIN_MODE_LABEL[mode]}
                {part.pinDuty?.[pin] !== undefined && ` · PWM ${Math.round(part.pinDuty[pin] * 100)}%`}
              </em>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
