import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run npm run publish:package.');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const filename = `${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.tgz`;
const tarball = path.join('.cache', 'npm', filename);
if (!fs.existsSync(tarball)) throw new Error('Run npm run test:package before publishing.');
const result = spawnSync(process.execPath, [npm, 'publish', tarball, '--access', 'public', '--json'], { encoding: 'utf8' });
const redact = text => (text ?? '').split(process.env.NODE_AUTH_TOKEN || '\0').join('[redacted]');
process.stdout.write(redact(result.stdout));
process.stderr.write(redact(result.stderr));
if (result.status !== 0) {
  let message;
  try {
    const output = JSON.parse(result.stdout);
    message = [output.error?.code, output.error?.summary, output.error?.detail].filter(Boolean).join(': ');
  } catch { message = result.stderr?.slice(-3000) || result.error?.message || 'npm publish failed'; }
  const escaped = redact(message).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=npm publish::${escaped}`);
  process.exit(result.status ?? 1);
}
