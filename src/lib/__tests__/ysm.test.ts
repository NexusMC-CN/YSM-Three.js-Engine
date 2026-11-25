import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzlibSync } from 'fflate';
import { ysmCityHash64 } from '../loader/ysm/CityHash';
import { decryptYsgp, isYsgpBytes } from '../loader/ysm/YsmCrypto';
import { readYsmBinary } from '../loader/ysm/YsmBinaryReader';
import { unpackArchiveBytes, YsmModelLoader } from '../loader/YsmModelLoader';
import { registerArchiveParser, unregisterArchiveParser } from '../loader/ArchiveRegistry';
import { buildCubeGeometry } from '../renderer/CubeGeometryBuilder';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/ysgp-crypto3.json', import.meta.url), 'utf8'));
const archive = (format: number): Uint8Array => new Uint8Array(Buffer.from(fixture.archives[format], 'base64'));

test('YSM CityHash64 matches independent OpenYSM Java vectors across every size branch', () => {
  const vectors = [
    [0, '6f9e3c421ae61eaf'], [1, '97cc4f650ff8461a'], [3, '8ce3417f001c839d'],
    [4, '78974e28fe30584d'], [7, '87aeb69ccdf1ad01'], [8, 'c7db645a1fbc376f'],
    [16, '13dc4d4f3d569a5b'], [17, '3f8447315b6902ed'], [32, 'd4233091db3da54c'],
    [33, 'd2eded8a4770e9c6'], [56, '94d69d5cc5cea4be'], [64, '14c438a6dc281653'],
    [65, '410edde80a0038cb'], [128, '5fce2ac3959c7c2b'], [4097, 'a55d08c79e0fcadf'],
  ] as const;
  for (const [length, expected] of vectors) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) & 255);
    assert.equal(ysmCityHash64(bytes, 0x9e5599db80c67c29n).toString(16), expected, `length ${length}`);
  }
});

for (const format of [26, 32]) {
  test(`YSGP crypto-3 format ${format} decrypts upstream fixtures and preserves geometry, images and keyframes`, async () => {
    const input = archive(format);
    const original = input.slice();
    assert.equal(isYsgpBytes(input), true);
    const payload = decryptYsgp(input);
    assert.deepEqual(payload, new Uint8Array(Buffer.from(fixture.payloads[format], 'base64')));
    assert.deepEqual(input, original, 'Decoding must not mutate the supplied archive');

    const files = await unpackArchiveBytes(input); // Signature detection without a filename.
    const loader = new YsmModelLoader();
    const pack = loader.extractFromVirtualFileSystem(files);
    assert.equal(pack.manifest!.name, 'Codec fixture');
    assert.deepEqual(pack.manifest!.authors, ['Fixture Author']);
    assert.equal(pack.manifest!.widthScale, 0.75);
    assert.ok(Math.abs(pack.manifest!.heightScale! - 0.8) < 1e-6);
    assert.equal(pack.textures.length, 1);
    assert.deepEqual(pack.manifest!.autoAnimations, ['parallel1']);
    assert.equal(files.has('functions/test@player_update.molang'), true);
    assert.equal(new TextDecoder().decode(files.get('lang/zh_cn.json')), '{"hello":"你好"}');

    const png = files.get('textures/skin')!;
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const pngView = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const idatSize = pngView.getUint32(33);
    assert.deepEqual([...unzlibSync(png.subarray(41, 41 + idatSize))], [0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0]);

    // A no-texture load exercises the full public loader and rig in Node; PNG
    // decoding itself is verified above and with the real pack in the browser.
    const nodeFiles = new Map(files);
    nodeFiles.delete('textures/skin');
    const instance = await loader.load({ files: Object.fromEntries(nodeFiles) });
    try {
      assert.equal(instance.model.cubeCount, 1);
      assert.deepEqual(instance.model.bones[0].pivot, [4, 8, 0]);
      assert.ok(Math.abs(instance.model.bones[0].rotation[0] - 45) < 1e-4);
      const cube = instance.model.bones[0].cubes[0];
      const geometry = buildCubeGeometry(cube);
      try {
        assert.equal(geometry.getAttribute('position').count, 4);
        assert.equal(geometry.index!.count, 6);
        assert.deepEqual([...geometry.getAttribute('position').array], [-0.5, 0.5, 0, 0.5, 0.5, 0, 0.5, -0.5, 0, -0.5, -0.5, 0]);
        assert.deepEqual([...geometry.getAttribute('uv').array], [0, 0, 1, 0, 1, 1, 0, 1]);
      } finally { geometry.dispose(); }
      const clips = loader.animationParser.mergeSets(pack.animationJsonTexts.map((text) => loader.animationParser.parse(text)));
      assert.equal(clips.static.length, 0, 'Infinite binary length means a continuous static clip');
      assert.equal(clips.idle.length, 1);
      assert.equal(clips.idle.bones.root.rotation!.keyframes[0].lerpMode, 'catmullrom');
      assert.deepEqual(clips.idle.bones.root.rotation!.keyframes[1].pre, [10, 20, 30]);
      assert.deepEqual(clips.idle.bones.root.rotation!.keyframes[1].post, [40, 50, 60]);
      assert.ok(clips.parallel1.bones.root, 'Main player clips must win duplicate first-person clip names');
      assert.deepEqual(instance.getActiveLayers().map((layer) => layer.name), ['parallel1']);
      instance.crossFadeTo('idle', 0);
      instance.update(0.1);
      assert.equal(instance.getActiveLayers().some((layer) => layer.name === 'parallel1'), true);
    } finally { instance.dispose(); }
  });
}

test('YSGP decoding rejects corruption, truncation, unsupported versions and invalid binary lengths', async () => {
  const damaged = archive(32);
  damaged[30] ^= 1;
  await assert.rejects(() => unpackArchiveBytes(damaged, 'broken.ysm'), /checksum mismatch/);
  assert.throws(() => decryptYsgp(archive(32).subarray(0, 24)), /Truncated/);
  const oldCrypto = archive(32);
  oldCrypto[8] = 2;
  assert.throws(() => decryptYsgp(oldCrypto), /crypto version 2/);
  const payload = decryptYsgp(archive(32));
  new DataView(payload.buffer, payload.byteOffset, payload.byteLength).setUint32(0, 99, true);
  assert.throws(() => readYsmBinary(payload), /binary format 99/);
  assert.throws(() => readYsmBinary(new Uint8Array([32, 0, 0, 0, 255, 255, 255, 255, 255])), /Invalid VarInt/);
  assert.throws(() => readYsmBinary(new Uint8Array([32, 0, 0, 0, 100])), /collection size/);
});

test('YSGP modified ChaCha state changes and MT twists match upstream across multiple chunks', () => {
  const bytes = Buffer.from(fixture.large.archive, 'base64');
  assert.equal(createHash('sha256').update(decryptYsgp(bytes)).digest('hex'), fixture.large.sha256);
});

test('registered custom parsers keep priority over built-in YSGP handling', async () => {
  registerArchiveParser({ name: 'ysgp-test-override', extensions: ['.ysm'], parse: () => new Map([['override', new Uint8Array([42])]]) });
  try {
    const files = await unpackArchiveBytes(archive(32), 'example.ysm');
    assert.deepEqual([...files.keys()], ['override']);
  } finally { unregisterArchiveParser('ysgp-test-override'); }
});
