import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Part } from '../model/types';
import { RATINGS } from '../model/ratings';
import type { SimResult } from '../sim/simulate';
import { useCircuit } from '../state/circuitStore';
import { useLcd } from '../state/lcdStore';
import { useServo } from '../state/servoStore';

/** Parts that have a drawn picture instead of a plain rectangle. */
export const HAS_GRAPHIC = new Set<Part['type']>(['led', 'motor', 'relay', 'potentiometer', 'button', 'switch', 'lcd1602', 'servo', 'esc']);

const POT_SWEEP_DEG = 270;
const POT_DRAG_PX = 160;

/** Runs `move` for every pointer move until the pointer is released. */
function trackPointer(move: (e: PointerEvent) => void, done?: () => void) {
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    done?.();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function Potentiometer({ part }: { part: Part }) {
  const pos = part.params?.position ?? 0.5;
  const angle = (pos - 0.5) * POT_SWEEP_DEG;
  const grab = (e: ReactPointerEvent) => {
    e.stopPropagation();
    const { x, y } = e.nativeEvent;
    const start = pos;
    useCircuit.getState().select({ kind: 'part', id: part.id });
    trackPointer((m) => {
      const next = Math.min(1, Math.max(0, start + (m.clientX - x + (y - m.clientY)) / POT_DRAG_PX));
      useCircuit.getState().setParam(part.id, 'position', Math.round(next * 100) / 100);
    });
  };
  return (
    <g>
      <rect x={0} y={-30} width={40} height={26} rx={3} fill="#2f4f8f" pointerEvents="none" />
      <line x1={0} y1={0} x2={0} y2={-4} stroke="#c9ced6" strokeWidth={2} pointerEvents="none" />
      <line x1={20} y1={0} x2={20} y2={-4} stroke="#c9ced6" strokeWidth={2} pointerEvents="none" />
      <line x1={40} y1={0} x2={40} y2={-4} stroke="#c9ced6" strokeWidth={2} pointerEvents="none" />
      <g transform={`rotate(${angle} 20 -17)`} onPointerDown={grab} style={{ cursor: 'grab' }}>
        <circle cx={20} cy={-17} r={11} fill="#c9ced6" stroke="#222" strokeWidth={1.5} />
        <line x1={20} y1={-17} x2={20} y2={-27} stroke="#d33" strokeWidth={3} strokeLinecap="round" />
        <title>Drag to turn</title>
      </g>
      <text x={20} y={6} textAnchor="middle" className="part-readout" pointerEvents="none">
        {Math.round(pos * 100)}%
      </text>
    </g>
  );
}

function PushButton({ part }: { part: Part }) {
  const pressed = (part.params?.pressed ?? 0) === 1;
  const set = (v: number) => useCircuit.getState().setParam(part.id, 'pressed', v);
  const down = (e: ReactPointerEvent) => {
    e.stopPropagation();
    useCircuit.getState().select({ kind: 'part', id: part.id });
    set(1);
    trackPointer(() => {}, () => set(0));
  };
  return (
    <g>
      <line x1={0} y1={0} x2={10} y2={0} stroke="#c9ced6" strokeWidth={2} pointerEvents="none" />
      <line x1={30} y1={0} x2={40} y2={0} stroke="#c9ced6" strokeWidth={2} pointerEvents="none" />
      <rect x={8} y={-13} width={24} height={26} rx={3} fill="#3a3f48" stroke="#111" pointerEvents="none" />
      <circle cx={20} cy={0} r={pressed ? 7 : 8.5} fill={pressed ? '#a8322d' : '#e5484d'} stroke="#111" strokeWidth={1.5} onPointerDown={down} style={{ cursor: 'pointer' }}>
        <title>Hold to press</title>
      </circle>
    </g>
  );
}

function ToggleSwitch({ part }: { part: Part }) {
  const closed = (part.params?.closed ?? 0) === 1;
  const toggle = (e: ReactPointerEvent) => {
    e.stopPropagation();
    const { select, setParam } = useCircuit.getState();
    select({ kind: 'part', id: part.id });
    setParam(part.id, 'closed', closed ? 0 : 1);
  };
  return (
    <g>
      <line x1={0} y1={0} x2={8} y2={0} stroke="#c9ced6" strokeWidth={2} pointerEvents="none" />
      <line x1={32} y1={0} x2={40} y2={0} stroke="#c9ced6" strokeWidth={2} pointerEvents="none" />
      <rect x={6} y={-14} width={28} height={28} rx={4} fill="#2b3039" stroke="#0d0f13" pointerEvents="none" />
      <circle cx={11} cy={0} r={2.5} fill="#c9ced6" pointerEvents="none" />
      <circle cx={29} cy={0} r={2.5} fill="#c9ced6" pointerEvents="none" />
      <rect x={11} y={-9} width={18} height={18} rx={9} fill={closed ? '#1f6f3f' : '#3a3f48'} stroke="#0d0f13" onPointerDown={toggle} style={{ cursor: 'pointer' }}>
        <title>{closed ? 'Closed (click to open)' : 'Open (click to close)'}</title>
      </rect>
      <line x1={11} y1={0} x2={closed ? 29 : 26} y2={closed ? 0 : -11} stroke={closed ? '#6fdc8c' : '#e8ecf2'} strokeWidth={3} strokeLinecap="round" pointerEvents="none" />
      <text x={20} y={26} textAnchor="middle" className="part-readout" pointerEvents="none">
        {closed ? 'ON' : 'OFF'}
      </text>
    </g>
  );
}

const MIN_SPIN_VOLTS = 0.3;
const DEG_PER_VOLT_SECOND = 90;
const MAX_DEG_PER_SECOND = 900;

function ledColor(vf: number): string {
  if (vf >= 2.8) return '#4da3ff';
  if (vf >= 2.2) return '#3fe06a';
  return '#ff4d4d';
}

function Led({ part, sim }: { part: Part; sim: SimResult }) {
  const el = sim.elements.find((e) => e.partId === part.id);
  const mA = Math.max(0, (el?.current ?? 0) * 1000);
  const maxMa = RATINGS.led?.maxMa ?? 30;
  const burnt = mA > maxMa;
  const level = burnt ? 0 : Math.min(1, Math.sqrt(mA / 15));
  const color = ledColor(part.params?.vf ?? 2);
  return (
    <g pointerEvents="none">
      <line x1={0} y1={0} x2={0} y2={-6} stroke="#c9ced6" strokeWidth={2} />
      <line x1={20} y1={0} x2={20} y2={-6} stroke="#c9ced6" strokeWidth={2} />
      {level > 0.02 && <circle cx={10} cy={-17} r={12 + level * 10} fill={color} opacity={level * 0.35} />}
      <path d="M -1 -6 L -1 -17 A 11 11 0 0 1 21 -17 L 21 -6 Z" fill={burnt ? '#2a2a2a' : color} fillOpacity={burnt ? 1 : 0.25 + level * 0.75} stroke="#e8ecf2" strokeOpacity={0.6} />
      <path d="M 4 -17 A 6 6 0 0 1 10 -23" fill="none" stroke="#fff" strokeOpacity={0.5} strokeWidth={2} strokeLinecap="round" />
      {burnt && <path d="M 4 -20 L 16 -9 M 16 -20 L 4 -9" stroke="#ff3b3b" strokeWidth={2} />}
    </g>
  );
}

function Motor({ part, sim }: { part: Part; sim: SimResult }) {
  const el = sim.elements.find((e) => e.partId === part.id && e.label === 'winding');
  const volts = el?.voltage ?? 0;
  const speed = Math.abs(volts) < MIN_SPIN_VOLTS ? 0 : Math.max(-MAX_DEG_PER_SECOND, Math.min(MAX_DEG_PER_SECOND, volts * DEG_PER_VOLT_SECOND));
  const rotor = useRef<SVGGElement>(null);
  const speedRef = useRef(speed);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    const t = { raf: 0, last: performance.now(), deg: 0 };
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - t.last) / 1000);
      t.last = now;
      if (speedRef.current !== 0) {
        t.deg = (t.deg + speedRef.current * dt) % 360;
        rotor.current?.setAttribute('transform', `rotate(${t.deg} 20 -23)`);
      }
      t.raf = requestAnimationFrame(frame);
    };
    t.raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(t.raf);
  }, []);

  return (
    <g pointerEvents="none">
      <line x1={0} y1={0} x2={0} y2={-8} stroke="#c9ced6" strokeWidth={2} />
      <line x1={40} y1={0} x2={40} y2={-8} stroke="#c9ced6" strokeWidth={2} />
      <rect x={4} y={-10} width={32} height={4} fill="#555" />
      <circle cx={20} cy={-23} r={15} fill="#9aa0a8" stroke="#555" strokeWidth={2} />
      <circle cx={20} cy={-23} r={11} fill="#6b7078" />
      <g ref={rotor}>
        <rect x={19} y={-33} width={2} height={20} fill="#e8ecf2" />
        <rect x={10} y={-24} width={20} height={2} fill="#e8ecf2" />
        <circle cx={20} cy={-33} r={2.5} fill="#ff6b3d" />
      </g>
      <circle cx={20} cy={-23} r={3} fill="#2b2f38" />
    </g>
  );
}

