#!/usr/bin/env python3
# char-токенизатор (ADR 0002): словарь «символ ↔ номер» по частотам корпусов.
# build: python tokenizer.py build --cover 0.999 файл1 файл2 …
# печатает лестницу покрытия; словарь → corpus/vocab.json (формат {"<unk>":0, "а":1, …})
import argparse
import json
from collections import Counter
from pathlib import Path

VOCAB_PATH = Path(__file__).resolve().parent.parent / "corpus" / "vocab.json"
UNK = "<unk>"


def build(files: list[str], cover: float, out: Path) -> None:
    cnt: Counter[str] = Counter()
    for fp in files:
        cnt.update(open(fp, encoding="utf-8", errors="replace").read())
    total = sum(cnt.values())

    print("лестница покрытия (сколько символов в словаре нужно под долю всех вхождений):")
    acc = 0
    for mark in (0.5, 0.9, 0.95, 0.99, 0.995, 0.999, 0.9999):
        n = 0
        a = 0
        for ch, c in cnt.most_common():
            if a / total >= mark:
                break
            a += c
            n += 1
        print(f"  {mark:.2%} → {n} симв.")

    vocab = {UNK: 0}
    acc = 0
    for ch, c in cnt.most_common():
        if acc / total >= cover:
            break
        vocab[ch] = len(vocab)
        acc += c
    out.write_text(json.dumps(vocab, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"\nсловарь: {len(vocab)} симв. (порог {cover:.2%}), реально покрывает {acc / total:.2%} → {out}")
    top = "".join(ch for ch, _ in cnt.most_common(40))
    print(f"топ-40 по частоте: {top!r}")


def encode(text: str, stoi: dict) -> list[int]:
    return [stoi.get(ch, 0) for ch in text]


def decode(ids: list[int], itos: dict) -> str:
    return "".join(itos.get(i, "") for i in ids)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("files", nargs="+")
    b.add_argument("--cover", type=float, default=0.999)
    b.add_argument("--out", type=Path, default=VOCAB_PATH)
    args = ap.parse_args()
    build(args.files, args.cover, args.out)
    vocab = json.loads(args.out.read_text(encoding="utf-8"))
    stoi = vocab
    itos = {v: k for k, v in vocab.items()}
    demo = "Привет, как дела? gpt-4 не нужен"
    ids = encode(demo, stoi)
    rt = decode(encode(demo, stoi), itos)
    print(f"проверка туда-обратно на «{demo}»: {'OK' if rt == demo else 'ПОТЕРИ: ' + repr(set(demo) - set(vocab))}")
