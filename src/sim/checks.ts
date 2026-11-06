import {
  BOARDS,
  GPIO_ABS_MAX_MA,
  GPIO_RECOMMENDED_MA,
  MAX_PIN_VOLTS,
  USB_BUDGET_MA,
  isBoardType,
  pinRole,
  type BoardDef,
} from '../model/boards';
import { pinKey } from '../model/connectivity';
import { param } from '../model/params';
import { PART_DEFS } from '../model/parts';
import { RATINGS } from '../model/ratings';
import type { Part } from '../model/types';
import { pinVoltage, type SimResult } from './simulate';
import { checkDevices } from './deviceChecks';
import type { Fix } from './fix';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Parts to highlight. */
  partIds: string[];
  /** Nets whose wires should blink. */
  nets: number[];
  /** Specific wires that should blink. */
  wireIds?: string[];
  /** What the suggestion engine should calculate for this problem. */
  fix?: Fix;
  /** Calculated advice, filled in by `addSuggestions`. */
  suggestion?: string;
}

const ma = (a: number) => Math.abs(a) * 1000;
const fmtMa = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(2)} A` : `${x.toFixed(x < 10 ? 1 : 0)} mA`);

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

interface BoardPart {
  part: Part;
  def: BoardDef;
}

export function checkCircuit(parts: Part[], sim: SimResult): Issue[] {
  const issues: Issue[] = [];
  const push = (i: Issue) => issues.push(i);
  const boards: BoardPart[] = parts
    .filter((p) => isBoardType(p.type))
    .map((part) => ({ part, def: BOARDS[part.type as keyof typeof BOARDS] }));

  // Component ratings and short circuits
  for (const e of sim.elements) {
    const amps = Math.abs(e.current);
    const watts = Math.abs(e.current * e.voltage);

    if (e.role === 'load') {
      const part = parts.find((p) => p.id === e.partId)!;
      const base = { partIds: [e.partId], nets: [e.netA, e.netB] };
      if (e.partType === 'fuse') {
        const rated = param(part, 'ratedA');
        if (amps > rated) {
          push({
            ...base,
            id: `fuse:${e.partId}`,
            severity: 'error',
            title: `${e.partName}: fuse would blow`,
            detail: `${fmtMa(amps * 1000)} flows but the fuse is rated ${fmtMa(rated * 1000)}. Reduce the load or choose a higher-rated fuse.`,
          });
        }
        continue;
      }
      const rating = RATINGS[e.partType];
      if (!rating) continue;
      if (rating.maxMa !== undefined && ma(amps) > rating.maxMa) {
        push({
          ...base,
          id: `max-ma:${e.id}`,
          severity: 'error',
          title: `${e.partName}: current too high`,
          detail: `${fmtMa(ma(amps))} exceeds the ${fmtMa(rating.maxMa)} limit of a ${rating.note}. ${
            e.partType === 'led' ? 'Add or increase a series resistor.' : 'Limit the current, e.g. with a series resistor.'
          }`,
          fix: e.partType === 'led' ? { kind: 'led-resistor', partId: e.partId } : undefined,
        });
      } else if (rating.warnMa !== undefined && ma(amps) > rating.warnMa) {
        push({
          ...base,
          id: `warn-ma:${e.id}`,
          severity: 'warning',
          title: `${e.partName}: running hot`,
          detail: `${fmtMa(ma(amps))} is above the ${fmtMa(rating.warnMa)} recommended for a ${rating.note}. Consider a larger series resistor.`,
          fix: e.partType === 'led' ? { kind: 'led-resistor', partId: e.partId } : undefined,
        });
      }
      if (rating.maxWatts !== undefined && watts > rating.maxWatts) {
        push({
          ...base,
          id: `watts:${e.id}`,
          severity: 'error',
          title: `${e.partName}: over its power rating`,
          detail: `It dissipates ${(watts * 1000).toFixed(0)} mW but a ${rating.note} handles ${(rating.maxWatts * 1000).toFixed(0)} mW. Use a higher-wattage part or raise the resistance.`,
          fix: e.partType === 'resistor' ? { kind: 'resistor-power', volts: Math.abs(e.voltage), watts } : undefined,
        });
      }
      if (rating.maxVolts !== undefined && Math.abs(e.voltage) > rating.maxVolts) {
        push({
          ...base,
          id: `volts:${e.id}`,
          severity: 'error',
          title: `${e.partName}: voltage too high`,
          detail: `${Math.abs(e.voltage).toFixed(1)} V exceeds the ${rating.maxVolts} V limit of a ${rating.note}.`,
        });
      }
      continue;
    }

    if (e.role === 'supply' || e.role === 'rail3v3' || e.role === 'rail5v') {
      const sourced = -e.current;
      const direct = e.netA === e.netB;
      const loadOhms = sourced > 1e-6 ? e.voltage / sourced : Infinity;
      if (direct || (sourced > 0.05 && loadOhms < 2)) {
        push({
          id: `short:${e.id}`,
          severity: 'error',
          title: `Short circuit on ${e.partName}`,
          detail: `${e.partName}'s ${e.label} is connected almost directly to its own return path (${direct ? 'same node' : `${loadOhms.toFixed(2)} Ω load`}), drawing ${fmtMa(ma(sourced))}. Find the wire or pin that joins + to − and remove it, or add a load such as a resistor.`,
          partIds: [e.partId],
          nets: [e.netA, e.netB],
        });
      }
      if (e.partType === 'usb5v' && ma(sourced) > USB_BUDGET_MA) {
        push({
          id: `usb-part:${e.id}`,
          severity: 'warning',
          title: `${e.partName}: over the USB current budget`,
          detail: `${fmtMa(ma(sourced))} is above the ${USB_BUDGET_MA} mA a USB 2.0 port provides.`,
          partIds: [e.partId],
          nets: [e.netA],
        });
      }
    }

    if (e.role === 'gpio') {
      const board = boards.find((b) => b.part.id === e.partId)!;
      const role = pinRole(board.def, e.pinA);
      const gpio = role.kind === 'gpio' ? role.gpio : 0;
      const m = ma(amps);
      const base = { partIds: [e.partId], nets: [e.netA] };
      const dir = e.current < 0 ? 'source' : 'sink';
      if (m > GPIO_ABS_MAX_MA) {
        push({
          ...base,
          id: `gpio-max:${e.id}`,
          severity: 'error',
          title: `${e.partName} GPIO${gpio}: overloaded`,
          detail: `The pin would ${dir} ${fmtMa(m)}, above the ${GPIO_ABS_MAX_MA} mA absolute maximum. It can be damaged. Add a series resistor, or drive heavy loads through a transistor/MOSFET.`,
          fix: { kind: 'gpio-load', boardId: e.partId, pin: e.pinA, amps, sourcing: e.current < 0 },
        });
      } else if (m > GPIO_RECOMMENDED_MA) {
        push({
          ...base,
          id: `gpio-warn:${e.id}`,
          severity: 'warning',
          title: `${e.partName} GPIO${gpio}: above recommended current`,
          detail: `The pin would ${dir} ${fmtMa(m)}. Keep it under ${GPIO_RECOMMENDED_MA} mA (absolute max ${GPIO_ABS_MAX_MA} mA) with a series resistor or a transistor.`,
          fix: { kind: 'gpio-load', boardId: e.partId, pin: e.pinA, amps, sourcing: e.current < 0 },
        });
      }
    }
  }

  // Board rails
  for (const { part, def } of boards) {
    if (!sim.poweredBoards.has(part.id)) continue;
    const el = (role: string) => sim.elements.find((e) => e.partId === part.id && e.role === role);
    const r3 = el('rail3v3');
    const r5 = el('rail5v');
    const ext3 = r3 ? Math.max(0, ma(-r3.current)) : 0;
    const total3 = ext3 + def.selfMa;
    const limit = def.ldoMaxMa;
    if (r3 && total3 > limit) {
      push({
        id: `ldo:${part.id}`,
        severity: 'error',
        title: `${part.name}: 3.3 V regulator overloaded`,
        detail: `Your circuit takes ${fmtMa(ext3)} from 3V3, plus about ${def.selfMa} mA for the chip itself: ${fmtMa(total3)} total against a ${fmtMa(limit)} regulator. Power the load from 5 V instead.`,
        partIds: [part.id],
        nets: [r3.netA],
      });
    } else if (r3 && total3 > limit * 0.8) {
      push({
        id: `ldo-warn:${part.id}`,
        severity: 'warning',
        title: `${part.name}: 3.3 V rail near its limit`,
        detail: `${fmtMa(total3)} of ${fmtMa(limit)} used (including ~${def.selfMa} mA for the chip). Wi-Fi bursts can push it over.`,
        partIds: [part.id],
        nets: [r3.netA],
      });
    }
    if (r5) {
      const ext5 = Math.max(0, ma(-r5.current));
      const usbTotal = ext5 + total3;
      if (usbTotal > USB_BUDGET_MA) {
        push({
          id: `usb:${part.id}`,
          severity: usbTotal > 2 * USB_BUDGET_MA ? 'error' : 'warning',
          title: `${part.name}: USB power budget exceeded`,
          detail: `About ${fmtMa(usbTotal)} drawn from USB (5 V pin ${fmtMa(ext5)} + 3.3 V side ${fmtMa(total3)}), above the ${USB_BUDGET_MA} mA a USB 2.0 port provides. Use an external supply for the load.`,
          partIds: [part.id],
          nets: [r5.netA],
        });
      }
    }
  }

  // Pins: voltage, mode, strapping, ADC2
  const drivers = new Map<number, { high: string[]; low: string[] }>();
  for (const { part, def } of boards) {
    const wifi = param(part, 'wifi') === 1;
    const powered = sim.poweredBoards.has(part.id);
    for (const pd of PART_DEFS[part.type].pins) {
      const role = pinRole(def, pd.name);
      const net = sim.nets.netOf.get(pinKey({ partId: part.id, pin: pd.name }))!;
      const v = pinVoltage(sim, part.id, pd.name) ?? 0;
      const label = role.kind === 'gpio' ? `GPIO${role.gpio}` : pd.name;
      const base = { partIds: [part.id], nets: [net] };

      if (role.kind === 'gpio' || role.kind === '3v3') {
        if (v > MAX_PIN_VOLTS) {
          push({
            ...base,
            id: `overvolt:${part.id}:${pd.name}`,
            severity: 'error',
            title: `${part.name} ${label}: ${v.toFixed(1)} V on a 3.3 V pin`,
            detail: `ESP32 pins tolerate at most about ${MAX_PIN_VOLTS} V. Use a voltage divider (e.g. 10 kΩ + 20 kΩ) or a level shifter for 5 V signals.`,
            fix: { kind: 'divider', volts: v },
          });
        } else if (role.kind === 'gpio' && v < -0.3) {
          push({
            ...base,
            id: `undervolt:${part.id}:${pd.name}`,
            severity: 'error',
            title: `${part.name} ${label}: negative voltage`,
            detail: `The pin sees ${v.toFixed(1)} V, below the −0.3 V limit.`,
          });
        }
      }
      if (role.kind !== 'gpio') continue;

      const mode = part.pinModes?.[pd.name] ?? 'in';
      const output = mode === 'high' || mode === 'low';

      if (output && def.inputOnly.includes(role.gpio)) {
        push({
          ...base,
          id: `inonly:${part.id}:${pd.name}`,
          severity: 'error',
          title: `${part.name} ${label} is input-only`,
          detail: `GPIO${role.gpio} cannot drive an output on this chip. Move the load to an output-capable pin.`,
        });
      }

      if (output && powered) {
        const d = drivers.get(net) ?? { high: [], low: [] };
        d[mode === 'high' ? 'high' : 'low'].push(`${part.name} ${label}`);
        drivers.set(net, d);
      }

      if (wifi && mode === 'adc' && def.adc2.includes(role.gpio)) {
        push({
          ...base,
          id: `adc2:${part.id}:${pd.name}`,
          severity: 'error',
          title: `${part.name} ${label}: ADC2 conflicts with Wi-Fi`,
          detail: `GPIO${role.gpio} is on ADC2, whose analog reads fail while Wi-Fi is active. Use an ADC1 pin instead${
            def.type === 'esp32-devkit-v1' ? ' (GPIO32–39)' : ''
          }.`,
        });
      }

      const note = def.strapping[role.gpio];
      if (note) {
        const hasExternal = (sim.nets.nets[net] ?? []).some((k) => {
          const [pid, pin] = k.split(':');
          const other = parts.find((p) => p.id === pid);
          return other && other.type !== 'breadboard' && !(pid === part.id && pin === pd.name);
        });
        if (hasExternal || output) {
          const forcesHigh = !output && /must be LOW/.test(note) && v > 2;
          push({
            ...base,
            id: `strap:${part.id}:${pd.name}`,
            severity: forcesHigh ? 'error' : 'warning',
            title: `${part.name} ${label} is a strapping pin`,
            detail: `${forcesHigh ? `It is held at ${v.toFixed(1)} V, so the board will fail to boot normally. ` : ''}At boot this pin ${note}. Anything attached must not force the wrong level while the board starts.`,
          });
        }
      }
    }
  }

  for (const [net, d] of drivers) {
    if (d.high.length > 0 && d.low.length > 0) {
      push({
        id: `contention:${net}`,
        severity: 'error',
        title: 'Output contention',
        detail: `${d.high.join(', ')} drive HIGH while ${d.low.join(', ')} drive LOW on the same connection. This shorts 3.3 V to ground through the pins.`,
        partIds: [],
        nets: [net],
      });
    }
  }

  issues.push(...checkDevices(parts, sim));
  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
