import { describe, expect, it } from 'vitest';
import type { PartType } from '../model/parts';
import type { Part, Wire } from '../model/types';
import { pinVoltage, simulate } from './simulate';

let n = 0;
const mk = (type: PartType, params: Record<string, number> = {}): Part => ({
  id: `${type}${n++}`,
  type,
  name: type,
  x: n * 1000,
  y: 0,
  rot: 0,
  params,
});
const wire = (a: Part, pa: string, b: Part, pb: string): Wire => ({
  id: `w${n++}`,
  from: { partId: a.id, pin: pa },
  to: { partId: b.id, pin: pb },
});
const find = (sim: ReturnType<typeof simulate>, part: Part, label: string) =>
  sim.elements.find((e) => e.partId === part.id && e.label === label)!;

describe('NPN transistor', () => {
  // 5 V -> 100 ohm load -> collector; emitter to ground; base resistor from `base`.
  function circuit(baseOhms: number, baseSource: 'supply' | 'ground') {
    const bat = mk('battery', { voltage: 5, rint: 0.001 });
    const load = mk('resistor', { ohms: 100 });
    const rb = mk('resistor', { ohms: baseOhms });
    const q = mk('npn', { beta: 100 });
    const wires = [
      wire(bat, '+', load, 'A'),
      wire(load, 'B', q, 'C'),
      wire(q, 'E', bat, '-'),
      wire(rb, 'B', q, 'B'),
      wire(rb, 'A', bat, baseSource === 'supply' ? '+' : '-'),
    ];
    return { q, load, sim: simulate([bat, load, rb, q], wires) };
  }

  it('is off with its base grounded', () => {
    const { q, sim } = circuit(10000, 'ground');
    expect(sim.converged).toBe(true);
    expect(Math.abs(find(sim, q, 'collector-emitter').current)).toBeLessThan(1e-6);
  });

  it('amplifies base current in the active region', () => {
    // Ib = (5 - 0.7) / 47 k = 0.09 mA, Ic = 100 x Ib = 9 mA
    const { q, sim } = circuit(47000, 'supply');
    const ic = find(sim, q, 'collector-emitter').current;
    expect(ic).toBeGreaterThan(0.0085);
    expect(ic).toBeLessThan(0.0095);
  });

  it('saturates when the load limits the current', () => {
    const { q, load, sim } = circuit(4700, 'supply');
    const ce = find(sim, q, 'collector-emitter');
    expect(ce.voltage).toBeLessThan(0.3);
    expect(ce.current).toBeGreaterThan(0.045);
    expect(ce.current).toBeLessThan(0.05);
    expect(pinVoltage(sim, load.id, 'B')).toBeLessThan(0.3);
  });
});

describe('N-MOSFET', () => {
  function circuit(gateVolts: number) {
    const supply = mk('battery', { voltage: 5, rint: 0.001 });
    const gate = mk('battery', { voltage: gateVolts, rint: 0.001 });
    const load = mk('resistor', { ohms: 10 });
    const m = mk('nmos', { vth: 2, rds: 0.05 });
    const wires = [
      wire(supply, '+', load, 'A'),
      wire(load, 'B', m, 'D'),
      wire(m, 'S', supply, '-'),
      wire(gate, '+', m, 'G'),
      wire(gate, '-', supply, '-'),
    ];
    return { m, sim: simulate([supply, gate, load, m], wires) };
  }

  it('conducts with low resistance when the gate is high', () => {
    const { m, sim } = circuit(5);
    const ds = find(sim, m, 'drain-source');
    expect(sim.converged).toBe(true);
    expect(ds.current).toBeGreaterThan(0.49);
    expect(ds.voltage).toBeLessThan(0.1);
  });

  it('blocks below the threshold', () => {
    const { m, sim } = circuit(1);
    expect(Math.abs(find(sim, m, 'drain-source').current)).toBeLessThan(1e-6);
  });

  it('is only partly on near the threshold', () => {
    const { m, sim } = circuit(2.1);
    const ds = find(sim, m, 'drain-source');
    expect(ds.current).toBeGreaterThan(0.01);
    expect(ds.voltage).toBeGreaterThan(0.3);
  });
});

describe('relay', () => {
  function circuit(coilVolts: number) {
    const coilSupply = mk('battery', { voltage: coilVolts, rint: 0.01 });
    const loadSupply = mk('battery', { voltage: 12, rint: 0.01 });
    const relay = mk('relay', { coilV: 5, coilOhms: 70 });
    const load = mk('resistor', { ohms: 120 });
    const wires = [
      wire(coilSupply, '+', relay, 'COIL+'),
      wire(coilSupply, '-', relay, 'COIL-'),
      wire(coilSupply, '-', loadSupply, '-'),
      wire(loadSupply, '+', relay, 'COM'),
      wire(relay, 'NO', load, 'A'),
      wire(load, 'B', loadSupply, '-'),
    ];
    return { relay, sim: simulate([coilSupply, loadSupply, relay, load], wires) };
  }

  it('closes the normally-open contact when the coil is powered', () => {
    const { relay, sim } = circuit(5);
    expect(sim.relays.has(relay.id)).toBe(true);
    expect(find(sim, relay, 'contact').current).toBeCloseTo(0.1, 2);
    expect(find(sim, relay, 'coil').current).toBeCloseTo(5 / 70, 3);
  });

  it('stays released with too little coil voltage', () => {
    const { relay, sim } = circuit(2);
    expect(sim.relays.has(relay.id)).toBe(false);
    expect(Math.abs(find(sim, relay, 'contact').current)).toBeLessThan(1e-6);
  });
});

