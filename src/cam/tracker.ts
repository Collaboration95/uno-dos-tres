import type { Det } from '../shared/protocol';

// Tunables
export const MIN_CONF = 0.5; // ignore weaker detections entirely
export const WINDOW = 4; // frames of history
export const MIN_VOTES = 3; // frames (of WINDOW) the same card must win to commit
export const REPLAY_IOU = 0.3; // same class, box overlap below this vs committed box => a new physical card
export const STABLE_IOU = 0.5; // the moved box must hold still (consecutive-frame IoU) before we trust it

export interface Commit {
  cls: number;
  conf: number;
  box: Det['box'];
}

export const iou = (a: Det['box'], b: Det['box']): number => {
  const ix = Math.min(a[0] + a[2] / 2, b[0] + b[2] / 2) - Math.max(a[0] - a[2] / 2, b[0] - b[2] / 2);
  const iy = Math.min(a[1] + a[3] / 2, b[1] + b[3] / 2) - Math.max(a[1] - a[3] / 2, b[1] - b[3] / 2);
  if (ix <= 0 || iy <= 0) return 0;
  const inter = ix * iy;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter);
};

/** Fully visible, confident, big card wins: the top of a pile. */
const score = (d: Det) => d.conf * Math.sqrt(d.box[2] * d.box[3]);
const best = (ds: Det[]) => ds.reduce<Det | undefined>((b, d) => (!b || score(d) > score(b) ? d : b), undefined);

export class Tracker {
  private hist: Det[][] = [];
  top: Commit | null = null;

  reset() {
    this.hist = [];
    this.top = null;
  }

  /** Feed one frame of detections; returns a Commit when a new card was played on the pile. */
  update(dets: Det[]): Commit | null {
    this.hist.push(dets.filter((d) => d.conf >= MIN_CONF));
    if (this.hist.length > WINDOW) this.hist.shift();

    const votes = new Map<number, number>();
    for (const f of this.hist) {
      const b = best(f);
      if (b) votes.set(b.cls, (votes.get(b.cls) ?? 0) + 1);
    }
    let cls = -1;
    for (const [c, n] of votes) if (n >= MIN_VOTES && (cls < 0 || n > votes.get(cls)!)) cls = c;
    if (cls < 0) return null;

    // best box of that class in each frame, oldest first
    const seen = this.hist.map((f) => best(f.filter((d) => d.cls === cls))).filter((d): d is Det => !!d);
    const last = seen[seen.length - 1];
    const top = this.top;

    if (!top || top.cls !== cls) return this.commit(last);

    // same class as the committed top: new card only if the box jumped and then held still
    const moved = seen.filter((d) => iou(d.box, top.box) < REPLAY_IOU);
    if (moved.length >= MIN_VOTES && moved.slice(-MIN_VOTES).every((d, i, a) => i === 0 || iou(d.box, a[i - 1].box) >= STABLE_IOU))
      return this.commit(last);
    if (iou(last.box, top.box) >= REPLAY_IOU) top.box = last.box; // follow slow drift / camera shake
    return null;
  }

  private commit(d: Det): Commit {
    this.hist = []; // old frames must not vote for the next commit
    return (this.top = { cls: d.cls, conf: d.conf, box: d.box });
  }
}
