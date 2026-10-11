/**
 * Ground-truth scoring. All times are host-clock receive times so phone/deck clock skew is irrelevant.
 * Each truth is answered by the next `play`: same card -> hit (latency), other card -> wrong,
 * next truth arriving first -> miss.
 */
export type Outcome = 'hit' | 'wrong' | 'miss';
export interface Row {
  n: number;
  truthId: number;
  detId: number | null;
  outcome: Outcome;
  latency: number | null;
}

export class Accuracy {
  hits = 0;
  wrong = 0;
  missed = 0;
  extra = 0; // plays with no truth pending
  latencies: number[] = [];
  rows: Row[] = [];
  pending: { n: number; cardId: number; at: number } | null = null;

  onTruth(cardId: number, n: number, now = performance.now()) {
    if (this.pending) this.finish(this.pending, 'miss', null, null);
    this.pending = { n, cardId, at: now };
  }

  onPlay(cardId: number, now = performance.now()) {
    const p = this.pending;
    if (!p) {
      this.extra++;
      return;
    }
    this.pending = null;
    const hit = p.cardId === cardId;
    this.finish(p, hit ? 'hit' : 'wrong', cardId, hit ? now - p.at : null);
  }

  /** Forget an unanswered truth (new game) without scoring it. */
  dropPending() {
    this.pending = null;
  }

  private finish(p: { n: number; cardId: number }, outcome: Outcome, detId: number | null, latency: number | null) {
    if (outcome === 'hit') this.hits++;
    else if (outcome === 'wrong') this.wrong++;
    else this.missed++;
    if (latency !== null) this.latencies.push(latency);
    this.rows.unshift({ n: p.n, truthId: p.cardId, detId, outcome, latency });
    if (this.rows.length > 30) this.rows.pop();
  }

  get total() {
    return this.hits + this.wrong + this.missed;
  }
  get rate() {
    return this.total ? this.hits / this.total : null;
  }
  percentile(q: number) {
    if (!this.latencies.length) return null;
    const s = [...this.latencies].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  }
}
