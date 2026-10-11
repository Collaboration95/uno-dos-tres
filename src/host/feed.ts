import { CARDS, COLOR_HEX, label } from '../shared/cards';
import type { Det } from '../shared/protocol';

interface Waiting {
  bmp?: ImageBitmap;
  dets?: Det[];
}

/**
 * Mirrors the phone's camera onto a canvas. Each JPEG arrives right before its `det`, but decoding is async,
 * so we pair them by arrival order and only ever show a frame once both halves are ready. Stale frames are dropped.
 */
export class Feed {
  lastAt = 0;
  private ctx: CanvasRenderingContext2D;
  private bmp: ImageBitmap | null = null;
  private dets: Det[] = [];
  private binId = 0;
  private shownId = 0;
  private unpaired = false; // a JPEG arrived that no det has claimed yet
  private waiting = new Map<number, Waiting>();

  constructor(private cv: HTMLCanvasElement) {
    this.ctx = cv.getContext('2d')!;
  }

  onFrame(blob: Blob) {
    const id = ++this.binId;
    this.unpaired = true;
    createImageBitmap(blob)
      .then((bmp) => {
        if (id < this.shownId) return bmp.close();
        const w = this.waiting.get(id) ?? {};
        w.bmp = bmp;
        this.waiting.set(id, w);
        this.flush(id);
      })
      .catch(() => {});
  }

  /** `dets` for the frame; if no JPEG preceded it (frame throttling) they overlay the last shown frame. */
  onDet(dets: Det[]) {
    this.lastAt = performance.now();
    if (this.unpaired) {
      this.unpaired = false;
      const w = this.waiting.get(this.binId) ?? {};
      w.dets = dets;
      this.waiting.set(this.binId, w);
      this.flush(this.binId);
    } else {
      this.dets = dets;
      this.draw();
    }
  }

  clear() {
    this.bmp?.close();
    this.bmp = null;
    this.dets = [];
    this.lastAt = 0;
    this.ctx.clearRect(0, 0, this.cv.width, this.cv.height);
  }

  private flush(id: number) {
    const w = this.waiting.get(id);
    if (!w?.bmp || !w.dets) return;
    for (const [k, v] of this.waiting) {
      if (k <= id) {
        if (k !== id) v.bmp?.close();
        this.waiting.delete(k);
      }
    }
    this.bmp?.close();
    this.bmp = w.bmp;
    this.dets = w.dets;
    this.shownId = id;
    this.draw();
  }

  private draw() {
    const { cv, ctx, bmp } = this;
    if (!bmp) return;
    if (cv.width !== bmp.width || cv.height !== bmp.height) {
      cv.width = bmp.width;
      cv.height = bmp.height;
    }
    ctx.drawImage(bmp, 0, 0);
    const k = cv.width / (cv.clientWidth || cv.width); // canvas px per CSS px, keeps strokes/text a constant on-screen size
    ctx.lineWidth = 3 * k;
    ctx.font = `600 ${14 * k}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textBaseline = 'middle';
    for (const d of this.dets) {
      const card = CARDS[d.cls];
      if (!card) continue;
      const [cx, cy, w, h] = d.box;
      const x = (cx - w / 2) * cv.width;
      const y = (cy - h / 2) * cv.height;
      const color = card.color ? COLOR_HEX[card.color] : '#ffffff';
      ctx.strokeStyle = color;
      ctx.strokeRect(x, y, w * cv.width, h * cv.height);

      const text = `${label(card)} ${d.conf.toFixed(2)}`;
      const th = 22 * k;
      const tw = ctx.measureText(text).width + 12 * k;
      const ty = y - th >= 0 ? y - th : y;
      ctx.fillStyle = color;
      ctx.fillRect(x - ctx.lineWidth / 2, ty, tw, th);
      ctx.fillStyle = card.color === 'yellow' || card.color === null ? '#111' : '#fff';
      ctx.fillText(text, x + 6 * k - ctx.lineWidth / 2, ty + th / 2 + k);
    }
  }
}
