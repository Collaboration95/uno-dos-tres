import { COLOR_HEX, label } from '../shared/cards';
import type { PlayEvent } from '../shared/rules';
import { $, el } from './dom';

const PLAYERS = 4;
const LOG_MAX = 6;
const accent = (c: PlayEvent['card']) => (c.color ? COLOR_HEX[c.color] : '#ffffff');

/** The "projector": big event banner, turn indicator and a short log, all derived from `play` events. */
export class Projector {
  private dir: 1 | -1 = 1;
  private turn = -1;
  private log: PlayEvent[] = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.dir = 1;
    this.turn = -1;
    this.log = [];
    const b = $('banner');
    b.className = 'banner idle-b';
    b.style.removeProperty('--accent');
    $('b-text').textContent = 'Waiting for the first card…';
    $('b-sub').textContent = '';
    $<HTMLImageElement>('b-thumb').removeAttribute('src');
    this.renderTurn();
    this.renderLog();
  }

  onPlay(ev: PlayEvent) {
    if (ev.legal && ev.card.value === 'reverse') this.dir = (this.dir * -1) as 1 | -1;
    this.turn = ev.nextTurn;
    this.log.unshift(ev);
    this.log.length = Math.min(this.log.length, LOG_MAX);

    const b = $('banner');
    b.className = ev.legal ? 'banner' : 'banner illegal';
    b.style.setProperty('--accent', accent(ev.card));
    $<HTMLImageElement>('b-thumb').src = `/cards/${ev.card.name}.svg`;
    $('b-text').textContent = ev.text;
    $('b-sub').textContent = ev.legal ? label(ev.card) : `ILLEGAL · ${label(ev.card)}`;
    void b.offsetWidth; // restart the pop animation
    b.classList.add('pop');

    this.renderTurn();
    this.renderLog();
  }

  private renderTurn() {
    const chips = $('chips');
    const out: HTMLElement[] = [];
    for (let i = 0; i < PLAYERS; i++) {
      if (i) out.push(el('span', 'arrow', this.dir === 1 ? '›' : '‹'));
      out.push(el('span', i === this.turn ? 'chip on' : 'chip', `P${i + 1}`));
    }
    chips.replaceChildren(...out);
    $('dir').textContent =
      this.turn < 0 ? 'no cards played yet' : `${this.dir === 1 ? '↻' : '↺'} Player ${this.turn + 1}'s turn`;
  }

  private renderLog() {
    $('log').replaceChildren(
      ...this.log.map((ev, i) => {
        const li = el('li', `${i === 0 ? 'first ' : ''}${ev.legal ? '' : 'bad'}`);
        const dot = el('i', 'dot');
        dot.style.background = accent(ev.card);
        li.append(dot, el('span', '', ev.text));
        return li;
      }),
    );
  }
}
