// Живая модель: sft.onnx (3,4 млн параметров, словарь 401) в onnxruntime-web, wasm, один поток.
// Входы как в экспорте train/export_onnx.py: ids [1,T] int64, pos [T] int64, mask [T,T] float32 → logits [1,T,401].
import * as ort from "../vendor/ort/ort.wasm.min.mjs";

const BASE = new URL("../", import.meta.url);
const URLS = {
  model: new URL("model/sft.onnx", BASE),
  vocab: new URL("model/vocab.json", BASE),
  wasm: new URL("vendor/ort/ort-wasm-simd-threaded.wasm", BASE),
};
const SIZES = { model: 13766266, wasm: 11246032 };

// Окно 64 символа: по замеру в candle.cjs точность та же, что на 256, а считать в разы быстрее.
export const WINDOW = 64;

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL("vendor/ort/", BASE).href;

async function fetchBytes(url, tick) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.pathname.split("/").pop()} не загрузился: HTTP ${res.status}`);
  if (!res.body || !res.body.getReader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    tick(buf.length);
    return buf;
  }
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    tick(value.length);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const TOTAL_BYTES = SIZES.model + SIZES.wasm;

export async function loadModel(onProgress = () => {}) {
  let loaded = 0;
  const tick = n => { loaded += n; onProgress({ stage: "download", loaded, total: TOTAL_BYTES }); };
  const [vocab, wasm, bytes] = await Promise.all([
    fetch(URLS.vocab).then(r => { if (!r.ok) throw new Error(`vocab.json не загрузился: HTTP ${r.status}`); return r.json(); }),
    fetchBytes(URLS.wasm, tick),
    fetchBytes(URLS.model, tick),
  ]);
  onProgress({ stage: "init", loaded: TOTAL_BYTES, total: TOTAL_BYTES });
  ort.env.wasm.wasmBinary = wasm;
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  return new Model(session, vocab);
}

export class Model {
  constructor(session, vocab) {
    this.session = session;
    this.stoi = vocab;
    this.itos = [];
    for (const [c, i] of Object.entries(vocab)) this.itos[i] = c;
    this.V = this.itos.length;
    this.unk = vocab["<unk>"] ?? 0;
    this.queue = Promise.resolve();
  }

  // распределение следующего символа; прогоны идут строго по очереди — сессия wasm однопоточная
  next(chars) {
    const run = async () => {
      const ctx = chars.slice(-WINDOW);
      const T = ctx.length;
      const ids = BigInt64Array.from(ctx, c => BigInt(this.stoi[c] ?? this.unk));
      const pos = BigInt64Array.from({ length: T }, (_, i) => BigInt(i));
      const mask = new Float32Array(T * T);
      for (let i = 0; i < T; i++) for (let j = i + 1; j < T; j++) mask[i * T + j] = -Infinity;
      const t0 = performance.now();
      const out = await this.session.run({
        ids: new ort.Tensor("int64", ids, [1, T]),
        pos: new ort.Tensor("int64", pos, [T]),
        mask: new ort.Tensor("float32", mask, [T, T]),
      });
      const ms = performance.now() - t0;
      const row = out.logits.data.subarray((T - 1) * this.V, T * this.V);
      let m = -Infinity;
      for (const x of row) if (x > m) m = x;
      const p = new Float64Array(this.V);
      let sum = 0;
      for (let i = 0; i < this.V; i++) { p[i] = Math.exp(row[i] - m); sum += p[i]; }
      for (let i = 0; i < this.V; i++) p[i] /= sum;
      return { p, ms };
    };
    const job = this.queue.then(run, run);
    this.queue = job.catch(() => {});
    return job;
  }

  // кандидаты для подсветки — как topCandidates в candle.cjs: топ-8, без переноса строки, <unk> и знаков без клавиши
  candidates(p, charSlot) {
    const order = [...p.keys()].sort((a, b) => p[b] - p[a]).slice(0, 8);
    const out = [];
    for (const i of order) {
      const ch = this.itos[i];
      if (ch === "\n" || ch === "<unk>") continue;
      const s = charSlot[ch];
      if (s === undefined) continue;
      out.push({ ch, p: p[i], s });
      if (out.length === 3) break;
    }
    return out;
  }

  sorted(p) {
    return [...p.keys()].sort((a, b) => p[b] - p[a]).map(i => [this.itos[i], p[i]]);
  }

  // призрак слова: жадно дописываем до пробела, не больше 12 знаков
  async ghost(chars, isStale) {
    const ctx = chars.slice();
    const out = [];
    for (let k = 0; k < 12; k++) {
      if (isStale()) return null;
      const { p } = await this.next(ctx);
      let best = 0;
      for (let i = 1; i < this.V; i++) if (p[i] > p[best]) best = i;
      const ch = this.itos[best];
      if (ch === " " || ch === "\n" || ch === "<unk>") break;
      out.push({ ch, p: p[best] });
      ctx.push(ch);
    }
    return out;
  }
}
