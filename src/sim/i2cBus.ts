import { BOARDS, isBoardType, pinRole } from '../model/boards';
import { pinKey } from '../model/connectivity';
import { param } from '../model/params';
import type { Part } from '../model/types';
import { PART_DEFS } from '../model/parts';
import { pinVoltage, type SimResult } from './simulate';

const LCD_MIN_VOLTS = 4.5;

const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;

/** Decides whether a sketch's I2C writes at `address` reach a display, based on how it is wired and powered. */
export function findLcd(
  parts: Part[],
  sim: SimResult,
  boardId: string,
  address: number,
  sdaPin: string,
  sclPin: string,
): { partId: string } | { problem: string } {
  const board = parts.find((p) => p.id === boardId);
  if (!board || !isBoardType(board.type)) return { problem: 'No ESP32 board to talk to the LCD.' };
  const lcds = parts.filter((p) => p.type === 'lcd1602');
  if (lcds.length === 0) return { problem: `LCD at ${hex(address)} not found: add an I2C LCD part to the circuit.` };
  const matching = lcds.filter((p) => param(p, 'address') === address);
  if (matching.length === 0) {
    const have = lcds.map((p) => hex(param(p, 'address'))).join(', ');
    return { problem: `LCD at ${hex(address)} not found: the LCD in the circuit answers at ${have}. Change the address in the sketch or in the part's settings.` };
  }

  const net = (partId: string, pin: string) => sim.nets.netOf.get(pinKey({ partId, pin }));
  const def = BOARDS[board.type];
  const boardGnds = PART_DEFS[board.type].pins.filter((p) => pinRole(def, p.name).kind === 'gnd').map((p) => net(board.id, p.name));
  const boardSda = net(board.id, sdaPin);
  const boardScl = net(board.id, sclPin);

  let first: string | undefined;
  for (const lcd of matching) {
    const nSda = net(lcd.id, 'SDA');
    const nScl = net(lcd.id, 'SCL');
    const vcc = pinVoltage(sim, lcd.id, 'VCC') ?? 0;
    const gnd = pinVoltage(sim, lcd.id, 'GND') ?? 0;
    const name = lcd.name;
    let problem: string | undefined;
    if (vcc - gnd < LCD_MIN_VOLTS) {
      problem = `${name} is not powered (VCC is ${(vcc - gnd).toFixed(1)} V, it needs about 5 V). Wire VCC to 5 V/VIN and GND to GND.`;
    } else if (!boardGnds.includes(net(lcd.id, 'GND'))) {
      problem = `${name}: GND is not connected to the ESP32's GND, so there is no common ground for I2C.`;
    } else if (nSda === boardScl && nScl === boardSda) {
      problem = `${name}: SDA and SCL look swapped. Connect SDA to ${sdaPin} and SCL to ${sclPin}.`;
    } else if (nSda !== boardSda) {
      problem = `${name}: SDA is not connected to the ESP32's I2C data pin ${sdaPin}.`;
    } else if (nScl !== boardScl) {
      problem = `${name}: SCL is not connected to the ESP32's I2C clock pin ${sclPin}.`;
    }
    if (!problem) return { partId: lcd.id };
    first ??= `LCD at ${hex(address)} not found on the I2C bus: ${problem}`;
  }
  return { problem: first ?? 'LCD not found.' };
}
