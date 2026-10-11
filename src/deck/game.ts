import { shuffle, standardDeck, type Card } from '../shared/cards';

/** Display modes: how many of the played cards stay visible (top card is always fully visible). */
export const MODES = {
  single: { visible: 1 },
  pile: { visible: 3 },
} as const;
export type Mode = keyof typeof MODES;
export const MODE_ORDER = Object.keys(MODES) as Mode[];

interface Jitter {
  rot: number; // deg
  dx: number; // vh
  dy: number; // vh
}
export interface Played {
  uid: number;
  card: Card;
  top: Jitter; // placement while on top (small)
  under: Jitter; // placement once covered (larger, so the card peeks out)
}

const rnd = (a: number) => (Math.random() * 2 - 1) * a;
let uid = 0;

/** Matches colour or value, wilds always fine (same rule as shared/rules.ts). */
export const isLegal = (top: Card, c: Card) =>
  c.color === null || top.color === null || c.color === top.color || c.value === top.value;

export class Game {
  draw: Card[] = shuffle(standardDeck());
  history: Played[] = [];

  get top() {
    return this.history.at(-1) ?? null;
  }

  reshuffle() {
    this.draw = shuffle(standardDeck());
    this.history = [];
  }

  /** Flip the next card. Never repeats the card id already on top (the phone could not see a change). */
  flip(legalOnly: boolean): Played {
    if (!this.draw.length) this.draw = shuffle(standardDeck());
    const top = this.top?.card ?? null;
    const fresh = (c: Card) => !top || c.id !== top.id;
    let i = -1;
    if (top && legalOnly) i = this.draw.findIndex((c) => fresh(c) && isLegal(top, c));
    if (i < 0) i = this.draw.findIndex(fresh);
    if (i < 0) i = 0;
    const [card] = this.draw.splice(i, 1);
    const p: Played = {
      uid: ++uid,
      card,
      top: { rot: rnd(8), dx: rnd(3), dy: rnd(3) },
      under: { rot: rnd(22), dx: rnd(10), dy: rnd(5) },
    };
    this.history.push(p);
    return p;
  }

  undo(): boolean {
    const p = this.history.pop();
    if (p) this.draw.unshift(p.card);
    return !!p;
  }
}
