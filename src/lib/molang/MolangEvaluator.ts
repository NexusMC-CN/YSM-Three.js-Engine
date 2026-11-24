/**
 * Pure TypeScript MoLang expression compiler and evaluator (zero Three.js dependencies).
 *
 * Pipeline: Source String -> Lexer -> Recursive-Descent AST -> Compiled Closure (cached).
 * Compiled closures run without `eval`/`new Function` (CSP-safe) and avoid per-frame
 * re-tokenization or re-parsing.
 */

export interface MolangQueryContext {
  anim_time?: number;
  life_time?: number;
  delta_time?: number;
  ground_speed?: number;
  is_on_ground?: number | boolean;
  /** Allow arbitrary additional query.* fields supplied by host apps */
  [key: string]: number | boolean | undefined;
}

export interface MolangEvalContext {
  query: MolangQueryContext;
  /** Persistent variable storage scoped to a model instance (variable.* / v.*) */
  variables: Record<string, number>;
  /** Ephemeral temp storage scoped to a single evaluation call (temp.* / t.*) */
  temp?: Record<string, number>;
}

export type CompiledMolangFn = (ctx: MolangEvalContext) => number;

type TokenType =
  | 'number'
  | 'ident'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'question'
  | 'colon'
  | 'semi'
  | 'eof';

interface Token {
  type: TokenType;
  value: string;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Bedrock MoLang `math.*` standard library.
 * Note: Bedrock `math.sin` and `math.cos` accept DEGREES (unlike JS Math.sin/cos).
 */
const MATH_FUNCS: Record<string, (...args: number[]) => number> = {
  sin: (deg = 0) => Math.sin(deg * DEG_TO_RAD),
  cos: (deg = 0) => Math.cos(deg * DEG_TO_RAD),
  asin: (x = 0) => Math.asin(Math.max(-1, Math.min(1, x))) * RAD_TO_DEG,
  acos: (x = 0) => Math.acos(Math.max(-1, Math.min(1, x))) * RAD_TO_DEG,
  atan: (x = 0) => Math.atan(x) * RAD_TO_DEG,
  atan2: (y = 0, x = 1) => Math.atan2(y, x) * RAD_TO_DEG,
  abs: (x = 0) => Math.abs(x),
  clamp: (v = 0, min = 0, max = 1) => (v < min ? min : v > max ? max : v),
  lerp: (a = 0, b = 0, t = 0) => a + (b - a) * t,
  lerprotate: (a = 0, b = 0, t = 0) => {
    let diff = ((((b - a) % 360) + 540) % 360) - 180;
    return a + diff * t;
  },
  min: (a = 0, b = 0) => Math.min(a, b),
  max: (a = 0, b = 0) => Math.max(a, b),
  mod: (a = 0, b = 1) => (b === 0 ? 0 : a % b),
  pow: (a = 0, b = 1) => Math.pow(a, b),
  random: (low = 0, high = 1) => low + Math.random() * (high - low),
  sqrt: (x = 0) => (x < 0 ? 0 : Math.sqrt(x)),
  floor: (x = 0) => Math.floor(x),
  ceil: (x = 0) => Math.ceil(x),
  round: (x = 0) => Math.round(x),
  trunc: (x = 0) => Math.trunc(x),
  exp: (x = 0) => Math.exp(x),
  ln: (x = 1) => (x <= 0 ? 0 : Math.log(x)),
  hermite_blend: (t = 0) => 3 * t * t - 2 * t * t * t,
  die_roll: (num = 1, low = 0, high = 1) => {
    const count = Math.max(0, Math.floor(num));
    let sum = 0;
    for (let i = 0; i < count; i++) {
      sum += low + Math.random() * (high - low);
    }
    return sum;
  },
  die_roll_integer: (num = 1, low = 0, high = 1) => {
    const count = Math.max(0, Math.floor(num));
    const lo = Math.floor(low);
    const hi = Math.floor(high);
    let sum = 0;
    for (let i = 0; i < count; i++) {
      sum += lo + Math.floor(Math.random() * (hi - lo + 1));
    }
    return sum;
  },
  pi: () => Math.PI,
};

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const len = source.length;
  let i = 0;

