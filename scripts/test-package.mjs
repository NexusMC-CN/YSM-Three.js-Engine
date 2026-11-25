import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this check using npm run test:package.');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ysm-package-'));
const packageDir = path.join(root, '.cache', 'npm');
fs.mkdirSync(packageDir, { recursive: true });
const npm = (args, cwd = root) => execFileSync(process.execPath, [npmCli, ...args], {
  cwd, encoding: 'utf8', timeout: 180000,
  env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_fetch_retries: '0' },
});

console.log('Packing npm distribution…');
const packOutput = npm(['pack', '--json', '--pack-destination', packageDir]);
const [packed] = JSON.parse(packOutput.slice(packOutput.indexOf('[{') >= 0 ? packOutput.indexOf('[{') : packOutput.indexOf('[\n')));
const tarball = path.join(packageDir, packed.filename);
const paths = packed.files.map((file) => file.path);
assert.ok(paths.includes('README.md'));
assert.ok(paths.includes('THIRD_PARTY_NOTICES.md'));
assert.ok(paths.includes('LICENSE'));
assert.ok(paths.includes('dist-lib/react.js'));
assert.ok(paths.includes('dist-lib/types/react/YsmViewer.d.ts'));
assert.ok(!paths.some((file) => /^(src|\.cache|node_modules|dist)\//.test(file)));
assert.ok(!paths.some((file) => /\.ysm$|\.env|fixtures/.test(file)));
console.log(`Packed ${packed.filename}: ${(packed.size / 1024).toFixed(1)} KB, ${paths.length} files.`);

fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ name: 'ysm-package-consumer', private: true, type: 'module' }));
const registry = process.env.YSM_TEST_REGISTRY;
const registryArgs = registry ? [`--registry=${registry}`] : [];
console.log('Installing tarball in an independent consumer:', scratch);
console.log(npm(['install', tarball, '--ignore-scripts', '--package-lock=false', '--omit=optional', ...registryArgs], scratch).trim());
fs.writeFileSync(path.join(scratch, 'core-only.mjs'), `
  import assert from 'node:assert/strict';
  import { createRequire } from 'node:module';
  import { MolangEvaluator, BedrockModelParser } from '${pkg.name}/core';
  const require = createRequire(import.meta.url);
  const evaluator = new MolangEvaluator();
  assert.equal(evaluator.evaluate('math.sin(90) + 2', { query: {}, variables: {} }), 3);
  assert.equal(typeof require('${pkg.name}/core').BedrockModelParser, 'function');
  assert.throws(() => require.resolve('react'), { code: 'MODULE_NOT_FOUND' });
  assert.throws(() => require.resolve('three'), { code: 'MODULE_NOT_FOUND' });
  console.log('Core ESM/CommonJS imports work without React or Three.js.');
`);
console.log(execFileSync(process.execPath, ['core-only.mjs'], { cwd: scratch, encoding: 'utf8' }).trim());

const versions = Object.fromEntries(['react', 'react-dom', 'three', '@types/react', '@types/react-dom', '@types/three'].map((name) => {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
  return [name, version];
}));
console.log(npm(['install', ...Object.entries(versions).map(([name, version]) => `${name}@${version}`), '--ignore-scripts', '--package-lock=false', ...registryArgs], scratch).trim());
fs.writeFileSync(path.join(scratch, 'entries.mjs'), `
  import assert from 'node:assert/strict';
  import { createRequire } from 'node:module';
  import React from 'react';
  import { renderToString } from 'react-dom/server';
  import { YsmModelLoader, registerArchiveParser, getRegisteredArchiveParsers } from '${pkg.name}';
  import { YsmViewer, YsmViewport } from '${pkg.name}/react';
  const require = createRequire(import.meta.url);
  const cjs = require('${pkg.name}');
  const cjsReact = require('${pkg.name}/react');
  assert.equal(typeof YsmModelLoader, 'function');
  assert.ok(YsmViewer && YsmViewport && cjsReact.YsmViewer);
  registerArchiveParser({ name: 'consumer', extensions: ['.consumer'], parse: () => new Map() });
  assert.equal(getRegisteredArchiveParsers()[0].name, 'consumer');
  assert.equal(typeof cjs.YsmModelLoader, 'function');
  assert.match(renderToString(React.createElement(YsmViewer, { style: { height: 200 } })), /height:200px/);
  assert.match(renderToString(React.createElement(cjsReact.YsmViewer)), /aria-busy/);
  console.log('Engine and React entries import in ESM/CommonJS and render on the server.');
`);
console.log(execFileSync(process.execPath, ['entries.mjs'], { cwd: scratch, encoding: 'utf8' }).trim());

const typeSource = `
import { createRef, createElement } from 'react';
import { YsmModelLoader, type YsmLoadSource } from '${pkg.name}';
import { MolangEvaluator } from '${pkg.name}/core';
import { YsmViewer, type YsmViewerHandle } from '${pkg.name}/react';
const ref = createRef<YsmViewerHandle>();
const source: YsmLoadSource = '/models/player.ysm';
const viewer = createElement(YsmViewer, { source, ref, animation: 'idle', onLoad(model) { model.play('walk'); } });
new YsmModelLoader(); new MolangEvaluator(); void viewer;
`;
fs.writeFileSync(path.join(scratch, 'types.mts'), typeSource);
fs.writeFileSync(path.join(scratch, 'types.cts'), typeSource);
for (const resolution of ['NodeNext', 'Bundler']) {
  const config = {
    compilerOptions: { strict: true, noEmit: true, module: resolution === 'NodeNext' ? 'NodeNext' : 'ESNext', moduleResolution: resolution, target: 'ES2022', skipLibCheck: false },
    include: resolution === 'NodeNext' ? ['types.mts', 'types.cts'] : ['types.mts'],
  };
  fs.writeFileSync(path.join(scratch, 'tsconfig.json'), JSON.stringify(config));
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(scratch, 'tsconfig.json')], { cwd: scratch, stdio: 'inherit' });
}
console.log('TypeScript ESM/CommonJS declarations pass NodeNext and Bundler resolution.');
console.log('Package checks passed. Tarball:', tarball);
console.log('Consumer workspace:', scratch);
fs.writeFileSync(path.join(root, '.cache', 'package-consumer.json'), JSON.stringify({ directory: scratch, tarball }));
