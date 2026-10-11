// Serve onnxruntime-web's wasm/mjs runtime files from /ort/ (avoids bundler wasm quirks).
import { cpSync, mkdirSync, readdirSync } from 'node:fs';

const src = 'node_modules/onnxruntime-web/dist';
mkdirSync('public/ort', { recursive: true });
for (const f of readdirSync(src)) if (/^ort-wasm.*\.(wasm|mjs)$/.test(f)) cpSync(`${src}/${f}`, `public/ort/${f}`);
