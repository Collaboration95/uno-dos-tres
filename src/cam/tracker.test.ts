// Run: node src/cam/tracker.test.ts
import assert from 'node:assert/strict';
// @ts-expect-error .ts extension import is only needed for node's type stripping
import { Tracker } from './tracker.ts';

type Box = [number, number, number, number];
const det = (cls: number, box: Box, conf = 0.9) => ({ cls, conf, box });
const A: Box = [0.5, 0.5, 0.3, 0.4];
const B: Box = [0.2, 0.3, 0.3, 0.4];

function feed(t: Tracker, frames: ReturnType<typeof det>[][]) {
  return frames.map((f) => t.update(f)?.cls ?? null);
}

// stable commit: exactly at the third consistent frame
{
  const t = new Tracker();
  assert.deepEqual(feed(t, [[det(7, A)], [det(7, A)], [det(7, A)], [det(7, A)]]), [null, null, 7, null]);
}
// flicker rejection: a single-frame blip never commits, low-conf is ignored
{
  const t = new Tracker();
  const r = feed(t, [[det(7, A)], [det(7, A)], [det(7, A)], [det(9, A)], [det(7, A)], [det(7, A)], [det(3, A, 0.4)], [det(7, A)]]);
  assert.deepEqual(r, [null, null, 7, null, null, null, null, null]);
  const u = new Tracker();
  assert.deepEqual(feed(u, [[det(1, A)], [det(2, A)], [det(1, A)], [det(2, A)], [det(1, A)], [det(2, A)]]), Array(6).fill(null));
}
// new card on top: partially covered old card + fully visible new one
{
  const t = new Tracker();
  const r = feed(t, [
    ...Array(3).fill([det(7, A)]),
    ...Array(3).fill([det(7, A, 0.6), det(12, B)]),
  ]);
  assert.deepEqual(r, [null, null, 7, null, null, 12]);
}
// same card played twice in a row (two Red 5s): box jumps, then holds still
{
  const t = new Tracker();
  const old = det(5, A, 0.7); // old card still visible beneath, lower score
  const r = feed(t, [
    det(5, A), det(5, A), det(5, A), // commit
    ...[0, 0, 0].map(() => det(5, A)), // jitter-free still pile: no commit
    [det(5, [0.52, 0.5, 0.3, 0.4]), ], // small drift: no commit
    [det(5, B), old], [det(5, B), old], [det(5, B), old], [det(5, B), old],
  ].map((x) => (Array.isArray(x) ? x : [x])));
  assert.deepEqual(r.filter((x) => x !== null), [5, 5]);
  assert.equal(r[2], 5);
  assert.equal(r[9], 5); // third settled frame of the new position
  assert.deepEqual(t.top?.box, B);
}
// reset
{
  const t = new Tracker();
  feed(t, Array(3).fill([det(7, A)]));
  t.reset();
  assert.equal(t.top, null);
  assert.deepEqual(feed(t, Array(3).fill([det(7, A)])), [null, null, 7]);
}
console.log('tracker tests passed');
