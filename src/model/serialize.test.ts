import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../examples';
import { parse } from '../script/lang';
import { checkCircuit } from '../sim/checks';
import { simulate } from '../sim/simulate';
import { addSuggestions } from '../sim/suggest';
import { parseCircuit, serializeCircuit } from './serialize';

const analyse = (id: string, edit?: (e: (typeof EXAMPLES)[number]) => void) => {
  const ex = structuredClone(EXAMPLES.find((e) => e.id === id)!);
  edit?.(ex);
  const sim = simulate(ex.parts, ex.wires);
  return { ex, sim, issues: addSuggestions(checkCircuit(ex.parts, sim), ex.parts, ex.wires, sim) };
};

describe('save and load', () => {
  const base = EXAMPLES[0];
  const json = (mutate?: (o: Record<string, unknown>) => void) => {
    const o = JSON.parse(serializeCircuit({ parts: base.parts, wires: base.wires, source: base.source, wireLimitMa: 800 }));
    mutate?.(o);
    return JSON.stringify(o);
  };

  it('round-trips parts, wires, colours, code and the wire limit', () => {
    const f = parseCircuit(json());
    expect(f.parts).toEqual(base.parts);
    expect(f.wires).toEqual(base.wires);
    expect(f.source).toBe(base.source);
    expect(f.wireLimitMa).toBe(800);
    expect(f.wires[0].color).toBe('#f5d90a');
  });

  it('rejects broken or foreign files with a readable message', () => {
    expect(() => parseCircuit('nope')).toThrow(/not valid JSON/);
    expect(() => parseCircuit('{"a":1}')).toThrow(/not a circuit file/);
    expect(() => parseCircuit(json((o) => (o.version = 99)))).toThrow(/newer version/);
    expect(() => parseCircuit(json((o) => ((o.parts as { type: string }[])[0].type = 'warp-drive')))).toThrow(/unknown part type/);
    expect(() => parseCircuit(json((o) => ((o.wires as { to: { pin: string } }[])[0].to.pin = 'ZZ')))).toThrow(/no pin "ZZ"/);
    expect(() => parseCircuit(json((o) => ((o.wires as { from: { partId: string } }[])[0].from.partId = 'ghost')))).toThrow(/unknown part/);
  });

  it('ignores an invalid wire colour', () => {
    const f = parseCircuit(json((o) => ((o.wires as { color: string }[])[0].color = 'url(javascript:1)')));
    expect(f.wires[0].color).toBeUndefined();
  });
});

describe('examples', () => {
  it('all have valid files, parsable sketches and no solver warnings', () => {
    for (const ex of EXAMPLES) {
      const f = parseCircuit(serializeCircuit({ parts: ex.parts, wires: ex.wires, source: ex.source, wireLimitMa: 1000 }));
      expect(f.wires.length).toBe(ex.wires.length);
      expect(() => parse(ex.source)).not.toThrow();
      expect(simulate(ex.parts, ex.wires).warnings, ex.id).toEqual([]);
      expect(ex.steps.length).toBeGreaterThan(0);
    }
  });

  it('the blink circuit is safe', () => {
    const { issues } = analyse('blink', (e) => {
      e.parts.find((p) => p.id === 'esp')!.pinModes = { D4: 'high' };
    });
    expect(issues.filter((i) => i.severity !== 'info')).toEqual([]);
  });

  it('the no-resistor circuit reports an overload with a suggestion', () => {
    const { issues } = analyse('no-resistor', (e) => {
      e.parts.find((p) => p.id === 'esp')!.pinModes = { D4: 'high' };
    });
    expect(issues.some((i) => i.suggestion)).toBe(true);
    expect(issues.some((i) => i.severity !== 'info')).toBe(true);
  });

  it('the motor circuit needs its diode', () => {
    const run = (drop: boolean) =>
      analyse('motor', (e) => {
        e.parts.find((p) => p.id === 'esp')!.pinModes = { D4: 'high' };
        if (drop) {
          e.parts = e.parts.filter((p) => p.id !== 'd1');
          e.wires = e.wires.filter((w) => w.from.partId !== 'd1');
        }
      }).issues;
    expect(run(false).filter((i) => i.severity !== 'info')).toEqual([]);
    expect(run(true).some((i) => i.id.startsWith('flyback:'))).toBe(true);
  });
});
