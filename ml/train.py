"""Train or fine-tune a detector on the synthetic Uno dataset."""
import argparse
from pathlib import Path
from ultralytics import YOLO
import torch

ML = Path(__file__).resolve().parent


def select_device(device="auto"):
    if device != "auto":
        return device
    if torch.cuda.is_available():
        return "0"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="yolo26n.pt"); ap.add_argument("--epochs", type=int, default=15)
    ap.add_argument("--batch", type=int, default=32); ap.add_argument("--name", default="uno")
    ap.add_argument("--imgsz", type=int, default=320); ap.add_argument("--device", default="auto")
    ap.add_argument("--workers", type=int, default=8); ap.add_argument("--lr0", type=float, default=0.01)
    ap.add_argument("--close-mosaic", type=int, default=3)
    a = ap.parse_args()
    if not (ML / "data" / "uno.yaml").exists():
        ap.error("Dataset missing. Run python synth.py first (see ml/README.md).")
    local = ML / "weights" / a.model
    model = YOLO(str(local) if local.exists() and not Path(a.model).exists() else a.model)
    device = select_device(a.device)
    # Ultralytics forces workers=0 on mps; augmentation then bottlenecks training, so restore workers.
    if device == "mps":
        model.add_callback("on_pretrain_routine_start", lambda t: setattr(t.args, "workers", a.workers))
    model.train(
        data=str(ML / "data" / "uno.yaml"), imgsz=a.imgsz, epochs=a.epochs, batch=a.batch, device=device, workers=a.workers,
        project=str(ML / "runs"), name=a.name, exist_ok=True, plots=False,
        fliplr=0.0, flipud=0.0, hsv_h=0.0, hsv_s=0.4, hsv_v=0.3,  # hue = class; never mirror digits
        mosaic=1.0, close_mosaic=a.close_mosaic, degrees=0, scale=0.4, lr0=a.lr0,
    )


if __name__ == "__main__":
    main()
