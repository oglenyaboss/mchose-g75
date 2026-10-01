// Свечка: подсветка топ-3 предсказаний следующей буквы через канал 0x08 (lightMode 11).
// Модель — sft.onnx через onnxruntime-node: 8.8 мс по стенке на окне 256, но 39 мс CPU на форвард
// (пул потоков ORT жжёт вхолостую: 446% при batch=1). На 64 символах — 2.4 мс при той же точности.
// Цвет = ранг кандидата (зелёный / янтарь / циан), яркость = вероятность (CANDLE_COLOR=conf —
// прежняя схема «цвет = уверенность», ранги 2-3 в ней совпадают оттенком в 79% случаев).
// Контекст — окно 256 символов, рвётся на границах: Enter (оставляет '\n') и смена приложения.
// Запуск: node candle.cjs [модель.onnx]  |  --dry [файл] печать по файлу  |  --keycheck карта слотов
//         --watch печать по живым нажатиям без HID (работает при занятой клаве)
// Выход Ctrl+C гасит оверлей и возвращает режим. keytap свой: коллектор (keylog) не трогаем.
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const hid = require("node-hid");
const ort = require("onnxruntime-node");
const mirror = require("./mirror.cjs");   // зеркало для браузера (только с --mirror)

const VID = 0x258a, PID = 0x010c, REPORT_ID = 6, TOTAL = 520, LEDS = 126, KEYS = 96, FPS = 25;
const CTX = 256, CANDIDATES = 8, SHOW = 3;
const BASE = [6, 5, 9];              // фон
const SPLASH = [110, 200, 255];      // вспышка нажатой клавиши
const DECAY = 0.80;                  // затухание вспышки за кадр
const IDLE_MS = 4000;                // простой, после которого свечка гаснет

// vkey -> слот keyList (калибровка радугой 2026-09-09; хвост добавлен свечкой — проверка: --keycheck)
const VKEY2LED = {
  0: 9, 1: 15, 2: 21, 3: 27, 4: 39, 5: 33, 6: 10, 7: 16, 8: 22, 9: 28, 11: 34,
  12: 8, 13: 14, 14: 20, 15: 26, 16: 38, 17: 32,
  18: 7, 19: 13, 20: 19, 21: 25, 22: 37, 23: 31, 25: 55, 26: 43, 28: 49, 29: 61,
  31: 56, 32: 44, 34: 50, 35: 62, 36: 81, 37: 57, 38: 45, 40: 51, 43: 52, 44: 64,
  45: 40, 46: 46, 47: 58, 49: 35, 53: 0, 48: 2,
  24: 73, 30: 74, 33: 68, 39: 69, 41: 63, 42: 80, 50: 1,
  // 27 ('-'/«_») — слот неизвестен: в keyList дырка 75-77. ponytail: калибровать, когда '-' полезет в топ
};

