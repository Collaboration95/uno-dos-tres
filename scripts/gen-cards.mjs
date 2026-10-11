// Single source of truth for card art.
//   public/cards/<name>.svg   -> shown by the deck page
//   ml/assets/cards/<name>.png -> composited into synthetic training data
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync('src/shared/classes.json', 'utf8'));
const HEX = { red: '#D72600', yellow: '#ECD407', green: '#379711', blue: '#0956BF' };
const INK = '#1a1a1a';
const W = 240;
const H = 360;
const FONT = `font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-style="italic"`;

/** Glyph for `value`, centred on (0,0), roughly `s` tall. */
function glyph(value, s, fill, stroke) {
  const sw = s * 0.06;
  const outline = stroke ? `stroke="${stroke}" stroke-width="${sw}" paint-order="stroke" stroke-linejoin="round"` : '';
  const text = (t, size = s) =>
    `<text x="0" y="${size * 0.36}" text-anchor="middle" font-size="${size}" ${FONT} fill="${fill}" ${outline}>${t}</text>`;
  if (/^\d$/.test(value)) {
    // Real Uno underlines 6 and 9 so they survive rotation.
    const bar = value === '6' || value === '9' ? `<rect x="${-s * 0.24}" y="${s * 0.46}" width="${s * 0.48}" height="${s * 0.08}" fill="${fill}" ${outline}/>` : '';
    return text(value) + bar;
  }
  if (value === 'draw2') return text('+2', s * 0.8);
  if (value === 'wild_draw4') return text('+4', s * 0.8);
  if (value === 'skip') {
    const r = s * 0.34;
    const w = s * 0.12;
    const d = r * Math.SQRT1_2;
    const sk = stroke ? `<circle r="${r}" fill="none" stroke="${stroke}" stroke-width="${w + sw * 2}"/><line x1="${-d}" y1="${d}" x2="${d}" y2="${-d}" stroke="${stroke}" stroke-width="${w + sw * 2}"/>` : '';
    return `${sk}<circle r="${r}" fill="none" stroke="${fill}" stroke-width="${w}"/><line x1="${-d}" y1="${d}" x2="${d}" y2="${-d}" stroke="${fill}" stroke-width="${w}"/>`;
  }
  if (value === 'reverse') {
    // Two opposing arrows, tilted 45deg.
    const a = s * 0.1; // half shaft width
    const L = s * 0.3; // shaft length
    const hw = s * 0.2; // head half width
    const hl = s * 0.2; // head length
    const arrow = `M${-a},${L / 2} L${-a},${-L / 2} L${-hw},${-L / 2} L0,${-L / 2 - hl} L${hw},${-L / 2} L${a},${-L / 2} L${a},${L / 2} Z`;
    const g = (dx, rot) => `<path transform="translate(${dx},${rot ? s * 0.06 : -s * 0.06}) rotate(${rot})" d="${arrow}" fill="${fill}" ${outline}/>`;
    return `<g transform="rotate(45)">${g(-s * 0.16, 0)}${g(s * 0.16, 180)}</g>`;
  }
  if (value === 'wild') return '';
  throw new Error(value);
}

/** Four-colour oval used by wild cards. */
function wildOval(rx, ry, id) {
  const q = (c, x, y) => `<rect x="${x}" y="${y}" width="${rx * 2}" height="${ry * 2}" fill="${HEX[c]}"/>`;
  return `<clipPath id="${id}"><ellipse rx="${rx}" ry="${ry}"/></clipPath>
  <g clip-path="url(#${id})" transform="rotate(30)">${q('red', -rx * 2, -ry * 2)}${q('blue', 0, -ry * 2)}${q('yellow', -rx * 2, 0)}${q('green', 0, 0)}</g>
  <ellipse rx="${rx}" ry="${ry}" transform="rotate(30)" fill="none" stroke="#fff" stroke-width="${rx * 0.08}"/>`;
}

function cardSVG(name, color, value) {
  const wild = color === null;
  const bg = wild ? INK : HEX[color];
  const inner = `<rect x="12" y="12" width="${W - 24}" height="${H - 24}" rx="14" fill="${bg}"/>`;
  let center;
  let corner;
  if (wild) {
    center = `<g transform="translate(${W / 2},${H / 2})">${wildOval(64, 112, 'wc')}${value === 'wild_draw4' ? glyph(value, 120, '#fff', INK) : ''}</g>`;
    corner = value === 'wild_draw4' ? glyph(value, 54, '#fff', INK) : `<g transform="translate(0,-4)">${wildOval(12, 20, `wk${Math.random().toString(36).slice(2, 7)}`)}</g>`;
  } else {
    center = `<g transform="translate(${W / 2},${H / 2})"><ellipse rx="72" ry="132" transform="rotate(30)" fill="#fff"/>${glyph(value, 140, bg, INK)}</g>`;
    corner = glyph(value, 54, '#fff', INK);
  }
  const corners = `<g transform="translate(40,52)">${corner}</g><g transform="translate(${W - 40},${H - 52}) rotate(180)">${corner}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-card="${name}">
<rect width="${W}" height="${H}" rx="20" fill="#fff"/>${inner}${center}${corners}</svg>\n`;
}

function backSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect width="${W}" height="${H}" rx="20" fill="#fff"/><rect x="12" y="12" width="${W - 24}" height="${H - 24}" rx="14" fill="${INK}"/>
<ellipse cx="${W / 2}" cy="${H / 2}" rx="72" ry="132" transform="rotate(30 ${W / 2} ${H / 2})" fill="${HEX.red}"/>
<text x="${W / 2}" y="${H / 2 + 22}" text-anchor="middle" font-size="64" ${FONT} fill="${HEX.yellow}" stroke="${INK}" stroke-width="4" paint-order="stroke" transform="rotate(-20 ${W / 2} ${H / 2})">UNO</text></svg>\n`;
}

const cards = [
  ...spec.colors.flatMap((c) => spec.values.map((v) => [`${c}_${v}`, c, v])),
  ...spec.wilds.map((w) => [w, null, w]),
];
mkdirSync('public/cards', { recursive: true });
mkdirSync('ml/assets/cards', { recursive: true });
const render = (name, svg) => {
  writeFileSync(`public/cards/${name}.svg`, svg);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 480 }, font: { loadSystemFonts: true, defaultFontFamily: 'Arial' } }).render().asPng();
  writeFileSync(`ml/assets/cards/${name}.png`, png);
};
for (const [name, c, v] of cards) render(name, cardSVG(name, c, v));
render('back', backSVG());
console.log(`rendered ${cards.length} cards + back`);
