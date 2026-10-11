# Uno card detector (ML)

Setup: `cd ml && uv sync` (Python 3.12). Needs `npm run cards` first (writes `ml/assets/cards/`).

1. Data: `uv run python synth.py` (15k train / 1.5k val, 384px, ~1.5 min on 9 procs) -> `data/uno/`, `data/uno.yaml`, `data/preview.jpg`.
2. Train: put `yolo26n.pt` in `ml/weights/`, then `uv run python train.py --epochs 15` (MPS, imgsz 320, ~40 min).
   No flips, `hsv_h=0` (hue = class). Output: `runs/uno/weights/best.pt`.
3. Export: `uv run python export.py` -> `public/models/uno.onnx` + `uno.json` (true I/O format read back via onnxruntime).

Results (YOLO26n, 15 epochs, synthetic val): mAP50 0.962, mAP50-95 0.943.
ONNX: fp32, 9.8 MB, output `[1, 58, 2100]` = (cx, cy, w, h in input px, 54 sigmoid class scores); needs NMS.
CPU onnxruntime latency ~5 ms/frame. Weakest class: yellow_reverse (mAP50 0.78).
