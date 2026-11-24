import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  BedrockModelParser,
  computeBoxUVs,
  computePerFaceUVs,
} from '../parser/BedrockModelParser';
import { BedrockAnimationParser } from '../parser/BedrockAnimationParser';

test('pure layers (parser, molang, animation) have zero imports of three', () => {
  const pureDirs = ['parser', 'molang', 'animation'];
  const libRoot = path.resolve(process.cwd(), 'src/lib');

  for (const dir of pureDirs) {
    const fullDir = path.join(libRoot, dir);
    const files = fs.readdirSync(fullDir).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(fullDir, file), 'utf-8');
      assert.equal(
        /from\s+['"]three['"/]/.test(content),
        false,
        `${dir}/${file} must not import three`,
      );
    }
  }
});

test('BedrockModelParser parses 1.12.0+ geometry, topological bone order, inflate, and cube center', () => {
  const parser = new BedrockModelParser();
  const model = parser.parse({
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: {
          identifier: 'geometry.test_hero',
          texture_width: 64,
          texture_height: 64,
        },
        bones: [
          // Intentionally list child before parent to verify topological sorting
          {
            name: 'head',
            parent: 'torso',
            pivot: [0, 24, 0],
            cubes: [
              {
                origin: [-4, 24, -4],
                size: [8, 8, 8],
                uv: [0, 0],
                inflate: 0.5,
              },
            ],
          },
          {
            name: 'torso',
            pivot: [0, 12, 0],
            cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] }],
          },
        ],
      },
    ],
  });

  assert.equal(model.description.identifier, 'geometry.test_hero');
  assert.equal(model.bones.length, 2);
  assert.equal(model.bones[0].name, 'torso');
  assert.equal(model.bones[1].name, 'head');
  assert.deepEqual(model.rootBones, ['torso']);
  assert.equal(model.cubeCount, 2);

  const headCube = model.boneMap.head.cubes[0];
  assert.deepEqual(headCube.inflatedSize, [9, 9, 9]);
  assert.deepEqual(headCube.center, [0, 28, 0]);
  assert.equal(headCube.uvMode, 'box');
});

test('computeBoxUVs computes exact 6-face layout and mirror swaps East/West with horizontal U flip', () => {
  const normal = computeBoxUVs([0, 0], [8, 8, 8], 64, 64, false);
  // North face: [u+d, v+d] = [8, 8] to [16, 16] -> [0.125, 0.125] to [0.25, 0.25]
  assert.equal(normal.uvs.north.u0, 8 / 64);
  assert.equal(normal.uvs.north.v0, 8 / 64);
  assert.equal(normal.uvs.north.u1, 16 / 64);
  assert.equal(normal.uvs.north.v1, 16 / 64);
  // East: [0, 8] -> [8, 16], West: [16, 8] -> [24, 16]
  assert.equal(normal.uvs.east.u0, 0);
  assert.equal(normal.uvs.east.u1, 8 / 64);
  assert.equal(normal.uvs.west.u0, 16 / 64);
  assert.equal(normal.uvs.west.u1, 24 / 64);

  const mirrored = computeBoxUVs([0, 0], [8, 8, 8], 64, 64, true);
  // Mirrored East takes West rect flipped horizontally: u0=24/64 -> u1=16/64
  assert.equal(mirrored.uvs.east.u0, 24 / 64);
  assert.equal(mirrored.uvs.east.u1, 16 / 64);
  // Mirrored West takes East rect flipped horizontally: u0=8/64 -> u1=0
  assert.equal(mirrored.uvs.west.u0, 8 / 64);
  assert.equal(mirrored.uvs.west.u1, 0);
  // North flipped horizontally
  assert.equal(mirrored.uvs.north.u0, 16 / 64);
  assert.equal(mirrored.uvs.north.u1, 8 / 64);
});

test('computePerFaceUVs supports per-face rects, negative uv_size flips, and hides omitted faces', () => {
  const res = computePerFaceUVs(
    {
      north: { uv: [8, 16], uv_size: [16, 8] },
      south: { uv: [24, 16], uv_size: [-8, 8] },
    },
    64,
    64,
    false,
  );

  assert.equal(res.uvs.north.hidden, false);
  assert.equal(res.uvs.north.u0, 8 / 64);
  assert.equal(res.uvs.north.u1, 24 / 64);
  assert.equal(res.uvs.south.u0, 24 / 64);
  assert.equal(res.uvs.south.u1, 16 / 64);
  assert.equal(res.uvs.east.hidden, true);
  assert.equal(res.uvs.up.hidden, true);
});

test('BedrockModelParser resolves multi-texture page index from UV V-offset and parses ysm.json', () => {
  const parser = new BedrockModelParser();
  const boxed = computeBoxUVs([0, 64], [4, 4, 4], 64, 64, false);
  assert.equal(boxed.textureIndex, 1);
  assert.equal(boxed.uvs.east.v0, 4 / 64);

  const manifest = parser.parseManifest({
    spec: 2,
    metadata: { name: 'Valkyrie', authors: ['Orbital'] },
    files: {
      player: {
        model: { main: 'models/main.json' },
        animation: { main: 'animations/main.animation.json' },
        texture: [
          { id: 'armor', uv: 'textures/armor.png' },
          { id: 'wings', uv: 'textures/wings.png' },
        ],
      },
    },
  });

  assert.equal(manifest.name, 'Valkyrie');
  assert.equal(manifest.mainModelPath, 'models/main.json');
  assert.deepEqual(manifest.animationPaths, ['animations/main.animation.json']);
  assert.equal(manifest.textures.length, 2);
  assert.equal(manifest.textures[1].id, 'wings');
});

test('BedrockAnimationParser handles loop modes, pre/post keyframes, and skips anim_time_update', () => {
  const animParser = new BedrockAnimationParser();
  const parsed = animParser.parse({
    format_version: '1.8.0',
    animations: {
      idle: {
        loop: true,
        animation_length: 2.0,
        anim_time_update: 'query.modified_distance_moved',
        bones: {
          head: {
            rotation: {
              '0.0': { post: [0, 0, 0], lerp_mode: 'catmullrom' },
              '1.0': { pre: [10, 0, 0], post: [20, 0, 0], lerp_mode: 'step' },
            },
          },
        },
      },
      guard: {
        loop: 'hold_on_last_frame',
        animation_length: 0.5,
        bones: {
          arm: { rotation: [0, 45, 0] },
        },
      },
    },
  });

  assert.equal(parsed.clips.idle.loop, 'loop');
  assert.equal(parsed.clips.idle.bones.head.rotation?.keyframes.length, 2);
  assert.deepEqual(parsed.clips.idle.bones.head.rotation?.keyframes[1].pre, [10, 0, 0]);
  assert.deepEqual(parsed.clips.idle.bones.head.rotation?.keyframes[1].post, [20, 0, 0]);
  assert.equal(parsed.clips.idle.bones.head.rotation?.keyframes[1].lerpMode, 'step');
  assert.equal(parsed.clips.guard.loop, 'hold_on_last_frame');
  assert.deepEqual(parsed.clips.guard.bones.arm.rotation?.staticValue, [0, 45, 0]);
});
