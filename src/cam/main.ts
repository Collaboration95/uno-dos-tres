import { CARDS, COLOR_HEX, label } from '../shared/cards';
import { connect, type Det, type Msg } from '../shared/protocol';
import { applyPlay, newGame, type GameState } from '../shared/rules';
import { Tracker } from './tracker';
import type { CropDet, FromWorker, ToWorker } from './types';

const MIRROR_W = 480;
const MIRROR_MS = 1000 / 12;
const JPEG_Q = 0.6;
const params = new URLSearchParams(location.search);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('v');
const overlay = $<HTMLCanvasElement>('o');
const hud = $('hud');
const bannerEl = $('banner');
const msgEl = $('msg');
const startBtn = $<HTMLButtonElement>('start');
const g = overlay.getContext('2d')!;

// ---- state
let game: GameState = newGame();
const tracker = new Tracker();
const relay = connect('cam', (m: Msg) => {
  if (m.type === 'cmd' && m.cmd === 'reset') {
    tracker.reset();
    game = newGame();
    bannerEl.textContent = '';
  } else if (m.type === 'peers') hosts = m.peers.host;
});
let hosts = 0;
let worker: Worker | null = null;
let ready = false;
let busy = false;
let backend = '-';
let classes: string[] = [];
let S = 320;
let seq = 0;
let lastDets: Det[] = [];
let inferMs = 0;
let latMs = 0;
let fps = 0;
let done: number[] = []; // completion timestamps (last second)
let bannerAt = 0;
let bannerColor = '#222';

// mirror
let lastMirror = 0;
let encoding = false;
let jpeg: { seq: number; blob: Blob | null } | null = null;
const mirrorCanvas = document.createElement('canvas');
const mirrorCtx = mirrorCanvas.getContext('2d')!;

const say = (t: string, warn = false) => {
  msgEl.textContent = t;
  msgEl.className = warn ? 'warn' : '';
};

// ---- start
if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) {
  startBtn.hidden = true;
  say('Camera needs a secure context. Open this page over https:// (run `npm run certs`, trust the cert on the phone).', true);
} else {
  startBtn.onclick = start;
}

async function start() {
  startBtn.hidden = true;
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    await video.play();
  } catch (e) {
    startBtn.hidden = false;
    say(`Camera unavailable: ${(e as Error).name} ${(e as Error).message}. Allow camera access and tap START again.`, true);
    return;
  }
  say('');
  navigator.wakeLock?.request('screen').catch(() => {});
  startWorker();
  setInterval(drawHud, 250);
  addEventListener('resize', () => draw());
  schedule();
}

function startWorker() {
  worker = new Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' });
  const send = (m: ToWorker) => worker!.postMessage(m, m.type === 'frame' ? [m.bitmap] : []);
  worker.onerror = (e) => say(`Worker error: ${e.message || 'failed to load'}. Streaming video only.`, true);
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.type === 'ready') {
      ready = true;
      backend = m.backend;
      S = m.imgsz;
      classes = m.classes;
      say('');
    } else if (m.type === 'error') {
      backend = 'none';
      say(`${m.missing ? 'Model missing' : 'Model failed'}: ${m.message}. Streaming video only.`, true);
    } else onResult(m);
  };
  sendToWorker = send;
  say('Loading model…');
  send({ type: 'init', name: params.get('model') ?? 'uno', ep: (params.get('ep') as 'webgpu' | 'wasm') ?? 'auto' });
}
let sendToWorker: (m: ToWorker) => void = () => {};

// ---- frame loop: one inference in flight, next frame grabbed as soon as the worker replies
function schedule() {
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(onFrame);
  else requestAnimationFrame(onFrame);
}

function onFrame() {
  schedule();
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || video.readyState < 2) return;
  const now = performance.now();
  const mirrorDue = !encoding && now - lastMirror >= MIRROR_MS && relay.open && hosts > 0;

  if (ready) {
    if (busy) return;
    busy = true;
    ++seq;
    if (mirrorDue) startEncode(seq, now);
    submit(seq, now, vw, vh);
  } else if (mirrorDue) {
    const s = ++seq;
    startEncode(s, now);
    // no model: ship the frame with an empty det so the host still sees video
    jpegDone = (blob) => {
      relay.sendBinary(blob);
      sendDet(s, [], 0);
    };
  }
}

let jpegDone: ((b: Blob) => void) | null = null;

async function submit(s: number, t0: number, vw: number, vh: number) {
  const side = Math.min(vw, vh);
  const sx = (vw - side) >> 1, sy = (vh - side) >> 1;
  try {
    const bitmap = await createImageBitmap(video, sx, sy, side, side, { resizeWidth: S, resizeHeight: S, resizeQuality: 'low' });
    pending = { seq: s, t0, sx, sy, side, vw, vh };
    sendToWorker({ type: 'frame', seq: s, bitmap });
  } catch {
    busy = false;
  }
}
let pending = { seq: 0, t0: 0, sx: 0, sy: 0, side: 1, vw: 1, vh: 1 };