function Relay({ part, sim }: { part: Part; sim: SimResult }) {
  const on = sim.relays.has(part.id);
  const armEnd = on ? 20 : 40;
  return (
    <g pointerEvents="none">
      <rect x={10} y={-6} width={60} height={54} rx={3} fill="#2d5a8c" fillOpacity={0.35} stroke="#7db4ff" strokeOpacity={0.5} />
      <polyline points="0,0 14,0 14,8 22,12 10,18 22,24 10,30 22,34 14,38 14,40 0,40" fill="none" stroke={on ? '#ffd24a' : '#c9ced6'} strokeWidth={2} />
      <polyline points="80,0 60,0" fill="none" stroke="#c9ced6" strokeWidth={2} />
      <line x1={80} y1={20} x2={64} y2={20} stroke="#c9ced6" strokeWidth={2} />
      <line x1={80} y1={40} x2={64} y2={40} stroke="#c9ced6" strokeWidth={2} />
      <line x1={60} y1={0} x2={64} y2={armEnd} stroke={on ? '#4ade80' : '#ff9f1c'} strokeWidth={3} strokeLinecap="round" />
      <circle cx={60} cy={0} r={2.5} fill="#e8ecf2" />
    </g>
  );
}

function Lcd({ part }: { part: Part }) {
  const view = useLcd((s) => s.views[part.id]);
  const address = part.params?.address ?? 39;
  const glassX = -12;
  const glassY = -62;
  const cols = 16;
  const cw = 5;
  const rh = 16;
  const lit = !!view?.backlight && view.on;
  const text = lit ? '#10301a' : '#5d8f6c';
  const cells: Array<{ x: number; y: number; ch: string }> = [];
  if (view?.on) {
    view.lines.slice(0, 2).forEach((line, r) => {
      for (let c = 0; c < cols; c++) {
        const ch = view.ready ? (line[c] ?? ' ') : r === 0 ? '█' : ' ';
        if (ch !== ' ') cells.push({ x: glassX + 2 + c * cw + cw / 2, y: glassY + 2 + r * rh + 11, ch });
      }
    });
  }
  return (
    <g pointerEvents="none">
      <rect x={-20} y={-70} width={100} height={64} rx={3} fill="#1f6f4a" stroke="#0e3d29" />
      <rect x={glassX} y={glassY} width={84} height={36} rx={2} fill={lit ? '#7ad06a' : '#274a35'} stroke="#0a1d13" />
      {cells.map((c, i) => (
        <text key={i} x={c.x} y={c.y} textAnchor="middle" fontSize={9} fontFamily="monospace" fontWeight={700} fill={text} opacity={c.ch === '█' ? 0.7 : 1}>
          {c.ch}
        </text>
      ))}
      {view?.on && view.ready && view.cursor && (
        <rect x={glassX + 2 + view.col * cw} y={glassY + 2 + view.row * rh + 13} width={cw - 0.5} height={1.5} fill={text} />
      )}
      {view?.on && view.ready && view.blink && (
        <rect x={glassX + 2 + view.col * cw} y={glassY + 2 + view.row * rh + 2} width={cw - 0.5} height={12} fill={text} opacity={0.5} />
      )}
      <text x={30} y={-26} textAnchor="middle" fontSize={5} fill="#cde9d8">
        I2C 0x{address.toString(16).toUpperCase()}
      </text>
      {['GND', 'VCC', 'SDA', 'SCL'].map((n, i) => (
        <text key={n} x={i * 20} y={-10} textAnchor="middle" fontSize={6} fill="#e8ecf2">
          {n}
        </text>
      ))}
    </g>
  );
}

