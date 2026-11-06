import type { PartType } from './parts';
import type { Part } from './types';

export interface ParamDef {
  key: string;
  label: string;
  unit: string;
  default: number;
  /** Rendered as a checkbox; value is 0 or 1. */
  bool?: boolean;
  min?: number;
  max?: number;
}

function BOARD_PARAMS(): ParamDef[] {
  return [
    { key: 'usb', label: 'Powered by USB', unit: '', default: 1, bool: true },
    { key: 'wifi', label: 'Wi-Fi enabled', unit: '', default: 0, bool: true },
  ];
}

export const PARAMS: Partial<Record<PartType, ParamDef[]>> = {
  'esp32-devkit-v1': BOARD_PARAMS(),
  'esp32-s3': BOARD_PARAMS(),
  'esp32-c3': BOARD_PARAMS(),
  resistor: [{ key: 'ohms', label: 'Resistance', unit: 'Ω', default: 220, min: 0.001 }],
  potentiometer: [
    { key: 'ohms', label: 'Total resistance', unit: 'Ω', default: 10000, min: 1 },
    { key: 'position', label: 'Wiper position', unit: '0-1', default: 0.5, min: 0, max: 1 },
  ],
  led: [{ key: 'vf', label: 'Forward voltage @20mA', unit: 'V', default: 2.0, min: 1, max: 4 }],
  zener: [{ key: 'vz', label: 'Zener voltage', unit: 'V', default: 5.1, min: 1.5, max: 100 }],
  fuse: [{ key: 'ratedA', label: 'Rated current', unit: 'A', default: 0.5, min: 0.001 }],
  button: [{ key: 'pressed', label: 'Pressed', unit: '', default: 0, bool: true }],
  switch: [{ key: 'closed', label: 'Closed', unit: '', default: 0, bool: true }],
  battery: [
    { key: 'voltage', label: 'Voltage', unit: 'V', default: 9, min: 0 },
    { key: 'rint', label: 'Internal resistance', unit: 'Ω', default: 0.5, min: 0.001 },
  ],
  usb5v: [{ key: 'voltage', label: 'Voltage', unit: 'V', default: 5, min: 0 }],
  motor: [{ key: 'ohms', label: 'Winding resistance', unit: 'Ω', default: 20, min: 0.1 }],
  npn: [
    { key: 'beta', label: 'Current gain (β)', unit: '', default: 100, min: 10, max: 500 },
    { key: 'maxMa', label: 'Max collector current', unit: 'mA', default: 600, min: 1 },
  ],
  nmos: [
    { key: 'vth', label: 'Gate threshold', unit: 'V', default: 2, min: 0.5, max: 5 },
    { key: 'rds', label: 'On-resistance @4.5 V', unit: 'Ω', default: 0.05, min: 0.001 },
    { key: 'maxA', label: 'Max drain current', unit: 'A', default: 10, min: 0.01 },
  ],
  relay: [
    { key: 'coilV', label: 'Coil voltage', unit: 'V', default: 5, min: 1 },
    { key: 'coilOhms', label: 'Coil resistance', unit: 'Ω', default: 70, min: 5 },
    { key: 'contactA', label: 'Contact rating', unit: 'A', default: 10, min: 0.1 },
  ],
  servo: [{ key: 'runMa', label: 'Running current @5 V', unit: 'mA', default: 250, min: 10 }],
  buck: [
    { key: 'vout', label: 'Output voltage', unit: 'V', default: 5, min: 1, max: 30 },
    { key: 'ratedA', label: 'Max output current', unit: 'A', default: 2, min: 0.1 },
    { key: 'eff', label: 'Efficiency', unit: '0-1', default: 0.85, min: 0.3, max: 0.99 },
  ],
  'i2c-sensor': [
    { key: 'ma', label: 'Supply current', unit: 'mA', default: 1, min: 0.01 },
    { key: 'maxV', label: 'Max supply voltage', unit: 'V', default: 3.6, min: 1.8 },
    { key: 'pullups', label: 'Has SDA/SCL pull-ups', unit: '', default: 1, bool: true },
  ],
  lcd1602: [
    { key: 'address', label: 'I2C address (0x27 = 39, 0x3F = 63)', unit: '', default: 39, min: 1, max: 127 },
    { key: 'ma', label: 'Supply current (backlight on)', unit: 'mA', default: 25, min: 0.1 },
    { key: 'pullups', label: 'Has SDA/SCL pull-ups to VCC', unit: '', default: 1, bool: true },
  ],
  multimeter: [{ key: 'ammeter', label: 'Ammeter mode (default: voltmeter)', unit: '', default: 0, bool: true }],
};

export function defaultParams(type: PartType): Record<string, number> {
  return Object.fromEntries((PARAMS[type] ?? []).map((p) => [p.key, p.default]));
}

export function param(part: Part, key: string): number {
  const v = part.params?.[key];
  if (v !== undefined) return v;
  const def = PARAMS[part.type]?.find((p) => p.key === key);
  if (!def) throw new Error(`Unknown param ${key} for ${part.type}`);
  return def.default;
}
