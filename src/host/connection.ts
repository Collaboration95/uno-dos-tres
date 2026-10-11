import QRCode from 'qrcode';
import { $, el } from './dom';

/** QR panel over the feed. Open while no phone is connected; collapses to the header pill once one is. */
export class Connection {
  private open = true;
  private connected = false;

  constructor() {
    $('conn-pill').addEventListener('click', () => this.set(!this.open));
    this.render();
    void this.load();
  }

  setPhone(connected: boolean) {
    if (connected === this.connected) return;
    this.connected = connected;
    this.open = !connected;
    this.render();
  }

  private set(open: boolean) {
    this.open = open;
    this.render();
  }

  private render() {
    $('conn').classList.toggle('open', this.open);
    $('conn-pill').classList.toggle('on', this.connected);
    $('conn-pill-text').textContent = this.connected ? 'Phone connected' : 'Waiting for phone';
  }

  private async load() {
    let urls: string[] = [];
    try {
      urls = ((await (await fetch('/api/info')).json()) as { camUrls: string[] }).camUrls;
    } catch {
      /* fall through to the fallback below */
    }
    if (!urls.length) urls = [`${location.origin}/cam.html`];
    const [main, ...rest] = urls;
    $<HTMLImageElement>('qr').src = await QRCode.toDataURL(main, {
      width: 480,
      margin: 2,
      color: { dark: '#0a0d0c', light: '#ffffff' },
    });
    const a = $<HTMLAnchorElement>('url-main');
    a.textContent = main.replace('https://', '');
    a.href = main;
    $('url-more').replaceChildren(...rest.map((u) => el('div', '', u.replace('https://', ''))));
  }
}
