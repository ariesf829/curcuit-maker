export class ScriptError extends Error {
  line: number;
  constructor(message: string, line: number) {
    super(message);
    this.line = line;
  }
}

// ---------------------------------------------------------------- lexer

export interface Tok {
  t: 'num' | 'str' | 'id' | 'op' | 'eof';
  v: string;
  n?: number;
  float?: boolean;
  line: number;
}

const OPS3 = ['<<=', '>>='];
const OPS2 = ['++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>'];
const OPS1 = '+-*/%&|^~!<>=?:;,.(){}[]';
const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', "'": "'" };
const NUMBER = /0[xX][0-9a-fA-F]+|0[bB][01]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const NUMBER_SUFFIX = /[fFuUlL]*/y;

function lexRaw(s: string, startLine: number, defs: Map<string, Tok[]>): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = startLine;
  while (i < s.length) {
    const c = s[i];
    if (c === '\n') {
      line++;
      i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
    } else if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      if (end < 0) throw new ScriptError('Comment is never closed (missing */).', line);
      for (const ch of s.slice(i, end)) if (ch === '\n') line++;
      i = end + 2;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] ?? ''))) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(s)!;
      const text = m[0];
      i += text.length;
      NUMBER_SUFFIX.lastIndex = i;
      const suffix = NUMBER_SUFFIX.exec(s)![0];
      i += suffix.length;
      const hex = /^0[xX]/.test(text);
      const bin = /^0[bB]/.test(text);
      const float = !hex && !bin && (/[.eE]/.test(text) || /[fF]/.test(suffix));
      const n = hex ? parseInt(text, 16) : bin ? parseInt(text.slice(2), 2) : Number(text);
      out.push({ t: 'num', v: text, n, float, line });
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      const word = s.slice(i, j);
      i = j;
      const def = defs.get(word);
      if (def) for (const t of def) out.push({ ...t, line });
      else out.push({ t: 'id', v: word, line });
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let text = '';
      while (j < s.length && s[j] !== c) {
        if (s[j] === '\n') throw new ScriptError('Text is never closed (missing quote).', line);
        if (s[j] === '\\') {
          j++;
          text += ESCAPES[s[j]] ?? s[j];
        } else text += s[j];
        j++;
      }
      if (j >= s.length) throw new ScriptError('Text is never closed (missing quote).', line);
      i = j + 1;
      if (c === '"') out.push({ t: 'str', v: text, line });
      else {
        if (text.length !== 1) throw new ScriptError(`A character such as 'a' must hold exactly one letter.`, line);
        out.push({ t: 'num', v: text, n: text.charCodeAt(0), float: false, line });
      }
    } else {
      const op = [...OPS3, ...OPS2].find((o) => s.startsWith(o, i)) ?? (OPS1.includes(c) ? c : undefined);
      if (!op) throw new ScriptError(`Unexpected character '${c}'.`, line);
      out.push({ t: 'op', v: op, line });
      i += op.length;
    }
  }
  return out;
}

