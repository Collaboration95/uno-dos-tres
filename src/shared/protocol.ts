/**
 * Wire protocol over the WebSocket relay at wss://<host>/relay?role=<role>.
 * The relay broadcasts every text message to all *other* clients; binary messages
 * (JPEG frames from the cam) go to hosts only. Clients ignore types they don't care about.
 */
import type { PlayEvent } from './rules';

export type Role = 'cam' | 'host' | 'deck';

/** One detection, box normalised to the camera frame: centre x/y, width/height in [0,1]. */
export interface Det {
  cls: number;
  conf: number;
  box: [cx: number, cy: number, w: number, h: number];
}

export type Msg =
  // cam -> all: per-frame detections. A binary JPEG of the same frame is sent right before it (throttled).
  | { type: 'det'; seq: number; t: number; dets: Det[]; inferMs: number; fps: number; frameW: number; frameH: number; backend: string }
  // cam -> all: tracker committed a new top-of-pile card; event computed with shared/rules.ts
  | { type: 'play'; t: number; cardId: number; conf: number; event: PlayEvent }
  // deck -> all: ground truth, the card now on top of the on-screen pile
  | { type: 'truth'; t: number; cardId: number; n: number }
  // host/deck -> cam: control
  | { type: 'cmd'; cmd: 'reset' }
  // relay -> all: who is connected
  | { type: 'peers'; peers: Record<Role, number> };

export function connect(role: Role, onMsg: (m: Msg) => void, onBinary?: (b: Blob) => void) {
  let ws: WebSocket;
  let open = false;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/relay?role=${role}`;
  const start = () => {
    ws = new WebSocket(url);
    ws.binaryType = 'blob';
    ws.onopen = () => (open = true);
    ws.onclose = () => {
      open = false;
      setTimeout(start, 1000);
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') onMsg(JSON.parse(e.data));
      else onBinary?.(e.data);
    };
  };
  start();
  return {
    send: (m: Msg) => open && ws.send(JSON.stringify(m)),
    sendBinary: (b: Blob | ArrayBuffer) => open && ws.bufferedAmount < 256_000 && ws.send(b),
    get open() {
      return open;
    },
  };
}