const SERVO_DEG_PER_SECOND = 300;
const SERVO_PIVOT = { x: 32, y: -25 };

function Servo({ part }: { part: Part }) {
  const target = useServo((s) => s.angles[part.id]);
  const horn = useRef<SVGGElement>(null);
  const targetRef = useRef(target ?? 90);

  useEffect(() => {
    if (target !== undefined) targetRef.current = target;
  }, [target]);

  useEffect(() => {
    const t = { raf: 0, last: performance.now(), deg: targetRef.current };
    const draw = () => horn.current?.setAttribute('transform', `rotate(${t.deg} ${SERVO_PIVOT.x} ${SERVO_PIVOT.y})`);
    draw();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - t.last) / 1000);
      t.last = now;
      const diff = targetRef.current - t.deg;
      if (diff !== 0) {
        const step = SERVO_DEG_PER_SECOND * dt;
        t.deg = Math.abs(diff) <= step ? targetRef.current : t.deg + Math.sign(diff) * step;
        draw();
      }
      t.raf = requestAnimationFrame(frame);
    };
    t.raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(t.raf);
  }, []);

  const { x, y } = SERVO_PIVOT;
  return (
    <g pointerEvents="none">
      <rect x={-8} y={-44} width={56} height={38} rx={3} fill="#3a6ea5" stroke="#1d3d63" />
      <rect x={-12} y={-30} width={4} height={10} fill="#3a6ea5" stroke="#1d3d63" />
      <rect x={48} y={-30} width={4} height={10} fill="#3a6ea5" stroke="#1d3d63" />
      <text x={6} y={-22} textAnchor="middle" fontSize={7} fill="#cfe3ff">SG90</text>
      <circle cx={x} cy={y} r={9} fill="#d7dbe2" stroke="#8a919c" />
      <g ref={horn}>
        <rect x={x - 20} y={y - 3} width={24} height={6} rx={3} fill="#f2f4f8" stroke="#8a919c" />
        <circle cx={x - 17} cy={y} r={1.2} fill="#8a919c" />
        <circle cx={x - 12} cy={y} r={1.2} fill="#8a919c" />
      </g>
      <circle cx={x} cy={y} r={3} fill="#2b2f38" />
      <text x={x} y={-10} textAnchor="middle" fontSize={6} fill="#cfe3ff">{target === undefined ? '' : `${Math.round(target)}°`}</text>
    </g>
  );
}

