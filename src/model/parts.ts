export const GRID = 20;

export type PartType =
  | 'breadboard'
  | 'esp32-devkit-v1'
  | 'esp32-s3'
  | 'esp32-c3'
  | 'resistor'
  | 'led'
  | 'button'
  | 'switch'
  | 'potentiometer'
  | 'diode'
  | 'zener'
  | 'capacitor'
  | 'fuse'
  | 'battery'
  | 'usb5v'
  | 'buck'
  | 'npn'
  | 'nmos'
  | 'relay'
  | 'motor'
  | 'servo'
  | 'esc'
  | 'i2c-sensor'
  | 'lcd1602'
  | 'multimeter';

export interface PinDef {
  name: string;
  x: number;
  y: number;
}

export interface PartDef {
  type: PartType;
  label: string;
  prefix: string;
  category: 'Boards' | 'Passive' | 'Semiconductors' | 'Power' | 'Loads & Switching' | 'Sensors & Tools' | 'Prototyping';
  pins: PinDef[];
  body: { x: number; y: number; w: number; h: number };
  color: string;
}

const row = (names: string[], y: number): PinDef[] => names.map((name, i) => ({ name, x: i * GRID, y }));

// Boards lie horizontally so that the two pin rows plug into breadboard rows e and f (40px apart).
function board(type: PartType, label: string, top: string[], bottom: string[], color: string): PartDef {
  const n = Math.max(top.length, bottom.length);
  return {
    type,
    label,
    prefix: 'ESP',
    category: 'Boards',
    pins: [...row(top, 0), ...row(bottom, 40)],
    body: { x: -10, y: -30, w: n * GRID, h: 100 },
    color,
  };
}

export const BREADBOARD_COLS = 30;
export const BB_ROW_Y: Record<string, number> = {
  'T+': -60,
  'T-': -40,
  a: 0,
  b: 20,
  c: 40,
  d: 60,
  e: 80,
  f: 120,
  g: 140,
  h: 160,
  i: 180,
  j: 200,
  'B+': 240,
  'B-': 260,
};

function breadboardPins(): PinDef[] {
  const pins: PinDef[] = [];
  for (const [rowName, y] of Object.entries(BB_ROW_Y)) {
    for (let c = 1; c <= BREADBOARD_COLS; c++) {
      pins.push({ name: `${rowName}${c}`, x: (c - 1) * GRID, y });
    }
  }
  return pins;
}

// Holes that are electrically tied together inside the breadboard.
export function breadboardGroup(pinName: string): string {
  const m = /^([a-j])(\d+)$/.exec(pinName);
  if (m) return `${'abcde'.includes(m[1]) ? 'top' : 'bot'}${m[2]}`;
  const rail = /^(T\+|T-|B\+|B-)\d+$/.exec(pinName);
  return rail ? `rail${rail[1]}` : pinName;
}

const p = (name: string, x: number, y: number): PinDef => ({ name, x, y });

