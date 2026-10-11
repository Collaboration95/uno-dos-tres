"""Train YOLO26n (fallback yolo11n) on the synthetic Uno dataset."""
import argparse
from pathlib import Path
from ultralytics import YOLO

ML = Path(__file__).resolve().parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="yolo26n.pt"); ap.add_argument("--epochs", type=int, default=25)
    ap.add_argument("--batch", type=int, default=32); ap.add_argument("--name", default="uno")
    a = ap.parse_args()
    model = YOLO(a.model if Path(a.model).exists() else str(ML / "weights" / a.model))
    # Ultralytics forces workers=0 on mps; augmentation then bottlenecks training, so restore workers.
    model.add_callback("on_pretrain_routine_start", lambda t: setattr(t.args, "workers", 8))
    model.train(
        data=str(ML / "data" / "uno.yaml"), imgsz=320, epochs=a.epochs, batch=a.batch, device="mps", workers=8,
        project=str(ML / "runs"), name=a.name, exist_ok=True, plots=False,
        fliplr=0.0, flipud=0.0, hsv_h=0.0, hsv_s=0.4, hsv_v=0.3,  # hue = class; never mirror digits
        mosaic=1.0, close_mosaic=3, degrees=0, scale=0.4,
    )


if __name__ == "__main__":
    main()