// символ -> vkey, снято с системного keylayout через UCKeyTranslate (модификаторы не важны:
// Shift даёт тот же физический ключ). Русская раскладка: '.' = Shift+7, ',' = Shift+6.
const EN = { "\t": 48, "\n": 36, " ": 49, _: 27, "-": 27, ",": 43, ";": 41, ":": 41, "!": 18, "?": 44, ".": 47, "'": 39, "\"": 39, "(": 25, ")": 29, "[": 33, "]": 30, "{": 33, "}": 30, "§": 10, "@": 19, "*": 28, "/": 44, "\\": 42, "&": 26, "#": 20, "%": 23, "`": 50, "^": 22, "+": 24, "±": 10, "<": 43, "=": 24, ">": 47, "|": 42, "~": 50, $: 21, "0": 29, "1": 18, "2": 19, "3": 20, "4": 21, "5": 23, "6": 22, "7": 26, "8": 28, "9": 25, a: 0, A: 0, b: 11, B: 11, c: 8, C: 8, d: 2, D: 2, e: 14, E: 14, f: 3, F: 3, g: 5, G: 5, h: 4, H: 4, i: 34, I: 34, j: 38, J: 38, k: 40, K: 40, l: 37, L: 37, m: 46, M: 46, n: 45, N: 45, o: 31, O: 31, p: 35, P: 35, q: 12, Q: 12, r: 15, R: 15, s: 1, S: 1, t: 17, T: 17, u: 32, U: 32, v: 9, V: 9, w: 13, W: 13, x: 7, X: 7, y: 16, Y: 16, z: 6, Z: 6 };
const RU = { "\t": 48, "\n": 36, " ": 49, _: 27, "-": 27, ",": 22, ";": 28, ":": 23, "!": 18, "?": 44, ".": 26, "\"": 19, "(": 25, ")": 29, "[": 50, "]": 50, "/": 44, "%": 21, "+": 24, "<": 10, "=": 24, ">": 10, "0": 29, "1": 18, "2": 19, "3": 20, "4": 21, "5": 23, "6": 22, "7": 26, "8": 28, "9": 25, "а": 3, "А": 3, "б": 43, "Б": 43, "в": 2, "В": 2, "г": 32, "Г": 32, "д": 37, "Д": 37, "е": 17, "Е": 17, "ё": 42, "Ё": 42, "ж": 41, "Ж": 41, "з": 35, "З": 35, "и": 11, "И": 11, "й": 12, "Й": 12, "к": 15, "К": 15, "л": 40, "Л": 40, "м": 9, "М": 9, "н": 16, "Н": 16, "о": 38, "О": 38, "п": 5, "П": 5, "р": 4, "Р": 4, "с": 8, "С": 8, "т": 45, "Т": 45, "у": 14, "У": 14, "ф": 0, "Ф": 0, "х": 33, "Х": 33, "ц": 13, "Ц": 13, "ч": 7, "Ч": 7, "ш": 34, "Ш": 34, "щ": 31, "Щ": 31, "ъ": 30, "Ъ": 30, "ы": 1, "Ы": 1, "ь": 46, "Ь": 46, "э": 39, "Э": 39, "ю": 47, "Ю": 47, "я": 6, "Я": 6, "№": 20 };
const LAYOUT = { en: EN, ru: RU };

// две схемы кодирования (CANDLE_COLOR=rank|conf, по умолчанию rank):
//   rank — цвет = ранг кандидата (зелёный / янтарь / циан: видно, какой это ранг),
//          яркость внутри семьи = вероятность;
//   conf — цвет = уверенность модели (синий «гадаю» → белый «знаю»), яркость = ранг.
// Ранги 2 и 3 при схеме conf совпадают оттенком в 79% случаев (медиана разницы 4°),
// поэтому дефолт — rank: три кандидата читаются как три разных цвета.
const FAMILY = [
  [[0, [0, 0, 0]], [0.5, [40, 220, 110]], [1, [225, 255, 225]]],   // ранг 1 — зелёный
  [[0, [0, 0, 0]], [0.5, [235, 140, 20]], [1, [255, 215, 150]]],  // ранг 2 — янтарь
  [[0, [0, 0, 0]], [0.5, [0, 150, 220]], [1, [160, 220, 255]]],   // ранг 3 — циан
];
const CONF = [[0, [8, 16, 60]], [0.25, [0, 80, 200]], [0.45, [0, 180, 210]], [0.62, [40, 220, 110]], [0.8, [235, 200, 40]], [1, [255, 245, 225]]];
const RANK = [1, 0.7, 0.45];
const SHOWN = p => Math.pow(p, 0.4);   // p тоже жмётся к нулю, но мягче корня: ранг-1 46% → 0.73, ранг-3 6% → 0.33
const COLOR = process.env.CANDLE_COLOR === "conf" ? "conf" : "rank";
const colorOf = (p, rank) => COLOR === "conf"
  ? grad(CONF, Math.sqrt(p)).map(v => v * RANK[rank])
  : grad(FAMILY[rank], SHOWN(p));

