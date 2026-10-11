import { CARDS, label, type Card } from './cards';

export interface GameState {
  players: number;
  turn: number; // index of the player whose turn it is
  dir: 1 | -1;
  top: Card | null;
}

export interface PlayEvent {
  card: Card;
  legal: boolean; // matches colour or value of previous top (wilds always legal)
  text: string; // big banner text, e.g. "Skip! Player 3 is skipped"
  nextTurn: number;
}

export const newGame = (players = 4): GameState => ({ players, turn: 0, dir: 1, top: null });

const step = (s: GameState, n: number) => (((s.turn + s.dir * n) % s.players) + s.players) % s.players;

/** Pure: apply a detected play of `cardId` onto the pile. */
export function applyPlay(s: GameState, cardId: number): { state: GameState; event: PlayEvent } {
  const card = CARDS[cardId];
  const prev = s.top;
  const legal = !prev || card.color === null || prev.color === null || card.color === prev.color || card.value === prev.value;
  const p = (i: number) => `Player ${i + 1}`;
  let dir = s.dir;
  let next: number;
  let text: string;
  switch (card.value) {
    case 'skip':
      next = step(s, 2);
      text = `Skip! ${p(step(s, 1))} loses their turn`;
      break;
    case 'reverse':
      dir = (s.dir * -1) as 1 | -1;
      next = s.players === 2 ? s.turn : (((s.turn + dir) % s.players) + s.players) % s.players;
      text = `Reverse! Play goes ${dir === 1 ? 'clockwise' : 'counter-clockwise'}`;
      break;
    case 'draw2':
      next = step(s, 2);
      text = `+2! ${p(step(s, 1))} draws 2 and is skipped`;
      break;
    case 'wild':
      next = step(s, 1);
      text = `Wild! ${p(s.turn)} picks a colour`;
      break;
    case 'wild_draw4':
      next = step(s, 2);
      text = `+4! ${p(step(s, 1))} draws 4 and is skipped`;
      break;
    default:
      next = step(s, 1);
      text = `${label(card)} — ${p(next)}'s turn`;
  }
  if (!legal) text = `Illegal play: ${label(card)} on ${label(prev!)}`;
  return { state: { ...s, dir, turn: legal ? next : s.turn, top: legal ? card : s.top }, event: { card, legal, text, nextTurn: legal ? next : s.turn } };
}
