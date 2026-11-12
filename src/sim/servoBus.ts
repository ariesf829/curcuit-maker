import { BOARDS, isBoardType, pinRole } from '../model/boards';
import { pinKey } from '../model/connectivity';
import { PART_DEFS } from '../model/parts';
import { SERVO_MIN_VOLTS } from '../model/ratings';
import type { Part } from '../model/types';
import { pinVoltage, type SimResult } from './simulate';

/** Servos whose SIG wire is on `pin` of the board and that have enough supply and a common ground to move. */
export function findServos(parts: Part[], sim: SimResult, boardId: string, pin: string): { partIds: string[] } | { problem: string } {
  const board = parts.find((p) => p.id === boardId);
  if (!board || !isBoardType(board.type)) return { problem: 'No ESP32 board to drive the servo.' };
  const servos = parts.filter((p) => p.type === 'servo');
  if (servos.length === 0) {
    return parts.some((p) => p.type === 'esc')
      ? { partIds: [] }
      : { problem: 'Servo not found: add a Servo part to the circuit.' };
  }

  const net = (partId: string, name: string) => sim.nets.netOf.get(pinKey({ partId, pin: name }));
  const pinNet = net(board.id, pin);
  const def = BOARDS[board.type];
  const boardGnds = PART_DEFS[board.type].pins.filter((p) => pinRole(def, p.name).kind === 'gnd').map((p) => net(board.id, p.name));

  const ids: string[] = [];
  let reason: string | undefined;
  for (const s of servos) {
    const volts = (pinVoltage(sim, s.id, 'V+') ?? 0) - (pinVoltage(sim, s.id, 'GND') ?? 0);
    if (net(s.id, 'SIG') !== pinNet) reason ??= `${s.name}: SIG is not connected to ${pin}, where the sketch attached the servo.`;
    else if (volts < SERVO_MIN_VOLTS) reason ??= `${s.name} is not powered (${volts.toFixed(1)} V, it needs 4 to 6 V). Wire V+ to 5 V and GND to GND.`;
    else if (!boardGnds.includes(net(s.id, 'GND'))) reason ??= `${s.name}: GND is not connected to the ESP32's GND, so the signal has no reference.`;
    else ids.push(s.id);
  }
  return ids.length > 0 ? { partIds: ids } : { problem: `Servo on ${pin} will not move. ${reason ?? ''}`.trim() };
}