export function lex(src: string): Tok[] {
  const defs = new Map<string, Tok[]>();
  const lines = src.split('\n').map((text, i) => {
    const m = /^\s*#\s*(\w+)\s*(.*)$/.exec(text);
    if (!m) return text;
    if (m[1] === 'define') {
      const d = /^(\w+)(\()?\s*(.*)$/.exec(m[2]);
      if (!d) throw new ScriptError('#define needs a name.', i + 1);
      if (d[2]) throw new ScriptError('Macros with parameters are not supported. Use a function instead.', i + 1);
      defs.set(d[1], lexRaw(d[3], i + 1, new Map()));
    }
    return '';
  });
  const toks = lexRaw(lines.join('\n'), 1, defs);
  toks.push({ t: 'eof', v: '', line: toks[toks.length - 1]?.line ?? 1 });
  return toks;
}

// ---------------------------------------------------------------- AST

export type Wrap = 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'i64';
export interface TypeSpec {
  kind: 'int' | 'float' | 'bool' | 'string' | 'void';
  wrap: Wrap;
}

export type Expr =
  | { k: 'num'; v: number; float: boolean; line: number }
  | { k: 'str'; v: string; line: number }
  | { k: 'id'; name: string; line: number }
  | { k: 'un'; op: string; e: Expr; line: number }
  | { k: 'bin'; op: string; l: Expr; r: Expr; line: number }
  | { k: 'assign'; op: string; target: Expr; value: Expr; line: number }
  | { k: 'incdec'; op: '++' | '--'; prefix: boolean; target: Expr; line: number }
  | { k: 'cond'; c: Expr; a: Expr; b: Expr; line: number }
  | { k: 'call'; name: string; args: Expr[]; line: number }
  | { k: 'index'; arr: Expr; idx: Expr; line: number }
  | { k: 'cast'; type: TypeSpec; e: Expr; line: number };

export interface VarDecl {
  name: string;
  isArray: boolean;
  size?: Expr;
  init?: Expr | Expr[];
  line: number;
}

export type Stmt =
  | { k: 'block'; body: Stmt[]; line: number }
  | { k: 'decl'; type: TypeSpec; vars: VarDecl[]; line: number }
  | { k: 'device'; cls: string; name: string; args: Expr[]; line: number }
  | { k: 'expr'; e: Expr; line: number }
  | { k: 'if'; c: Expr; a: Stmt; b?: Stmt; line: number }
  | { k: 'while'; c: Expr; body: Stmt; line: number }
  | { k: 'do'; body: Stmt; c: Expr; line: number }
  | { k: 'for'; init?: Stmt; c?: Expr; step?: Expr; body: Stmt; line: number }
  | { k: 'ret'; e?: Expr; line: number }
  | { k: 'break'; line: number }
  | { k: 'continue'; line: number }
  | { k: 'switch'; e: Expr; cases: Array<{ test?: Expr; body: Stmt[] }>; line: number };

export interface Param {
  name: string;
  type: TypeSpec;
  isArray: boolean;
}

export interface Func {
  name: string;
  ret: TypeSpec;
  params: Param[];
  body: Stmt[];
  line: number;
}

export interface Program {
  globals: Stmt[];
  funcs: Map<string, Func>;
}

// ---------------------------------------------------------------- parser

const MODIFIERS = new Set(['const', 'static', 'volatile', 'inline', 'extern']);
const TYPE_WORDS = new Set([
  ...MODIFIERS,
  'void', 'int', 'long', 'short', 'char', 'byte', 'bool', 'boolean', 'float', 'double', 'unsigned', 'signed', 'String',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'size_t', 'word',
]);
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);
const PREC: Record<string, number> = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8,
  '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
};

class Parser {
  private p = 0;
  private toks: Tok[];
  constructor(toks: Tok[]) {
    this.toks = toks;
  }

  private get cur() {
    return this.toks[this.p];
  }
  private peek(n = 0) {
    return this.toks[Math.min(this.p + n, this.toks.length - 1)];
  }
  private next() {
    return this.toks[this.p++];
  }
  private isOp(v: string, n = 0) {
    const t = this.peek(n);
    return t.t === 'op' && t.v === v;
  }
  private isId(v: string) {
    return this.cur.t === 'id' && this.cur.v === v;
  }
  private accept(v: string) {
    if (this.isOp(v)) {
      this.p++;
      return true;
    }
    return false;
  }
  private describe(t: Tok) {
    return t.t === 'eof' ? 'the end of the program' : `'${t.v}'`;
  }
  private expect(v: string) {
    if (!this.isOp(v)) {
      // A missing ';' is reported on the line where the statement ended.
      const line = v === ';' && this.p > 0 ? this.toks[this.p - 1].line : this.cur.line;
      throw new ScriptError(`Expected '${v}' but found ${this.describe(this.cur)}.`, line);
    }
    return this.next();
  }
  private ident(what: string) {
    if (this.cur.t !== 'id') throw new ScriptError(`Expected ${what} but found ${this.describe(this.cur)}.`, this.cur.line);
    return this.next().v;
  }

  private isTypeStart(n = 0) {
    const t = this.peek(n);
    return t.t === 'id' && TYPE_WORDS.has(t.v);
  }

