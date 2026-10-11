"""Export best.pt -> public/models/uno.onnx (+ uno.json describing the true graph I/O)."""
import json, shutil, sys
from pathlib import Path
import numpy as np, onnxruntime as ort
from ultralytics import YOLO

ML = Path(__file__).resolve().parent
OUT = ML.parent / "public" / "models"
weights = Path(sys.argv[1]) if len(sys.argv) > 1 else ML / "runs" / "uno" / "weights" / "best.pt"
classes = json.loads((ML.parent / "src/shared/classes.json").read_text())
names = [f"{c}_{v}" for c in classes["colors"] for v in classes["values"]] + classes["wilds"]

m = YOLO(str(weights))
onnx = Path(m.export(format="onnx", imgsz=320, batch=1, dynamic=False, simplify=True, opset=17, half=False))
OUT.mkdir(parents=True, exist_ok=True)
shutil.copy(onnx, OUT / "uno.onnx")

s = ort.InferenceSession(str(OUT / "uno.onnx"), providers=["CPUExecutionProvider"])
inp, out = s.get_inputs()[0], s.get_outputs()[0]
shape = [int(d) for d in out.shape]
y = s.run(None, {inp.name: np.random.rand(1, 3, 320, 320).astype(np.float32)})[0]
assert list(y.shape) == shape, (y.shape, shape)
output = "end2end" if shape[-1] == 6 else "raw"
if output == "raw": assert shape[1] == 4 + len(names), shape
arch = "yolo26n" if "26" in str(m.model.yaml.get("yaml_file", weights)) or "26" in str(m.model.args.get("model", "")) else "yolo11n"
meta = dict(imgsz=320, arch=arch, output=output, outputShape=shape, classes=names, input=inp.name, outputName=out.name)
(OUT / "uno.json").write_text(json.dumps(meta, indent=2))
print({k: v for k, v in meta.items() if k != "classes"}, f"{(OUT / 'uno.onnx').stat().st_size / 1e6:.2f} MB")
