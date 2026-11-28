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

for (const mode of ['vue', 'vanilla']) {
  const entry = path.join(directory, `browser-${mode}.js`);
  fs.writeFileSync(entry, `
    ${mode === 'vue' ? `import { createApp, h, shallowReactive, shallowRef, isProxy } from 'vue'; import { YsmViewer } from '${name}/vue';` : ''}
    import { createYsmViewer, YsmModelInstance, registerArchiveParser } from '${name}';
    const geometry = id => JSON.stringify({ format_version: '1.12.0', 'minecraft:geometry': [{
      description: { identifier: id, texture_width: 16, texture_height: 16 },
      bones: [{ name: 'body', pivot: [0, 0, 0], cubes: [{ origin: [-4, 0, -2], size: [8, 16, 4], uv: [0, 0] }] }],
    }] });
    const files = id => ({ 'main.json': geometry(id), 'main.animation.json': JSON.stringify({ animations: {
      idle: { loop: true, animation_length: 10, bones: { body: { rotation: [0, 'q.ground_speed * 10', 0] } } },
      walk: { loop: true, animation_length: 10, bones: { body: { rotation: ['q.anim_time * 10', 0, 0] } } },
    } }) });
    const packs = { a: { files: files('a') }, b: { files: files('b') } };
    const api = window.testApi = { models: [], errors: [], disposed: [], pending: [], loading: [], telemetry: [] };
    const originalDispose = YsmModelInstance.prototype.dispose;
    YsmModelInstance.prototype.dispose = function() { api.disposed.push(this); return originalDispose.call(this); };
    registerArchiveParser({ name: 'package-test', extensions: ['.custom'], canParse: bytes => bytes[0] === 99,
      parse: () => new Promise(resolve => api.pending.push(() => resolve(new Map(Object.entries(files('delayed')).map(([name, value]) => [name, new TextEncoder().encode(value)]))))) });
    const callbacks = {
      onLoad(model) {
        if (!(model instanceof YsmModelInstance)) throw new Error('Duplicate engine runtime');
        if ('${mode}' === 'vue' && (isProxy(model) || isProxy(model.root))) throw new Error('Three.js objects became Vue proxies');
        api.models.push(model);
      },
      onError: error => api.errors.push(error.message),
      onLoadingChange: loading => api.loading.push(loading),
      onTelemetry: value => api.telemetry.push(value),
    };
    const initial = { source: packs.a, animation: 'idle', paused: false, fadeDuration: 0, query: { ground_speed: 1 }, loadOptions: { unitScale: 1 / 16 } };
    if ('${mode}' === 'vue') {
      const current = shallowReactive(initial);
      const ref = shallowRef(null);
      const app = createApp({ render: () => h(YsmViewer, { ...current, ...callbacks, ref, style: { height: '280px' } }, {
        loading: () => h('span', { id: 'loading-slot' }, 'loading model'),
        error: ({ error }) => h('span', { id: 'error-slot' }, error.message),
      }) });
      app.mount(document.getElementById('root'));
      api.handle = () => ref.value;
      api.render = updates => Object.assign(current, updates);
      api.unmount = () => app.unmount();
    } else {
      const container = document.getElementById('root');
      container.style.height = '280px';
      const controller = createYsmViewer(container, { ...initial, ...callbacks });
      api.handle = () => controller;
      api.render = updates => controller.update(updates);
      api.load = (source, options) => controller.load(source, options);
      api.unmount = () => { controller.dispose(); controller.dispose(); };
    }
    api.model = () => api.handle()?.getModel();
    api.pack = key => packs[key];
    api.slow = () => new File([new Uint8Array([99])], 'slow.ysm');
    api.invalid = () => new File([new Uint8Array([1])], 'bad.zip');
  `);
  const result = await build({ entryPoints: [entry], outfile: path.join(directory, `bundle-${mode}.js`), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', metafile: true });
  if (mode === 'vanilla') assert.ok(!Object.keys(result.metafile.inputs).some(file => /node_modules[\\/](vue|@vue|react)[\\/]/.test(file)), 'Vanilla viewer must not bundle a framework');
}

const server = http.createServer((request, response) => {
  const match = /^\/bundle-(vue|vanilla)\.js$/.exec(request.url ?? '');
  response.setHeader('Content-Type', match ? 'text/javascript' : 'text/html');
  response.end(match ? fs.readFileSync(path.join(directory, `bundle-${match[1]}.js`))
    : '<!doctype html><div id="root" style="width:620px"></div><script type="module" src="/bundle-' + (request.url === '/vanilla' ? 'vanilla' : 'vue') + '.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.YSM_BROWSER_CHANNEL ? { channel: process.env.YSM_BROWSER_CHANNEL } : {}) });
try {
  for (const mode of ['vue', 'vanilla']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(`${mode} browser: ${error.message}`); });
    await page.goto(`http://127.0.0.1:${server.address().port}/${mode}`);
    await page.waitForFunction(() => window.testApi?.models.length === 1 && window.testApi.telemetry.length > 0);
    assert.equal(await page.locator('canvas').count(), 1);
    assert.equal((await page.locator('canvas').boundingBox()).height, 280);
    await page.waitForFunction(() => Math.abs(window.testApi.model().bones.get('body').pivotGroup.rotation.y) > 0.1);
    await page.evaluate(() => window.testApi.render({ paused: true }));
    await page.waitForTimeout(200);
    const clock = await page.evaluate(() => window.testApi.model().getActiveLayers()[0].time);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.testApi.model().getActiveLayers()[0].time), clock);
    await page.evaluate(() => window.testApi.render({ paused: false, animation: 'walk', query: { ground_speed: 2 }, loadOptions: { unitScale: 1 / 16 } }));
    await page.waitForFunction(() => window.testApi.model().getActiveLayers().some(layer => layer.name === 'walk' && layer.time > 0));
    assert.equal(await page.evaluate(() => window.testApi.models.length), 1, 'Equivalent inline options must not reload');
    await page.evaluate(() => { document.getElementById('root').style.width = '420px'; });
    await page.waitForFunction(() => document.querySelector('canvas').width === 420);
    await page.evaluate(() => window.testApi.render({ animation: null }));
    await page.waitForFunction(() => window.testApi.model().getActiveLayers().length === 0);
    assert.equal(await page.evaluate(() => window.testApi.handle().play('walk')), true);
    assert.equal(await page.evaluate(() => window.testApi.handle().stop('walk', 0)), true);
    assert.equal(await page.evaluate(() => window.testApi.handle().crossFadeTo('idle', 0)), true);
    await page.evaluate(() => window.testApi.handle().resetPose());
    assert.equal(await page.evaluate(() => window.testApi.model().getActiveLayers().length), 0);
    await page.evaluate(() => window.testApi.handle().setCameraPreset('front'));
    assert.ok((await page.evaluate(() => window.testApi.handle().getMemorySnapshot())).geometries > 0);
    await page.evaluate(() => window.testApi.render({ source: window.testApi.pack('b'), animation: 'idle' }));
    await page.waitForFunction(() => window.testApi.models.length === 2);
    assert.equal(await page.evaluate(() => window.testApi.models[0].isDisposed), true);
    await page.evaluate(() => window.testApi.render({ source: window.testApi.slow() }));
    await page.waitForFunction(() => window.testApi.pending.length === 1);
    if (mode === 'vue') await page.locator('#loading-slot').waitFor();
    await page.evaluate(() => window.testApi.render({ source: window.testApi.pack('a') }));
    await page.waitForFunction(() => window.testApi.models.length === 3);
    await page.evaluate(() => window.testApi.pending.shift()());
    await page.waitForFunction(() => window.testApi.disposed.some(model => model.model.description.identifier === 'delayed'));
    assert.equal(await page.evaluate(() => window.testApi.model().model.description.identifier), 'a');
    await page.evaluate(() => window.testApi.render({ source: window.testApi.invalid() }));
    await page.waitForFunction(() => window.testApi.errors.length === 1);
    if (mode === 'vue') await page.locator('#error-slot').waitFor();
    assert.equal(await page.evaluate(() => window.testApi.models[2].isDisposed), true);
    await page.evaluate(() => window.testApi.render({ source: null }));
    if (mode === 'vue') await page.getByRole('alert').waitFor({ state: 'detached' });
    else assert.equal(await page.evaluate(() => window.testApi.handle().getState().error), null);
    if (mode === 'vanilla') {
      assert.equal(await page.evaluate(async () => {
        const model = await window.testApi.load(window.testApi.pack('a'));
        return model === window.testApi.model();
      }), true, 'Vanilla load resolves to the installed model');
    } else {
      await page.evaluate(() => window.testApi.render({ source: window.testApi.pack('a') }));
    }
    await page.waitForFunction(() => window.testApi.models.length === 4);
    // Option changes must really reload, including a replacement of the options object.
    await page.evaluate(() => window.testApi.render({ loadOptions: { unitScale: 1 / 32 } }));
    await page.waitForFunction(() => window.testApi.models.length === 5);
    assert.equal(await page.evaluate(() => window.testApi.models[3].isDisposed), true);
    await page.evaluate(() => window.testApi.render({ source: window.testApi.slow() }));
    await page.waitForFunction(() => window.testApi.pending.length === 1);
    await page.evaluate(() => { window.testApi.unmount(); window.testApi.pending.shift()(); });
    await page.waitForFunction(() => window.testApi.disposed.filter(model => model.model.description.identifier === 'delayed').length === 2);
    assert.equal(await page.locator('canvas').count(), 0);
    assert.equal(await page.evaluate(() => window.testApi.models.every(model => model.isDisposed)), true);
    assert.equal(await page.evaluate(() => window.testApi.disposed.length === new Set(window.testApi.disposed).size), true, 'Each instance is disposed exactly once');
    assert.deepEqual(errors, []);
    console.log(`${mode}: playback, query, pause, source/options changes, resize, errors, stale loads and unmount disposal passed.`);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
