import type { PartType } from './parts';

/** How the running script has configured a GPIO. Pins without an entry are plain inputs. */
export type PinMode = 'in' | 'adc' | 'high' | 'low' | 'pullup' | 'pulldown';

export const PIN_MODE_LABEL: Record<PinMode, string> = {
  in: 'INPUT',
  adc: 'analog input',
  high: 'OUTPUT HIGH',
  low: 'OUTPUT LOW',
  pullup: 'INPUT_PULLUP',
  pulldown: 'INPUT_PULLDOWN',
};

export const GPIO_PULL_OHMS = 45000;

export type BoardType = Extract<PartType, 'esp32-devkit-v1' | 'esp32-s3' | 'esp32-c3'>;

export type PinRole =
  | { kind: 'gpio'; gpio: number }
  | { kind: 'gnd' }
  | { kind: '3v3' }
  | { kind: '5v' }
  | { kind: 'other' };

export interface BoardDef {
  type: BoardType;
  /** Pin that carries the 5 V rail (USB 5 V / VIN). */
  vinPin: string;
  inputOnly: number[];
  /** GPIO number -> what the boot ROM does with it. */
  strapping: Record<number, string>;
  /** GPIOs on ADC2, which cannot be used for analog reads while Wi-Fi is on. */
  adc2: number[];
  /** Pin-name aliases for named (non "D<n>") GPIO pins. */
  aliases: Record<string, number>;
  /** Regulator output limit in mA (5 V -> 3.3 V LDO). */
  ldoMaxMa: number;
  /** Typical consumption of the chip itself, which eats into the 3.3 V budget. */
  selfMa: number;
}

export const BOARDS: Record<BoardType, BoardDef> = {
  'esp32-devkit-v1': {
    type: 'esp32-devkit-v1',
    vinPin: 'VIN',
    inputOnly: [34, 35, 36, 39],
    strapping: {
      0: 'must be HIGH at boot (LOW enters download mode)',
      2: 'must be LOW or floating at boot',
      5: 'should be HIGH at boot',
      12: 'must be LOW at boot (HIGH selects 1.8 V flash and the board will not boot)',
      15: 'HIGH at boot enables boot log; keep it HIGH or floating',
    },
    adc2: [0, 2, 4, 12, 13, 14, 15, 25, 26, 27],
    aliases: { VP: 36, VN: 39, TX0: 1, RX0: 3, TX2: 17, RX2: 16 },
    ldoMaxMa: 800,
    selfMa: 80,
  },
  'esp32-s3': {
    type: 'esp32-s3',
    vinPin: '5V',
    inputOnly: [],
    strapping: {
      0: 'must be HIGH at boot (LOW enters download mode)',
      3: 'selects the JTAG signal source at boot',
      45: 'must be LOW at boot (HIGH selects 1.8 V flash)',
      46: 'must be LOW or floating at boot (ROM message / download mode)',
    },
    adc2: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    aliases: { TX: 43, RX: 44 },
    ldoMaxMa: 500,
    selfMa: 100,
  },
  'esp32-c3': {
    type: 'esp32-c3',
    vinPin: '5V',
    inputOnly: [],
    strapping: {
      2: 'must be HIGH or floating at boot',
      8: 'must be HIGH at boot',
      9: 'must be HIGH at boot (LOW enters download mode)',
    },
    adc2: [5],
    aliases: { TX: 21, RX: 20 },
    ldoMaxMa: 500,
    selfMa: 70,
  },
};

export function isBoardType(t: PartType): t is BoardType {
  return t in BOARDS;
}

export function pinRole(board: BoardDef, pin: string): PinRole {
  if (/^GND\d*$/.test(pin)) return { kind: 'gnd' };
  if (/^3V3b?$/.test(pin)) return { kind: '3v3' };
  if (pin === board.vinPin || /^5Vb?$/.test(pin)) return { kind: '5v' };
  const m = /^D(\d+)$/.exec(pin);
  if (m) return { kind: 'gpio', gpio: Number(m[1]) };
  const alias = board.aliases[pin];
  if (alias !== undefined) return { kind: 'gpio', gpio: alias };
  return { kind: 'other' };
}

export const GPIO_ABS_MAX_MA = 40;
export const GPIO_RECOMMENDED_MA = 20;
export const GPIO_OUT_OHMS = 30;
export const GPIO_HIGH_VOLTS = 3.3;
export const MAX_PIN_VOLTS = 3.6;
export const USB_BUDGET_MA = 500;
