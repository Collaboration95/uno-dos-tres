"""Size/speed vs accuracy sweep. Stages: train -> export -> bench. Results: runs/exp/results.{json,md}.

  uv run python experiments.py            # everything (skips trained/exported artifacts that exist)
  uv run python experiments.py bench      # re-bench only
"""
import argparse, json, shutil, time
from pathlib import Path

import cv2, numpy as np, onnxruntime as ort
from ultralytics import YOLO
from train import select_device

ML = Path(__file__).resolve().parent
DATA = ML / "data" / "uno.yaml"
OUT = ML / "runs" / "exp"
BASE = ML / "runs" / "uno" / "weights" / "best.pt"
DEVICE = "auto"
AUG = dict(fliplr=0.0, flipud=0.0, hsv_h=0.0, hsv_s=0.4, hsv_v=0.3, mosaic=1.0, close_mosaic=2, degrees=0, scale=0.4)

# name: (init weights/cfg, imgsz, epochs or 0 = no training)
CANDIDATES = {
    "n320": (BASE, 320, 0),  # current model
    "n256_noft": (BASE, 256, 0),  # same weights, smaller input
    "n256": (BASE, 256, 5),  # fine-tuned at 256
    "n224": (BASE, 224, 5),  # fine-tuned at 224
    # "pico256": (ML / "cfg" / "yolo26n-pico.yaml", 256, 20),  # half-width model from scratch  # dropped: 0.08 mAP50-95 after 9 epochs from scratch
}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def weights(name):
    init, imgsz, epochs = CANDIDATES[name]
    if not epochs:
        return init
    w = ML / "runs" / f"exp_{name}" / "weights" / "best.pt"
    if w.exists():
        return w
    log(f"TRAIN {name} imgsz={imgsz} epochs={epochs}")
    m = YOLO(str(init))
    if select_device(DEVICE) == "mps":
        m.add_callback("on_pretrain_routine_start", lambda t: setattr(t.args, "workers", 8))
    m.add_callback("on_fit_epoch_end", lambda t: log(f"EPOCH {name} {t.epoch + 1}/{epochs} mAP50-95={t.metrics.get('metrics/mAP50-95(B)', 0):.4f}"))
    m.train(data=str(DATA), imgsz=imgsz, epochs=epochs, batch=64, device=select_device(DEVICE), workers=8, project=str(ML / "runs"),
            name=f"exp_{name}", exist_ok=True, plots=False, lr0=0.002 if init == BASE else 0.01, **AUG)
    return w


def export(name):
    onnx = OUT / f"{name}.onnx"
    if not onnx.exists():
        w = weights(name)
        log(f"EXPORT {name}")
        p = Path(YOLO(str(w)).export(format="onnx", imgsz=CANDIDATES[name][1], batch=1, dynamic=False, simplify=True, opset=17))
        OUT.mkdir(parents=True, exist_ok=True)
        shutil.move(p, onnx)
    q = OUT / f"{name}_int8.onnx"
    if not q.exists():
        from onnxruntime.quantization import QuantType, quantize_dynamic
        quantize_dynamic(str(onnx), str(q), weight_type=QuantType.QUInt8)
    return [onnx, q]


def top1(path, imgsz, n=600):
    """Largest labelled card (= top of pile / main card) vs highest-scoring prediction."""
    s = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    inp = s.get_inputs()[0].name
    imgs = sorted((ML / "data/uno/images/val").glob("*.jpg"))[:n]
    hit = tot = 0
    for f in imgs:
        lab = np.loadtxt(ML / "data/uno/labels/val" / (f.stem + ".txt"), ndmin=2)
        if not lab.size:
            continue
        gt = int(lab[np.argmax(lab[:, 3] * lab[:, 4]), 0])
        x = cv2.resize(cv2.imread(str(f)), (imgsz, imgsz))[..., ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255
        y = s.run(None, {inp: x})[0][0]  # raw [4+nc, N]  or end2end [K, 6]
        pred = int(y[np.argmax(y[:, 4]), 5]) if y.shape[-1] == 6 else int(np.unravel_index(np.argmax(y[4:]), y[4:].shape)[0])
        hit += pred == gt
        tot += 1
    return hit / tot


def latency(path, imgsz, runs=60):
    o = ort.SessionOptions()
    o.intra_op_num_threads = 1  # phone runs single-threaded wasm; this is the honest CPU proxy
    s = ort.InferenceSession(str(path), o, providers=["CPUExecutionProvider"])
    x = {s.get_inputs()[0].name: np.random.rand(1, 3, imgsz, imgsz).astype(np.float32)}
    for _ in range(5):
        s.run(None, x)
    t = time.perf_counter()
    for _ in range(runs):
        s.run(None, x)
    return (time.perf_counter() - t) / runs * 1000


def bench():
    rows = []
    for name, (_, imgsz, _) in CANDIDATES.items():
        for path in export(name):
            log(f"BENCH {path.name}")
            mp = YOLO(str(path), task="detect").val(data=str(DATA), imgsz=imgsz, batch=1, device="cpu", plots=False, verbose=False)
            r = dict(model=path.stem, imgsz=imgsz, mb=round(path.stat().st_size / 1e6, 2), map50=round(mp.box.map50, 4),
                     map=round(mp.box.map, 4), top1=round(top1(path, imgsz), 4), cpu_ms=round(latency(path, imgsz), 1))
            log("RESULT", json.dumps(r))
            rows.append(r)
            (OUT / "results.json").write_text(json.dumps(rows, indent=2))
    md = ["| model | imgsz | MB | mAP50 | mAP50-95 | top-card acc | CPU 1-thread ms |", "|---|---|---|---|---|---|---|"]
    md += [f"| {r['model']} | {r['imgsz']} | {r['mb']} | {r['map50']} | {r['map']} | {r['top1']:.1%} | {r['cpu_ms']} |" for r in rows]
    (OUT / "results.md").write_text("\n".join(md) + "\n")
    log("DONE\n" + "\n".join(md))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("stage", nargs="?", choices=["all", "bench"], default="all")
    ap.add_argument("--device", default="auto")
    args = ap.parse_args()
    DEVICE = args.device
    if not BASE.exists() or not DATA.exists():
        ap.error("Base weights or dataset missing. Follow ml/README.md before running the sweep.")
    OUT.mkdir(parents=True, exist_ok=True)
    if args.stage != "bench":
        for n in CANDIDATES:
            weights(n)
    bench()
