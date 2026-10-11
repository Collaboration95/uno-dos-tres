import { CARDS, COLOR_HEX, label } from '../shared/cards';
import type { Accuracy } from './accuracy';
import { $, el } from './dom';

const ms = (v: number | null) => (v === null ? '–' : `${Math.round(v)} ms`);

function cardCell(id: number | null) {
  const c = el('span', 'cell');
  if (id === null) {
    c.textContent = '–';
    c.classList.add('none');
    return c;
  }
  const card = CARDS[id];
  const dot = el('i', 'dot');
  dot.style.background = card.color ? COLOR_HEX[card.color] : '#fff';
  c.append(dot, label(card));
  return c;
}

export function renderAccuracy(a: Accuracy) {
  $('a-rate').textContent = a.rate === null ? '–' : `${(a.rate * 100).toFixed(a.rate === 1 ? 0 : 1)}%`;
  $('a-med').textContent = ms(a.percentile(0.5));
  $('a-p90').textContent = ms(a.percentile(0.9));
  $('a-hits').textContent = String(a.hits);
  $('a-wrong').textContent = String(a.wrong);
  $('a-miss').textContent = String(a.missed);

  const rows = $('rows');
  const out: HTMLElement[] = [];
  if (a.pending) {
    const r = el('div', 'row pending');
    r.append(el('span', 'n', String(a.pending.n)), cardCell(a.pending.cardId), el('span', 'cell none', 'waiting…'), el('span', 'lat', ''));
    out.push(r);
  }
  for (const row of a.rows) {
    const r = el('div', `row ${row.outcome}`);
    const mark = row.outcome === 'hit' ? '✓' : row.outcome === 'wrong' ? '✗' : 'missed';
    const lat = el('span', 'lat', row.outcome === 'hit' ? ms(row.latency) : mark);
    r.append(el('span', 'n', String(row.n)), cardCell(row.truthId), cardCell(row.detId), lat);
    out.push(r);
  }
  rows.replaceChildren(...out);
}
