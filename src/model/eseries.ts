const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
const E6 = [1.0, 1.5, 2.2, 3.3, 4.7, 6.8];

function series(values: number[], x: number, up: boolean): number {
  if (!(x > 0)) return values[0];
  const decade = Math.floor(Math.log10(x));
  const candidates: number[] = [];
  for (let d = decade - 1; d <= decade + 1; d++) for (const v of values) candidates.push(+(v * 10 ** d).toPrecision(3));
  candidates.sort((a, b) => a - b);
  const eps = x * 1e-9;
  if (up) return candidates.find((c) => c >= x - eps) ?? candidates[candidates.length - 1];
  return [...candidates].reverse().find((c) => c <= x + eps) ?? candidates[0];
}

/** Next standard E12 resistor value at or above `ohms`. */
export const e12Up = (ohms: number) => series(E12, ohms, true);
/** Next standard E12 resistor value at or below `ohms`. */
export const e12Down = (ohms: number) => series(E12, ohms, false);
/** Next standard E6 capacitor value at or above `farads`. */
export const e6Up = (farads: number) => series(E6, farads, true);

export function formatOhms(ohms: number): string {
  if (ohms >= 1e6) return `${+(ohms / 1e6).toPrecision(3)} MΩ`;
  if (ohms >= 1e3) return `${+(ohms / 1e3).toPrecision(3)} kΩ`;
  return `${+ohms.toPrecision(3)} Ω`;
}

export function formatFarads(farads: number): string {
  if (farads >= 1e-3) return `${+(farads * 1e3).toPrecision(3)} mF`;
  if (farads >= 1e-6) return `${+(farads * 1e6).toPrecision(3)} µF`;
  return `${+(farads * 1e9).toPrecision(3)} nF`;
}