function startEncode(s: number, now: number) {
  encoding = true;
  lastMirror = now;
  const w = MIRROR_W, h = Math.round((MIRROR_W * video.videoHeight) / video.videoWidth);
  if (mirrorCanvas.width !== w || mirrorCanvas.height !== h) {
    mirrorCanvas.width = w;
    mirrorCanvas.height = h;
  }
  mirrorCtx.drawImage(video, 0, 0, w, h);
  jpeg = { seq: s, blob: null };
  mirrorCanvas.toBlob(
    (blob) => {
      encoding = false;
      if (!blob) return;
      if (jpeg?.seq === s) jpeg.blob = blob;
      const cb = jpegDone;
      jpegDone = null;
      cb?.(blob);
    },
    'image/jpeg',
    JPEG_Q,
  );
}

function onResult(m: Extract<FromWorker, { type: 'result' }>) {
  const p = pending;
  const t = performance.now();
  busy = false;
  inferMs = m.inferMs;
  latMs = t - p.t0;
  backend = m.backend;
  done.push(t);
  while (done[0] < t - 1000) done.shift();
  fps = done.length;

  // crop-space -> full-frame normalised
  const dets: Det[] = m.dets.map((d: CropDet) => ({
    cls: d.cls,
    conf: d.conf,
    box: [(p.sx + d.box[0] * p.side) / p.vw, (p.sy + d.box[1] * p.side) / p.vh, (d.box[2] * p.side) / p.vw, (d.box[3] * p.side) / p.vh],
  }));
  lastDets = dets;

  const commit = tracker.update(dets.filter((d) => d.cls < CARDS.length));
  if (commit) {
    const r = applyPlay(game, commit.cls);
    game = r.state;
    bannerEl.textContent = r.event.text;
    bannerEl.className = '';
    bannerColor = CARDS[commit.cls].color ? COLOR_HEX[CARDS[commit.cls].color!] : '#444';
    bannerEl.style.background = r.event.legal ? bannerColor : '#7a1d1d';
    bannerEl.style.color = CARDS[commit.cls].color === 'yellow' ? '#000' : '#fff';
    bannerAt = t;
    relay.send({ type: 'play', t: Date.now(), cardId: commit.cls, conf: commit.conf, event: r.event });
  }

  // JPEG of this very frame goes right before its det
  if (jpeg?.seq === m.seq && jpeg.blob) {
    relay.sendBinary(jpeg.blob);
    jpeg = null;
  }
  sendDet(m.seq, dets, m.inferMs);
  draw();
}

function sendDet(s: number, dets: Det[], ms: number) {
  relay.send({ type: 'det', seq: s, t: Date.now(), dets, inferMs: ms, fps, frameW: video.videoWidth, frameH: video.videoHeight, backend });
}

// ---- overlay
function draw() {
  const dpr = devicePixelRatio || 1;
  const W = innerWidth, H = innerHeight;
  const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
  if (overlay.width !== pw || overlay.height !== ph) {
    overlay.width = pw;
    overlay.height = ph;
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw) return;
  const k = Math.min(W / vw, H / vh);
  const ox = (W - vw * k) / 2, oy = (H - vh * k) / 2;

  // center-square crop the model sees
  const side = Math.min(vw, vh) * k;
  g.setLineDash([8, 6]);
  g.strokeStyle = '#fff8';
  g.lineWidth = 1.5;
  g.strokeRect(ox + (vw * k - side) / 2, oy + (vh * k - side) / 2, side, side);
  g.setLineDash([]);

  g.font = '600 13px system-ui, sans-serif';
  g.textBaseline = 'top';
  for (const d of lastDets) {
    const c = CARDS[d.cls];
    const color = c?.color ? COLOR_HEX[c.color] : '#e8e8e8';
    const text = `${c ? label(c) : (classes[d.cls] ?? d.cls)} ${d.conf.toFixed(2)}`;
    const w = d.box[2] * vw * k, h = d.box[3] * vh * k;
    const x = ox + d.box[0] * vw * k - w / 2, y = oy + d.box[1] * vh * k - h / 2;
    g.strokeStyle = color;
    g.lineWidth = 3;
    g.strokeRect(x, y, w, h);
    const tw = g.measureText(text).width + 8;
    const ty = y >= 20 ? y - 20 : y;
    g.fillStyle = color;
    g.fillRect(x, ty, tw, 20);
    g.fillStyle = c?.color === 'yellow' || !c?.color ? '#000' : '#fff';
    g.fillText(text, x + 4, ty + 3);
  }
}

function drawHud() {
  hud.textContent =
    `${fps} fps  ${inferMs.toFixed(1)} ms  lat ${latMs.toFixed(0)} ms\n` +
    `${backend}${ready ? '' : ' (no model)'}  ${innerWidth > 0 ? `${video.videoWidth}x${video.videoHeight}` : ''}\n` +
    `relay ${relay.open ? `up, ${hosts} host${hosts === 1 ? '' : 's'}` : 'down'}`;
  if (bannerAt && performance.now() - bannerAt > 4000) bannerEl.classList.add('stale');
}
