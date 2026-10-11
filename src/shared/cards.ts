import spec from './classes.json';

export type Color = 'red' | 'yellow' | 'green' | 'blue';
export type Value = (typeof spec.values)[number];
export interface Card {
  id: number; // class index, shared with the model
  name: string; // e.g. "red_7", "wild_draw4"
  color: Color | null; // null for wilds
  value: string; // "7", "skip", "reverse", "draw2", "wild", "wild_draw4"
}

export const CARDS: Card[] = [
  ...spec.colors.flatMap((color) =>
    spec.values.map((value) => ({ color: color as Color, value, name: `${color}_${value}` })),
  ),
  ...spec.wilds.map((w) => ({ color: null, value: w, name: w })),
].map((c, id) => ({ id, ...c }));

export const NUM_CLASSES = CARDS.length; // 54
export const byName = (name: string) => CARDS.find((c) => c.name === name)!;

export const COLOR_HEX: Record<Color, string> = {
  red: '#D72600',
  yellow: '#ECD407',
  green: '#379711',
  blue: '#0956BF',
};

/** Human label, e.g. "Red 7", "Blue Skip", "Wild +4". */
export function label(c: Card): string {
  const v: Record<string, string> = { skip: 'Skip', reverse: 'Reverse', draw2: '+2', wild: 'Wild', wild_draw4: 'Wild +4' };
  const val = v[c.value] ?? c.value;
  return c.color ? `${c.color[0].toUpperCase()}${c.color.slice(1)} ${val}` : val;
}

/** A standard 108-card Uno deck (one 0, two of 1-9/skip/reverse/+2 per colour, 4 wild, 4 wild+4). */
export function standardDeck(): Card[] {
  return CARDS.flatMap((c) => {
    if (c.color === null) return [c, c, c, c];
    return c.value === '0' ? [c] : [c, c];
  });
}

export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
