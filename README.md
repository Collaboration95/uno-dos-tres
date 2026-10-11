# uno-dos-tres

Proof that real-time Uno card recognition is easy with a tiny model running **entirely on the phone**.

- `deck.html` — on-screen Uno deck (laptop). Flip cards fast; broadcasts ground truth.
- `index.html` — host: QR code for the phone, mirrored phone feed + detections, game events, live accuracy/latency vs ground truth.
- `cam.html` — phone: camera → YOLO (onnxruntime-web, WebGPU/WASM, in a Web Worker) → top-card tracker → Uno rules.

```sh
npm i
npm run cards   # regenerate card art (public/cards/*.svg, ml/assets/cards/*.png)
npm run dev     # https://<lan-ip>:5173 — open on laptop, scan QR with phone
```

Model training lives in `ml/` (synthetic data from the same card art → YOLO → ONNX in `public/models/`).
