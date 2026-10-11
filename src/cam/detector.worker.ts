/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import type { CropDet, FromWorker, ModelMeta, ToWorker } from './types';

const CONF = 0.3; // display threshold; the tracker applies its own, stricter one
const NMS_IOU = 0.5;
const MAX_DETS = 20;

const post = (m: FromWorker) => postMessage(m);

ort.env.wasm.wasmPaths = '/ort/';
// Already off the main thread; ORT's nested pthread workers hang under Vite dev + WebKit, so stay single-threaded.
ort.env.wasm.numThreads = 1;

let session: ort.InferenceSession;
let meta: ModelMeta;
let backend = '';
let S = 320;
let tensor: ort.Tensor;
let chw: Float32Array;
let ctx: OffscreenCanvasRenderingContext2D;

async function create(buf: ArrayBuffer, ep: 'auto' | 'webgpu' | 'wasm') {
  const tryEps = ep === 'auto' ? (navigator.gpu ? ['webgpu', 'wasm'] : ['wasm']) : [ep];
  let lastErr: unknown;
  for (const name of tryEps) {
    try {
      // iOS WebGPU can hang instead of throwing; give up after a while and fall back.
      const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${name} init timed out`)), 10_000));
      await Promise.race([
        (async () => {
          session = await ort.InferenceSession.create(buf, { executionProviders: [name], graphOptimizationLevel: 'all' });
          backend = name;
          await run(); // warm-up: compiles shaders / allocates; proves the backend really works
        })(),
        timeout,
      ]);
      return;
    } catch (e) {
      lastErr = e;
      console.warn(`[worker] ${name} failed`, e);
    }
  }
  throw lastErr;
}

async function init(name: string, ep: 'auto' | 'webgpu' | 'wasm') {
  const t0 = performance.now();
  const jr = await fetch(`/models/${name}.json`);
  let m: ModelMeta | null = null;
  try {
    m = await jr.json(); // Vite answers missing files with index.html => parse failure
  } catch {}
  if (!jr.ok || !m || !m.input) return post({ type: 'error', message: `model /models/${name}.json not found`, missing: true });
  meta = m;
  S = meta.imgsz;
  const mr = await fetch(`/models/${name}.onnx`);
  const buf = await mr.arrayBuffer();
  if (!mr.ok || buf.byteLength < 1000 || mr.headers.get('content-type')?.includes('text/html'))
    return post({ type: 'error', message: `model /models/${name}.onnx not found`, missing: true });

  chw = new Float32Array(3 * S * S);
  tensor = new ort.Tensor('float32', chw, [1, 3, S, S]);
  ctx = new OffscreenCanvas(S, S).getContext('2d', { willReadFrequently: true })!;
  await create(buf, ep);
  post({ type: 'ready', backend, imgsz: S, classes: meta.classes, loadMs: performance.now() - t0 });
}

/** RGBA ImageData -> planar float32 RGB / 255, into the reused buffer. */
function fill(d: Uint8ClampedArray) {
  const n = S * S;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    chw[i] = d[j] / 255;
    chw[n + i] = d[j + 1] / 255;
    chw[2 * n + i] = d[j + 2] / 255;
  }
}

async function run(): Promise<CropDet[]> {
  const out = await session.run({ [meta.input]: tensor });
  const t = out[meta.outputName] ?? out[session.outputNames[0]];
  const data = t.data as Float32Array;
  const dets = meta.output === 'end2end' ? decodeEnd2End(data, t.dims) : decodeRaw(data, t.dims);
  return dets;
}

function decodeEnd2End(a: Float32Array, dims: readonly number[]): CropDet[] {
  const K = dims[1];
  const dets: CropDet[] = [];
  for (let k = 0; k < K; k++) {
    const o = k * 6;
    const conf = a[o + 4];
    if (conf < CONF) continue;
    const x1 = a[o] / S, y1 = a[o + 1] / S, x2 = a[o + 2] / S, y2 = a[o + 3] / S;
    dets.push({ cls: a[o + 5] | 0, conf, box: [(x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1] });
  }
  return dets.sort((p, q) => q.conf - p.conf).slice(0, MAX_DETS);
}

function decodeRaw(a: Float32Array, dims: readonly number[]): CropDet[] {
  const C = dims[1], N = dims[2], nc = C - 4;
  const cand: CropDet[] = [];
  for (let i = 0; i < N; i++) {
    let best = -1, bc = CONF;
    for (let c = 0; c < nc; c++) {
      const s = a[(4 + c) * N + i];
      if (s > bc) { bc = s; best = c; }
    }
    if (best < 0) continue;
    cand.push({ cls: best, conf: bc, box: [a[i] / S, a[N + i] / S, a[2 * N + i] / S, a[3 * N + i] / S] });
  }
  return nms(cand);
}

const iou = (a: CropDet['box'], b: CropDet['box']) => {
  const ix = Math.min(a[0] + a[2] / 2, b[0] + b[2] / 2) - Math.max(a[0] - a[2] / 2, b[0] - b[2] / 2);
  const iy = Math.min(a[1] + a[3] / 2, b[1] + b[3] / 2) - Math.max(a[1] - a[3] / 2, b[1] - b[3] / 2);
  if (ix <= 0 || iy <= 0) return 0;
  const inter = ix * iy;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter);
};

/** Class-agnostic NMS: one physical card should yield one box. */
function nms(c: CropDet[]): CropDet[] {
  c.sort((p, q) => q.conf - p.conf);
  const keep: CropDet[] = [];
  for (const d of c) {
    if (keep.length >= MAX_DETS) break;
    if (keep.every((k) => iou(k.box, d.box) < NMS_IOU)) keep.push(d);
  }
  return keep;
}

onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      await init(m.name, m.ep);
    } catch (err) {
      post({ type: 'error', message: String((err as Error)?.message ?? err), missing: false });
    }
    return;
  }
  const t0 = performance.now();
  ctx.drawImage(m.bitmap, 0, 0, S, S);
  m.bitmap.close();
  fill(ctx.getImageData(0, 0, S, S).data);
  let dets: CropDet[] = [];
  try {
    dets = await run();
  } catch (err) {
    console.error('[worker] run failed', err);
  }
  post({ type: 'result', seq: m.seq, dets, inferMs: performance.now() - t0, backend });
};
