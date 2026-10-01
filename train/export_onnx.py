#!/usr/bin/env python3
# Экспорт чекпоинта в ONNX для браузера/onnxruntime-node.
# Маска каузальности — ВХОДОМ (float32 [T,T]), а не генерацией в графе:
# убирает Trilu/Mod/Range/Where, которые валит wasm-сборка орта.
# usage: export_onnx.py [ckpt] [out.onnx]
import sys
from pathlib import Path

import math

import torch

sys.path.insert(0, str(Path(__file__).parent))
from pretrain import MiniGPT  # noqa: E402

ckpt_path = Path(sys.argv[1] if len(sys.argv) > 1 else "ckpt/mid.pt")
out_path = Path(sys.argv[2] if len(sys.argv) > 2 else "../mid.onnx")

ck = torch.load(ckpt_path, map_location="cpu", weights_only=False)
model = MiniGPT(len(ck["vocab"]), ck["d"], ck["layers"], ck["heads"], ck["seq"], dropout=0.0)
model.load_state_dict(ck["model"])
model.eval()


class Export(MiniGPT):
    def forward(self, ids, pos, mask):
        h = self.tok(ids) + self.pos(pos)
        for b in self.blocks:
            x = b.ln1(h)
            qkv = torch.nn.functional.linear(x, b.attn.in_proj_weight, b.attn.in_proj_bias)
            q, k, v = qkv.chunk(3, dim=-1)
            B, T, d = q.shape
            H, hd = b.attn.num_heads, d // b.attn.num_heads
            q = q.view(B, T, H, hd).permute(0, 2, 1, 3)
            k = k.view(B, T, H, hd).permute(0, 2, 1, 3)
            v = v.view(B, T, H, hd).permute(0, 2, 1, 3)
            s = (q @ k.transpose(-2, -1)) / math.sqrt(hd) + mask
            a = (s.softmax(-1) @ v).permute(0, 2, 1, 3).reshape(B, T, d)
            h = h + b.attn.out_proj(a)
            h = h + b.ffn(b.ln2(h))
        return self.head(self.ln_f(h))


net = Export(len(ck["vocab"]), ck["d"], ck["layers"], ck["heads"], ck["seq"], dropout=0.0)
net.load_state_dict(ck["model"])
net.eval()

T = 17
ids = torch.randint(1, len(ck["vocab"]), (1, T))
pos = torch.arange(T)
mask = torch.nn.Transformer.generate_square_subsequent_mask(T)
with torch.no_grad():
    ref = model(ids)
    ref2 = net(ids, pos, mask)
torch.onnx.export(
    net, (ids, pos, mask), out_path,
    input_names=["ids", "pos", "mask"], output_names=["logits"],
    dynamic_axes={"ids": {1: "T"}, "pos": {0: "T"}, "mask": {0: "T", 1: "T"}, "logits": {1: "T"}},
    opset_version=14, dynamo=False,
)

import collections

import onnx

assert not ({"Trilu", "Mod", "Range", "Where"} & set(n.op_type for n in onnx.load(str(out_path)).graph.node)), "экзотика вернулась"

import onnxruntime as ort  # noqa: E402

sess = ort.InferenceSession(str(out_path), providers=["CPUExecutionProvider"])
got = sess.run(None, {"ids": ids.numpy(), "pos": pos.numpy(), "mask": mask.numpy().astype("float32")})[0]
diff_t = abs(ref.numpy() - ref2.numpy()).max()
diff_o = abs(ref2.numpy() - got).max()
print(f"{ckpt_path} → {out_path} ({out_path.stat().st_size / 1e6:.1f} МБ) | обёртка vs torch: {diff_t:.1e} | onnx vs обёртка: {diff_o:.1e}")
print("ops:", dict(collections.Counter(n.op_type for n in onnx.load(str(out_path)).graph.node)))
assert diff_t < 1e-5 and diff_o < 1e-3, "численно разошлись"