function grad(stops, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++)
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], k = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  return [...stops[stops.length - 1][1]];
}

const rgbHex = c => "#" + c.map(v => Math.round(Math.min(255, v)).toString(16).padStart(2, "0")).join("");

// --- модель ---
const ARG = process.argv[2] || "";
const DRY = ARG === "--dry";
const KEYCHECK = ARG === "--keycheck";
const WATCH = ARG === "--watch";
const MIRROR = process.argv.includes("--mirror");      // страница-зеркало: свечение + логи предикта
const MODEL = path.join(__dirname, ARG && !ARG.startsWith("--") ? ARG : "sft.onnx");
const DEBUG = !!process.env.CANDLE_DEBUG || WATCH;

let sess = null, stoi = null, itos = [], V = 0, layout = "ru";

async function boot() {
  stoi = JSON.parse(fs.readFileSync(path.join(__dirname, "corpus/vocab.json"), "utf8"));
  itos = [];
  for (const [c, i] of Object.entries(stoi)) itos[i] = c;
  V = itos.length;
  sess = await ort.InferenceSession.create(MODEL);
}

async function infer(chars) {
  const T = chars.length;
  const ids = BigInt64Array.from(chars, c => BigInt(stoi[c] ?? 0));
  const pos = BigInt64Array.from({ length: T }, (_, i) => BigInt(i));
  const mask = new Float32Array(T * T);
  for (let i = 0; i < T; i++) for (let j = 0; j < T; j++) mask[i * T + j] = j <= i ? 0 : -Infinity;
  const out = await sess.run({
    ids: new ort.Tensor("int64", ids, [1, T]),
    pos: new ort.Tensor("int64", pos, [T]),
    mask: new ort.Tensor("float32", mask, [T, T]),
  });
  const row = out.logits.data.subarray((T - 1) * V, T * V);
  let m = -Infinity;
  for (const x of row) if (x > m) m = x;
  const ex = Float64Array.from(row, x => Math.exp(x - m));
  let sum = 0;
  for (const x of ex) sum += x;
  return { ex, sum };
}

function slotOf(ch) {
  const table = LAYOUT[layout];
  const other = LAYOUT[layout === "ru" ? "en" : "ru"];
  const vkey = table[ch] ?? other[ch];
  if (vkey === undefined) return undefined;
  return VKEY2LED[vkey];
}

// кандидаты для подсветки: топ по вероятности, без служебных (перенос строки, <unk>, без клавиши)
function topCandidates(ex, sum) {
  const order = [...ex.keys()].sort((a, b) => ex[b] - ex[a]).slice(0, CANDIDATES);
  const out = [];
  for (const i of order) {
    const ch = itos[i];
    if (ch === "\n" || ch === "<unk>") continue;
    const slot = slotOf(ch);
    if (slot === undefined) continue;
    out.push({ ch, p: ex[i] / sum, slot });
    if (out.length === SHOW) break;
  }
  return out;
}

async function predictNext(chars) {
  const { ex, sum } = await infer(chars);
  return topCandidates(ex, sum);
}

// пересчёт на каждое нажатие: ответы могут прийти не в том порядке — берём только последний
let seqNo = 0;
async function refreshPredict() {
  if (!ctx.length) { predict = []; return; }
  const t0 = process.hrtime.bigint();
  const seq = ++seqNo;
  const cand = await predictNext(ctx.slice(-CTX));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (seq !== seqNo) return;
  predict = cand.map((c, rank) => ({ ...c, col: colorOf(c.p, rank) }));
  if (MIRROR) mirror.pred({
    ms, layout, ctx: ctx.join(""),
    cands: predict.map((c, rank) => ({ ch: c.ch, p: c.p, rank, slot: c.slot, hex: rgbHex(c.col) })),
  });
  if (DEBUG) console.log(`  ${JSON.stringify(ctx.slice(-10).join(""))} → ` + cand.map((c, r) => `[${r + 1}] ${JSON.stringify(c.ch)} ${(c.p * 100).toFixed(0)}% слот ${c.slot}`).join("  ") + `  (${ms.toFixed(1)}мс)`);
}

