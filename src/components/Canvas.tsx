import { useEffect, useRef, useState } from 'react';
import type { DragEvent, PointerEvent as RPointerEvent, WheelEvent } from 'react';
import { pinWorld } from '../model/connectivity';
import { PART_DEFS, type PartType } from '../model/parts';
import type { Part, Point } from '../model/types';
import { snap, useCircuit } from '../state/circuitStore';
import { DRAG_MIME } from './Palette';

interface View {
  x: number;
  y: number;
  k: number;
}

type Drag =
  | { kind: 'part'; id: string; dx: number; dy: number }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | null;

const pinLabel = (name: string) => name.replace(/^(GND|3V3|5V)(\d|b)+$/, '$1');

function PartView({ part }: { part: Part }) {
  const def = PART_DEFS[part.type];
  const selected = useCircuit((s) => s.selection?.kind === 'part' && s.selection.id === part.id);
  const wiringFrom = useCircuit((s) => s.wiringFrom);
  const isBoard = part.type === 'breadboard';
  const midY = def.body.y + def.body.h / 2;

  return (
    <g transform={`translate(${part.x} ${part.y}) rotate(${part.rot * 90})`}>
      <rect
        className={`part-body${selected ? ' selected' : ''}`}
        x={def.body.x}
        y={def.body.y}
        width={def.body.w}
        height={def.body.h}
        rx={isBoard ? 8 : 4}
        fill={def.color}
        data-part={part.id}
      />
      {!isBoard && (
        <text className="part-name" x={def.body.x + def.body.w / 2} y={def.body.y + def.body.h / 2 + 4} textAnchor="middle">
          {part.name}
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

  const toWorld = (e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      const st = useCircuit.getState();
      if (e.key === 'Delete' || e.key === 'Backspace') st.removeSelected();
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
    const partId = target.getAttribute('data-part');
    const st = useCircuit.getState();
    svgRef.current!.setPointerCapture(e.pointerId);
    if (partId) {
      const part = st.parts.find((q) => q.id === partId)!;
      const w = toWorld(e);
      st.select({ kind: 'part', id: partId });
      dragRef.current = { kind: 'part', id: partId, dx: w.x - part.x, dy: w.y - part.y };
    } else {
      st.select(null);
      st.cancelWiring();
      dragRef.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    }
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    setMouse(toWorld(e));
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
    else {
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
  const boards = parts.filter((q) => q.type === 'breadboard');
  const others = parts.filter((q) => q.type !== 'breadboard');
  const fromPos = wiringFrom && byId.get(wiringFrom.partId) ? pinWorld(byId.get(wiringFrom.partId)!, wiringFrom.pin) : null;

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
          return (
            <g
              key={w.id}
              onPointerDown={(e) => {
                e.stopPropagation();
                useCircuit.getState().select({ kind: 'wire', id: w.id });
              }}
            >
              <line className="wire-hit" x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} />
              <line className={`wire${sel ? ' selected' : ''}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} />
            </g>
          );
        })}
        {others.map((q) => (
          <PartView key={q.id} part={q} />
        ))}
        {fromPos && mouse && <line className="wire preview" x1={fromPos.x} y1={fromPos.y} x2={mouse.x} y2={mouse.y} />}
      </g>
    </svg>
  );
}
