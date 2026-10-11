"""Render README figures from committed measurements and seeded synthetic scenes.

Run from ml/: uv run python plot_docs.py (run npm run cards at the repo root first).
"""
import csv
import json
from pathlib import Path

import cv2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from synth import CLASSES, load_cards, make_image

DOCS = Path(__file__).resolve().parent.parent / "docs"
OUT = DOCS / "images"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "axes.spines.top": False,
                     "axes.spines.right": False, "figure.facecolor": "white", "axes.facecolor": "white"})
BLUE, GREEN, ORANGE = "#2563eb", "#059669", "#ea580c"


def training():
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.3), layout="constrained")
    for ax, file, title in zip(axes, ["training-320.csv", "training-256.csv"],
                               ["Base training · 320px · 15 epochs", "Fine-tuning · 256px · 5 epochs"]):
        with (DOCS / "data" / file).open() as f:
            rows = list(csv.DictReader(f))
        epochs = [int(r["epoch"]) for r in rows]
        for metric, label, color in [("metrics/mAP50(B)", "mAP50", BLUE), ("metrics/mAP50-95(B)", "mAP50–95", GREEN)]:
            ax.plot(epochs, [float(r[metric]) for r in rows], marker="o", markersize=4, label=label, color=color, linewidth=2)
        ax.set(title=title, xlabel="Epoch", ylabel="Synthetic validation mAP")
        ax.set_xticks(epochs[::2] if len(epochs) > 8 else epochs)
        ax.grid(axis="y", alpha=0.2)
        ax.legend(loc="lower right", frameon=False)
    fig.suptitle("Measured training history (separate stages; axes have different ranges)", fontsize=14, fontweight="bold")
    fig.savefig(OUT / "training-history.png", dpi=170)
    plt.close(fig)


def benchmarks():
    rows = json.loads((DOCS / "data" / "benchmarks.json").read_text())
    fig, ax = plt.subplots(figsize=(10, 5.3), layout="constrained")
    for quantized, marker, color, label in [(False, "o", BLUE, "FP32"), (True, "s", ORANGE, "Dynamic INT8")]:
        group = [r for r in rows if ("int8" in r["model"]) == quantized]
        ax.scatter([r["cpu_ms"] for r in group], [r["map"] * 100 for r in group],
                   marker=marker, color=color, s=95, label=label, zorder=3)
        for r in group:
            offsets = {"n256_noft": (10, -18), "n256": (10, 9), "n224": (-12, -22),
                       "n224_int8": (-65, -17), "n256_noft_int8": (-90, -19)}
            ax.annotate(r["model"], (r["cpu_ms"], r["map"] * 100),
                        xytext=offsets.get(r["model"], (10, 8)), textcoords="offset points", fontsize=10)
    shipped = next(r for r in rows if r["model"] == "n256")
    ax.scatter([shipped["cpu_ms"]], [shipped["map"] * 100], s=260, facecolors="none", edgecolors=GREEN, linewidths=2, zorder=4)
    ax.set(title="Recorded model sweep · n256 is the shipped model", xlabel="CPU inference time (ms/frame, one thread) · lower is faster",
           ylabel="Synthetic validation mAP50–95 (%)", xlim=(1.5, 11), ylim=(84, 96))
    ax.grid(alpha=0.2)
    ax.legend(frameon=False, loc="lower right")
    fig.savefig(OUT / "speed-accuracy.png", dpi=170)
    plt.close(fig)


def examples():
    load_cards()
    fig, axes = plt.subplots(2, 4, figsize=(12, 6.6), layout="constrained")
    for i, ax in enumerate(axes.flat):
        jpg, labels = make_image(10**6 + i, 384, seed=0)
        image = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
        ax.imshow(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        for line in labels:
            cls, cx, cy, w, h = map(float, line.split())
            x, y, w, h = (cx - w / 2) * 384, (cy - h / 2) * 384, w * 384, h * 384
            ax.add_patch(plt.Rectangle((x, y), w, h, fill=False, edgecolor="#22c55e", linewidth=1.5))
            ax.text(x, max(10, y), CLASSES[int(cls)], color="white", fontsize=7,
                    bbox={"facecolor": "#166534", "alpha": 0.9, "pad": 1, "edgecolor": "none"})
        ax.set_axis_off()
    fig.suptitle("Seeded synthetic validation scenes · generated labels in green", fontsize=14, fontweight="bold")
    fig.savefig(OUT / "synthetic-examples.jpg", dpi=150)
    plt.close(fig)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    training()
    benchmarks()
    examples()
    print(f"Wrote three figures to {OUT}")
