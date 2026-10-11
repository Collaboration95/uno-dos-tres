"""Synthetic Uno dataset: a phone camera looking at a laptop screen showing the deck page."""
import argparse, json, math
from multiprocessing import Pool
from pathlib import Path

import cv2
import numpy as np

cv2.setNumThreads(1)
ML = Path(__file__).resolve().parent
ROOT = ML.parent
CARDS_DIR = ML / "assets" / "cards"
_c = json.loads((ROOT / "src/shared/classes.json").read_text())
CLASSES = [f"{col}_{v}" for col in _c["colors"] for v in _c["values"]] + _c["wilds"]
CARDS = {}  # name -> premultiplied uint8 BGRA
FELT0, FELT1 = np.array([42, 59, 14], np.float32), np.array([24, 36, 7], np.float32)  # BGR
TEXTS = ["Your turn", "Player 2", "Cards: 7", "UNO!", "Draw", "Discard", "Score 120", "Round 3", "Turn 12", "+2", "Waiting...", "Pass"]


def load_cards():
    for n in CLASSES + ["back"]:
        im = cv2.imread(str(CARDS_DIR / f"{n}.png"), cv2.IMREAD_UNCHANGED)
        a = im[..., 3:4].astype(np.float32) / 255
        CARDS[n] = np.dstack([im[..., :3] * a, im[..., 3:4]]).astype(np.uint8)


