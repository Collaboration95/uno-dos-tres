import './host.css';
import { connect } from '../shared/protocol';
import { Accuracy } from './accuracy';
import { renderAccuracy } from './accuracy-view';
import { Connection } from './connection';
import { $ } from './dom';
import { Feed } from './feed';
import { Projector } from './projector';

const feed = new Feed($<HTMLCanvasElement>('cv'));
const projector = new Projector();
const conn = new Connection();
let acc = new Accuracy();
let peers = { cam: 0, host: 0, deck: 0 };
let lastDet = 0;

const ws = connect(
  'host',
  (m) => {
    switch (m.type) {
      case 'peers':
        peers = m.peers;
        conn.setPhone(peers.cam > 0);
        $('peer-deck').classList.toggle('on', peers.deck > 0);
        $('s-peers').textContent = `${peers.cam} phone · ${peers.deck} deck`;
        break;
      case 'det':
        feed.onDet(m.dets);
        lastDet = performance.now();
        $('s-fps').textContent = m.fps.toFixed(0);
        $('s-ms').textContent = `${m.inferMs.toFixed(0)} ms`;
        $('s-backend').textContent = m.backend;
        break;
      case 'play':
        projector.onPlay(m.event);
        acc.onPlay(m.cardId);
        renderAccuracy(acc);
        break;
      case 'truth':
        acc.onTruth(m.cardId, m.n);
        renderAccuracy(acc);
        break;
      case 'cmd':
        // Only the deck can send this to us (reshuffle): new pile => new game, but keep the scores.
        if (m.cmd === 'reset') {
          projector.reset();
          acc.dropPending();
          renderAccuracy(acc);
        }
        break;
    }
  },
  (blob) => feed.onFrame(blob),
);

$('reset').addEventListener('click', () => {
  ws.send({ type: 'cmd', cmd: 'reset' });
  acc = new Accuracy();
  projector.reset();
  renderAccuracy(acc);
});

// "Waiting for phone…" whenever no detections have arrived for a moment.
setInterval(() => {
  const live = performance.now() - lastDet < 2000;
  $('idle').classList.toggle('gone', live);
  $('feed').classList.toggle('live', live);
  if (!live) ['s-fps', 's-ms'].forEach((id) => ($(id).textContent = '–'));
}, 300);

renderAccuracy(acc);
