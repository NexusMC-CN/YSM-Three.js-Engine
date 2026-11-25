import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { directory } = JSON.parse(fs.readFileSync(path.join(root, '.cache/package-consumer.json'), 'utf8'));
const { name } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

for (const format of ['esm']) {
  const imports = `import React from 'react'; import { createRoot } from 'react-dom/client';
    import { YsmViewer } from '${name}/react'; import { YsmModelInstance, registerArchiveParser } from '${name}';`;
  const entry = path.join(directory, `browser-${format}.jsx`);
  fs.writeFileSync(entry, `${imports}
    const geometry = (id) => JSON.stringify({ format_version: '1.12.0', 'minecraft:geometry': [{
      description: { identifier: id, texture_width: 16, texture_height: 16 },
      bones: [{ name: 'body', pivot: [0, 0, 0], cubes: [{ origin: [-4, 0, -2], size: [8, 16, 4], uv: [0, 0] }] }],
    }] });
    const files = (id) => ({ 'main.json': geometry(id), 'main.animation.json': JSON.stringify({ animations: {
      idle: { loop: true, animation_length: 10, bones: { body: { rotation: [0, 'q.ground_speed * 10', 0] } } },
      walk: { loop: true, animation_length: 10, bones: { body: { rotation: ['q.anim_time * 10', 0, 0] } } },
    } }) });
    const packs = { a: { files: files('a') }, b: { files: files('b') } };
    const api = window.testApi = { models: [], errors: [], disposed: [], pending: [], loading: [] };
    const originalDispose = YsmModelInstance.prototype.dispose;
    YsmModelInstance.prototype.dispose = function() { api.disposed.push(this); return originalDispose.call(this); };
    registerArchiveParser({ name: 'package-test', extensions: ['.custom'], canParse: (bytes) => bytes[0] === 99,
      parse: () => new Promise(resolve => api.pending.push(() => resolve(new Map(Object.entries(files('delayed')).map(([name, value]) => [name, new TextEncoder().encode(value)]))))) });
    const ref = React.createRef();
    const tree = createRoot(document.getElementById('root'));
    let current = { source: packs.a, animation: 'idle', paused: false, fadeDuration: 0, query: { ground_speed: 1 }, style: { height: 280 } };
    api.model = () => ref.current?.getModel();
    api.render = (updates = {}) => {
      current = { ...current, ...updates };
      const props = { ...current, ref, loadOptions: { unitScale: 1 / 16 },
        onLoad: model => { if (!(model instanceof YsmModelInstance)) throw new Error('React uses a duplicate engine runtime'); api.models.push(model); },
        onError: error => api.errors.push(error.message), onLoadingChange: value => api.loading.push(value),
      };
      tree.render(<React.StrictMode><YsmViewer {...props} /></React.StrictMode>);
    };
    api.pack = key => packs[key];
    api.slow = () => new File([new Uint8Array([99])], 'slow.ysm');
    api.invalid = () => new File([new Uint8Array([1])], 'bad.zip');
    api.unmount = () => tree.unmount();
    api.render();
  `);
  await build({ entryPoints: [entry], outfile: path.join(directory, `browser-${format}.js`), bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', target: 'es2022' });
}

const server = http.createServer((request, response) => {
  const match = /^\/browser-(esm|cjs)\.js$/.exec(request.url ?? '');
  response.setHeader('Content-Type', match ? 'text/javascript' : 'text/html');
  response.end(match ? fs.readFileSync(path.join(directory, `browser-${match[1]}.js`))
    : '<!doctype html><div id="root" style="width:620px"></div><script type="module" src="/browser-' + (request.url === '/cjs' ? 'cjs' : 'esm') + '.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.YSM_BROWSER_CHANNEL ? { channel: process.env.YSM_BROWSER_CHANNEL } : {}) });
try {
  for (const format of ['esm']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(`${format} browser: ${error.message}`); });
    await page.goto(`http://127.0.0.1:${server.address().port}/${format}`);
    await page.waitForFunction(() => window.testApi?.models.length === 1);
    assert.equal(await page.locator('canvas').count(), 1, 'StrictMode must leave exactly one canvas');
    assert.equal((await page.locator('canvas').boundingBox()).height, 280);
    await page.evaluate(() => window.testApi.render({ paused: true }));
    await page.waitForTimeout(200);
    const clock = await page.evaluate(() => window.testApi.model().getActiveLayers()[0].time);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.testApi.model().getActiveLayers()[0].time), clock);
    await page.evaluate(() => window.testApi.render({ paused: false, animation: 'walk', query: { ground_speed: 2 } }));
    await page.waitForFunction(() => window.testApi.model().getActiveLayers().some(layer => layer.name === 'walk' && layer.time > 0));
    assert.equal(await page.evaluate(() => window.testApi.models.length), 1, 'Inline options and callbacks must not reload models');
    await page.evaluate(() => { document.getElementById('root').style.width = '420px'; });
    await page.waitForFunction(() => document.querySelector('canvas').width === 420);
    await page.evaluate(() => window.testApi.render({ animation: null }));
    await page.waitForFunction(() => window.testApi.model().getActiveLayers().length === 0);
    await page.evaluate(() => window.testApi.render({ source: window.testApi.pack('b') }));
    await page.waitForFunction(() => window.testApi.models.length === 2);
    assert.equal(await page.evaluate(() => window.testApi.models[0].isDisposed), true);
    await page.evaluate(() => window.testApi.render({ source: window.testApi.slow() }));
    await page.waitForFunction(() => window.testApi.pending.length === 1);
    await page.evaluate(() => window.testApi.render({ source: window.testApi.pack('a') }));
    await page.waitForFunction(() => window.testApi.models.length === 3);
    await page.evaluate(() => window.testApi.pending.shift()());
    await page.waitForFunction(() => window.testApi.disposed.some(model => model.model.description.identifier === 'delayed'));
    assert.equal(await page.evaluate(() => window.testApi.model().model.description.identifier), 'a', 'Stale load cannot replace the current source');
    await page.evaluate(() => window.testApi.render({ source: window.testApi.invalid() }));
    await page.getByRole('alert').waitFor();
    assert.equal(await page.evaluate(() => window.testApi.models[2].isDisposed), true);
    await page.evaluate(() => window.testApi.render({ source: null }));
    await page.getByRole('alert').waitFor({ state: 'detached' });
    await page.evaluate(() => window.testApi.render({ source: window.testApi.pack('a') }));
    await page.waitForFunction(() => window.testApi.models.length === 4);
    await page.evaluate(() => window.testApi.unmount());
    assert.equal(await page.locator('canvas').count(), 0);
    assert.equal(await page.evaluate(() => window.testApi.models.every(model => model.isDisposed)), true);
    assert.deepEqual(errors, []);
    console.log(`${format}: React StrictMode, playback, pause, source replacement, resize, stale loads, registry sharing and disposal passed.`);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
