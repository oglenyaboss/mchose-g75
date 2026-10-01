#!/usr/bin/env python3
# Достаёт матрицы внимания из обученного чекпоинта для строки → JSON для лекции 2.
# usage: attn_probe.py [ckpt] [текст] [out.json]
import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).parent))
from pretrain import MiniGPT  # noqa: E402

ckpt_path = Path(sys.argv[1] if len(sys.argv) > 1 else "train/ckpt/small.pt")
text = sys.argv[2] if len(sys.argv) > 2 else "Привет, как дела?"
out_path = Path(sys.argv[3] if len(sys.argv) > 3 else "docs/lessons/attn-small.json")

ck = torch.load(ckpt_path, map_location="cpu", weights_only=False)
model = MiniGPT(len(ck["vocab"]), ck["d"], ck["layers"], ck["heads"], ck["seq"], dropout=0.0)
model.load_state_dict(ck["model"])
model.eval()
stoi = {c: i for i, c in enumerate(ck["vocab"])}
x = torch.tensor([[stoi.get(c, 0) for c in text]])

with torch.no_grad():
    h = model.tok(x) + model.pos(torch.arange(x.shape[1]))
    layers_out = []
    for b in model.blocks:
        q = b.ln1(h)
        _, w = b.attn(q, q, q, need_weights=True, average_attn_weights=False)
        w = (w[0] * 1000).round() / 1000
        layers_out.append(w.tolist())  # [heads, T, T]
        a, _ = b.attn(q, q, q, need_weights=False, attn_mask=b._mask, is_causal=True)
        h = h + a
        h = h + b.ffn(b.ln2(h))

out_path.write_text(json.dumps({"text": list(text), "layers": layers_out}, ensure_ascii=False), encoding="utf-8")
print(f"{len(layers_out)} слоёв × {len(layers_out[0])} голов × {len(text)}×{len(text)} → {out_path} ({out_path.stat().st_size // 1024}КБ)")
