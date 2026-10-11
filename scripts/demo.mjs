// One command: dev server + Cloudflare quick tunnel (real https cert => phone just works, no CA install).
import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';

const URL_FILE = '.certs/tunnel-url';
rmSync(URL_FILE, { force: true });
const vite = spawn('npx', ['vite'], { stdio: 'inherit' });
const cf = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', 'https://localhost:5173', '--no-tls-verify']);
cf.stderr.on('data', (d) => {
  const url = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  if (!url) return;
  writeFileSync(URL_FILE, url);
  console.log(`\n  ▶ Phone:  ${url}/cam.html\n  ▶ Host:   ${url}/   (QR points at the tunnel)\n  ▶ Deck:   ${url}/deck.html\n`);
});
const stop = () => {
  rmSync(URL_FILE, { force: true });
  vite.kill();
  cf.kill();
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
vite.on('exit', stop);