  while (i < len) {
    const ch = source[i];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // Number literal (supports decimals and scientific notation like 1e-3)
    if (
      (ch >= '0' && ch <= '9') ||
      (ch === '.' && i + 1 < len && source[i + 1] >= '0' && source[i + 1] <= '9')
    ) {
      let start = i;
      let hasDot = ch === '.';
      i++;
      while (i < len) {
        const c = source[i];
        if (c >= '0' && c <= '9') {
          i++;
        } else if (c === '.' && !hasDot) {
          hasDot = true;
          i++;
        } else if (c === 'e' || c === 'E') {
          i++;
          if (i < len && (source[i] === '+' || source[i] === '-')) i++;
        } else {
          break;
        }
      }
      tokens.push({ type: 'number', value: source.slice(start, i) });
      continue;
    }

    // Identifiers and dotted paths (e.g., query.anim_time, math.sin, v.x, return)
    if (
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      ch === '_'
    ) {
      const start = i;
      i++;
      while (i < len) {
        const c = source[i];
        if (
          (c >= 'a' && c <= 'z') ||
          (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') ||
          c === '_' ||
          c === '.'
        ) {
          i++;
        } else {
          break;
        }
      }
      tokens.push({ type: 'ident', value: source.slice(start, i) });
      continue;
    }

    // Two-character operators
    const two = source.slice(i, i + 2);
    if (
      two === '==' ||
      two === '!=' ||
      two === '<=' ||
      two === '>=' ||
      two === '&&' ||
      two === '||'
    ) {
      tokens.push({ type: 'op', value: two });
      i += 2;
      continue;
    }

    // Single-character punctuation & operators
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: '(' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ')' });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', value: ',' });
      i++;
      continue;
    }
    if (ch === '?') {
      tokens.push({ type: 'question', value: '?' });
      i++;
      continue;
    }
    if (ch === ':') {
      tokens.push({ type: 'colon', value: ':' });
      i++;
      continue;
    }
    if (ch === ';') {
      tokens.push({ type: 'semi', value: ';' });
      i++;
      continue;
    }
    if (
      ch === '+' ||
      ch === '-' ||
      ch === '*' ||
      ch === '/' ||
      ch === '%' ||
      ch === '<' ||
      ch === '>' ||
      ch === '=' ||
      ch === '!'
    ) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }

    throw new Error(`MolangEvaluator: Unexpected character "${ch}" at index ${i} in "${source}"`);
  }

  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

type EvalNode = (ctx: MolangEvalContext, temp: Record<string, number>) => number;

interface StatementNode {
  isReturn: boolean;
  eval: EvalNode;
}

/**
 * Recursive-descent parser that compiles directly into lightweight JS closures.
 */
class MolangCompiler {
  private pos = 0;

  constructor(private readonly tokens: Token[], private readonly source: string) {}