function Esc() {
  const motorPhases = [
    { y: -26, color: '#e78b32' },
    { y: 0, color: '#e3c33d' },
    { y: 26, color: '#4387c6' },
  ];
  return (
    <g pointerEvents="none">
      <path d="M -70 -20 H -150" stroke="#dc3e3e" strokeWidth={5} fill="none" />
      <path d="M -70 20 H -150" stroke="#20242a" strokeWidth={5} fill="none" />
      <rect x={-166} y={-35} width={30} height={70} rx={5} fill="#e2a62d" stroke="#9b6718" strokeWidth={2} />
      <circle cx={-150} cy={-20} r={5} fill="#a96c16" stroke="#f6ce68" strokeWidth={2} />
      <circle cx={-150} cy={20} r={5} fill="#a96c16" stroke="#f6ce68" strokeWidth={2} />

      <path d="M 70 -26 H 120" stroke="#e78b32" strokeWidth={4} fill="none" />
      <path d="M 70 0 H 120" stroke="#e3c33d" strokeWidth={4} fill="none" />
      <path d="M 70 26 H 120" stroke="#4387c6" strokeWidth={4} fill="none" />
      {motorPhases.map(({ y, color }) => (
        <g key={y}>
          <rect x={106} y={y - 6} width={18} height={12} rx={4} fill="#c6cbd2" stroke="#747b85" />
          <circle cx={120} cy={y} r={3} fill={color} stroke="#343a43" />
        </g>
      ))}

      <path d="M -30 44 V 84" stroke="#d83c3c" strokeWidth={3} fill="none" />
      <path d="M 0 44 V 84" stroke="#f1f1ed" strokeWidth={3} fill="none" />
      <path d="M 30 44 V 84" stroke="#252a32" strokeWidth={3} fill="none" />
      <rect x={-36} y={76} width={72} height={16} rx={3} fill="#353a43" stroke="#16191e" />
      <rect x={-31} y={78} width={62} height={12} rx={2} fill="#252a32" />
      <circle cx={-30} cy={84} r={3} fill="#d83c3c" stroke="#f2a0a0" />
      <circle cx={0} cy={84} r={3} fill="#f1f1ed" stroke="#858991" />
      <circle cx={30} cy={84} r={3} fill="#252a32" stroke="#858991" />

      <rect x={-70} y={-44} width={140} height={88} rx={8} fill="#252a32" stroke="#11151a" strokeWidth={2} />
      <rect x={-62} y={-36} width={124} height={72} rx={5} fill="#343a44" stroke="#555d69" />
      <path d="M -42 -30 V -21 M -28 -30 V -21 M -14 -30 V -21 M 0 -30 V -21 M 14 -30 V -21 M 28 -30 V -21 M 42 -30 V -21" stroke="#969da8" strokeWidth={3} />
      <text x={0} y={-5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#f2f4f8">BRUSHLESS ESC</text>
      <text x={0} y={11} textAnchor="middle" fontSize={7} fill="#bac3d1">3-PHASE SPEED CONTROLLER</text>
      <text x={0} y={25} textAnchor="middle" fontSize={7} fill="#bac3d1">XT60 · 3.5 mm BULLETS</text>
    </g>
  );
}

export function PartGraphic({ part, sim }: { part: Part; sim: SimResult }) {
  switch (part.type) {
    case 'esc':
      return <Esc />;
    case 'servo':
      return <Servo part={part} />;
    case 'lcd1602':
      return <Lcd part={part} />;
    case 'led':
      return <Led part={part} sim={sim} />;
    case 'motor':
      return <Motor part={part} sim={sim} />;
    case 'relay':
      return <Relay part={part} sim={sim} />;
    case 'potentiometer':
      return <Potentiometer part={part} />;
    case 'switch':
      return <ToggleSwitch part={part} />;
    case 'button':
      return <PushButton part={part} />;
    default:
      return null;
  }
}
