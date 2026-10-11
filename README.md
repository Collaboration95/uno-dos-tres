# uno-dos-tres

Proof that real-time Uno card recognition is easy with a tiny model running **entirely on the phone**.

- `deck.html` — on-screen Uno deck (laptop). Flip cards fast; broadcasts ground truth.
- `index.html` — host: QR code for the phone, mirrored phone feed + detections, game events, live accuracy/latency vs ground truth.
- `cam.html` — phone: camera → YOLO26n (onnxruntime-web, WebGPU/WASM, in a Web Worker) → top-card tracker → Uno rules.

## Run it (recommended: Cloudflare tunnel, zero phone setup)

Phones only allow camera access over HTTPS. A Cloudflare quick tunnel gives you a public `https://*.trycloudflare.com`
URL with a real certificate, so the phone just opens a link — no cert installs. No Cloudflare account needed.

```sh
brew install cloudflared mkcert   # once (Linux/Windows: see Cloudflare + mkcert docs)
mkcert -install                   # once
npm i
npm run demo                      # dev server + tunnel; prints the Phone / Host / Deck URLs
```

1. Open the **Host** URL on the laptop and the **Deck** URL in a second window.
2. Scan the host's QR code with the phone (or open the printed **Phone** URL) → START.
3. Flip cards on the deck (Space / click; `A` autoplay, `L` legal-only, `M` pile mode, `S` reshuffle).

The tunnel URL changes on every run and is public while it runs — stop it (Ctrl-C) when done.
It is written to `.certs/tunnel-url` (gitignored) so the host QR code points at it.

## Run it on the LAN only (no tunnel)

```sh
npm run dev                       # https://<lan-ip>:5173
```

iOS refuses the WebSocket relay to an untrusted cert, so trust the mkcert CA on the phone once:
open `https://<lan-ip>:5173/ca` in Safari → Settings → General → VPN & Device Management → install,
then Settings → General → About → Certificate Trust Settings → enable full trust.

## Phone URL options

- `?ep=webgpu` / `?ep=wasm` — force a backend (compare speed).
- `?model=<name>` — load `/models/<name>.onnx` + `.json` instead of `uno`.

## Model

Training lives in `ml/`: synthetic scenes built from the same card art (`npm run cards`) → Ultralytics YOLO26n at 320px
→ ONNX in `public/models/`. See `ml/synth.py`, `ml/train.py`, `ml/export.py`.
