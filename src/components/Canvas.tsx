import { useEffect, useRef, useState } from 'react';
import type { DragEvent, PointerEvent as RPointerEvent, WheelEvent } from 'react';
import { pinKey, pinWorld } from '../model/connectivity';
import { isBoardType } from '../model/boards';
import { PART_DEFS, type PartType } from '../model/parts';
import { pathMid, pathToString, routePath } from '../model/routing';
import type { Part, Point } from '../model/types';
import { snap, useCircuit } from '../state/circuitStore';
import { DRAG_MIME } from './Palette';
import { HAS_GRAPHIC, PartGraphic } from './PartGraphics';
import { formatAmps, formatVolts, useIssues, useSimulation, useWireCurrents } from './useSimulation';

interface View {
  x: number;
  y: number;
  k: number;
}

type Drag =
  | { kind: 'part'; id: string; dx: number; dy: number }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'vertex'; id: string; index: number }
  | null;

const pinLabel = (name: string) => name.replace(/^(GND|3V3|5V)(\d|b)+$/, '$1');

function PartView({ part }: { part: Part }) {
  const def = PART_DEFS[part.type];
  const selected = useCircuit((s) => s.selection?.kind === 'part' && s.selection.id === part.id);
  const wiringFrom = useCircuit((s) => s.wiringFrom);
  const sim = useSimulation();
  const isBoard = part.type === 'breadboard';
  const midY = def.body.y + def.body.h / 2;
  const graphic = HAS_GRAPHIC.has(part.type);
  let readout = '';
  if (part.type === 'multimeter') {
    const m = sim.elements.find((e) => e.partId === part.id && e.label === 'meter');
    if (m) readout = part.params?.ammeter ? formatAmps(m.current) : formatVolts(m.voltage);
  } else if (part.type === 'relay' && sim.relays.has(part.id)) readout = 'ON';
  else if (part.type === 'buck') {
    const b = sim.bucks.get(part.id);
    if (b) readout = `${b.vout.toFixed(1)} V`;
  }

  return (
    <g data-part={part.id} transform={`translate(${part.x} ${part.y}) rotate(${part.rot * 90})`}>
      <rect
        className={`part-body${selected ? ' selected' : ''}`}
        x={def.body.x}
        y={def.body.y}
        width={def.body.w}
        height={def.body.h}
        rx={isBoard ? 8 : 4}
        fill={graphic ? '#12151b' : def.color}
        fillOpacity={graphic ? 0.01 : 1}
        data-part={part.id}
      />
      {graphic && <PartGraphic part={part} sim={sim} />}
      {!isBoard && (
        <text
          className="part-name"
          x={def.body.x + def.body.w / 2}
          y={graphic ? def.body.y - 4 : def.body.y + def.body.h / 2 + 4}
          textAnchor="middle"
          transform={graphic ? `rotate(${-part.rot * 90} ${def.body.x + def.body.w / 2} ${def.body.y - 4})` : undefined}
        >
          {part.name}
        </text>
      )}
      {readout && (
        <text className="part-readout" x={def.body.x + def.body.w / 2} y={def.body.y + def.body.h / 2 + 16} textAnchor="middle" transform={`rotate(${-part.rot * 90} ${def.body.x + def.body.w / 2} ${def.body.y + def.body.h / 2 + 12})`}>
          {readout}
        </text>
      )}
      {def.pins.map((pin) => {
        const active = wiringFrom?.partId === part.id && wiringFrom.pin === pin.name;
        return (
          <g key={pin.name}>
            {!isBoard && (
              <text
                className="pin-label"
                x={pin.x}
                y={pin.y < midY ? pin.y - 8 : pin.y + 15}
                textAnchor="middle"
                transform={`rotate(${-part.rot * 90} ${pin.x} ${pin.y})`}
              >
                {pinLabel(pin.name)}
              </text>
            )}
            <circle
              className={`pin${isBoard ? ' hole' : ''}${active ? ' active' : ''}`}
              cx={pin.x}
              cy={pin.y}
              r={isBoard ? 4 : 5}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                useCircuit.getState().clickPin({ partId: part.id, pin: pin.name });
              }}
            >
              <title>{`${part.name} ${pinLabel(pin.name)}`}</title>
            </circle>
          </g>
        );
      })}
    </g>
  );
}

