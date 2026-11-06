/** What a check wants the suggestion engine to work out; resolved into text by `suggest.ts`. */
export type Fix =
  | { kind: 'led-resistor'; partId: string }
  | { kind: 'resistor-power'; volts: number; watts: number }
  | { kind: 'gpio-load'; boardId: string; pin: string; amps: number; sourcing: boolean }
  | { kind: 'divider'; volts: number }
  | { kind: 'flyback'; amps: number }
  | { kind: 'bulk-cap'; amps: number; volts: number }
  | { kind: 'i2c-pullup'; volts: number }
  | { kind: 'mosfet-gate'; vth: number };