  private parseType(): TypeSpec {
    let unsigned = false;
    let longs = 0;
    let base: string | null = null;
    const line = this.cur.line;
    while (this.isTypeStart()) {
      const w = this.next().v;
      if (MODIFIERS.has(w) || w === 'signed') continue;
      if (w === 'unsigned') unsigned = true;
      else if (w === 'long') longs++;
      else base = w;
    }
    if (this.isOp('*')) throw new ScriptError('Pointers are not supported.', line);
    const int = (wrap: Wrap): TypeSpec => ({ kind: 'int', wrap });
    switch (base) {
      case 'void': return { kind: 'void', wrap: 'i32' };
      case 'float': case 'double': return { kind: 'float', wrap: 'i32' };
      case 'bool': case 'boolean': return { kind: 'bool', wrap: 'i32' };
      case 'String': return { kind: 'string', wrap: 'i32' };
      case 'char': return int(unsigned ? 'u8' : 'i8');
      case 'byte': case 'uint8_t': return int('u8');
      case 'int8_t': return int('i8');
      case 'short': return int(unsigned ? 'u16' : 'i16');
      case 'int16_t': return int('i16');
      case 'uint16_t': case 'word': return int('u16');
      case 'uint32_t': case 'size_t': return int('u32');
      case 'int64_t': case 'uint64_t': return int('i64');
      default:
        if (longs >= 2) return int('i64');
        return int(unsigned ? 'u32' : 'i32');
    }
  }

  parseProgram(): Program {
    const globals: Stmt[] = [];
    const funcs = new Map<string, Func>();
    while (this.cur.t !== 'eof') {
      if (this.accept(';')) continue;
      const line = this.cur.line;
      if (this.isId('Servo')) {
        const cls = this.next().v;
        do {
          const name = this.ident('a name for the servo');
          globals.push({ k: 'device', cls, name, args: [], line });
        } while (this.accept(','));
        this.expect(';');
        continue;
      }
      if (this.isId('LiquidCrystal_I2C')) {
        const cls = this.next().v;
        const name = this.ident('a name for the display');
        const args: Expr[] = [];
        this.expect('(');
        if (!this.isOp(')')) {
          do args.push(this.parseAssign());
          while (this.accept(','));
        }
        this.expect(')');
        this.expect(';');
        globals.push({ k: 'device', cls, name, args, line });
        continue;
      }
      if (!this.isTypeStart()) {
        throw new ScriptError(`Expected a function or variable here but found ${this.describe(this.cur)}.`, line);
      }
      const type = this.parseType();
      const name = this.ident('a name');
      if (this.isOp('(')) {
        if (funcs.has(name)) throw new ScriptError(`Function '${name}' is defined twice.`, line);
        funcs.set(name, this.parseFunc(type, name, line));
      } else {
        globals.push(this.parseDecl(type, name, line));
      }
    }
    return { globals, funcs };
  }

  private parseFunc(ret: TypeSpec, name: string, line: number): Func {
    this.expect('(');
    const params: Param[] = [];
    if (!this.isOp(')')) {
      if (this.isId('void') && this.isOp(')', 1)) this.next();
      else {
        do {
          const type = this.parseType();
          const pname = this.ident('a parameter name');
          const isArray = this.accept('[');
          if (isArray) this.expect(']');
          params.push({ name: pname, type, isArray });
        } while (this.accept(','));
      }
    }
    this.expect(')');
    if (!this.isOp('{')) throw new ScriptError(`Expected '{' to start the body of ${name}().`, this.cur.line);
    return { name, ret, params, body: this.parseBlockBody(), line };
  }

  private parseBlockBody(): Stmt[] {
    const open = this.expect('{');
    const body: Stmt[] = [];
    while (!this.isOp('}')) {
      if (this.cur.t === 'eof') throw new ScriptError("A '{' is never closed (missing '}').", open.line);
      body.push(this.parseStmt());
    }
    this.next();
    return body;
  }