// --- HID ---
function feature(p) {
  const o = Buffer.alloc(TOTAL); o[0] = REPORT_ID;
  Buffer.from(p).copy(o, 1);
  DEV.sendFeatureReport(o);
}
function getPerf() {
  const p = Buffer.alloc(519); p[0] = 0x84; p[3] = 1; p[5] = 0x80;
  feature(p);
  return Buffer.from(DEV.getFeatureReport(REPORT_ID, TOTAL)).slice(2, 136);
}
let DEV = null;

// гасим оверлей: в режиме 11 кадр держится сам, без этого после выхода клава останется с замороженной свечкой
function blank() {
  if (!DEV) return;
  const out = Buffer.alloc(TOTAL);
  out[0] = REPORT_ID;
  out[1] = 0x08; out[2] = 0; out[3] = 0; out[4] = 1; out[5] = 0; out[6] = 0x7A; out[7] = 1;
  try { DEV.sendFeatureReport(out); } catch (e) { console.error("blank:", e.message); }
}

// --- состояние ---
let ctx = [];
let predict = [];                                        // [{ch, p, slot, col}]
const ripple = Array.from({ length: LEDS }, () => [0, 0, 0]);
let lastKey = Date.now();

// --- границы сегментов ---
// Контекст не тянется через границы: замер на этом корпусе — начала сообщений предсказываются
// top-3 72.5% с одним '\n' против 69.3% с 256 символами прошлого сообщения (прошлое скорее мешает).
// Enter: оставляем '\n' (модель училась на сообщениях через перенос — это её родной старт сообщения).
// Смена приложения: пусто, там шва нет вообще.
function resetCtx(seed, why) {
  ctx = seed;
  predict = [];
  seqNo++;                                   // ответ, посчитанный по старому контексту, уже не нужен
  if (DEBUG) console.log(`  граница (${why}): контекст ${seed.length ? JSON.stringify(seed.join("")) : "пуст"}`);
}

let frontApp = null, pendingApp = null;
function pollApp() {
  execFile(process.env.APPINFO_BIN || "lsappinfo", ["front"], { timeout: 1500 }, (e, out) => {
    if (e) return;
    const id = out.trim();
    if (!id) return;
    if (frontApp === null) { frontApp = id; return; }   // первый поллинг — просто запоминаем
    if (id === frontApp) { pendingApp = null; return; }
    if (id !== pendingApp) { pendingApp = id; return; }  // смена подтверждается вторым поллингом:
    frontApp = id;                                       // транзитный ASN (диалог, Dock) контекст не рвёт
    pendingApp = null;
    resetCtx([], `смена приложения ${id}`);
  });
}

function onKey(code, ch, mod) {
  if (mod & 3) return;                                   // cmd/ctrl — шорткаты, не текст
  if (code === 51) ctx.pop();                            // backspace
  else if (code === 36) resetCtx(["\n"], "Enter");          // конец сообщения — режем
  else if (ch) {
    if (/^[а-яё]$/i.test(ch)) layout = "ru";
    else if (/^[a-z]$/i.test(ch)) layout = "en";
    ctx.push(ch);
  } else return;
  if (ctx.length > CTX) ctx.splice(0, ctx.length - CTX);
  refreshPredict();
  const s = VKEY2LED[code];
  if (s !== undefined) ripple[s] = [...SPLASH];
  if (MIRROR) mirror.key({ slot: s ?? null, ch, mod, layout });
  lastKey = Date.now();
}

