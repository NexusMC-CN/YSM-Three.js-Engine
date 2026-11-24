import test from 'node:test';
import assert from 'node:assert/strict';
import { MolangEvaluator, type MolangEvalContext } from '../molang/MolangEvaluator';

function makeCtx(overrides: Partial<MolangEvalContext['query']> = {}): MolangEvalContext {
  return {
    query: {
      anim_time: 0.5,
      life_time: 10.0,
      delta_time: 0.016,
      ground_speed: 1.2,
      is_on_ground: 1,
      ...overrides,
    },
    variables: {},
  };
}

test('MolangEvaluator handles operator precedence, parentheses, unary, comparison, logic, and ternary', () => {
  const ev = new MolangEvaluator();
  const ctx = makeCtx();

  assert.equal(ev.evaluate('2 + 3 * 4', ctx), 14);
  assert.equal(ev.evaluate('(2 + 3) * 4', ctx), 20);
  assert.equal(ev.evaluate('-5 + 12 / 3', ctx), -1);
  assert.equal(ev.evaluate('3 < 5 && 10 >= 10', ctx), 1);
  assert.equal(ev.evaluate('3 > 5 || 0', ctx), 0);
  assert.equal(ev.evaluate('!0', ctx), 1);
  assert.equal(ev.evaluate('query.is_on_ground ? 100 : 200', ctx), 100);
  assert.equal(ev.evaluate('query.is_on_ground ? 100 : 200', makeCtx({ is_on_ground: 0 })), 200);
});

test('MolangEvaluator implements required math.* functions (degree-based sin/cos)', () => {
  const ev = new MolangEvaluator();
  const ctx = makeCtx();

  assert.ok(Math.abs(ev.evaluate('math.sin(90)', ctx) - 1) < 1e-6);
  assert.ok(Math.abs(ev.evaluate('math.cos(180)', ctx) - -1) < 1e-6);
  assert.equal(ev.evaluate('math.abs(-7.5)', ctx), 7.5);
  assert.equal(ev.evaluate('math.clamp(15, 0, 10)', ctx), 10);
  assert.equal(ev.evaluate('math.lerp(10, 20, 0.25)', ctx), 12.5);
  assert.equal(ev.evaluate('math.min(8, 3)', ctx), 3);
  assert.equal(ev.evaluate('math.max(8, 3)', ctx), 8);
  assert.equal(ev.evaluate('math.mod(10, 3)', ctx), 1);
  assert.equal(ev.evaluate('math.pow(2, 5)', ctx), 32);
  assert.equal(ev.evaluate('math.sqrt(81)', ctx), 9);

  const rnd = ev.evaluate('math.random(5, 10)', ctx);
  assert.ok(rnd >= 5 && rnd <= 10);
});

test('MolangEvaluator persists variable.* across expressions and supports assignments + return', () => {
  const ev = new MolangEvaluator();
  const ctx = makeCtx({ delta_time: 0.5, ground_speed: 2.0 });

  const step1 = ev.evaluate(
    'variable.acc = variable.acc + query.delta_time * query.ground_speed; return variable.acc * 10;',
    ctx,
  );
  assert.equal(step1, 10);
  assert.equal(ctx.variables.acc, 1);

  // Second expression reads persisted variable via short alias `v.`
  const step2 = ev.evaluate('v.acc = v.acc + 2.5; return v.acc;', ctx);
  assert.equal(step2, 3.5);
  assert.equal(ctx.variables.acc, 3.5);
});

test('MolangEvaluator caches compiled closures by expression string', () => {
  const ev = new MolangEvaluator();
  const expr = 'math.sin(q.anim_time * 180) + q.ground_speed';
  const fn1 = ev.compile(expr);
  const fn2 = ev.compile(`  ${expr}  `);

  assert.equal(fn1, fn2);
  assert.equal(ev.cacheSize, 1);
  assert.ok(Math.abs(fn1(makeCtx({ anim_time: 0.5, ground_speed: 2 })) - 3) < 1e-6);
});
