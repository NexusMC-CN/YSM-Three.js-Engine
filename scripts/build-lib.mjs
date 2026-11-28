import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'dist-lib');
// Build output is a fixed child of this repository, never a caller-supplied path.
fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });

for (const format of ['esm', 'cjs']) {
  const extension = format === 'esm' ? '.js' : '.cjs';
  const result = await build({
    absWorkingDir: root,
    entryPoints: { index: 'src/lib/index.ts', core: 'src/core/index.ts', react: 'src/react/index.ts', vue: 'src/vue/index.ts' },
    outdir,
    outExtension: { '.js': extension },
    bundle: true, format, platform: 'browser', target: 'es2022',
    splitting: format === 'esm', chunkNames: 'chunks/[name]-[hash]',
    minify: true, treeShaking: true, metafile: true,
    external: ['three', 'react', 'react-dom', 'vue'],
    jsx: 'automatic',
    banner: { js: '/*! YSGP decoder includes OpenYSM code (c) 2026 OpenYSM, MIT. See THIRD_PARTY_NOTICES.md. */' },
    plugins: [{
      name: 'shared-engine-entry',
      setup(build) {
        // Framework adapters and the root entry must share the same archive registry and
        // runtime classes, including in the CommonJS distribution.
        build.onResolve({ filter: /^\.\.\/lib$/ }, (args) => {
          if (/\/src\/(react|vue|components)\//.test(args.importer.replaceAll('\\', '/'))) return { path: `./index${extension}`, external: true };
        });
      },
    }],
  });
  const reactEntry = path.join(outdir, `react${extension}`);
  fs.writeFileSync(reactEntry, `'use client';\n${fs.readFileSync(reactEntry, 'utf8')}`);
  fs.writeFileSync(path.join(outdir, `meta-${format}.json`), JSON.stringify(result.metafile, null, 2));
}

execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.lib.json'], { cwd: root, stdio: 'inherit' });

function fixDeclarations(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) fixDeclarations(filename);
    else if (entry.name.endsWith('.d.ts')) {
      const text = fs.readFileSync(filename, 'utf8').replace(/(from\s+['"]|import\(['"])(\.[^'"]+)(['"])/g, (_, prefix, specifier, suffix) => {
        const target = path.resolve(path.dirname(filename), specifier);
        const resolved = fs.existsSync(`${target}.d.ts`) ? `${specifier}.js` : `${specifier}/index.js`;
        return prefix + resolved + suffix;
      });
      fs.writeFileSync(filename, text);
    }
  }
}
fixDeclarations(path.join(outdir, 'types'));
function commonJsDeclarations(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) commonJsDeclarations(filename);
    else if (entry.name.endsWith('.d.ts')) {
      const relative = path.relative(path.join(outdir, 'types'), filename).replace(/\.d\.ts$/, '.d.cts');
      const target = path.join(outdir, 'types-cjs', relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, fs.readFileSync(filename, 'utf8').replace(/(from\s+['"]|import\(['"])(\.[^'"]+)\.js(['"])/g, '$1$2.cjs$3'));
    }
  }
}
commonJsDeclarations(path.join(outdir, 'types'));
fs.copyFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(outdir, 'THIRD_PARTY_NOTICES.md'));

const metadata = JSON.parse(fs.readFileSync(path.join(outdir, 'meta-esm.json'), 'utf8'));
const entry = Object.entries(metadata.outputs).find(([, info]) => info.entryPoint === 'src/lib/index.ts')[0];
const visited = new Set();
function collect(filename) {
  if (visited.has(filename)) return;
  visited.add(filename);
  for (const imported of metadata.outputs[filename]?.imports ?? []) if (!imported.external) collect(imported.path);
}
collect(entry);
const size = zlib.gzipSync(Buffer.concat([...visited].map((file) => fs.readFileSync(path.resolve(root, file))))).length;
if (size >= 150 * 1024) throw new Error(`Engine exceeds 150 KB gzip budget: ${size} bytes`);
for (const format of ['esm', 'cjs']) fs.rmSync(path.join(outdir, `meta-${format}.json`));
console.log(`Built ESM, CommonJS and declarations for engine, core, React and Vue. Engine gzip: ${(size / 1024).toFixed(2)} KB.`);
