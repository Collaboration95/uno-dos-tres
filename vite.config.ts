import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { WebSocketServer, type WebSocket } from 'ws';
import { lanIPs } from './scripts/lan.mjs';

type Role = 'cam' | 'host' | 'deck';

/** WebSocket relay at /relay + /api/info, mounted on the dev server (same origin => same cert). */
function relay(): Plugin {
  return {
    name: 'uno-relay',
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });
      const roles = new Map<WebSocket, Role>();
      const peers = () => {
        const p: Record<Role, number> = { cam: 0, host: 0, deck: 0 };
        roles.forEach((r) => p[r]++);
        const msg = JSON.stringify({ type: 'peers', peers: p });
        roles.forEach((_, ws) => ws.send(msg));
      };
      server.httpServer?.once('listening', () => {
        const port = server.config.server.port ?? 5173;
        const base = `https://${lanIPs()[0] ?? 'localhost'}:${port}`;
        setTimeout(() => {
          console.log(`\n  ▶ Host (open this):  https://localhost:${port}/`);
          console.log(`  ▶ Deck:             https://localhost:${port}/deck.html`);
          console.log(`  ▶ Phone (LAN):      ${base}/cam.html   (or scan the QR on the host page)\n`);
        }, 100); // after Vite's own banner
      });
      server.httpServer?.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url ?? '', 'http://x');
        if (url.pathname !== '/relay') return; // leave Vite HMR alone
        wss.handleUpgrade(req, socket, head, (ws) => {
          roles.set(ws, (url.searchParams.get('role') as Role) ?? 'host');
          peers();
          ws.on('message', (data, isBinary) => {
            for (const [other, role] of roles) {
              if (other === ws || other.readyState !== other.OPEN) continue;
              if (isBinary && role !== 'host') continue;
              if (isBinary && other.bufferedAmount > 512_000) continue; // drop frames for slow viewers
              other.send(data, { binary: isBinary });
            }
          });
          ws.on('close', () => {
            roles.delete(ws);
            peers();
          });
        });
      });
      // ORT dynamically imports its .mjs glue from /ort/; Vite refuses imports from /public in dev, so serve raw.
      server.middlewares.use('/ort', (req, res, next) => {
        const file = resolve(import.meta.dirname, 'public/ort', (req.url ?? '').split('?')[0].replace(/^\/+/, ''));
        if (!file.startsWith(resolve(import.meta.dirname, 'public/ort')) || !existsSync(file)) return next();
        res.setHeader('content-type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.setHeader('cross-origin-resource-policy', 'same-origin');
        res.end(readFileSync(file));
      });
      // iOS WebKit refuses wss:// to an untrusted cert even after the page warning is accepted,
      // so the phone must install + trust the mkcert root CA once: open /ca on the phone.
      server.middlewares.use('/ca', (_req, res) => {
        const root = execFileSync('mkcert', ['-CAROOT'], { encoding: 'utf8' }).trim();
        res.setHeader('content-type', 'application/x-x509-ca-cert');
        res.setHeader('content-disposition', 'attachment; filename="uno-dev-ca.pem"');
        res.end(readFileSync(resolve(root, 'rootCA.pem')));
      });
      server.middlewares.use('/api/info', (_req, res) => {
        const port = server.config.server.port ?? 5173;
        res.setHeader('content-type', 'application/json');
        const tunnel = existsSync('.certs/tunnel-url') ? [`${readFileSync('.certs/tunnel-url', 'utf8').trim()}/cam.html`] : [];
        res.end(JSON.stringify({ camUrls: [...tunnel, ...lanIPs().map((ip) => `https://${ip}:${port}/cam.html`)] }));
      });
    },
  };
}

const certs = existsSync('.certs/cert.pem')
  ? { cert: readFileSync('.certs/cert.pem'), key: readFileSync('.certs/key.pem') }
  : undefined;

export default defineConfig({
  plugins: [relay()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: ['.trycloudflare.com'],
    https: certs,
    // cross-origin isolation => SharedArrayBuffer => multi-threaded wasm fallback
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
  },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  build: {
    rollupOptions: {
      input: {
        host: resolve(import.meta.dirname, 'index.html'),
        deck: resolve(import.meta.dirname, 'deck.html'),
        cam: resolve(import.meta.dirname, 'cam.html'),
      },
    },
  },
});
