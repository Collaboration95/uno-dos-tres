// Phones only grant camera access on https, so issue a mkcert cert covering every LAN IP.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import { lanIPs } from './lan.mjs';

mkdirSync('.certs', { recursive: true });
const names = ['localhost', '127.0.0.1', `${os.hostname().replace(/\.local$/, '')}.local`, ...lanIPs()];
try {
  execFileSync('mkcert', ['-cert-file', '.certs/cert.pem', '-key-file', '.certs/key.pem', ...names], { stdio: 'inherit' });
} catch (err) {
  console.error(err.code === 'ENOENT'
    ? 'mkcert is missing. Install it, run mkcert -install, then retry (see README.md).'
    : 'Certificate generation failed. Check the mkcert output above.');
  process.exit(1);
}
console.log(`certs: ${names.join(', ')}`);