// строки keytap → нажатия (модификатор срезаем с конца, как в keylog.cjs: иначе символ 'M' съедается)
function feedTap(text) {
  for (const raw of text.split("\n")) {
    if (!raw.startsWith("KEY:")) continue;
    let line = raw;
    const mm = / M:(\d+)$/.exec(line);
    const mod = mm ? +mm[1] : 0;
    if (mm) line = line.slice(0, mm.index);
    const km = /^KEY:(\d+)(?: (.*))?$/.exec(line);
    if (km) onKey(+km[1], km[2] || "", mod);
  }
}

function frame() {
  const now = Date.now();
  if (now - lastKey > IDLE_MS) for (const p of predict) p.col = p.col.map(v => v * 0.94);
  const out = Buffer.alloc(TOTAL);
  out[0] = REPORT_ID;
  out[1] = 0x08; out[2] = 0; out[3] = 0; out[4] = 1; out[5] = 0; out[6] = 0x7A; out[7] = 1;
  for (let s = 0; s < LEDS; s++) {
    let [r, g, b] = s < KEYS ? BASE : [0, 0, 0];
    const rp = ripple[s];
    r = Math.max(r, rp[0]); g = Math.max(g, rp[1]); b = Math.max(b, rp[2]);
    for (let k = 0; k < 3; k++) { rp[k] *= DECAY; if (rp[k] < 1) rp[k] = 0; }
    for (const p of predict) if (p.slot === s) { r = Math.max(r, p.col[0]); g = Math.max(g, p.col[1]); b = Math.max(b, p.col[2]); }
    out[8 + s * 3] = Math.round(Math.min(255, r));
    out[9 + s * 3] = Math.round(Math.min(255, g));
    out[10 + s * 3] = Math.round(Math.min(255, b));
  }
  if (MIRROR) mirror.frame(out);
  try { DEV.sendFeatureReport(out); } catch (e) { console.error("send:", e.message); }
}

// --- режимы ---
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function dryMode() {
  const file = process.argv[3] || "corpus/tg.txt";
  const text = fs.readFileSync(path.join(__dirname, file), "utf8");
  const chars = [...text].slice(0, 400).filter(c => c !== "\r");
  const show = s => (s === " " ? "␣" : s === "\n" ? "⏎" : s);
  let n = 0;
  for (let i = 1; i < chars.length && n < 25; i++) {
    const probe = chars.slice(0, i);
    const tail = probe.slice(-12).join("").replace(/\n/g, "⏎");
    const t0 = process.hrtime.bigint();
    const { ex, sum } = await infer(probe.slice(-CTX));
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const top = topCandidates(ex, sum);
    const hex = c => "#" + c.map(v => Math.round(Math.min(255, v)).toString(16).padStart(2, "0")).join("");
    console.log(`${tail.padEnd(14)} → ` + top.map((c, r) => `[${r + 1}] ${show(c.ch)} ${(c.p * 100).toFixed(0)}% слот ${c.slot} ${hex(colorOf(c.p, r))}`).join("  ") + `   (${ms.toFixed(1)}мс)`);
    if (++n >= 25) break;
  }
  // карта: что вообще можно подсветить
  const mapped = itos.filter(c => slotOf(c) !== undefined);
  const unmapped = itos.filter(c => c !== "<unk>" && slotOf(c) === undefined);
  console.log(`\nкарта: ${mapped.length}/${itos.length} символов словаря попадают на клавишу`);
  console.log("без клавиши: " + unmapped.map(c => JSON.stringify(c)).join(" "));
}

