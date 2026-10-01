#!/usr/bin/env python3
# Смесь нейромодели с личной n-граммой: p = λ·p_nn + (1−λ)·p_backoff(tri→bi→uni).
# Свип λ на tg-val, метрики top-1/top-3. usage: blend_eval.py [ckpt]
import json
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).parent))
from pretrain import MiniGPT  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
ck_path = Path(sys.argv[1] if len(sys.argv) > 1 else "ckpt/sft-midv2s4000.pt")
SEQ = 256

stoi = json.loads((ROOT / "corpus/vocab.json").read_text())
V = len(stoi)
ck = torch.load(ck_path, map_location="cpu", weights_only=False)
model = MiniGPT(V, ck["d"], ck["layers"], ck["heads"], ck["seq"], dropout=0.0)
model.load_state_dict(ck["model"])
model.eval()
device = "mps" if torch.backends.mps.is_available() else "cpu"
model.to(device)

text = (ROOT / "corpus/tg.txt").read_text(encoding="utf-8")
ids = np.fromiter((stoi.get(ch, 0) for ch in text), dtype=np.int64, count=len(text))
cut = int(len(ids) * 0.99)
tr, ev = ids[:cut], ids[cut:]

# ---- n-граммы на tg-train ----
a, b, c = tr[:-2], tr[1:-1], tr[2:]
tri = np.bincount((a * V + b) * V + c, minlength=V * V * V).reshape(V * V, V).astype(np.float32)
bi = np.bincount(b * V + c, minlength=V * V).reshape(V, V).astype(np.float32)
uni = np.bincount(c, minlength=V).astype(np.float32)
tri /= np.maximum(tri.sum(1, keepdims=True), 1)
bi /= np.maximum(bi.sum(1, keepdims=True), 1)
uni /= uni.sum()

ea, eb, ec = ev[:-2], ev[1:-1], ev[2:]
rows = tri[ea * V + eb]
has_tri = rows.sum(1) > 0
rows_bi = bi[eb]
has_bi = rows_bi.sum(1) > 1
uni_t = uni[None, :].repeat(len(ec), 0)
backoff = np.where(has_tri[:, None], rows, np.where(has_bi[:, None], rows_bi, uni_t))

# ---- нейро-вероятности на tg-val (окнами, как eval_tg) ----
probs = np.zeros((len(ec), V), dtype=np.float32)
with torch.no_grad():
    for i in range(0, len(ec), 4096):
        j = min(i + 4096, len(ec))
        # контекст: окно до SEQ символов, заканчивающееся на позиции предсказания
        # окно SEQ символов, заканчивающееся прямо перед предсказываемым
        starts = cut + np.arange(i, j) + 2 - SEQ
        assert starts.min() >= 0
        xs = np.stack([ids[s: s + SEQ] for s in starts])
        x = torch.from_numpy(xs).to(device)
        p = torch.softmax(model(x)[:, -1], dim=-1).cpu().numpy()
        probs[i:j] = p

nn_top1 = (probs.argmax(1) == ec).mean()
nn_top3 = (np.argsort(-probs, 1)[:, :3] == ec[:, None]).any(1).mean()
print(f"nn {ck_path.name}: top-1 {nn_top1:.4f} | top-3 {nn_top3:.4f}")

print(f"{'λ(nn)':>6} {'top-1':>7} {'top-3':>7}")
best = (0, 0, 0)
for lam in [0.0, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0]:
    mix = lam * probs + (1 - lam) * backoff
    t1 = (mix.argmax(1) == ec).mean()
    t3 = (np.argsort(-mix, 1)[:, :3] == ec[:, None]).any(1).mean()
    if t3 > best[2]:
        best = (lam, t1, t3)
    print(f"{lam:6.2f} {t1:7.4f} {t3:7.4f}")
print(f"лучший λ={best[0]}: top-1 {best[1]:.4f} | top-3 {best[2]:.4f}")