describe('buck converter', () => {
  function circuit(vin: number, loadOhms: number, vout = 5) {
    const bat = mk('battery', { voltage: vin, rint: 0.05 });
    const buck = mk('buck', { vout, eff: 0.85 });
    const load = mk('resistor', { ohms: loadOhms });
    const wires = [
      wire(bat, '+', buck, 'IN+'),
      wire(bat, '-', buck, 'IN-'),
      wire(buck, 'OUT+', load, 'A'),
      wire(buck, 'OUT-', load, 'B'),
    ];
    return { buck, load, bat, sim: simulate([bat, buck, load], wires) };
  }

  it('regulates its output and draws less input current than output current', () => {
    const { buck, load, bat, sim } = circuit(12, 50);
    expect(sim.converged).toBe(true);
    expect(pinVoltage(sim, load.id, 'A')).toBeGreaterThan(4.9);
    const iin = -sim.elements.find((e) => e.partId === bat.id)!.current;
    // 5 V x 0.1 A / (0.85 x 12 V) = 49 mA
    expect(iin).toBeGreaterThan(0.045);
    expect(iin).toBeLessThan(0.053);
    expect(sim.bucks.get(buck.id)!.vout).toBeGreaterThan(4.9);
  });

  it('cannot hold 5 V from a 4 V input', () => {
    const { load, sim } = circuit(4, 50);
    expect(pinVoltage(sim, load.id, 'A')).toBeLessThan(3.2);
  });

  it('adjusts the output down to the 1.25 V minimum', () => {
    const { buck, load, sim } = circuit(5, 100, 1.25);
    expect(pinVoltage(sim, load.id, 'A')).toBeCloseTo(1.25, 2);
    expect(sim.bucks.get(buck.id)?.vout).toBeCloseTo(1.25, 2);
  });

  it('supports a 35 V output target with the expected headroom', () => {
    const { buck, load, sim } = circuit(35, 1000, 35);
    expect(pinVoltage(sim, load.id, 'A')).toBeCloseTo(34, 1);
    expect(sim.bucks.get(buck.id)?.vout).toBeCloseTo(34, 1);
  });

  it('turns the output off outside the 3.2-35 V input range', () => {
    for (const vin of [3.1, 35.1]) {
      const { buck, load, sim } = circuit(vin, 100);
      expect(sim.bucks.get(buck.id)?.vout).toBeCloseTo(0, 2);
      expect(pinVoltage(sim, load.id, 'A')).toBeCloseTo(0, 2);
    }
  });
});

describe('loads and instruments', () => {
  it('servo draws its running current at 5 V', () => {
    const bat = mk('battery', { voltage: 5, rint: 0.01 });
    const servo = mk('servo', { runMa: 250 });
    const sim = simulate([bat, servo], [wire(bat, '+', servo, 'V+'), wire(bat, '-', servo, 'GND')]);
    expect(find(sim, servo, 'motor and electronics').current).toBeCloseTo(0.25, 2);
  });

  it('sensor pull-ups pull SDA up to the supply', () => {
    const bat = mk('battery', { voltage: 5, rint: 0.01 });
    const sensor = mk('i2c-sensor', { pullups: 1 });
    const sim = simulate([bat, sensor], [wire(bat, '+', sensor, 'VCC'), wire(bat, '-', sensor, 'GND')]);
    expect(pinVoltage(sim, sensor.id, 'SDA')).toBeGreaterThan(4.9);
  });

  it('voltmeter reads the voltage and barely loads the circuit; ammeter reads the current', () => {
    const bat = mk('battery', { voltage: 6, rint: 0.001 });
    const r = mk('resistor', { ohms: 100 });
    const volt = mk('multimeter', { ammeter: 0 });
    const sim = simulate([bat, r, volt], [wire(bat, '+', r, 'A'), wire(r, 'B', bat, '-'), wire(volt, 'V/A', r, 'A'), wire(volt, 'COM', r, 'B')]);
    expect(find(sim, volt, 'meter').voltage).toBeCloseTo(6, 2);

    const amm = mk('multimeter', { ammeter: 1 });
    const series = simulate([bat, r, amm], [wire(bat, '+', amm, 'V/A'), wire(amm, 'COM', r, 'A'), wire(r, 'B', bat, '-')]);
    expect(find(series, amm, 'meter').current).toBeCloseTo(0.06, 3);
  });

  it('probe replaces a part with a resistor', () => {
    const bat = mk('battery', { voltage: 5, rint: 0.001 });
    const led = mk('led');
    const r = mk('resistor', { ohms: 100 });
    const wires = [wire(bat, '+', r, 'A'), wire(r, 'B', led, 'A'), wire(led, 'K', bat, '-')];
    const open = simulate([bat, led, r], wires, { partId: led.id, ohms: 1e9 });
    expect(pinVoltage(open, led.id, 'A')).toBeCloseTo(5, 2);
  });
});
