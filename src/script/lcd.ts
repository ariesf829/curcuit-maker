/** What an LCD shows; the canvas draws this. */
export interface LcdView {
  lines: string[];
  backlight: boolean;
  on: boolean;
  cursor: boolean;
  blink: boolean;
  /** False until the sketch calls init() / begin(): a real LCD then shows blocks on its top row. */
  ready: boolean;
  col: number;
  row: number;
}

/** Character memory of an HD44780 display, without the timing. */
export class LcdModel {
  readonly cols: number;
  readonly rows: number;
  private cells: string[][];
  private state: Omit<LcdView, 'lines'> = { backlight: false, on: true, cursor: false, blink: false, ready: false, col: 0, row: 0 };

  constructor(cols: number, rows: number) {
    this.cols = Math.max(1, Math.min(40, cols));
    this.rows = Math.max(1, Math.min(4, rows));
    this.cells = this.blank();
  }

  private blank() {
    return Array.from({ length: this.rows }, () => new Array<string>(this.cols).fill(' '));
  }

  call(method: string, args: Array<number | string>) {
    const s = this.state;
    const num = (i: number) => (typeof args[i] === 'number' ? Math.trunc(args[i]) : 0);
    switch (method) {
      case 'init': case 'begin':
        s.ready = true;
        s.on = true;
        break;
      case 'backlight': s.backlight = true; break;
      case 'noBacklight': s.backlight = false; break;
      case 'setBacklight': s.backlight = num(0) !== 0; break;
      case 'clear':
        this.cells = this.blank();
        s.col = 0;
        s.row = 0;
        break;
      case 'home': s.col = 0; s.row = 0; break;
      case 'setCursor':
        s.col = Math.max(0, num(0));
        s.row = Math.max(0, Math.min(this.rows - 1, num(1)));
        break;
      case 'display': s.on = true; break;
      case 'noDisplay': s.on = false; break;
      case 'cursor': s.cursor = true; break;
      case 'noCursor': s.cursor = false; break;
      case 'blink': s.blink = true; break;
      case 'noBlink': s.blink = false; break;
      case 'print':
        for (const ch of String(args[0] ?? '')) {
          if (ch === '\n' || ch === '\r') continue;
          if (s.col < this.cols) this.cells[s.row][s.col] = ch;
          s.col++;
        }
        break;
      default:
        break;
    }
  }

  view(): LcdView {
    return { ...this.state, lines: this.cells.map((r) => r.join('')) };
  }
}