  compile(): CompiledMolangFn {
    const statements: StatementNode[] = [];

    while (!this.check('eof')) {
      while (this.check('semi')) {
        this.advance();
      }
      if (this.check('eof')) break;

      if (this.check('ident') && this.peek().value.toLowerCase() === 'return') {
        this.advance();
        const expr = this.parseExpression();
        statements.push({ isReturn: true, eval: expr });
      } else {
        const expr = this.parseExpression();
        statements.push({ isReturn: false, eval: expr });
      }

      if (this.check('semi')) {
        this.advance();
      }
    }

    if (statements.length === 0) {
      return () => 0;
    }

    // Fast path for single-expression MoLang strings (most keyframes)
    if (statements.length === 1) {
      const single = statements[0].eval;
      return (ctx: MolangEvalContext) => {
        const temp = ctx.temp ?? {};
        const val = single(ctx, temp);
        return Number.isFinite(val) ? val : 0;
      };
    }

    return (ctx: MolangEvalContext) => {
      const temp = ctx.temp ?? {};
      let last = 0;
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        last = stmt.eval(ctx, temp);
        if (stmt.isReturn) {
          return Number.isFinite(last) ? last : 0;
        }
      }
      return Number.isFinite(last) ? last : 0;
    };
  }

  private parseExpression(): EvalNode {
    return this.parseAssignment();
  }

  private parseAssignment(): EvalNode {
    if (this.check('ident') && this.peekNext().type === 'op' && this.peekNext().value === '=') {
      const target = this.advance().value.toLowerCase();
      this.advance(); // consume '='
      const rhs = this.parseAssignment();
      const dotIdx = target.indexOf('.');
      const ns = dotIdx >= 0 ? target.slice(0, dotIdx) : 'variable';
      const key = dotIdx >= 0 ? target.slice(dotIdx + 1) : target;

      if (ns === 't' || ns === 'temp') {
        return (ctx, temp) => {
          const v = rhs(ctx, temp);
          temp[key] = v;
          return v;
        };
      }
      return (ctx, temp) => {
        const v = rhs(ctx, temp);
        ctx.variables[key] = v;
        return v;
      };
    }

    return this.parseTernary();
  }

  private parseTernary(): EvalNode {
    const cond = this.parseLogicalOr();
    if (this.check('question')) {
      this.advance();
      const whenTrue = this.parseExpression();
      let whenFalse: EvalNode = () => 0;
      if (this.check('colon')) {
        this.advance();
        whenFalse = this.parseExpression();
      }
      return (ctx, temp) => (cond(ctx, temp) !== 0 ? whenTrue(ctx, temp) : whenFalse(ctx, temp));
    }
    return cond;
  }

  private parseLogicalOr(): EvalNode {
    let left = this.parseLogicalAnd();
    while (this.checkOp('||')) {
      this.advance();
      const right = this.parseLogicalAnd();
      const lhs = left;
      left = (ctx, temp) => (lhs(ctx, temp) !== 0 || right(ctx, temp) !== 0 ? 1 : 0);
    }
    return left;
  }

  private parseLogicalAnd(): EvalNode {
    let left = this.parseEquality();
    while (this.checkOp('&&')) {
      this.advance();
      const right = this.parseEquality();
      const lhs = left;
      left = (ctx, temp) => (lhs(ctx, temp) !== 0 && right(ctx, temp) !== 0 ? 1 : 0);
    }
    return left;
  }

  private parseEquality(): EvalNode {
    let left = this.parseComparison();
    while (this.checkOp('==') || this.checkOp('!=')) {
      const op = this.advance().value;
      const right = this.parseComparison();
      const lhs = left;
      if (op === '==') {
        left = (ctx, temp) => (lhs(ctx, temp) === right(ctx, temp) ? 1 : 0);
      } else {
        left = (ctx, temp) => (lhs(ctx, temp) !== right(ctx, temp) ? 1 : 0);
      }
    }
    return left;
  }

  private parseComparison(): EvalNode {
    let left = this.parseAdditive();
    while (
      this.checkOp('<') ||
      this.checkOp('<=') ||
      this.checkOp('>') ||
      this.checkOp('>=')
    ) {
      const op = this.advance().value;
      const right = this.parseAdditive();
      const lhs = left;
      switch (op) {
        case '<':
          left = (ctx, temp) => (lhs(ctx, temp) < right(ctx, temp) ? 1 : 0);
          break;
        case '<=':
          left = (ctx, temp) => (lhs(ctx, temp) <= right(ctx, temp) ? 1 : 0);
          break;
        case '>':
          left = (ctx, temp) => (lhs(ctx, temp) > right(ctx, temp) ? 1 : 0);
          break;
        default:
          left = (ctx, temp) => (lhs(ctx, temp) >= right(ctx, temp) ? 1 : 0);
          break;
      }
    }
    return left;
  }

  private parseAdditive(): EvalNode {
    let left = this.parseMultiplicative();
    while (this.checkOp('+') || this.checkOp('-')) {
      const op = this.advance().value;
      const right = this.parseMultiplicative();
      const lhs = left;
      if (op === '+') {
        left = (ctx, temp) => lhs(ctx, temp) + right(ctx, temp);
      } else {
        left = (ctx, temp) => lhs(ctx, temp) - right(ctx, temp);
      }
    }
    return left;
  }

  private parseMultiplicative(): EvalNode {
    let left = this.parseUnary();
    while (this.checkOp('*') || this.checkOp('/') || this.checkOp('%')) {
      const op = this.advance().value;
      const right = this.parseUnary();
      const lhs = left;
      if (op === '*') {
        left = (ctx, temp) => lhs(ctx, temp) * right(ctx, temp);
      } else if (op === '/') {
        left = (ctx, temp) => {
          const denom = right(ctx, temp);
          return denom === 0 ? 0 : lhs(ctx, temp) / denom;
        };
      } else {
        left = (ctx, temp) => {
          const denom = right(ctx, temp);
          return denom === 0 ? 0 : lhs(ctx, temp) % denom;
        };
      }
    }
    return left;
  }

  private parseUnary(): EvalNode {
    if (this.checkOp('-')) {
      this.advance();
      const operand = this.parseUnary();
      return (ctx, temp) => -operand(ctx, temp);
    }
    if (this.checkOp('+')) {
      this.advance();
      return this.parseUnary();
    }
    if (this.checkOp('!')) {
      this.advance();
      const operand = this.parseUnary();
      return (ctx, temp) => (operand(ctx, temp) === 0 ? 1 : 0);
    }
    return this.parsePrimary();
  }

  private parsePrimary(): EvalNode {
    const tok = this.peek();

    if (tok.type === 'number') {
      this.advance();
      const num = Number(tok.value);
      return () => num;
    }

    if (tok.type === 'lparen') {
      this.advance();
      const expr = this.parseExpression();
      if (!this.check('rparen')) {
        throw new Error(`MolangEvaluator: Missing closing ")" in "${this.source}"`);
      }
      this.advance();
      return expr;
    }

    if (tok.type === 'ident') {
      this.advance();
      const lower = tok.value.toLowerCase();

      if (lower === 'true') return () => 1;
      if (lower === 'false') return () => 0;

      // Function call: math.sin(...), query.is_on_ground(), etc.
      if (this.check('lparen')) {
        this.advance();
        const args: EvalNode[] = [];
        if (!this.check('rparen')) {
          do {
            args.push(this.parseExpression());
          } while (this.check('comma') && this.advance());
        }
        if (!this.check('rparen')) {
          throw new Error(`MolangEvaluator: Missing ")" after arguments of "${tok.value}"`);
        }
        this.advance();
        return this.compileCall(lower, args);
      }

      return this.compileSymbol(lower);
    }

    throw new Error(
      `MolangEvaluator: Unexpected token "${tok.value || tok.type}" in "${this.source}"`,
    );
  }

  private compileCall(name: string, args: EvalNode[]): EvalNode {
    const dotIdx = name.indexOf('.');
    const ns = dotIdx >= 0 ? name.slice(0, dotIdx) : '';
    const fnName = dotIdx >= 0 ? name.slice(dotIdx + 1) : name;

    if (ns === 'math' || ns === 'm') {
      const fn = MATH_FUNCS[fnName];
      if (!fn) {
        throw new Error(`MolangEvaluator: Unsupported math function "math.${fnName}"`);
      }
      // Specialized fast-paths for 0-3 argument calls to avoid allocating arg arrays per frame
      if (args.length === 0) return () => fn();
      if (args.length === 1) {
        const a0 = args[0];
        return (ctx, temp) => fn(a0(ctx, temp));
      }
      if (args.length === 2) {
        const [a0, a1] = args;
        return (ctx, temp) => fn(a0(ctx, temp), a1(ctx, temp));
      }
      if (args.length === 3) {
        const [a0, a1, a2] = args;
        return (ctx, temp) => fn(a0(ctx, temp), a1(ctx, temp), a2(ctx, temp));
      }
      return (ctx, temp) => {
        const evaluated = new Array<number>(args.length);
        for (let i = 0; i < args.length; i++) {
          evaluated[i] = args[i](ctx, temp);
        }
        return fn(...evaluated);
      };
    }

    if (ns === 'query' || ns === 'q') {
      return this.compileQueryRead(fnName);
    }

    throw new Error(`MolangEvaluator: Unknown function "${name}"`);
  }

  private compileSymbol(name: string): EvalNode {
    if (name === 'math.pi' || name === 'm.pi') {
      return () => Math.PI;
    }

    const dotIdx = name.indexOf('.');
    if (dotIdx < 0) {
      return (ctx, temp) => temp[name] ?? ctx.variables[name] ?? 0;
    }

    const ns = name.slice(0, dotIdx);
    const prop = name.slice(dotIdx + 1);

    if (ns === 'query' || ns === 'q') {
      return this.compileQueryRead(prop);
    }
    if (ns === 'variable' || ns === 'v') {
      return (ctx) => ctx.variables[prop] ?? 0;
    }
    if (ns === 'temp' || ns === 't') {
      return (_ctx, temp) => temp[prop] ?? 0;
    }
    if (ns === 'context' || ns === 'c') {
      return (ctx) => {
        const val = ctx.query[prop];
        return typeof val === 'boolean' ? (val ? 1 : 0) : (val ?? 0);
      };
    }

    return () => 0;
  }

  private compileQueryRead(prop: string): EvalNode {
    return (ctx) => {
      const val = ctx.query[prop];
      if (val === undefined) return 0;
      if (typeof val === 'boolean') return val ? 1 : 0;
      return Number.isFinite(val) ? val : 0;
    };
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: 'eof', value: '' };
  }

  private peekNext(): Token {
    return this.tokens[this.pos + 1] ?? { type: 'eof', value: '' };
  }

  private advance(): Token {
    const tok = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return tok;
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private checkOp(op: string): boolean {
    const tok = this.peek();
    return tok.type === 'op' && tok.value === op;
  }
}

/**
 * Public MoLang expression evaluator with built-in closure compilation cache.
 * Can be used standalone or shared across animation tracks to prevent redundant parsing.
 */
export class MolangEvaluator {
  private readonly cache = new Map<string, CompiledMolangFn>();

  /**
   * Compiles a MoLang expression string into a reusable closure and caches it.
   */
  compile(expression: string): CompiledMolangFn {
    const trimmed = expression.trim();
    const cached = this.cache.get(trimmed);
    if (cached) return cached;

    const tokens = tokenize(trimmed);
    const compiled = new MolangCompiler(tokens, trimmed).compile();
    this.cache.set(trimmed, compiled);
    return compiled;
  }

  /**
   * Evaluates a numeric constant or MoLang expression string against the given context.
   */
  evaluate(value: number | string, context: MolangEvalContext): number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    const fn = this.compile(value);
    return fn(context);
  }

  /** Number of unique compiled expressions currently cached */
  get cacheSize(): number {
    return this.cache.size;
  }

  /** Clears the compiled closure cache */
  clearCache(): void {
    this.cache.clear();
  }
}