async function keyCheck() {
  const list = [["-", 27], ["ё", 42], ["[", 33], ["]", 30], [";", 41], ["'", 39], ["`", 50], ["=", 24], ["пробел", 49], ["Enter", 36]];
  const cfg0 = getPerf();
  const sp = Buffer.alloc(135); sp[0] = 0x04;
  const on = Buffer.from(cfg0); on[38] = 0; on[39] = 11; on.copy(sp, 1); feature(sp);
  for (const [name, vkey] of list) {
    const slot = VKEY2LED[vkey];
    console.log(`должна загореться клавиша ${name}  (vkey ${vkey} → слот ${slot})${slot === undefined ? " — СЛОТ НЕИЗВЕСТЕН" : ""}`);
    if (slot !== undefined) {
      const out = Buffer.alloc(TOTAL);
      out[0] = REPORT_ID;
      out[1] = 0x08; out[2] = 0; out[3] = 0; out[4] = 1; out[5] = 0; out[6] = 0x7A; out[7] = 1;
      for (let s = 0; s < LEDS; s++) {
        const lit = s === slot ? 255 : 0;
        out[8 + s * 3] = lit; out[9 + s * 3] = lit; out[10 + s * 3] = lit;
      }
      DEV.sendFeatureReport(out);
    }
    await sleep(1300);
  }
  blank();
  cfg0.copy(sp, 1); feature(sp);
  DEV.close();
  console.log("готово. Скажи, какие клавиши загорелись не там, где обещано.");
}

function shutdown(tap, cfg0) {
  try { if (tap) tap.kill("SIGKILL"); } catch {}
  const mark = t => DEBUG && console.error(`shutdown[${Date.now() % 1000000}] ${t}`);
  mark("гашу кадр"); blank();
  if (cfg0) {
    const b = Buffer.alloc(135); b[0] = 0x04; cfg0.copy(b, 1);
    mark("возвращаю режим");
    try { feature(b); } catch {}
  }
  mark("закрываю HID");
  try { if (DEV) DEV.close(); } catch {}
  mark("выход");
  process.exit(0);
}

async function main() {
  // HID открывается эксклюзивно (второй процесс получит «exclusive access»), поэтому читающие
  // режимы (--dry, --watch) вообще не трогают устройство и работают при занятой клаве
  if (!DRY && !WATCH) {
    const found = hid.devices().find(d => d.vendorId === VID && d.productId === PID && d.usagePage === 0xff00);
    if (!found) { console.error("клава не найдена (USB, usagePage 0xff00)"); process.exit(1); }
    DEV = new hid.HID(found.path);
  }
  await boot();
  console.log(`свечка: модель ${path.basename(MODEL)}, словарь ${V} символов`);

  if (MIRROR) mirror.start({ model: path.basename(MODEL), fps: FPS });
  if (KEYCHECK) return keyCheck();
  if (DRY) return dryMode();

  const tap = spawn(process.env.KEYTAP_BIN || path.join(__dirname, "keytap"));
  tap.stdout.on("data", d => feedTap(d.toString()));
  tap.stderr.on("data", d => console.error(String(d).trim()));
  pollApp();
  setInterval(pollApp, 1000);

  if (WATCH) {
    process.on("SIGINT", () => shutdown(tap, null));
    process.on("SIGTERM", () => shutdown(tap, null));
    process.on("exit", () => { try { tap.kill("SIGKILL"); } catch {} });
    console.log("watch: печатай — предсказания идут в терминал, клаву не трогаю. Ctrl+C — выход.");
    return;
  }

  const cfg0 = getPerf();
  const sp = Buffer.alloc(135); sp[0] = 0x04;
  const on = Buffer.from(cfg0); on[38] = 0; on[39] = 11; on.copy(sp, 1); feature(sp);
  process.on("SIGINT", () => shutdown(tap, cfg0));
  process.on("SIGTERM", () => shutdown(tap, cfg0));
  process.on("exit", () => { try { tap.kill("SIGKILL"); } catch {} });
  console.log("печатай: цвет = ранг кандидата (зелёный/янтарь/циан), яркость = вероятность. Ctrl+C — выход.");
  setInterval(frame, 1000 / FPS);
}

main().catch(e => {
  console.error("не завелось:", e.message);
  if (/busy|exclusive|IOHIDOpenUserClient/i.test(e.message))
    console.error("клавиатуру держит другой процесс (старый candle/lamp/драйвер) — останови его и запусти снова.");
  process.exit(1);
});