def smooth_noise(rng, h, w, scale):
    return cv2.resize(rng.random((h // scale + 2, w // scale + 2)).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)


def texture(rng, w, h):
    """Random solid / gradient / noise / wood / dark-UI texture, BGR float32."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    b1, b2 = rng.integers(8, 220, 3).astype(np.float32), rng.integers(8, 220, 3).astype(np.float32)
    k = rng.integers(6)
    if k == 0:
        img = np.broadcast_to(b1, (h, w, 3)).copy()
    elif k == 1:
        t = (xx * math.cos(a := rng.uniform(0, 6.28)) + yy * math.sin(a)); t = (t - t.min()) / (np.ptp(t) + 1e-6)
        img = b1 + (b2 - b1) * t[..., None]
    elif k == 2:
        n = 0.6 * smooth_noise(rng, h, w, 40) + 0.4 * smooth_noise(rng, h, w, 8)
        img = b1 + (b2 - b1) * n[..., None] * 0.5
    elif k == 3:  # wood
        base = np.array([rng.uniform(20, 60), rng.uniform(50, 110), rng.uniform(90, 170)], np.float32)
        t = yy * math.cos(a := rng.uniform(0, 3.14)) + xx * math.sin(a) + 40 * smooth_noise(rng, h, w, 60)
        v = 0.8 + 0.2 * np.sin(t * rng.uniform(0.05, 0.4))
        img = base * v[..., None]
    elif k == 4:
        img = b1 + rng.normal(0, rng.uniform(3, 12), (h, w, 3))
    else:  # dark UI radial
        r = np.hypot((xx - w / 2) / w, (yy - h / 2) / h)[..., None]
        img = b1 * 0.2 + (b2 * 0.08 - b1 * 0.2) * np.clip(r, 0, 1)
    return np.clip(img, 0, 255).astype(np.float32)


def felt(rng, w, h):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w / 2 + rng.normal(0, 0.03 * w), h / 2 + rng.normal(0, 0.03 * h)
    t = np.clip(np.hypot((xx - cx) / (w / 2), (yy - cy) / (h / 2)) / 1.414, 0, 1)[..., None]
    img = FELT0 + (FELT1 - FELT0) * t
    img = img * rng.uniform(0.75, 1.4) + rng.normal(0, 4, 3)
    return np.clip(img + rng.normal(0, rng.uniform(0, 3), (h, w, 1)), 0, 255).astype(np.float32)


def make_overlay(rng, W, H, S):
    """HUD text / UI rectangles in screen space; returns premultiplied BGR and alpha (uint8)."""
    rgb, al = np.zeros((H, W, 3), np.uint8), np.zeros((H, W), np.uint8)
    cx = W / 2

    def pos(edge):
        x = cx + rng.uniform(-0.5, 0.5) * S
        y = rng.choice([rng.uniform(0.04, 0.12), rng.uniform(0.9, 0.97)]) * H if edge else rng.uniform(0.05, 0.95) * H
        return int(x), int(y)

    for _ in range(rng.integers(0, 5)):
        scale, col = rng.uniform(0.35, 0.9) * S / 384, [int(rng.integers(170, 256))] * 3
        p = pos(rng.random() < 0.8)
        cv2.putText(rgb, str(rng.choice(TEXTS)), p, cv2.FONT_HERSHEY_SIMPLEX, scale, col, 1 + int(scale > 0.7), cv2.LINE_AA)
    al = np.maximum(al, (rgb.max(2) > 0).astype(np.uint8) * 255)
    for _ in range(rng.integers(0, 4)):  # translucent UI rectangles / buttons
        x, y = pos(rng.random() < 0.5)
        w, h = int(rng.uniform(0.05, 0.25) * S), int(rng.uniform(0.03, 0.1) * S)
        a, col = rng.uniform(0.3, 0.8), rng.integers(20, 230, 3).astype(np.float32)
        m = np.zeros((H, W), np.uint8); cv2.rectangle(m, (x, y), (x + w, y + h), 255, -1)
        m = m > 0
        rgb[m] = (col * a).astype(np.uint8); al[m] = int(a * 255)
    return rgb, al


def motion_kernel(L, ang):
    k = np.zeros((L, L), np.float32)
    cv2.line(k, (0, L // 2), (L - 1, L // 2), 1, 1)
    R = cv2.getRotationMatrix2D((L / 2 - 0.5, L / 2 - 0.5), ang, 1)
    k = cv2.warpAffine(k, R, (L, L))
    return k / k.sum()


def camera(f, rng, S):
    """Screen-through-phone-camera effects. f: float32 BGR 0..255 -> JPEG bytes."""
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    if rng.random() < 0.4:  # glare blobs / streak
        for _ in range(rng.integers(1, 3)):
            cx, cy, a = rng.uniform(0, S), rng.uniform(0, S), rng.uniform(0, 3.14)
            sx, sy = rng.uniform(0.08, 0.4) * S, rng.uniform(0.03, 0.4) * S
            u = (xx - cx) * math.cos(a) + (yy - cy) * math.sin(a); v = -(xx - cx) * math.sin(a) + (yy - cy) * math.cos(a)
            g = np.exp(-0.5 * ((u / sx) ** 2 + (v / sy) ** 2)) * rng.uniform(0.1, 0.45)
            f = 255 - (255 - f) * (1 - g[..., None] * np.array([0.95, 1, 1.0], np.float32))
    if rng.random() < 0.6:  # moire
        m = 0
        for _ in range(rng.integers(1, 3)):
            P, a = rng.uniform(5, 80), rng.uniform(0, 6.28)
            ph = rng.uniform(0, 6.28) + (rng.uniform(0, 1.5, 3) if rng.random() < 0.5 else 0)
            t = (2 * math.pi / P) * (xx * math.cos(a) + yy * math.sin(a))
            m = m + rng.uniform(1.5, 7) * np.sin(t[..., None] + ph)
        f = f + m
    if rng.random() < 0.7:
        s = rng.uniform(0.3, 1.6); f = cv2.GaussianBlur(f, (0, 0), s)
    if rng.random() < 0.2:
        f = cv2.filter2D(f, -1, motion_kernel(int(rng.integers(3, 12)) | 1, rng.uniform(0, 180)))
    g = rng.uniform(0.75, 1.35)
    f = 255 * (np.clip(f, 0, 255) / 255) ** g
    m = f.mean(); f = (f - m) * rng.uniform(0.7, 1.3) + m + rng.uniform(-25, 25) + rng.uniform(0, 18)
    f = f * np.clip(rng.normal(1, 0.035, 3), 0.9, 1.1)  # mild white balance
    v = rng.uniform(0, 0.5) * (np.hypot(xx - S / 2 - rng.normal(0, S * .05), yy - S / 2 - rng.normal(0, S * .05)) / (S * .72)) ** 2
    f = f * (1 - v[..., None])
    f = f + rng.normal(0, rng.uniform(0, 9), f.shape)
    f = np.clip(f, 0, 255).astype(np.uint8)
    if rng.random() < 0.2:
        s = int(S * rng.uniform(0.4, 0.8))
        f = cv2.resize(cv2.resize(f, (s, s), interpolation=cv2.INTER_AREA), (S, S), interpolation=cv2.INTER_LINEAR)
    return cv2.imencode(".jpg", f, [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(40, 96))])[1].tobytes()


def homography(rng, Wb, Hb, S):
    z = rng.uniform(1.0, 1.45) if rng.random() < 0.6 else rng.uniform(0.45, 0.95)  # screen height / frame height
    h = S * z; w = h * Wb / Hb
    a = math.radians(rng.normal(0, 3))
    R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
    dst = (np.array([[-w, -h], [w, -h], [w, h], [-w, h]]) / 2) @ R.T + S / 2 + rng.normal(0, 0.04 * S, 2)
    k, l = rng.uniform(-0.1, 0.1), rng.uniform(-0.06, 0.06)  # keystone
    dst[:2, 0] += np.array([1, -1]) * k * w / 2; dst[2:, 0] -= np.array([-1, 1]) * k * w / 2
    dst[[0, 3], 1] += np.array([1, -1]) * l * h / 2; dst[[1, 2], 1] += np.array([1, -1]) * l * h / 2
    dst += rng.normal(0, 0.012 * S, (4, 2))
    src = np.array([[0, 0], [Wb, 0], [Wb, Hb], [0, Hb]], np.float32)
    return cv2.getPerspectiveTransform(src, dst.astype(np.float32))


def plan_cards(rng, W, H, b):
    """List of dicts (name, h-fraction, cx, cy, angle, shade) in bezel-canvas coords, bottom to top."""
    cx0, cy0 = b + W / 2, b + H / 2
    names = list(rng.choice(CLASSES, 8, replace=False))
    rot = lambda: float(rng.uniform(-90, 90) if rng.random() < 0.07 else rng.uniform(-35, 35) if rng.random() < 0.2 else np.clip(rng.normal(0, 4), -8, 8))
    kind = rng.choice(["single", "pile", "scatter", "empty"], p=[0.45, 0.28, 0.22, 0.05])
    out = []
    if kind in ("single", "pile"):
        fr = float(np.clip(rng.normal(0.68, 0.14), 0.3, 0.92)) if rng.random() < 0.85 else float(rng.uniform(0.15, 0.4))
        cx, cy = cx0 + rng.normal(0, 0.04 * H), cy0 + rng.normal(0, 0.04 * H)
        if fr < 0.4 and rng.random() < 0.7:
            cx, cy = cx0 + rng.uniform(-0.4, 0.4) * H, cy0 + rng.uniform(-0.35, 0.35) * H
        top = dict(name=names[0], fr=fr, cx=cx, cy=cy, ang=rot(), shade=1.0)
        if kind == "pile":
            for i in range(rng.integers(1, 6)):
                d, th = rng.uniform(0.05, 0.4) * fr * H * 0.64, rng.uniform(0, 6.28)
                out.append(dict(name=names[i + 1], fr=fr * rng.uniform(0.92, 1.02), cx=cx + d * math.cos(th), cy=cy + d * math.sin(th),
                                ang=top["ang"] + rng.uniform(-35, 35), shade=rng.uniform(0.55, 1.0) if rng.random() < 0.5 else 1.0))
        out.append(top)
    elif kind == "scatter":
        for i in range(rng.integers(2, 7)):
            wide = 0.5 if rng.random() > 0.1 else 0.9
            out.append(dict(name=names[i] if rng.random() > 0.2 else "back", fr=float(rng.uniform(0.12, 0.45)),
                            cx=cx0 + rng.uniform(-wide, wide) * H, cy=cy0 + rng.uniform(-0.42, 0.42) * H,
                            ang=float(rng.uniform(-90, 90) if rng.random() < 0.15 else np.clip(rng.normal(0, 18), -35, 35)), shade=1.0))
    if (kind != "scatter" and rng.random() < 0.3) or (kind == "empty" and rng.random() < 0.5):  # draw pile back at the side
        sx = rng.choice([-1, 1]) * rng.uniform(0.55, 0.85) * H
        out.insert(0, dict(name="back", fr=float(rng.uniform(0.15, 0.3)), cx=cx0 + sx, cy=cy0 + rng.uniform(-0.3, 0.3) * H, ang=float(rng.uniform(-8, 8)), shade=1.0))
    return out


def make_image(idx, S, seed):
    rng = np.random.default_rng([seed, idx])
    H = S; W = int(S * rng.uniform(1.3, 2.0)); b = int(H * rng.uniform(0.02, 0.05))
    Wb, Hb = W + 2 * b, H + 2 * b
    scr = felt(rng, W, H) if rng.random() < 0.72 else texture(rng, W, H)
    bez = np.empty((Hb, Wb, 3), np.float32); bez[:] = rng.integers(5, 35) + rng.normal(0, 2, 3)
    bez[b:b + H, b:b + W] = scr
    Hm = homography(rng, Wb, Hb, S)
    desk = texture(rng, S, S) * rng.uniform(0.25, 1.0)
    m = cv2.warpPerspective(np.ones((Hb, Wb), np.float32), Hm, (S, S))[..., None]
    frame = desk * (1 - m) + cv2.warpPerspective(bez, Hm, (S, S), borderMode=cv2.BORDER_REPLICATE) * m
    frame = frame.astype(np.float32)

    cards, labels = [], []
    for c in plan_cards(rng, W, H, b):
        hc = max(int(c["fr"] * H), 10); wc = max(int(hc * 480 / 720), 7)
        src = CARDS[c["name"]]
        img = cv2.resize(src, (wc, hc), interpolation=cv2.INTER_AREA if wc < 480 else cv2.INTER_LINEAR).astype(np.float32) / 255
        img[..., :3] *= c["shade"]
        t = math.radians(c["ang"]); cs, sn = math.cos(t), math.sin(t)
        A = np.array([[cs, -sn, c["cx"] - (cs * wc / 2 - sn * hc / 2)], [sn, cs, c["cy"] - (sn * wc / 2 + cs * hc / 2)], [0, 0, 1]])
        M = Hm @ A
        w = cv2.warpPerspective(img, M, (S, S))
        quad = cv2.perspectiveTransform(np.array([[[0, 0], [wc, 0], [wc, hc], [0, hc]]], np.float32), M)[0]
        a = w[..., 3]
        dx, dy = rng.uniform(2, 8) * S / 384, rng.uniform(3, 10) * S / 384
        sh = cv2.GaussianBlur(cv2.warpAffine(a, np.float32([[1, 0, dx], [0, 1, dy]]), (S, S)), (0, 0), rng.uniform(3, 8) * S / 384)
        frame = frame * (1 - rng.uniform(0.2, 0.5) * sh[..., None])
        frame = w[..., :3] * 255 + (1 - a[..., None]) * frame
        cards.append((c["name"], quad, a > 0.5, cv2.contourArea(quad) * 0.99))

    if rng.random() < 0.6:  # HUD / UI overlay on top
        rgb, al = make_overlay(rng, W + 2 * b, H + 2 * b, S)
        o = cv2.warpPerspective(rgb.astype(np.float32), Hm, (S, S)); oa = cv2.warpPerspective(al.astype(np.float32) / 255, Hm, (S, S))
        frame = o + (1 - oa[..., None]) * frame

    covered = np.zeros((S, S), bool)
    for name, quad, mask, area in reversed(cards):
        if name != "back" and (mask & ~covered).sum() / max(area, 1) >= 0.4:
            x0, y0 = np.clip(quad.min(0), 0, S); x1, y1 = np.clip(quad.max(0), 0, S)
            if x1 - x0 >= 6 and y1 - y0 >= 6:
                labels.append(f"{CLASSES.index(name)} {(x0 + x1) / 2 / S:.6f} {(y0 + y1) / 2 / S:.6f} {(x1 - x0) / S:.6f} {(y1 - y0) / S:.6f}")
        covered |= mask
    return camera(frame, rng, S), labels


def work(args):
    split, idx, S, seed, out = args
    jpg, labels = make_image(idx + (10**6 if split == "val" else 0), S, seed)
    (out / "images" / split / f"{idx:06d}.jpg").write_bytes(jpg)
    (out / "labels" / split / f"{idx:06d}.txt").write_text("\n".join(labels))


def preview(out, S, n=16):
    tiles = []
    for i in range(n):
        im = cv2.imread(str(out / "images" / "val" / f"{i:06d}.jpg"))
        for ln in (out / "labels" / "val" / f"{i:06d}.txt").read_text().split("\n"):
            if not ln: continue
            c, cx, cy, w, h = ln.split(); c = int(c); cx, cy, w, h = (float(v) * S for v in (cx, cy, w, h))
            p0, p1 = (int(cx - w / 2), int(cy - h / 2)), (int(cx + w / 2), int(cy + h / 2))
            cv2.rectangle(im, p0, p1, (0, 255, 0), 1); cv2.putText(im, CLASSES[c], (p0[0] + 2, p0[1] + 12), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 255), 1, cv2.LINE_AA)
        tiles.append(im)
    rows = [np.hstack(tiles[r * 4:r * 4 + 4]) for r in range(n // 4)]
    cv2.imwrite(str(out.parent / "preview.jpg"), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 85])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", type=int, default=15000); ap.add_argument("--val", type=int, default=1500)
    ap.add_argument("--size", type=int, default=384); ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--workers", type=int, default=9); ap.add_argument("--out", type=Path, default=ML / "data" / "uno")
    a = ap.parse_args()
    for s in ("train", "val"):
        for d in ("images", "labels"):
            (a.out / d / s).mkdir(parents=True, exist_ok=True)
    jobs = [("train", i, a.size, a.seed, a.out) for i in range(a.train)] + [("val", i, a.size, a.seed, a.out) for i in range(a.val)]
    with Pool(a.workers, initializer=load_cards) as p:
        for _ in p.imap_unordered(work, jobs, chunksize=64): pass
    names = "\n".join(f"  {i}: {n}" for i, n in enumerate(CLASSES))
    (a.out.parent / "uno.yaml").write_text(f"path: {a.out}\ntrain: images/train\nval: images/val\nnames:\n{names}\n")
    preview(a.out, a.size)
    print("done", a.train, a.val)


if __name__ == "__main__":
    main()
