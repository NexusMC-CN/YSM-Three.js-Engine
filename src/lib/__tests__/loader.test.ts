import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { zipSync } from 'fflate';
import { BedrockModelParser } from '../parser/BedrockModelParser';
import { buildModelRig } from '../renderer/RigBuilder';
import type { ManagedMaterialTable } from '../renderer/TextureManager';
import {
  registerArchiveParser,
  unregisterArchiveParser,
} from '../loader/ArchiveRegistry';
import {
  YsmModelLoader,
  isZipBytes,
  unpackArchiveBytes,
} from '../loader/YsmModelLoader';

const SAMPLE_MODEL_JSON = JSON.stringify({
  format_version: '1.12.0',
  'minecraft:geometry': [
    {
      description: {
        identifier: 'geometry.zip_test',
        texture_width: 64,
        texture_height: 64,
      },
      bones: [
        {
          name: 'arm',
          pivot: [-4, 22, 0],
          cubes: [{ origin: [-6, 10, -2], size: [4, 12, 4], uv: [0, 0] }],
        },
      ],
    },
  ],
});

const SAMPLE_ANIM_JSON = JSON.stringify({
  format_version: '1.8.0',
  animations: {
    idle: {
      loop: true,
      animation_length: 1.0,
      bones: { arm: { rotation: [0, 0, 0] } },
    },
  },
});

test('fflate Zip archive unpacks and extracts main.json, animations, and PNGs cleanly', async () => {
  const enc = new TextEncoder();
  const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const zipped = zipSync({
    'my_pack/models/main.json': enc.encode(SAMPLE_MODEL_JSON),
    'my_pack/animations/main.animation.json': enc.encode(SAMPLE_ANIM_JSON),
    'my_pack/textures/skin.png': fakePng,
  });

  assert.equal(isZipBytes(zipped), true);

  const vfs = await unpackArchiveBytes(zipped, 'my_pack.zip');
  // Common top-level prefix `my_pack/` should be stripped automatically
  assert.ok(vfs.has('models/main.json'));
  assert.ok(vfs.has('animations/main.animation.json'));
  assert.ok(vfs.has('textures/skin.png'));

  const loader = new YsmModelLoader();
  const extracted = loader.extractFromVirtualFileSystem(vfs);
  assert.equal(extracted.animationJsonTexts.length, 1);
  assert.equal(extracted.textures.length, 1);
});

test('Encrypted .ysm archive throws clear extension error when unregistered and works via registerArchiveParser()', async () => {
  const fakeYsmBytes = new Uint8Array([0x59, 0x53, 0x4d, 0x01, 0x00, 0xff]);

  // 1. Unregistered -> instructive error mentioning registerArchiveParser
  await assert.rejects(
    () => unpackArchiveBytes(fakeYsmBytes, 'hero.ysm'),
    /registerArchiveParser/,
  );

  // 2. Register mock OpenYSM WASM archive parser
  const enc = new TextEncoder();
  registerArchiveParser({
    name: 'mock-openysm-wasm',
    extensions: ['.ysm'],
    parse: () => {
      const vfs = new Map<string, Uint8Array>();
      vfs.set('main.json', enc.encode(SAMPLE_MODEL_JSON));
      vfs.set('main.animation.json', enc.encode(SAMPLE_ANIM_JSON));
      return vfs;
    },
  });

  try {
    const vfs = await unpackArchiveBytes(fakeYsmBytes, 'hero.ysm');
    assert.ok(vfs.has('main.json'));
    assert.ok(vfs.has('main.animation.json'));
  } finally {
    unregisterArchiveParser('mock-openysm-wasm');
  }
});

test('RigBuilder rotates model root 180 deg around Y, applies T(pivot)*R*T(-pivot), and disposes cleanly', () => {
  const parser = new BedrockModelParser();
  const parsed = parser.parse(SAMPLE_MODEL_JSON);

  const dummyMat = new THREE.MeshStandardMaterial();
  const dummyTable: ManagedMaterialTable = {
    defaultMaterial: dummyMat,
    byIndex: [dummyMat],
    byKey: new Map([['default', dummyMat]]),
    textures: [],
    materials: [dummyMat],
    dispose: () => {
      dummyMat.dispose();
    },
  };

  const rig = buildModelRig(parsed, dummyTable);

  // Root rotated 180 deg around Y so Bedrock -Z faces Three +Z
  assert.ok(Math.abs(rig.root.rotation.y - Math.PI) < 1e-6);

  // Verify T(pivot) * R * T(-pivot): rotating arm 90 deg around pivot [-4, 22, 0]
  // keeps pivot point invariant in world space while swinging cube tip forward!
  const armNode = rig.bones.get('arm')!;
  rig.root.updateMatrixWorld(true);
  const pivotBefore = new THREE.Vector3();
  armNode.pivotGroup.getWorldPosition(pivotBefore);

  rig.applyPose(
    new Map([
      ['arm', { rotation: [-90, 0, 0], position: [0, 0, 0], scale: [1, 1, 1] }],
    ]),
  );
  rig.root.updateMatrixWorld(true);

  const pivotAfter = new THREE.Vector3();
  armNode.pivotGroup.getWorldPosition(pivotAfter);
  assert.ok(pivotBefore.distanceTo(pivotAfter) < 1e-6, 'Pivot position must remain invariant under rotation');

  // Verify cube rotated forward toward +Z (since root is rotated 180 deg, local -Z maps to world +Z)
  const cubeMesh = armNode.offsetGroup.children[0];
  const cubeWorldPos = new THREE.Vector3();
  cubeMesh.getWorldPosition(cubeWorldPos);
  assert.ok(cubeWorldPos.z > 0.25, `Expected arm swung forward (+Z), got z=${cubeWorldPos.z}`);

  // Dispose releases every geometry/material/bone cleanly
  assert.ok(rig.geometryCount > 0);
  rig.dispose();
  assert.equal(rig.geometryCount, 0);
  assert.equal(rig.bones.size, 0);
});
