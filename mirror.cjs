// mirror.cjs — показывает в браузере то, что candle.cjs реально пишет в клавиатуру.
// Кадр канала 0x08 (126 слотов × RGB) уходит на страницу как есть, поэтому свечение
// совпадает с железом без пересчёта цветов на клиенте; отдельно идут нажатия и
// посчитанные кандидаты (буква, вероятность, ранг, цвет) — их считает candle.cjs.
//
// Запуск: node candle.cjs --mirror   → страница http://127.0.0.1:8124/
//         node mirror.cjs --fake     → то же, но без клавы и модели: сценарий-заглушка
//
// Раздаём только keyboard.html и assets/ — corpus/personal.log наружу не отдаём.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.MIRROR_PORT || 8124);
const ROOT = __dirname;
const CLIENTS = new Set();
const GOOD_EXT = new Set([".html", ".css", ".js", ".json", ".woff2", ".png", ".glb", ".jpg"]);
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".glb": "model/gltf-binary", ".jpg": "image/jpeg",
  ".woff2": "font/woff2", ".png": "image/png",
};

let hello = { model: "?", fps: 25 };
const FRAME = 378; // 126 слотов × 3

function send(name, payload) {
  const line = `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of CLIENTS) res.write(line);
}

const frame = buf => send("f", { t: Date.now(), d: Buffer.from(buf).subarray(8, 8 + FRAME).toString("base64") });
const key = k => send("k", k);
const pred = p => send("p", p);

function onRequest(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
      Connection: "keep-alive", "X-Accel-Buffering": "no",
    });
    res.write("retry: 500\n\n");
    res.write(`event: hello\ndata: ${JSON.stringify(hello)}\n\n`);
    CLIENTS.add(res);
    req.on("close", () => CLIENTS.delete(res));
    return;
  }
  const rel = url.pathname === "/" ? "board3d.html"
    : /^\/(board3d|keyboard)\.html$/.test(url.pathname) ? url.pathname.slice(1)
    : /^\/assets\/[A-Za-z0-9._/-]+$/.test(url.pathname) && !url.pathname.includes("..") ? url.pathname.slice(1) : null;
  const ext = rel && path.extname(rel);
  if (!rel || !GOOD_EXT.has(ext)) { res.writeHead(404).end("нет"); return; }
  fs.readFile(path.join(ROOT, rel), (e, data) => {
    if (e) { res.writeHead(404).end("нет"); return; }
    res.writeHead(200, { "Content-Type": MIME[ext], "Cache-Control": "no-store" });
    res.end(data);
  });
}

function start(info) {
  if (info) hello = { ...hello, ...info };
  const server = http.createServer(onRequest);
  server.on("error", e => console.error(`mirror: не поднялся на ${PORT}: ${e.message}`));
  server.listen(PORT, "127.0.0.1", () => console.log(`страница: http://127.0.0.1:${PORT}/`));
  return server;
}

module.exports = { start, frame, key, pred, PORT };

