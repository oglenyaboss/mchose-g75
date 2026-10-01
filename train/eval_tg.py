#!/usr/bin/env python3
# Замер претрейн-модели и триграммы на ЛИЧНОМ тексте (tg.txt) против корпусной валидации.
# Печатает только метрики, содержимое корпусов не выводится.
# usage: eval_tg.py [ckpt]
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).parent))
from pretrain import MiniGPT, load_data  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
ck_path = Path(sys.argv[1] if len(sys.argv) > 1 else "ckpt/mid.pt")

stoi_v = json.loads((ROOT / "corpus/vocab.json").read_text())
V = len(stoi_v)
SEQ = 256

ck = torch.load(ck_path, map_location="cpu", weights_only=False)
model = MiniGPT(len(ck["vocab"]), ck["d"], ck["layers"], ck["heads"], ck["seq"], dropout=0.0)
model.load_state_dict(ck["model"])
model.eval()

stoi = json.loads((ROOT / "corpus/vocab.json").read_text())


def tg_ids():
    text = (ROOT / "corpus/tg.txt").read_text(encoding="utf-8")
    return np.fromiter((stoi.get(ch, 0) for ch in text), dtype=np.int64, count=len(text))


@torch.no_grad()
def eval_model(ids, tag, device, batch=48):
    n = (len(ids) - SEQ - 1) // SEQ
    tot = loss1 = top1 = top3 = 0.0
    for i in range(0, n * SEQ, SEQ * batch):
        chunk = min(batch, (n * SEQ - i) // SEQ)
        xs = np.stack([ids[i + b * SEQ: i + (b + 1) * SEQ] for b in range(chunk)])
        ys = np.stack([ids[i + b * SEQ + 1: i + (b + 1) * SEQ + 1] for b in range(chunk)])
        x = torch.from_numpy(xs).to(device)
        y = torch.from_numpy(ys).to(device)
        logits = model(x)
        loss1 += F.cross_entropy(logits.flatten(0, 1), y.flatten()).item() * chunk
        top1 += (logits.argmax(-1) == y).float().mean().item() * chunk
        top3 += (logits.topk(3, -1).indices == y.unsqueeze(-1)).any(-1).float().mean().item() * chunk
        tot += chunk
    print(f"  модель {ck_path.name:12s} на {tag:10s}: loss {loss1 / tot:.3f} | top-1 {top1 / tot:.3f} | top-3 {top3 / tot:.3f}")
    return loss1 / tot, top1 / tot, top3 / tot


def trigram_fit_eval(train_np, eval_np, tag):
    a, b, c = train_np[:-2], train_np[1:-1], train_np[2:]
    tri = np.bincount((a * V + b) * V + c, minlength=V * V * V).reshape(V * V, V).astype(np.int32)
    bi = np.bincount(b * V + c, minlength=V * V).reshape(V, V)
    uni = np.bincount(c, minlength=V)
    ea, eb, ec = eval_np[:-2], eval_np[1:-1], eval_np[2:]
    keys = ea * V + eb
    rows = tri[keys]
    pred3 = np.argsort(-rows, axis=1)[:, :3]
    back = rows.sum(1) == 0
    if back.any():
        pred3[back] = np.argsort(-bi[eb[back]], axis=1)[:, :3]
        empty = bi[eb[back]].sum(1) == 0
        if empty.any():
            pred3[back][empty] = np.argsort(-uni)[:3]
    top1 = (pred3[:, 0] == ec).mean()
    top3 = (pred3 == ec[:, None]).any(1).mean()
    print(f"  триграмма (обучение на {tag.split()[0]}) на {tag.split()[-1]:10s}:            top-1 {top1:.3f} | top-3 {top3:.3f}")
    return top1, top3


device = "mps" if torch.backends.mps.is_available() else "cpu"
model.to(device)

print("== личный текст (tg.txt) ==")
ids = tg_ids()
unk = (ids == 0).mean()
cut = int(len(ids) * 0.99)
print(f"  символов: {len(ids) / 1e6:.1f}М, unk {unk * 100:.1f}%, валидация — последние 1%")
eval_model(ids[cut:], "tg-val", device)

print("== чужие корпуса (валидация претрейна) ==")
train, val, _ = load_data(ROOT / "corpus/vocab.json",
                          [ROOT / "corpus/raw/tinystories.txt", ROOT / "corpus/raw/enwiki.txt", ROOT / "corpus/raw/ruwiki.txt"], val_frac=0.01)
train_np, val_np = train.numpy(), val.numpy()
eval_model(val_np, "corpus-val", device, batch=16)

print("== триграммный бейзлайн ==")
trigram_fit_eval(train_np, ids[cut:], "corpus-train → tg-val")
