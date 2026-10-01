#!/usr/bin/env python3
# SFT: дообучение претрейн-чекпоинта на личном тексте (tg.txt).
# Валидация — последние 1% tg.txt, чекпоинтbest по val → ckpt/sft-mid.pt (формат как у pretrain).
import csv
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).parent))
from pretrain import MiniGPT  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SEQ = 256
_argv = [a for a in sys.argv[1:]]
SRC = _argv[0] if len(_argv) > 0 else "ckpt/mid.pt"
OUT = _argv[1] if len(_argv) > 1 else "ckpt/sft-mid.pt"
STEPS = int(_argv[2]) if len(_argv) > 2 else 400
BATCH = 48
LR = float(_argv[3]) if len(_argv) > 3 else 6e-4
stoi = json.loads((ROOT / "corpus/vocab.json").read_text())
text = (ROOT / "corpus/tg.txt").read_text(encoding="utf-8")
ids = np.fromiter((stoi.get(ch, 0) for ch in text), dtype=np.int64, count=len(text))
cut = int(len(ids) * 0.99)
train, val = torch.from_numpy(ids[:cut]), torch.from_numpy(ids[cut:])

ck = torch.load(SRC, map_location="cpu", weights_only=False)
model = MiniGPT(len(stoi), ck["d"], ck["layers"], ck["heads"], ck["seq"], dropout=0.1)
model.load_state_dict(ck["model"])
device = "mps" if torch.backends.mps.is_available() else "cpu"
model.to(device)
print(f"SFT {SRC} → {OUT}: train {len(train) / 1e6:.1f}М токенов, val {len(val) / 1e3:.0f}К, {device}")

vx = torch.stack([val[i:i + SEQ] for i in range(0, len(val) - SEQ - 1, SEQ)]).to(device)
vy = torch.stack([val[i + 1:i + SEQ + 1] for i in range(0, len(val) - SEQ - 1, SEQ)]).to(device)


@torch.no_grad()
def evaluate():
    model.eval()
    logits = model(vx)
    loss = F.cross_entropy(logits.flatten(0, 1), vy.flatten()).item()
    top1 = (logits.argmax(-1) == vy).float().mean().item()
    top3 = (logits.topk(3, -1).indices == vy.unsqueeze(-1)).any(-1).float().mean().item()
    model.train()
    return loss, top1, top3


opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.1)
warmup = 25
lr_at = lambda s: LR * s / warmup if s < warmup else LR * 0.5 * (1 + math.cos(math.pi * (s - warmup) / (STEPS - warmup)))

best = float("inf")
t0 = time.time()
with open(ROOT / f"train/logs/{Path(OUT).stem}.csv", "w", newline="") as lf:
    w = csv.writer(lf)
    w.writerow(["step", "train", "val", "top1", "top3"])
    for step in range(1, STEPS + 1):
        for g in opt.param_groups:
            g["lr"] = lr_at(step)
        ix = torch.randint(len(train) - SEQ - 1, (BATCH,))
        x = torch.stack([train[i:i + SEQ] for i in ix]).to(device)
        y = torch.stack([train[i + 1:i + SEQ + 1] for i in ix]).to(device)
        loss = F.cross_entropy(model(x).flatten(0, 1), y.flatten())
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        if step % 25 == 0 or step == STEPS:
            vl, t1, t3 = evaluate()
            mark = ""
            if vl < best:
                best = vl
                torch.save({"model": model.state_dict(), "d": ck["d"], "layers": ck["layers"], "heads": ck["heads"],
                            "seq": SEQ, "vocab": list(stoi), "val": vl, "step": step}, ROOT / f"train/{OUT}")
                mark = " *"
            w.writerow([step, f"{loss.item():.4f}", f"{vl:.4f}", f"{t1:.4f}", f"{t3:.4f}"])
            lf.flush()
            print(f"[sft] {step:3d} | train {loss.item():.3f} | val {vl:.3f} | top1 {t1:.3f} | top3 {t3:.3f} | {time.time() - t0:.0f}с{mark}")
print(f"готово: лучший val {best:.4f} → train/{OUT}")
