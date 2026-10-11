"""Export best.pt -> public/models/uno.onnx (+ uno.json describing the true graph I/O)."""
import argparse, json, shutil
from pathlib import Path
import numpy as np, onnxruntime as ort
from ultralytics import YOLO

ML = Path(__file__).resolve().parent
OUT = ML.parent / "public" / "models"
ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument("weights", type=Path, nargs="?", default=ML / "runs" / "uno" / "weights" / "best.pt")
ap.add_argument("--imgsz", type=int, default=320)
args = ap.parse_args()
weights = args.weights
if not weights.exists():
    ap.error(f"Weights missing: {weights}. Train the model first (see ml/README.md).")
classes = json.loads((ML.parent / "src/shared/classes.json").read_text())
names = [f"{c}_{v}" for c in classes["colors"] for v in classes["values"]] + classes["wilds"]

m = YOLO(str(weights))
assert [m.names[i] for i in range(len(m.names))] == names, "Model class order differs from src/shared/classes.json"
onnx = Path(m.export(format="onnx", imgsz=args.imgsz, batch=1, dynamic=False, simplify=True, opset=17, half=False))
OUT.mkdir(parents=True, exist_ok=True)
shutil.copy(onnx, OUT / "uno.onnx")

s = ort.InferenceSession(str(OUT / "uno.onnx"), providers=["CPUExecutionProvider"])
inp, out = s.get_inputs()[0], s.get_outputs()[0]
shape = [int(d) for d in out.shape]
imgsz = int(inp.shape[2])
assert inp.shape == [1, 3, imgsz, imgsz], inp.shape
y = s.run(None, {inp.name: np.random.rand(1, 3, imgsz, imgsz).astype(np.float32)})[0]
assert list(y.shape) == shape, (y.shape, shape)
output = "end2end" if shape[-1] == 6 else "raw"
if output == "raw": assert shape[1] == 4 + len(names), shape
arch = "yolo26n" if "26" in str(m.model.yaml.get("yaml_file", weights)) or "26" in str(m.model.args.get("model", "")) else "yolo11n"
meta = dict(imgsz=imgsz, arch=arch, output=output, outputShape=shape, classes=names, input=inp.name, outputName=out.name)
(OUT / "uno.json").write_text(json.dumps(meta, indent=2))
print({k: v for k, v in meta.items() if k != "classes"}, f"{(OUT / 'uno.onnx').stat().st_size / 1e6:.2f} MB")
