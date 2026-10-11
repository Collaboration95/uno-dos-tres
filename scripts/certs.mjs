// Phones only grant camera access on https, so issue a mkcert cert covering every LAN IP.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import { lanIPs } from './lan.mjs';

mkdirSync('.certs', { recursive: true });
const names = ['localhost', '127.0.0.1', `${os.hostname().replace(/\.local$/, '')}.local`, ...lanIPs()];
execFileSync('mkcert', ['-cert-file', '.certs/cert.pem', '-key-file', '.certs/key.pem', ...names], { stdio: 'ignore' });
console.log(`certs: ${names.join(', ')}`);
