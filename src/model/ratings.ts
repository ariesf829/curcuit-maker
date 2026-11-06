import type { PartType } from './parts';

/** Typical hobby-grade limits used by the overload checks. */
export interface Rating {
  /** Current above this is a warning (mA). */
  warnMa?: number;
  /** Current above this is an error (mA). */
  maxMa?: number;
  /** Power above this is a warning (W). */
  maxWatts?: number;
  /** Voltage across the part above this is an error (V). */
  maxVolts?: number;
  note: string;
}

export const RATINGS: Partial<Record<PartType, Rating>> = {
  resistor: { maxWatts: 0.25, note: '1/4 W resistor' },
  potentiometer: { maxWatts: 0.125, note: '1/8 W potentiometer' },
  led: { warnMa: 20, maxMa: 30, note: 'standard 5 mm LED (20 mA typical, 30 mA max)' },
  diode: { maxMa: 1000, maxVolts: 50, note: '1N4001-style diode (1 A, 50 V)' },
  zener: { maxWatts: 0.5, note: '0.5 W Zener diode' },
  capacitor: { maxVolts: 16, note: '16 V capacitor' },
  button: { maxMa: 50, note: 'tactile button (50 mA)' },
  switch: { maxMa: 500, note: 'small slide switch (0.5 A)' },
  motor: { maxMa: 500, note: 'small hobby motor (0.5 A)' },
};

export const BJT_MAX_VCE = 40;
export const BJT_MAX_WATTS = 0.5;
export const MOS_MAX_VDS = 55;
export const MOS_MAX_VGS = 20;
export const MOS_FULLY_ON_VGS = 4.5;
export const MOS_MAX_WATTS = 1;
export const SERVO_MIN_VOLTS = 4;
export const SERVO_MAX_VOLTS = 6.6;
export const BUCK_DROPOUT_VOLTS = 1;
export const BUCK_MAX_VIN = 40;
export const RELAY_PULL_IN = 0.75;
export const RELAY_DROP_OUT = 0.25;
export const RELAY_CONTACT_OHMS = 0.05;
export const METER_VOLTMETER_OHMS = 1e7;
export const METER_AMMETER_OHMS = 0.1;
