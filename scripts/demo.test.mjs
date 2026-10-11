// Launcher failure checks use temporary projects and fake binaries, never a real tunnel.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { findTunnelUrl } from './demo.mjs';

function fixture(t, withBinary = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'uno-demo-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['scripts', 'bin', '.certs', 'node_modules/vite/bin']) mkdirSync(path.join(root, dir), { recursive: true });
  copyFileSync(new URL('./demo.mjs', import.meta.url), path.join(root, 'scripts/demo.mjs'));
  writeFileSync(path.join(root, 'scripts/certs.mjs'), "import { writeFileSync } from 'node:fs'; writeFileSync('.certs/prepared', 'certs');");
  writeFileSync(path.join(root, 'scripts/copy-ort.mjs'), "import { appendFileSync } from 'node:fs'; appendFileSync('.certs/prepared', '+runtime');");
  writeFileSync(path.join(root, 'node_modules/vite/bin/vite.js'), "console.error('fake Vite failure'); process.exit(23);");
  if (withBinary) {
    writeFileSync(path.join(root, 'bin/cloudflared'), `#!${process.execPath}\nif (process.argv[2] === '--version') process.exit(0);\nrequire('node:fs').writeFileSync('unexpected-tunnel', 'started');\n`, { mode: 0o755 });
  }
  return root;
}

async function run(t, root, args = []) {
  const child = spawn(process.execPath, [path.join(root, 'scripts/demo.mjs'), ...args], {
    cwd: root, env: { ...process.env, PATH: path.join(root, 'bin') },
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let log = '';
  child.stdout.on('data', (data) => { log += data; });
  child.stderr.on('data', (data) => { log += data; });
  const [code] = await once(child, 'close');
  return { code, log };
}

test('finds a complete URL after split log chunks, ignoring unrelated links', () => {
  const prefix = 'docs: https://developers.cloudflare.com\nurl: https://example-demo.trycloud';
  assert.equal(findTunnelUrl(prefix), undefined);
  assert.equal(findTunnelUrl(prefix + 'flare.com\n'), 'https://example-demo.trycloudflare.com');
});

test('invalid port exits before setup', { timeout: 5000 }, async (t) => {
  const root = fixture(t);
  const result = await run(t, root, ['--port', 'NaN']);
  assert.equal(result.code, 1);
  assert.match(result.log, /--port must be an integer/);
  assert.equal(existsSync(path.join(root, '.certs/prepared')), false);
});

test('missing cloudflared exits with installation guidance', { timeout: 5000 }, async (t) => {
  const root = fixture(t);
  const result = await run(t, root);
  assert.equal(result.code, 1);
  assert.match(result.log, /cloudflared is missing/);
  assert.equal(existsSync(path.join(root, '.certs/prepared')), false);
});

test('busy port preserves an existing URL and skips setup', { timeout: 5000, skip: process.platform === 'win32' }, async (t) => {
  const root = fixture(t, true);
  const server = net.createServer();
  server.listen(0);
  await once(server, 'listening');
  t.after(() => server.close());
  const file = path.join(root, '.certs/tunnel-url');
  writeFileSync(file, 'existing-demo');
  const result = await run(t, root, ['--port', String(server.address().port)]);
  assert.equal(result.code, 1);
  assert.match(result.log, /Port .* is unavailable/);
  assert.equal(readFileSync(file, 'utf8'), 'existing-demo');
  assert.equal(existsSync(path.join(root, '.certs/prepared')), false);
});

test('fresh setup prepares certs and runtime; Vite failure removes stale URL and prevents tunnelling',
  { timeout: 5000, skip: process.platform === 'win32' }, async (t) => {
    const root = fixture(t, true);
    const probe = net.createServer();
    probe.listen(0);
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    writeFileSync(path.join(root, '.certs/tunnel-url'), 'stale-demo');
    const result = await run(t, root, ['--port', String(port)]);
    assert.equal(result.code, 1);
    assert.match(result.log, /Vite exited \(23\)/);
    assert.equal(readFileSync(path.join(root, '.certs/prepared'), 'utf8'), 'certs+runtime');
    assert.equal(existsSync(path.join(root, '.certs/tunnel-url')), false);
    assert.equal(existsSync(path.join(root, 'unexpected-tunnel')), false);
  });
