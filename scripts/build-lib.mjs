/**
 * Builds the standalone tree-shakable ESM package from `src/lib/index.ts`
 * (excluding peer dependency `three`) and verifies gzip bundle size < 150 KB.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { build } from 'esbuild';

const outFile = path.resolve(process.cwd(), 'dist-lib/index.js');
const MAX_GZIP_BYTES = 150 * 1024;

await build({
  entryPoints: ['src/lib/index.ts'],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  treeShaking: true,
  external: ['three'],
  sourcemap: false,
  banner: { js: '/*! YSGP decoder includes OpenYSM code (c) 2026 OpenYSM, MIT. See THIRD_PARTY_NOTICES.md. */' },
});

fs.copyFileSync('THIRD_PARTY_NOTICES.md', path.join(path.dirname(outFile), 'THIRD_PARTY_NOTICES.md'));

const raw = fs.readFileSync(outFile);
const gzipped = zlib.gzipSync(raw, { level: 9 });

const rawKb = (raw.byteLength / 1024).toFixed(2);
const gzipKb = (gzipped.byteLength / 1024).toFixed(2);

console.log(`ESM Library Bundle (excluding three):`);
console.log(`  Output : dist-lib/index.js`);
console.log(`  Minified: ${rawKb} KB`);
console.log(`  Gzipped : ${gzipKb} KB (budget: < 150.00 KB)`);

if (gzipped.byteLength >= MAX_GZIP_BYTES) {
  console.error(`ERROR: Bundle exceeds 150 KB gzip budget (${gzipKb} KB)!`);
  process.exit(1);
}
