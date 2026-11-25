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

test('YSM bone rotation supports vector member access with live case-sensitive bone names', () => {
  const evaluator = new MolangEvaluator();
  const expression = "(v.legOrnamentsAngle - ysm.bone_rot('LeftLeg').x)*0.5";
  const angles = [30, -15, 60];
  const context: MolangEvalContext = {
    ...makeCtx(),
    variables: { legornamentsangle: 50 },
    readBoneRotation: (name, axis) => name === 'LeftLeg' ? angles[axis] : undefined,
  };
  const fn = evaluator.compile(expression);
  assert.equal(fn(context), 10);
  angles[0] = -10;
  assert.equal(fn(context), 30, 'Cached expressions must query current bone data');
  assert.equal(evaluator.evaluate('ysm.bone_rot("LeftLeg").y', context), -15);
  assert.equal(evaluator.evaluate("(ysm.bone_rot('LeftLeg')).z + .5", context), 60.5);
  assert.equal(evaluator.evaluate("ysm.bone_rot('leftleg').x", context), 0);
  assert.equal(evaluator.evaluate("ysm.bone_rot('missing').x ?? 7", context), 7);
  assert.equal(fn(makeCtx()), 0, 'Missing model context must not throw');
  assert.equal(evaluator.evaluate("ysm.bone_rot('LeftLeg').x", { ...context, readBoneRotation: () => NaN }), 0);
  assert.throws(() => evaluator.compile('ysm.bone_rot(1).x'), /quoted bone name/);
  assert.throws(() => evaluator.compile("ysm.bone_rot('LeftLeg').w"), /component/);
  assert.throws(() => evaluator.compile('math.sin(0).x'), /member/);
});

test('MolangEvaluator supports null coalescing without replacing zero or false', () => {
  const ev = new MolangEvaluator();
  const ctx = makeCtx({ is_on_ground: false });

  assert.equal(ev.evaluate('v.red_bow_headdress??1', ctx), 1);
  ctx.variables.red_bow_headdress = 0;
  assert.equal(ev.evaluate('v.red_bow_headdress??1', ctx), 0);
  assert.equal(ev.evaluate('q.is_on_ground ?? 1', ctx), 0);
  assert.equal(ev.evaluate('v.missing ?? t.missing ?? q.ground_speed + 1', ctx), 2.2);
  assert.equal(ev.evaluate('q.missing ?? 1 ? 4 : 5', ctx), 4);
  assert.equal(ev.evaluate('0 ?? (v.changed = 1)', ctx), 0);
  assert.equal(ctx.variables.changed, undefined);
  assert.equal(ev.evaluate('v.missing + 2', ctx), 2);
});

test('YSM head queries and named second-order dynamics accept Unicode string arguments', () => {
  const ev = new MolangEvaluator();
  const ctx = makeCtx({ life_time: 0, head_yaw: 30, head_pitch: -15 });
  const expression = "ysm.second_order('眼睛yaw', ysm.head_yaw / 180, 2, 0.8, 0)";

  assert.equal(ev.evaluate('ysm.head_pitch', ctx), -15);
  assert.equal(ev.evaluate(expression, ctx), 1 / 6);
  assert.equal(ev.evaluate('ysm.second_order("头发pitch", -ysm.head_pitch, 2, 0.6, 0)', ctx), 15);
  assert.equal(ev.evaluate("ysm.second_order('hair\\'s yaw', 4, 2, 0.8, 0)", ctx), 4);

  ctx.query.head_yaw = 90;
  ctx.query.life_time = 1 / 60;
  const first = ev.evaluate(expression, ctx);
  assert.ok(first < 0.5, 'Second-order motion should ease towards the new target');
  assert.equal(ev.evaluate(expression, ctx), first, 'Repeated reads in a frame must reuse the result');
  for (let frame = 2; frame <= 180; frame++) {
    ctx.query.life_time = frame / 60;
    assert.ok(Number.isFinite(ev.evaluate(expression, ctx)));
  }
  assert.ok(Math.abs(ev.evaluate(expression, ctx) - 0.5) < 1e-5);

  const otherCtx = makeCtx({ life_time: 0, head_yaw: -90 });
  assert.equal(ev.evaluate(expression, otherCtx), -0.5, 'Dynamics state must be isolated per model');
  assert.throws(() => ev.compile("ysm.second_order('unterminated, 1, 2, 0.8, 0)"), /Unterminated/);
  assert.throws(() => ev.compile("ysm.second_order('name', 1)"), /second_order/);
  assert.throws(() => ev.compile("math.sin('name')"), /numeric/);
});
