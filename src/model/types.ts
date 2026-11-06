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
}

export interface PinRef {
  partId: string;
  pin: string;
}

export interface Wire {
  id: string;
  from: PinRef;
  to: PinRef;
}
