import test from 'node:test';
import assert from 'node:assert/strict';
import { BedrockAnimationParser } from '../parser/BedrockAnimationParser';
import { MolangEvaluator } from '../molang/MolangEvaluator';
import { KeyframeTrack } from '../animation/KeyframeTrack';
import { AnimationController } from '../animation/AnimationController';
import type { Vec3 } from '../parser/types';

test('KeyframeTrack accurately interpolates linear, step, and catmullrom with tangents', () => {
  const ev = new MolangEvaluator();
  const ctx = { query: { anim_time: 0 }, variables: {} };
  const out: Vec3 = [0, 0, 0];

  // Linear track
  const linearTrack = new KeyframeTrack(
    {
      channel: 'rotation',
      keyframes: [
        { time: 0, pre: [0, 0, 0], post: [0, 0, 0], lerpMode: 'linear' },
        { time: 1, pre: [90, 0, 0], post: [90, 0, 0], lerpMode: 'linear' },
      ],
    },
    ev,
  );
  linearTrack.sample(0.5, ctx, out);
  assert.ok(Math.abs(out[0] - 45) < 1e-6);

  // Step track
  const stepTrack = new KeyframeTrack(
    {
      channel: 'rotation',
      keyframes: [
        { time: 0, pre: [10, 0, 0], post: [10, 0, 0], lerpMode: 'step' },
        { time: 1, pre: [90, 0, 0], post: [90, 0, 0], lerpMode: 'step' },
      ],
    },
    ev,
  );
  stepTrack.sample(0.99, ctx, out);
  assert.equal(out[0], 10);
  stepTrack.sample(1.0, ctx, out);
  assert.equal(out[0], 90);

  // Catmull-Rom track across 4 points (curves smoothly above linear chord at midpoint)
  const catmullTrack = new KeyframeTrack(
    {
      channel: 'position',
      keyframes: [
        { time: 0, pre: [0, 0, 0], post: [0, 0, 0], lerpMode: 'catmullrom' },
        { time: 1, pre: [0, 10, 0], post: [0, 10, 0], lerpMode: 'catmullrom' },
        { time: 2, pre: [0, 10, 0], post: [0, 10, 0], lerpMode: 'catmullrom' },
        { time: 3, pre: [0, 0, 0], post: [0, 0, 0], lerpMode: 'catmullrom' },
      ],
    },
    ev,
  );
  catmullTrack.sample(1.5, ctx, out);
  // Smooth arch between (1,10) and (2,10) flanked by 0s arches above 10 (specifically 11.25)
  assert.ok(out[1] > 10.5 && out[1] < 12.0, `Expected smooth arch > 10.5, got ${out[1]}`);
});

test('AnimationController supports loop, once, hold_on_last_frame, additive blending, crossFadeTo, and setTimeScale', () => {
  const parser = new BedrockAnimationParser();
  const parsed = parser.parse({
    format_version: '1.8.0',
    animations: {
      walk: {
        loop: true,
        animation_length: 1.0,
        bones: {
          leg: {
            rotation: {
              '0.0': [0, 0, 0],
              '0.5': [40, 0, 0],
              '1.0': [0, 0, 0],
            },
          },
          arm: {
            rotation: [10, 0, 0],
          },
        },
      },
      attack: {
        loop: false,
        animation_length: 0.4,
        bones: {
          arm: {
            rotation: {
              '0.0': [0, 0, 0],
              '0.2': [-80, 0, 0],
              '0.4': [0, 0, 0],
            },
          },
        },
      },
      hold: {
        loop: 'hold_on_last_frame',
        animation_length: 0.5,
        bones: {
          arm: {
            rotation: {
              '0.0': [0, 0, 0],
              '0.5': [60, 0, 0],
            },
          },
        },
      },
    },
  });

  const ctrl = new AnimationController(parsed.clips, ['leg', 'arm']);

  // Additive blending: play walk + attack simultaneously
  ctrl.play('walk');
  ctrl.play('attack');
  const d1 = ctrl.evaluate(0.2);
  // walk leg at t=0.2 -> 0.4 * 40 = 16; arm = walk(10) + attack(-80) = -70
  assert.ok(Math.abs(d1.get('leg')!.rotation[0] - 16) < 1e-5);
  assert.ok(Math.abs(d1.get('arm')!.rotation[0] - -70) < 1e-5);

  // Advance past attack duration (0.4s) -> attack finishes and removes itself, walk keeps looping
  ctrl.evaluate(0.3);
  assert.deepEqual(
    ctrl.getActiveLayers().map((l) => l.name),
    ['walk'],
  );

  // Test setTimeScale
  ctrl.setTimeScale('walk', 2.0);
  const beforeTime = ctrl.getActiveLayers()[0].time;
  ctrl.evaluate(0.1);
  const afterTime = ctrl.getActiveLayers()[0].time;
  assert.ok(Math.abs(afterTime - (beforeTime + 0.2)) < 1e-5);

  // Test crossFadeTo hold_on_last_frame over 0.2s
  ctrl.crossFadeTo('hold', 0.2);
  ctrl.evaluate(0.1); // halfway crossfade: both layers active with 0.5 weight
  assert.equal(ctrl.getActiveLayers().length, 2);
  ctrl.evaluate(0.15); // walk fully faded out
  assert.deepEqual(
    ctrl.getActiveLayers().map((l) => l.name),
    ['hold'],
  );

  // Advance well past hold length (0.5s) -> holds last frame at 60 deg
  const dHold = ctrl.evaluate(1.0);
  assert.ok(Math.abs(dHold.get('arm')!.rotation[0] - 60) < 1e-5);
});