export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 20, y: 120, k: 1 });
  const [mouse, setMouse] = useState<Point | null>(null);
  const dragRef = useRef<Drag>(null);

  const parts = useCircuit((s) => s.parts);
  const wires = useCircuit((s) => s.wires);
  const selection = useCircuit((s) => s.selection);
  const wiringFrom = useCircuit((s) => s.wiringFrom);
  const wiringPoints = useCircuit((s) => s.wiringPoints);
  const orthogonal = useCircuit((s) => s.orthogonal);
  const sim = useSimulation();
  const issues = useIssues();
  const currents = useWireCurrents();
  const wireSeverity = (w: { id: string; from: { partId: string; pin: string } }) => {
    const n = sim.nets.netOf.get(pinKey(w.from));
    let sev = '';
    for (const i of issues) {
      if (i.severity === 'info') continue;
      const hit = i.wireIds?.includes(w.id) || (n !== undefined && i.nets.includes(n));
      if (!hit) continue;
      if (i.severity === 'error') return 'error';
      sev = 'warning';
    }
    return sev;
  };

  const toWorld = (e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      const st = useCircuit.getState();
      if (e.key === 'Backspace' && st.wiringFrom) st.removeLastWaypoint();
      else if (e.key === 'Delete' || e.key === 'Backspace') st.removeSelected();
      else if (e.key === 'r' || e.key === 'R') st.rotateSelected();
      else if (e.key === 'Escape') {
        st.cancelWiring();
        st.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    const target = e.target as SVGElement;
    const partId = target.closest('[data-part]')?.getAttribute('data-part');
    const st = useCircuit.getState();
    svgRef.current!.setPointerCapture(e.pointerId);
    if (partId) {
      const part = st.parts.find((q) => q.id === partId)!;
      const w = toWorld(e);
      st.select({ kind: 'part', id: partId });
      dragRef.current = { kind: 'part', id: partId, dx: w.x - part.x, dy: w.y - part.y };
    } else if (st.wiringFrom) {
      const w = toWorld(e);
      st.addWaypoint({ x: snap(w.x), y: snap(w.y) });
    } else {
      st.select(null);
      dragRef.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    }
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    setMouse(toWorld(e));
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
    else if (d.kind === 'vertex') {
      const w = toWorld(e);
      useCircuit.getState().moveWirePoint(d.id, d.index, { x: snap(w.x), y: snap(w.y) });
    } else {
      const w = toWorld(e);
      useCircuit.getState().movePart(d.id, snap(w.x - d.dx), snap(w.y - d.dy));
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    const r = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    setView((v) => {
      const k = Math.min(3, Math.max(0.3, v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
    });
  };

  const onDrop = (e: DragEvent<SVGSVGElement>) => {
    e.preventDefault();
    const type = e.dataTransfer.getData(DRAG_MIME) as PartType;
    if (!PART_DEFS[type]) return;
    const w = toWorld(e);
    useCircuit.getState().addPart(type, w.x, w.y);
  };

  const byId = new Map(parts.map((q) => [q.id, q]));
  const isUnder = (q: Part) => q.type === 'breadboard' || isBoardType(q.type);
  const boards = parts.filter(isUnder);
  const others = parts.filter((q) => !isUnder(q));
  const fromPos = wiringFrom && byId.get(wiringFrom.partId) ? pinWorld(byId.get(wiringFrom.partId)!, wiringFrom.pin) : null;
  const preview =
    fromPos && mouse ? routePath(fromPos, wiringPoints, { x: snap(mouse.x), y: snap(mouse.y) }, orthogonal) : null;

  return (
    <svg
      ref={svgRef}
      className="canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <defs>
        <pattern id="grid" width={20 * view.k} height={20 * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
          <circle cx={1} cy={1} r={1} fill="#2c3340" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        {boards.map((q) => (
          <PartView key={q.id} part={q} />
        ))}
        {wires.map((w) => {
          const a = byId.get(w.from.partId);
          const b = byId.get(w.to.partId);
          if (!a || !b) return null;
          const pa = pinWorld(a, w.from.pin);
          const pb = pinWorld(b, w.to.pin);
          const sel = selection?.kind === 'wire' && selection.id === w.id;
          const pts = pathToString([pa, ...(w.points ?? []), pb]);
          const sev = wireSeverity(w);
          const amps = currents.get(w.id) ?? 0;
          const mA = Math.abs(amps) * 1000;
          const flowing = mA >= 0.01;
          const width = 3 + Math.min(4, Math.log10(1 + mA / 10) * 2);
          const mid = pathMid([pa, ...(w.points ?? []), pb]);
          return (
            <g
              key={w.id}
              onPointerDown={(e) => {
                e.stopPropagation();
                useCircuit.getState().select({ kind: 'wire', id: w.id });
              }}
            >
              <polyline className="wire-hit" points={pts}>
                <title>{`${formatAmps(amps)} ${amps < 0 ? '(flows from the second pin to the first)' : ''}`}</title>
              </polyline>
              <polyline
                className={`wire${sel ? ' selected' : ''}${sev ? ` blink-${sev}` : ''}`}
                points={pts}
                style={{ strokeWidth: width, ...(w.color && !sev && !sel && { stroke: w.color }) }}
              />
              {flowing && (
                <polyline
                  className={`wire-flow${amps < 0 ? ' reverse' : ''}`}
                  points={pts}
                  style={{ animationDuration: `${Math.max(0.25, 3 / (1 + mA / 20))}s` }}
                />
              )}
              {sel && flowing && (
                <text className="wire-label" x={mid.x} y={mid.y - 8} textAnchor="middle">
                  {formatAmps(amps)}
                </text>
              )}
              {sel &&
                w.points?.map((p, i) => (
                  <circle
                    key={i}
                    className="wire-handle"
                    cx={p.x}
                    cy={p.y}
                    r={5}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      svgRef.current!.setPointerCapture(e.pointerId);
                      dragRef.current = { kind: 'vertex', id: w.id, index: i };
                    }}
                    onDoubleClick={() => useCircuit.getState().removeWirePoint(w.id, i)}
                  >
                    <title>Drag to move, double-click to remove</title>
                  </circle>
                ))}
            </g>
          );
        })}
        {others.map((q) => (
          <PartView key={q.id} part={q} />
        ))}
        {preview && <polyline className="wire preview" points={pathToString(preview)} />}
        {wiringPoints.map((p, i) => (
          <circle key={i} className="wire-handle" cx={p.x} cy={p.y} r={4} />
        ))}
      </g>
    </svg>
  );
}