  /** Parses the rest of a declaration after the type and first name have been read. */
  private parseDecl(type: TypeSpec, firstName: string, line: number): Stmt {
    const vars: VarDecl[] = [];
    let name = firstName;
    for (;;) {
      const v: VarDecl = { name, isArray: false, line: this.cur.line };
      if (this.accept('[')) {
        v.isArray = true;
        if (!this.isOp(']')) v.size = this.parseExpr();
        this.expect(']');
      }
      if (this.accept('=')) {
        if (this.isOp('{')) {
          if (!v.isArray) throw new ScriptError(`'${name}' is not an array, so it cannot be set with { }.`, this.cur.line);
          this.next();
          const list: Expr[] = [];
          while (!this.isOp('}')) {
            list.push(this.parseAssign());
            if (!this.accept(',')) break;
          }
          this.expect('}');
          v.init = list;
        } else v.init = this.parseAssign();
      }
      if (v.isArray && !v.size && !Array.isArray(v.init)) throw new ScriptError(`Array '${name}' needs a size, like ${name}[5].`, line);
      vars.push(v);
      if (!this.accept(',')) break;
      name = this.ident('a variable name');
    }
    this.expect(';');
    return { k: 'decl', type, vars, line };
  }

  private parseStmt(): Stmt {
    const t = this.cur;
    const line = t.line;
    if (this.isOp('{')) return { k: 'block', body: this.parseBlockBody(), line };
    if (this.accept(';')) return { k: 'block', body: [], line };
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': {
          this.next();
          this.expect('(');
          const c = this.parseExpr();
          this.expect(')');
          const a = this.parseStmt();
          let b: Stmt | undefined;
          if (this.isId('else')) {
            this.next();
            b = this.parseStmt();
          }
          return { k: 'if', c, a, b, line };
        }
        case 'while': {
          this.next();
          this.expect('(');
          const c = this.parseExpr();
          this.expect(')');
          return { k: 'while', c, body: this.parseStmt(), line };
        }
        case 'do': {
          this.next();
          const body = this.parseStmt();
          if (!this.isId('while')) throw new ScriptError("Expected 'while' after the body of do { }.", this.cur.line);
          this.next();
          this.expect('(');
          const c = this.parseExpr();
          this.expect(')');
          this.expect(';');
          return { k: 'do', body, c, line };
        }
        case 'for': {
          this.next();
          this.expect('(');
          let init: Stmt | undefined;
          if (!this.accept(';')) {
            if (this.isTypeStart()) {
              const type = this.parseType();
              init = this.parseDecl(type, this.ident('a variable name'), line);
            } else {
              init = { k: 'expr', e: this.parseExpr(), line };
              this.expect(';');
            }
          }
          const c = this.isOp(';') ? undefined : this.parseExpr();
          this.expect(';');
          const step = this.isOp(')') ? undefined : this.parseExpr();
          this.expect(')');
          return { k: 'for', init, c, step, body: this.parseStmt(), line };
        }
        case 'return': {
          this.next();
          const e = this.isOp(';') ? undefined : this.parseExpr();
          this.expect(';');
          return { k: 'ret', e, line };
        }
        case 'break':
          this.next();
          this.expect(';');
          return { k: 'break', line };
        case 'continue':
          this.next();
          this.expect(';');
          return { k: 'continue', line };
        case 'switch': {
          this.next();
          this.expect('(');
          const e = this.parseExpr();
          this.expect(')');
          this.expect('{');
          const cases: Array<{ test?: Expr; body: Stmt[] }> = [];
          while (!this.isOp('}')) {
            let test: Expr | undefined;
            if (this.isId('case')) {
              this.next();
              test = this.parseExpr();
            } else if (this.isId('default')) this.next();
            else throw new ScriptError(`Expected 'case' or 'default' but found ${this.describe(this.cur)}.`, this.cur.line);
            this.expect(':');
            const body: Stmt[] = [];
            while (!this.isOp('}') && !this.isId('case') && !this.isId('default')) {
              if (this.cur.t === 'eof') throw new ScriptError("A '{' is never closed (missing '}').", line);
              body.push(this.parseStmt());
            }
            cases.push({ test, body });
          }
          this.next();
          return { k: 'switch', e, cases, line };
        }
      }
      if (this.isTypeStart() && !this.isOp('(', 1)) {
        const type = this.parseType();
        return this.parseDecl(type, this.ident('a variable name'), line);
      }
    }
    const e = this.parseExpr();
    this.expect(';');
    return { k: 'expr', e, line };
  }

  parseExpr(): Expr {
    return this.parseAssign();
  }

  private parseAssign(): Expr {
    const left = this.parseTernary();
    if (this.cur.t === 'op' && ASSIGN_OPS.has(this.cur.v)) {
      const op = this.next();
      if (left.k !== 'id' && left.k !== 'index') throw new ScriptError('You can only assign to a variable.', op.line);
      return { k: 'assign', op: op.v, target: left, value: this.parseAssign(), line: op.line };
    }
    return left;
  }

  private parseTernary(): Expr {
    const c = this.parseBin(1);
    if (this.isOp('?')) {
      const line = this.next().line;
      const a = this.parseAssign();
      this.expect(':');
      const b = this.parseAssign();
      return { k: 'cond', c, a, b, line };
    }
    return c;
  }

  private parseBin(min: number): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.cur;
      const prec = t.t === 'op' ? PREC[t.v] : undefined;
      if (prec === undefined || prec < min) return left;
      this.next();
      const right = this.parseBin(prec + 1);
      left = { k: 'bin', op: t.v, l: left, r: right, line: t.line };
    }
  }

  private parseUnary(): Expr {
    const t = this.cur;
    if (t.t === 'op') {
      if (t.v === '-' || t.v === '+' || t.v === '!' || t.v === '~') {
        this.next();
        return { k: 'un', op: t.v, e: this.parseUnary(), line: t.line };
      }
      if (t.v === '++' || t.v === '--') {
        this.next();
        const target = this.parseUnary();
        if (target.k !== 'id' && target.k !== 'index') throw new ScriptError(`'${t.v}' needs a variable.`, t.line);
        return { k: 'incdec', op: t.v, prefix: true, target, line: t.line };
      }
      if (t.v === '(' && this.isTypeStart(1)) {
        this.next();
        const type = this.parseType();
        this.expect(')');
        return { k: 'cast', type, e: this.parseUnary(), line: t.line };
      }
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      const t = this.cur;
      if (t.t !== 'op') return e;
      if (t.v === '[') {
        this.next();
        const idx = this.parseExpr();
        this.expect(']');
        e = { k: 'index', arr: e, idx, line: t.line };
      } else if (t.v === '(') {
        if (e.k !== 'id') throw new ScriptError('Only a function name can be called.', t.line);
        this.next();
        const args: Expr[] = [];
        if (!this.isOp(')')) {
          do args.push(this.parseAssign());
          while (this.accept(','));
        }
        this.expect(')');
        e = { k: 'call', name: e.name, args, line: t.line };
      } else if (t.v === '.') {
        if (e.k !== 'id') throw new ScriptError("Unexpected '.'.", t.line);
        this.next();
        e = { k: 'id', name: `${e.name}.${this.ident('a name')}`, line: t.line };
      } else if (t.v === '++' || t.v === '--') {
        if (e.k !== 'id' && e.k !== 'index') throw new ScriptError(`'${t.v}' needs a variable.`, t.line);
        this.next();
        e = { k: 'incdec', op: t.v, prefix: false, target: e, line: t.line };
      } else return e;
    }
  }

  private parsePrimary(): Expr {
    const t = this.next();
    if (t.t === 'num') return { k: 'num', v: t.n!, float: !!t.float, line: t.line };
    if (t.t === 'str') return { k: 'str', v: t.v, line: t.line };
    if (t.t === 'id') return { k: 'id', name: t.v, line: t.line };
    if (t.t === 'op' && t.v === '(') {
      const e = this.parseExpr();
      this.expect(')');
      return e;
    }
    throw new ScriptError(`Unexpected ${this.describe(t)}.`, t.line);
  }
}

export function parse(src: string): Program {
  return new Parser(lex(src)).parseProgram();
}