const defs: PartDef[] = [
  {
    type: 'breadboard',
    label: 'Breadboard',
    prefix: 'BB',
    category: 'Prototyping',
    pins: breadboardPins(),
    body: { x: -20, y: -80, w: (BREADBOARD_COLS - 1) * GRID + 40, h: 360 },
    color: '#e9e4d4',
  },
  board(
    'esp32-devkit-v1',
    'ESP32 DevKit V1',
    ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN'],
    ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND2', '3V3'],
    '#1f3a5f',
  ),
  board(
    'esp32-s3',
    'ESP32-S3 DevKitC',
    ['3V3', '3V3b', 'RST', 'D4', 'D5', 'D6', 'D7', 'D15', 'D16', 'D17', 'D18', 'D8', 'D3', 'D46', 'D9', 'D10', 'D11', 'D12', 'D13', 'D14', '5V', 'GND'],
    ['GND2', 'TX', 'RX', 'D1', 'D2', 'D42', 'D41', 'D40', 'D39', 'D38', 'D37', 'D36', 'D35', 'D0', 'D45', 'D48', 'D47', 'D21', 'D20', 'D19', 'GND3', 'GND4'],
    '#3a2f5f',
  ),
  board(
    'esp32-c3',
    'ESP32-C3 DevKitM',
    ['GND', '3V3', '3V3b', 'D2', 'D3', 'GND2', 'RST', 'GND3', 'D0', 'D1', 'D10', 'GND4', '5V', '5Vb', 'GND5'],
    ['GND6', 'TX', 'RX', 'GND7', 'D9', 'D8', 'D7', 'GND8', 'D6', 'D5', 'D4', 'GND9', 'D18', 'D19', 'GND10'],
    '#1f5f4a',
  ),
  { type: 'resistor', label: 'Resistor', prefix: 'R', category: 'Passive', pins: [p('A', 0, 0), p('B', 60, 0)], body: { x: 10, y: -8, w: 40, h: 16 }, color: '#d9b26f' },
  { type: 'capacitor', label: 'Capacitor', prefix: 'C', category: 'Passive', pins: [p('+', 0, 0), p('-', 40, 0)], body: { x: 8, y: -12, w: 24, h: 24 }, color: '#4a7fb5' },
  { type: 'fuse', label: 'Fuse', prefix: 'F', category: 'Passive', pins: [p('A', 0, 0), p('B', 60, 0)], body: { x: 10, y: -8, w: 40, h: 16 }, color: '#c9c9c9' },
  { type: 'potentiometer', label: 'Potentiometer', prefix: 'POT', category: 'Passive', pins: [p('1', 0, 0), p('W', 20, 0), p('2', 40, 0)], body: { x: -8, y: -36, w: 56, h: 30 }, color: '#4466aa' },
  { type: 'led', label: 'LED', prefix: 'LED', category: 'Semiconductors', pins: [p('A', 0, 0), p('K', 20, 0)], body: { x: -6, y: -28, w: 32, h: 24 }, color: '#e04b4b' },
  { type: 'diode', label: 'Diode', prefix: 'D', category: 'Semiconductors', pins: [p('A', 0, 0), p('K', 40, 0)], body: { x: 8, y: -8, w: 24, h: 16 }, color: '#333' },
  { type: 'zener', label: 'Zener Diode', prefix: 'ZD', category: 'Semiconductors', pins: [p('A', 0, 0), p('K', 40, 0)], body: { x: 8, y: -8, w: 24, h: 16 }, color: '#7a5a2a' },
  { type: 'npn', label: 'NPN Transistor', prefix: 'Q', category: 'Semiconductors', pins: [p('C', 0, 0), p('B', 20, 0), p('E', 40, 0)], body: { x: -8, y: -32, w: 56, h: 26 }, color: '#2b2b2b' },
  { type: 'nmos', label: 'N-MOSFET', prefix: 'M', category: 'Semiconductors', pins: [p('G', 0, 0), p('D', 20, 0), p('S', 40, 0)], body: { x: -8, y: -32, w: 56, h: 26 }, color: '#2b2b2b' },
  { type: 'button', label: 'Push Button', prefix: 'BTN', category: 'Loads & Switching', pins: [p('1', 0, 0), p('2', 40, 0)], body: { x: 6, y: -14, w: 28, h: 28 }, color: '#6b6b6b' },
  { type: 'switch', label: 'Switch', prefix: 'SW', category: 'Loads & Switching', pins: [p('1', 0, 0), p('2', 40, 0)], body: { x: 6, y: -12, w: 28, h: 24 }, color: '#8a8a3a' },
  { type: 'relay', label: 'Relay', prefix: 'K', category: 'Loads & Switching', pins: [p('COIL+', 0, 0), p('COIL-', 0, 40), p('COM', 80, 0), p('NO', 80, 20), p('NC', 80, 40)], body: { x: 6, y: -12, w: 68, h: 64 }, color: '#2d5a8c' },
  { type: 'motor', label: 'DC Motor', prefix: 'MOT', category: 'Loads & Switching', pins: [p('M+', 0, 0), p('M-', 40, 0)], body: { x: 0, y: -40, w: 40, h: 34 }, color: '#888' },
  { type: 'servo', label: 'Servo', prefix: 'SRV', category: 'Loads & Switching', pins: [p('GND', 0, 0), p('V+', 20, 0), p('SIG', 40, 0)], body: { x: -8, y: -44, w: 56, h: 38 }, color: '#3a6ea5' },
  { type: 'esc', label: 'Brushless ESC', prefix: 'ESC', category: 'Loads & Switching', pins: [p('BAT+', -150, -20), p('BAT-', -150, 20), p('M1', 120, -26), p('M2', 120, 0), p('M3', 120, 26), p('+5V', -30, 84), p('SIG', 0, 84), p('GND', 30, 84)], body: { x: -70, y: -44, w: 140, h: 88 }, color: '#252a32' },
  { type: 'battery', label: 'Battery', prefix: 'BAT', category: 'Power', pins: [p('+', 0, 0), p('-', 40, 0)], body: { x: -8, y: -36, w: 56, h: 30 }, color: '#c98a2b' },
  { type: 'usb5v', label: 'USB 5V', prefix: 'USB', category: 'Power', pins: [p('5V', 0, 0), p('GND', 20, 0)], body: { x: -8, y: -32, w: 36, h: 26 }, color: '#9aa4ad' },
  { type: 'buck', label: 'Buck Converter', prefix: 'BUCK', category: 'Power', pins: [p('IN+', 0, 0), p('IN-', 0, 20), p('OUT+', 80, 0), p('OUT-', 80, 20)], body: { x: 6, y: -10, w: 68, h: 40 }, color: '#1f6fb2' },
  { type: 'i2c-sensor', label: 'I2C Sensor', prefix: 'SNS', category: 'Sensors & Tools', pins: [p('VCC', 0, 0), p('GND', 20, 0), p('SDA', 40, 0), p('SCL', 60, 0)], body: { x: -8, y: -36, w: 76, h: 30 }, color: '#2f8f6f' },
  { type: 'lcd1602', label: 'I2C LCD 16x2', prefix: 'LCD', category: 'Sensors & Tools', pins: [p('GND', 0, 0), p('VCC', 20, 0), p('SDA', 40, 0), p('SCL', 60, 0)], body: { x: -20, y: -70, w: 100, h: 64 }, color: '#1f6f4a' },
  { type: 'multimeter', label: 'Multimeter', prefix: 'MM', category: 'Sensors & Tools', pins: [p('V/A', 0, 0), p('COM', 40, 0)], body: { x: -8, y: -44, w: 56, h: 38 }, color: '#d8c43a' },
];

export const PART_DEFS: Record<PartType, PartDef> = Object.fromEntries(defs.map((d) => [d.type, d])) as Record<
  PartType,
  PartDef
>;

export const PART_LIST = defs;
