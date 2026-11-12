import { BOARDS, isBoardType, pinRole } from '../model/boards';
import { pinKey } from '../model/connectivity';
import { PART_DEFS } from '../model/parts';
import type { Part } from '../model/types';
import { pinVoltage, type SimResult } from './simulate';

const MOTOR_PHASES = ['M1', 'M2', 'M3'] as const;
const MOTOR_PINS = ['A', 'B', 'C'] as const;

/** ESCs whose receiver input, battery supply, and common ground are valid for this ESP32 output. */
export function findEscs(parts: Part[], sim: SimResult, boardId: string, pin: string): { partIds: string[] } | { problem: string } {
  const board = parts.find((p) => p.id === boardId);
  if (!board || !isBoardType(board.type)) return { problem: 'No ESP32 board to drive the ESC.' };
  const escs = parts.filter((p) => p.type === 'esc');
  if (escs.length === 0) return { partIds: [] };

  const net = (partId: string, name: string) => sim.nets.netOf.get(pinKey({ partId, pin: name }));
  const pinNet = net(board.id, pin);
  const def = BOARDS[board.type];
  const boardGnds = PART_DEFS[board.type].pins.filter((p) => pinRole(def, p.name).kind === 'gnd').map((p) => net(board.id, p.name));
  const ids: string[] = [];
  let reason: string | undefined;

  for (const esc of escs) {
    const volts = (pinVoltage(sim, esc.id, 'BAT+') ?? 0) - (pinVoltage(sim, esc.id, 'BAT-') ?? 0);
    if (net(esc.id, 'SIG') !== pinNet) reason ??= `${esc.name}: SIG is not connected to ${pin}, where the sketch attached the ESC.`;
    else if (!sim.poweredEscs.has(esc.id)) reason ??= `${esc.name} needs a 2S-6S supply (6-25.2 V) on BAT+ and BAT-.`;
    else if (volts < 6 || volts > 25.2) reason ??= `${esc.name} battery voltage is outside its simulated 6-25.2 V range.`;
    else if (!boardGnds.includes(net(esc.id, 'GND'))) reason ??= `${esc.name}: GND is not connected to the ESP32's GND, so the signal has no reference.`;
    else ids.push(esc.id);
  }
  return ids.length > 0 ? { partIds: ids } : { problem: `${escs[0].name} will not run. ${reason ?? ''}`.trim() };
}

/** Returns the ESC whose three phase outputs connect to all three pins of this brushless motor. */
export function findMotorEsc(parts: Part[], sim: SimResult, motorId: string): Part | undefined {
  const motor = parts.find((p) => p.id === motorId && p.type === 'brushless-motor');
  if (!motor) return undefined;
  const motorNets = MOTOR_PINS.map((pin) => sim.nets.netOf.get(pinKey({ partId: motor.id, pin })));
  if (motorNets.some((n) => n === undefined) || new Set(motorNets).size !== MOTOR_PINS.length) return undefined;
  return parts.find((part) => {
    if (part.type !== 'esc') return false;
    const phaseNets = MOTOR_PHASES.map((pin) => sim.nets.netOf.get(pinKey({ partId: part.id, pin })));
    return new Set(phaseNets).size === MOTOR_PHASES.length && phaseNets.every((n) => n !== undefined && motorNets.includes(n));
  });
}