// --- источник-заглушка: полный конвейер свечки без клавы и модели ---
// Кадры собираются как в candle.cjs: фон, вспышка нажатия с затуханием, топ-3 кандидатов
// с ранговыми цветами, затухание после простоя. Слоты — честная карта RU+VKEY2LED оттуда же.
if (require.main === module) {
  const LEDS = 126, KEYS = 96, FPS = 25, BASE = [6, 5, 9], SPLASH = [110, 200, 255], DECAY = 0.80, IDLE_MS = 4000;
  const FAMILY = [
    [[0, [0, 0, 0]], [0.5, [40, 220, 110]], [1, [225, 255, 225]]],   // ранг 1 — зелёный
    [[0, [0, 0, 0]], [0.5, [235, 140, 20]], [1, [255, 215, 150]]],  // ранг 2 — янтарь
    [[0, [0, 0, 0]], [0.5, [0, 150, 220]], [1, [160, 220, 255]]],   // ранг 3 — циан
  ];
  const SHOWN = p => Math.pow(p, 0.4);
  const grad = (stops, t) => {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < stops.length; i++)
      if (t <= stops[i][0]) {
        const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], k = (t - t0) / (t1 - t0);
        return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
      }
    return [...stops[stops.length - 1][1]];
  };
  const rgbHex = c => "#" + c.map(v => Math.round(Math.min(255, v)).toString(16).padStart(2, "0")).join("");
  // символ → слот keyList (RU-таблица candle.cjs × VKEY2LED; в старой заглушке а/г/с/т светились не там)
  const SLOT = { а: 27, б: 52, в: 21, г: 44, д: 57, е: 32, ё: 80, ж: 63, з: 62, и: 34, й: 8, к: 26,
    л: 51, м: 28, н: 38, о: 45, п: 33, р: 39, с: 22, т: 40, у: 20, ф: 9, х: 68, ц: 14, ч: 16, ш: 50,
    щ: 56, ъ: 74, ы: 15, ь: 46, э: 69, ю: 58, я: 10, " ": 35, "\n": 81 };
  const TEXT = "привет, это демо свечки без клавы, печатаю само\n";

  // биграммная «модель» по тексту сценария: кандидаты и вероятности как у настоящего предикта
  const bigrams = new Map();
  for (let i = 1; i < TEXT.length; i++) {
    if (!bigrams.has(TEXT[i - 1])) bigrams.set(TEXT[i - 1], new Map());
    const m = bigrams.get(TEXT[i - 1]);
    m.set(TEXT[i], (m.get(TEXT[i]) || 0) + 1);
  }
  function candidates(prev) {
    const m = bigrams.get(prev) || bigrams.get(" ");
    const total = [...m.values()].reduce((s, v) => s + v, 0);
    const out = [];
    for (const [ch, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
      const slot = SLOT[ch];
      if (slot === undefined) continue;             // как в candle: без слота не подсвечиваем
      const p = (n + 0.3) / (total + 1);
      out.push({ ch, p, rank: out.length, slot, col: grad(FAMILY[out.length], SHOWN(p)) });
      if (out.length === 3) break;
    }
    return out;
  }

  const ripple = Array.from({ length: LEDS }, () => [0, 0, 0]);
  let ctx = "", i = 0, cands = candidates(" "), lastKey = Date.now();

  start({ model: "заглушка (--fake)" });
  setInterval(() => {                               // кадр 0x08 — сборка как в candle.cjs
    if (Date.now() - lastKey > IDLE_MS) for (const c of cands) c.col = c.col.map(v => v * 0.94);
    const out = Buffer.alloc(520);
    out[0] = 6; out[1] = 0x08; out[2] = 0; out[3] = 0; out[4] = 1; out[5] = 0; out[6] = 0x7A; out[7] = 1;
    for (let s = 0; s < LEDS; s++) {
      let [r, g, b] = s < KEYS ? BASE : [0, 0, 0];
      const rp = ripple[s];
      r = Math.max(r, rp[0]); g = Math.max(g, rp[1]); b = Math.max(b, rp[2]);
      for (let k = 0; k < 3; k++) { rp[k] *= DECAY; if (rp[k] < 1) rp[k] = 0; }
      for (const c of cands) if (c.slot === s) { r = Math.max(r, c.col[0]); g = Math.max(g, c.col[1]); b = Math.max(b, c.col[2]); }
      out[8 + s * 3] = Math.round(Math.min(255, r));
      out[9 + s * 3] = Math.round(Math.min(255, g));
      out[10 + s * 3] = Math.round(Math.min(255, b));
    }
    frame(out);
  }, 1000 / FPS);

  (function typeNext() {                            // «печатаем»: нажатие → пересчёт кандидатов
    setTimeout(() => {
      const ch = TEXT[i % TEXT.length];
      const slot = SLOT[ch];
      if (slot !== undefined) ripple[slot] = [...SPLASH];
      key({ slot: slot ?? null, ch, mod: 0, layout: "ru" });
      ctx = (ctx + ch).slice(-256);
      cands = candidates(ch);
      pred({ ms: 6 + Math.random() * 6, layout: "ru", ctx,
        cands: cands.map(c => ({ ch: c.ch, p: c.p, rank: c.rank, slot: c.slot, hex: rgbHex(c.col) })) });
      lastKey = Date.now();
      i++;
      typeNext();
    }, i % TEXT.length === 0 ? 6000 : 280 + Math.random() * 180);   // пауза после текста — видно затухание
  })();
}
