// Prepare a fresh checkout, wait for Vite, then start a Cloudflare quick tunnel.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export function findTunnelUrl(log) {
  return log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
}

async function main() {
  const { values } = parseArgs({ options: { port: { type: 'string', default: '5173' } } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be an integer from 1 to 65535.');
  process.chdir(fileURLToPath(new URL('..', import.meta.url)));
  try {
    execFileSync('cloudflared', ['--version'], { stdio: 'ignore' });
  } catch (err) {
    throw new Error(err.code === 'ENOENT'
      ? 'cloudflared is missing. Install it and retry (see README.md).'
      : 'cloudflared could not run. Check your installation.');
  }
  // Fail before touching a running demo's certificates or URL file.
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error(`Port ${port} is unavailable. Stop its server or use npm run demo -- --port ${port === 65535 ? 5173 : port + 1}.`)));
    probe.listen(port, () => probe.close(resolve));
  });
  execFileSync(process.execPath, ['scripts/certs.mjs'], { stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/copy-ort.mjs'], { stdio: 'inherit' });

  const urlFile = '.certs/tunnel-url';
  mkdirSync('.certs', { recursive: true });
  rmSync(urlFile, { force: true });
  let stopping = false;
  let cf;
  let deadline;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port)], { stdio: 'inherit' });
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    clearTimeout(deadline);
    rmSync(urlFile, { force: true });
    vite.kill();
    cf?.kill();
    process.exitCode = code;
  };
  const fail = (message) => { console.error(`demo: ${message}`); stop(1); };
  process.on('SIGINT', () => stop());
  process.on('SIGTERM', () => stop());
  vite.on('error', (err) => fail(`Cannot start Vite: ${err.message}`));
  vite.on('exit', (code) => { if (!stopping) fail(`Vite exited (${code ?? 'signal'}).`); });

  const ready = () => new Promise((resolve) => {
    const req = https.get(`https://localhost:${port}/api/info`, { rejectUnauthorized: false }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.setTimeout(1000, () => req.destroy());
    req.on('error', () => resolve(false));
  });
  const started = Date.now();
  while (!stopping && !(await ready())) {
    if (Date.now() - started > 30_000) { fail('Vite did not become ready within 30 seconds.'); return; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (stopping) return;

  cf = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `https://localhost:${port}`, '--no-tls-verify']);
  cf.on('error', (err) => fail(`Cannot start cloudflared: ${err.message}`));
  cf.on('exit', (code) => { if (!stopping) fail(`cloudflared exited (${code ?? 'signal'}). Check its output above.`); });
  let log = '';
  let published = false;
  const output = (data) => {
    process.stderr.write(data);
    log = (log + String(data)).slice(-16_384); // keep partial lines across chunks
    const url = findTunnelUrl(log);
    if (!url || published) return;
    published = true;
    clearTimeout(deadline);
    writeFileSync(urlFile, url);
    console.log(`\n  ▶ Phone:  ${url}/cam.html\n  ▶ Host:   ${url}/   (QR points at the tunnel)\n  ▶ Deck:   ${url}/deck.html\n`);
  };
  cf.stdout.on('data', output);
  cf.stderr.on('data', output);
  deadline = setTimeout(() => fail('No tunnel URL after 60 seconds. Check cloudflared output and your internet connection.'), 60_000);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((err) => { console.error(`demo: ${err.message}`); process.exitCode = 1; });
}
