# Uno card detector: optional training

The app already includes the 256px FP32 model in `public/models/`. Follow this guide only to regenerate data, retrain, run the model sweep, or rebuild the README figures.

## Environment and card art

Install [uv](https://docs.astral.sh/uv/getting-started/installation/). The project pins Python 3.12 in `.python-version` and dependencies in `uv.lock`. From the repository root:

```sh
npm ci
npm run cards
cd ml
uv sync --locked
```

The card generator writes deck SVGs into `public/cards/` and training PNGs into `ml/assets/cards/`. Regenerated SVGs can differ in generated clip identifiers and fonts across systems; inspect changes before committing them. The PNGs, dataset and checkpoints are ignored by Git.

## Generate the dataset

From `ml/`:

```sh
uv run python synth.py --train 15000 --val 1500 --size 384 --seed 0 --workers 9
```

This creates `data/uno/images/{train,val}/`, corresponding YOLO labels, `data/uno.yaml`, and `data/preview.jpg`. Each image has a deterministic seed derived from the global seed and image index; validation indices are offset from training indices. Reduce `--workers` if memory or CPU resources are limited. Use a new `--out` directory for different dataset sizes so leftover images from an older run are not included.

The class order comes from `src/shared/classes.json`: 52 color/value classes followed by two wild classes. Scenes include card backs, UI, screen bezels, random backgrounds, piles and occlusion. The camera simulation adds perspective, glare, moiré, blur, compression, noise and mild color balance changes. Faces with at least 40% visible projected area receive labels; card backs are distractors.

## Train the 320px base model

```sh
uv run python train.py --epochs 15 --imgsz 320 --batch 32 --name uno
```

The launcher uses `ml/weights/yolo26n.pt` if present; otherwise Ultralytics resolves/downloads the named pretrained weights. The first run therefore needs internet access unless you provide a local checkpoint with `--model <path>`.

Device selection is automatic: CUDA device 0, then Apple MPS, then CPU. Override it with `--device mps`, `--device 0`, or `--device cpu`. Lower `--batch` for out-of-memory errors and use `--workers 0` for multiprocessing problems. Training on CPU can take substantially longer. See the [Ultralytics training documentation](https://docs.ultralytics.com/modes/train/) for device and training behavior.

The base checkpoint is `runs/uno/weights/best.pt`. The recorded run used MPS and took about 40 minutes. Flips and hue shifts are disabled because digits must remain readable and hue is part of the class label. Saturation/value variation and mosaic remain enabled. Repeated runs with the same `--name` reuse the output directory; use another name to retain an earlier run.

## Fine-tune and export the shipped model configuration

```sh
uv run python train.py --model runs/uno/weights/best.pt --epochs 5 --imgsz 256 --batch 64 --name exp_n256 --lr0 0.002 --close-mosaic 2
uv run python export.py runs/exp_n256/weights/best.pt --imgsz 256
```

The export **replaces** `public/models/uno.onnx` and `uno.json`. It checks the checkpoint's class order, exports static FP32 ONNX at opset 17, and runs an ONNX Runtime inference to verify output shape and discover actual graph input/output names. Keep both files together. Reproduction follows the recorded configuration; different devices or library behavior can produce different weights and scores.

For just the 320px base model, use `uv run python export.py runs/uno/weights/best.pt --imgsz 320` instead. The browser reads the size from the JSON metadata.

The shipped 256px graph has input `[1, 3, 256, 256]` and raw output `[1, 58, 1344]`: center-x, center-y, width, height in input pixels plus 54 class scores. The browser applies class-agnostic NMS. The corresponding 320px raw graph has 2,100 candidates. Do not assume every export is raw; the export script also describes end-to-end output graphs when that is the actual format.

## Model sweep and measurements

```sh
uv run python experiments.py
# Re-evaluate available candidates; missing exports/weights may still be created:
uv run python experiments.py bench
```

The sweep compares 320px, 256px without fine-tuning, 256px fine-tuning, and 224px fine-tuning, each as FP32 and dynamic INT8. `--device` selects the training device; validation and latency measurements use CPU. Existing training/export artifacts are reused, so remove the relevant local artifacts or use a separate checkout to rerun a changed configuration.

Outputs are `runs/exp/results.json` and `results.md`. The committed [historical sweep](results.md) records the shipped model at mAP50 **0.9558**, mAP50–95 **0.9354**, a top-card proxy of **90.7%**, and **3.2 ms/frame** on the original development CPU with one thread. These are synthetic validation / desktop CPU results, not phone or physical-card accuracy. The proxy compares the largest labelled card with the highest-scoring prediction, excluding empty-label images among the first 600 validation images. Latency averages 60 runs after five warmups.

## Rebuild README figures

```sh
uv run python plot_docs.py
```

This renders the committed training curves and model-sweep data in `docs/data/`, plus eight seeded synthetic examples using the generated card PNGs. It writes `docs/images/` and needs no full dataset or retraining. [Figure provenance](../docs/data/README.md) explains the snapshots and the small differences between epoch validation and exported-model evaluation.
