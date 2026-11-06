import type { PinMode } from './boards';
import type { PartType } from './parts';

export interface Point {
  x: number;
  y: number;
}

export interface Part {
  id: string;
  type: PartType;
  name: string;
  x: number;
  y: number;
  rot: 0 | 1 | 2 | 3;
  params?: Record<string, number>;
  /** ESP32 boards only: how the running script uses each GPIO (absent = input). */
  pinModes?: Record<string, PinMode>;
  /** PWM duty (0..1) for output pins driven with analogWrite/ledcWrite. */
  pinDuty?: Record<string, number>;
}

export interface PinRef {
  partId: string;
  pin: string;
}

export interface Wire {
  id: string;
  from: PinRef;
  to: PinRef;
  /** Bend points between the two pins, in world coordinates. */
  points?: Point[];
  /** Display colour as a #rrggbb string; absent = default green. */
  color?: string;
}
