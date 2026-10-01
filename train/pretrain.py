#!/usr/bin/env python3
# Претрейн mini-GPT на char-уровне (стадия 4 плана): микс EN/RU 70/30, окно 256.
# Лестница размеров: small d=128 (~0.9M) | mid d=256 (~3.4M) | big d=512 (~13M).
# Артефакты: train/logs/<size>.csv (кривые), train/ckpt/<size>.pt (лучший по val).
# ponytail: данные грузятся в RAM целиком (~500МБ); при росте корпусов → memmap.
import argparse
import csv
import math
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

ROOT = Path(__file__).resolve().parent.parent
SEQ = 256
SIZES = {"small": 128, "mid": 256, "big": 512}


# ---------- данные: корпуса → массивы токенов (с кэшем .npy) ----------

def tokenize_file(fp: Path, stoi: dict) -> np.ndarray:
    cache = fp.with_suffix(".npy")
    if cache.exists():
        return np.load(cache)
    text = fp.read_text(encoding="utf-8", errors="replace")
    ids = np.fromiter((stoi.get(ch, 0) for ch in text), dtype=np.int32, count=len(text))
    np.save(cache, ids)
    return ids


def load_data(vocab_path: Path, files: list[Path], val_frac: float):
    import json
    stoi = json.loads(vocab_path.read_text(encoding="utf-8"))
    train_parts, val_parts = [], []
    for fp in files:
        ids = tokenize_file(fp, stoi)
        cut = int(len(ids) * (1 - val_frac))
        train_parts.append(ids[:cut])
        val_parts.append(ids[cut:])
    train = np.concatenate(train_parts)
    val = np.concatenate(val_parts)
    return torch.from_numpy(train.astype(np.int64)), torch.from_numpy(val.astype(np.int64)), stoi


def sample_batch(data: torch.Tensor, batch: int, seq: int, device):
    ix = torch.randint(len(data) - seq - 1, (batch,))
    x = torch.stack([data[i : i + seq] for i in ix]).to(device)
    y = torch.stack([data[i + 1 : i + seq + 1] for i in ix]).to(device)
    return x, y


# ---------- модель: блоки как в лекции 1 ----------

class Block(nn.Module):
    def __init__(self, d: int, heads: int, dropout: float):
        super().__init__()
        self.ln1 = nn.LayerNorm(d)
        self.attn = nn.MultiheadAttention(d, heads, dropout=dropout, batch_first=True)
        self.ln2 = nn.LayerNorm(d)
        self.ffn = nn.Sequential(nn.Linear(d, 4 * d), nn.GELU(), nn.Dropout(dropout), nn.Linear(4 * d, d))
        self._mask = None
        self.drop = nn.Dropout(dropout)

    def forward(self, x):
        h = self.ln1(x)
        if self._mask is None or self._mask.device != x.device:
            self._mask = nn.Transformer.generate_square_subsequent_mask(x.shape[1], device=x.device)
        a, _ = self.attn(h, h, h, need_weights=False, attn_mask=self._mask, is_causal=True)
        x = x + self.drop(a)
        return x + self.drop(self.ffn(self.ln2(x)))


class MiniGPT(nn.Module):
    def __init__(self, vocab: int, d: int, layers: int, heads: int, seq: int, dropout: float):
        super().__init__()
        self.tok = nn.Embedding(vocab, d)
        self.pos = nn.Embedding(seq, d)
        self.blocks = nn.ModuleList(Block(d, heads, dropout) for _ in range(layers))
        self.ln_f = nn.LayerNorm(d)
        self.head = nn.Linear(d, vocab)
        for p in self.parameters():
            if p.dim() > 1:
                nn.init.normal_(p, 0.0, 0.02)

    def forward(self, x):
        B, T = x.shape
        h = self.tok(x) + self.pos(torch.arange(T, device=x.device))
        for b in self.blocks:
            h = b(h)
        return self.head(self.ln_f(h))


# ---------- обучение ----------

@torch.no_grad()
def evaluate(model, val, batch, device):
    model.eval()
    x, y = sample_batch(val, batch * 4, SEQ, device)  # крупнее батч — стабильнее метрика
    logits = model(x)
    loss = F.cross_entropy(logits.flatten(0, 1), y.flatten())
    top3 = (logits.topk(3, dim=-1).indices == y.unsqueeze(-1)).any(-1).float().mean()
    model.train()
    return loss.item(), top3.item()


def train(size: str, steps: int, batch: int, lr0: float, out_dir: Path, data, device, tag: str = "", layers: int = 4):
    train_ids, val_ids, stoi = data
    d = SIZES[size]
    model = MiniGPT(len(stoi), d, layers=4, heads=4, seq=SEQ, dropout=0.1).to(device)
    model = MiniGPT(len(stoi), d, layers=layers, heads=4, seq=SEQ, dropout=0.1).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"[{size}] d={d}, L={layers}, параметров {n_params / 1e6:.2f}M, токенов train {len(train_ids) / 1e6:.0f}М")

    opt = torch.optim.AdamW(model.parameters(), lr=lr0, weight_decay=0.1)
    warmup = 100
    def lr_at(step):
        if step < warmup:
            return lr0 * step / warmup
        return lr0 * 0.5 * (1 + math.cos(math.pi * (step - warmup) / (steps - warmup)))

    log_path = out_dir / f"logs/{size}{tag}.csv"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    ckpt_path = out_dir / f"ckpt/{size}{tag}.pt"
    ckpt_path.parent.mkdir(parents=True, exist_ok=True)
    best_val = float("inf")
    t0 = time.time()
    with log_path.open("w", newline="") as lf:
        w = csv.writer(lf)
        w.writerow(["step", "train", "val", "top3", "lr", "sec"])
        for step in range(1, steps + 1):
            for g in opt.param_groups:
                g["lr"] = lr_at(step)
            x, y = sample_batch(train_ids, batch, SEQ, device)
            loss = F.cross_entropy(model(x).flatten(0, 1), y.flatten())
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            if step % 50 == 0 or step == steps:
                vl, t3 = evaluate(model, val_ids, batch, device)
                w.writerow([step, f"{loss.item():.4f}", f"{vl:.4f}", f"{t3:.4f}", f"{lr_at(step):.1e}", f"{time.time()-t0:.0f}"])
                lf.flush()
                mark = ""
                if vl < best_val:
                    best_val = vl
                    torch.save({"model": model.state_dict(), "d": d, "layers": layers, "heads": 4, "seq": SEQ,
                                "vocab": list(stoi), "val": vl, "step": step}, ckpt_path)
                    mark = " *"
                print(f"[{size}] {step:4d} | train {loss.item():.3f} | val {vl:.3f} | top3 {t3:.3f} | {time.time()-t0:.0f}с{mark}")
    print(f"[{size}] готово за {(time.time()-t0)/60:.1f} мин, лучший val {best_val:.4f} → {ckpt_path}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("size", choices=[*SIZES, "ladder"])
    ap.add_argument("--steps", type=int, default=2000)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--tag", default="", help="суффикс имён ckpt/log (итерации)")
    ap.add_argument("--layers", type=int, default=4)
    args = ap.parse_args()

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print("устройство:", device)
    data = load_data(ROOT / "corpus/vocab.json",
                     [ROOT / "corpus/raw/tinystories.txt", ROOT / "corpus/raw/enwiki.txt", ROOT / "corpus/raw/ruwiki.txt"], val_frac=0.01)
    sizes = list(SIZES) if args.size == "ladder" else [args.size]
    for s in sizes:
        train(s, args.steps, args.batch, args.lr, ROOT / "train", data, device, args.tag, args.layers)
