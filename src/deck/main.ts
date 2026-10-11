import './deck.css';
import { CARDS } from '../shared/cards';
import { connect } from '../shared/protocol';
import { Game, MODES, MODE_ORDER, type Mode, type Played } from './game';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pileEl = $('pile');
const hud = $('hud');
const speed = $<HTMLInputElement>('speed');

// Preload every face so rapid flips never wait on the network.
const preloaded = [...CARDS.map((c) => c.name), 'back'].map((n) => Object.assign(new Image(), { src: `/cards/${n}.svg` }));

const game = new Game();
let mode: Mode = 'single';
let legalOnly = false;
let auto = false;
let interval = 800;
let seq = 0; // monotonic, so every truth message is distinguishable even after undo
let autoTimer = 0;
let peers = { cam: 0, host: 0, deck: 0 };

const ws = connect('deck', (m) => {
  if (m.type === 'peers') {
    peers = m.peers;
    renderHud();
  }
});

const imgs = new Map<number, HTMLImageElement>();
function renderPile() {
  const vis = game.history.slice(-MODES[mode].visible);
  const keep = new Set(vis.map((p) => p.uid));
  for (const [id, img] of imgs) {
    if (!keep.has(id)) {
      img.remove();
      imgs.delete(id);
    }
  }
  vis.forEach((p: Played, i) => {
    const depth = vis.length - 1 - i;
    let img = imgs.get(p.uid);
    if (!img) {
      img = new Image();
      img.className = depth === 0 ? 'card pop' : 'card';
      img.draggable = false;
      img.src = `/cards/${p.card.name}.svg`;
      imgs.set(p.uid, img);
      pileEl.append(img);
    }
    const j = depth === 0 ? p.top : p.under;
    img.style.transform = `translate(calc(-50% + ${j.dx}vh), calc(-50% + ${j.dy}vh)) rotate(${j.rot}deg)`;
    img.style.zIndex = String(i);
  });
  $('draw-count').textContent = String(game.draw.length);
  $('hint').classList.toggle('gone', game.history.length > 0 || seq > 0);
}

function sendTruth() {
  const top = game.top;
  if (top) ws.send({ type: 'truth', t: Date.now(), cardId: top.card.id, n: ++seq });
}

function flip() {
  game.flip(legalOnly);
  renderPile();
  sendTruth();
  poke();
}
function undo() {
  if (game.undo()) {
    renderPile();
    sendTruth();
  }
  poke();
}
function reshuffle() {
  game.reshuffle();
  ws.send({ type: 'cmd', cmd: 'reset' }); // new pile => phone starts a fresh game
  renderPile();
  poke();
}

function setAuto(on: boolean) {
  auto = on;
  clearTimeout(autoTimer);
  if (auto) {
    const tick = () => {
      flip();
      autoTimer = window.setTimeout(tick, interval);
    };
    autoTimer = window.setTimeout(tick, interval);
  }
  poke();
}
function setSpeed(ms: number) {
  interval = Math.min(3000, Math.max(200, ms));
  speed.value = String(interval);
  poke();
}

// HUD: tiny, bottom corner, fades after a moment of inactivity.
let fadeTimer = 0;
function renderHud() {
  $('h-mode').textContent = `mode: ${mode}`;
  $('h-left').textContent = `${game.draw.length} left · flip ${seq}`;
  $('h-auto').textContent = auto ? 'auto on' : 'auto off';
  $('h-ms').textContent = `${interval} ms`;
  $('h-legal').textContent = `legal-only ${legalOnly ? 'on' : 'off'}`;
  $('h-peers').textContent = `phone ${peers.cam ? '●' : '○'} host ${peers.host ? '●' : '○'}`;
}
function poke() {
  renderHud();
  hud.classList.add('show');
  document.body.classList.remove('idle');
  clearTimeout(fadeTimer);
  fadeTimer = window.setTimeout(() => {
    hud.classList.remove('show');
    document.body.classList.add('idle');
  }, 2500);
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const speedKey = k === '[' || k === ']';
  if (e.repeat && !speedKey) return;
  switch (k) {
    case ' ':
    case 'arrowright':
      flip();
      break;
    case 'arrowleft':
      undo();
      break;
    case 'a':
      setAuto(!auto);
      break;
    case '[':
      setSpeed(interval - 100);
      break;
    case ']':
      setSpeed(interval + 100);
      break;
    case 's':
      reshuffle();
      break;
    case 'l':
      legalOnly = !legalOnly;
      poke();
      break;
    case 'm':
      mode = MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length];
      renderPile();
      poke();
      break;
    case 'h':
      hud.classList.toggle('hidden');
      break;
    default:
      return;
  }
  e.preventDefault();
});
window.addEventListener('click', (e) => {
  if (!hud.contains(e.target as Node)) flip();
});
window.addEventListener('mousemove', poke);
speed.addEventListener('input', () => setSpeed(+speed.value));
speed.addEventListener('change', () => speed.blur());

setSpeed(interval);
flip(); // start with a card on the pile
void preloaded;
