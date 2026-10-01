// Лампа: режимы подсветки поверх канала 0x08 (lightMode 11), 25fps, печать не лагает.
//   node lamp.cjs auto  — live-слой (риплл от скорости + грелка + индикатор раскладки),
//                          при 15с простоя плавно перетекает в огонь, нажатие возвращает
//   node lamp.cjs fire  — только огонь
//   node lamp.cjs live  — только live-слой
// Выход Ctrl+C возвращает постоянный режим.
const { spawn, execSync, execFile } = require("child_process");
const hid = require("node-hid");
const VID = 0x258a, PID = 0x010c, REPORT_ID = 6, TOTAL = 520, LEDS = 126;
const KEYS = 96;               // физические клавиши; слоты 96-125 — запас, держим тёмными
const FPS = 25;
const MODE = ["auto", "fire", "live"].includes(process.argv[2]) ? process.argv[2] : "auto";

// vkey -> слот (позиция keyList; калибровка радугой 2026-09-09)
const VKEY2LED = {
  0: 9, 1: 15, 2: 21, 3: 27, 4: 39, 5: 33, 6: 10, 7: 16, 8: 22, 9: 28, 11: 34,
  12: 8, 13: 14, 14: 20, 15: 26, 16: 38, 17: 32,
  18: 7, 19: 13, 20: 19, 21: 25, 22: 37, 23: 31, 25: 55, 26: 43, 28: 49, 29: 61,
  31: 56, 32: 44, 34: 50, 35: 62, 36: 81, 37: 57, 38: 45, 40: 51, 43: 52, 44: 64,
  45: 40, 46: 46, 47: 58, 49: 35, 53: 0, 48: 2,
};

// физическая сетка из порядка keyList: колонками по 6 рядов
const colOf = s => Math.floor(s / 6), rowOf = s => s % 6;

// --- палитры: [t, rgb] стопы, lerp между ними ---
function grad(stops, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++)
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], k = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  return [...stops[stops.length - 1][1]];
}
const FIRE = grad.bind(null, [
  [0, [0, 0, 0]], [0.2, [40, 2, 0]], [0.45, [150, 25, 0]],
  [0.7, [235, 90, 0]], [0.88, [255, 170, 40]], [1, [255, 240, 190]],
]);
const WPMC = grad.bind(null, [[0, [70, 150, 255]], [0.5, [255, 110, 50]], [1, [255, 255, 235]]]);
const HEAT = grad.bind(null, [[0, [0, 0, 0]], [0.35, [120, 20, 2]], [0.7, [220, 90, 15]], [1, [255, 190, 90]]]);
const BASE = { en: [24, 12, 3], ru: [3, 9, 24] };   // фон раскладки
const WAVE = { en: [255, 190, 90], ru: [90, 160, 255] }; // фронт волны при смене

// --- HID ---
const path = hid.devices().find(d => d.vendorId === VID && d.productId === PID && d.usagePage === 0xff00)?.path;
if (!path) { console.error("клава не найдена"); process.exit(1); }
const dev = new hid.HID(path);
function feature(p) {
  const o = Buffer.alloc(TOTAL); o[0] = REPORT_ID;
  Buffer.from(p).copy(o, 1);
  dev.sendFeatureReport(o);
}
function getPerf() {
  const p = Buffer.alloc(519); p[0] = 0x84; p[3] = 1; p[5] = 0x80;
  feature(p);
  return Buffer.from(dev.getFeatureReport(REPORT_ID, TOTAL)).slice(2, 136);
}

// --- состояние ---
const ripple = Array.from({ length: LEDS }, () => [0, 0, 0]); // быстрый слой, decay 0.82/кадр
const warm = new Float32Array(LEDS);                          // грелка, остывает минуты
let layout = null, layoutPrev = null, layoutT = -1e9;         // 'en' | 'ru' + время смены
let lastKey = Date.now();
const stamps = [];                                            // нажатия за окно 12с
let wpm = 0;

// --- огонь: виртуальный буфер 32x30, LED сэмплирует блок 2x5 ---
const VW = 32, VH = 30;
let fire = new Float32Array(VW * VH);
const base = Array.from({ length: VW }, () => 0.8);           // очаги источника, дрейфуют
function stepFire() {
  const next = new Float32Array(VW * VH);
  for (let x = 0; x < VW; x++)
    base[x] = Math.max(0.55, Math.min(1, base[x] + (Math.random() - 0.5) * 0.08));
  for (let x = 0; x < VW; x++) {
    next[(VH - 1) * VW + x] = base[x];
    next[(VH - 2) * VW + x] = base[x] * (0.9 + Math.random() * 0.1);
  }
  for (let y = 0; y < VH - 2; y++)
    for (let x = 0; x < VW; x++) {
      const sx = Math.max(0, Math.min(VW - 1, x + (Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0)));
      const v = (fire[(y + 1) * VW + Math.max(0, sx - 1)] + fire[(y + 1) * VW + sx] + fire[(y + 1) * VW + Math.min(VW - 1, sx + 1)]) / 3;
      next[y * VW + x] = v * (0.955 + Math.random() * 0.02);
    }
  fire = next;
}
const fireAt = (s, now) => {
  const c = colOf(s), r = rowOf(s);
  let v = 0;
  const vx = c * 2, vy = (5 - r) * 5;
  for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 2; dx++) v += fire[(vy + dy) * VW + vx + dx];
  v = v / 10 * 1.15;
  if (r === 5) { // угли: нижний ряд всегда тлеет
    const ember = 0.55 + 0.2 * Math.sin(now * 0.0016 + s * 0.9);
    v = Math.max(v, ember);
  }
  return FIRE(v);
};

// --- раскладка: поллинг HIToolbox 1р/с, смена — волна слева направо ---
function pollLayout() {
  execFile("defaults", ["read", "com.apple.HIToolbox", "AppleCurrentKeyboardLayoutInputSourceID"],
    { timeout: 1500 }, (e, out) => {
      if (e) return;
      const cur = /russian/i.test(out) ? "ru" : "en";
      if (layout && cur !== layout) { layoutPrev = layout; layout = cur; layoutT = Date.now(); }
      else if (!layout) layout = cur;
    });
}
setInterval(pollLayout, 900); pollLayout();

// --- нажатия ---
function onKey(code) {
  const now = lastKey = Date.now();
  stamps.push(now);
  const t = Math.max(0, Math.min(1, (wpm - 10) / 50));
  const splash = WPMC(t).map(v => 30 + v * 0.8); // от лёдяного до белого кала
  const s = VKEY2LED[code];
  if (s !== undefined) {
    ripple[s] = [...splash];
    if (s > 0) ripple[s - 1] = ripple[s - 1].map((v, k) => Math.max(v, splash[k] * 0.25));
    warm[s] = Math.min(1, warm[s] + 0.3);
  }
}

// --- кадр ---
let blend = MODE === "fire" ? 1 : 0; // 0=live, 1=огонь
function frame() {
  const now = Date.now();
  // окно WPM 12с
  while (stamps.length && stamps[0] < now - 12000) stamps.shift();
  wpm += (stamps.length - wpm) * 0.2;

  if (MODE === "auto") {
    const idle = now - lastKey > 15000;
    blend += idle ? 0.012 : -0.09; // в огонь ~3.3с, обратно ~0.4с
    blend = Math.max(0, Math.min(1, blend));
  }
  if (blend > 0.02) stepFire();

  const out = Buffer.alloc(TOTAL);
  out[0] = REPORT_ID;
  out[1] = 0x08; out[2] = 0; out[3] = 0; out[4] = 1; out[5] = 0; out[6] = 0x7A; out[7] = 1;
  for (let s = 0; s < LEDS; s++) {
    let r = 0, g = 0, b = 0;
    if (s < KEYS) {
      // фон раскладки + волна смены
      let bg = BASE[layout || "en"];
      const age = (now - layoutT) / 1000 - colOf(s) * 0.05;
      if (layoutPrev && age < 1.2) { // фронт 0.7с, бегущий по колонкам
        const front = Math.exp(-((age - 0.35) ** 2) / 0.02);
        const gone = Math.max(0, Math.min(1, age / 0.7));
        bg = bg.map((v, k) => v * gone + BASE[layoutPrev][k] * (1 - gone) + WAVE[layout][k] * front * 0.9);
      }
      // грелка с лёгким тлением
      const w = warm[s];
      const hc = w > 0.01 ? HEAT(w).map(v => v * (0.92 + 0.08 * Math.sin(now * 0.003 + s * 1.3))) : [0, 0, 0];
      // риппл
      const rp = ripple[s];
      r = Math.max(bg[0], hc[0], rp[0]); g = Math.max(bg[1], hc[1], rp[1]); b = Math.max(bg[2], hc[2], rp[2]);
      for (let k = 0; k < 3; k++) {
        rp[k] *= 0.82;
        if (rp[k] < 1) rp[k] = 0;
      }
      warm[s] *= 0.9992;
      // огонь поверх (blend)
      if (blend > 0.02) {
        const f = fireAt(s, now).map(v => v * blend);
        r = Math.max(r, f[0]); g = Math.max(g, f[1]); b = Math.max(b, f[2]);
      }
    }
    out[8 + s * 3] = Math.round(r); out[9 + s * 3] = Math.round(g); out[10 + s * 3] = Math.round(b);
  }
  try { dev.sendFeatureReport(out); } catch (e) { console.error("send:", e.message); }
}

// --- keytap lifecycle ---
try { execSync("pkill -x keytap 2>/dev/null"); } catch {}
const tap = spawn(__dirname + "/keytap");
function shutdown() {
  try { tap.kill("SIGKILL"); } catch {}
  const back = getPerf(); back[39] = 1; back[38] = 0;
  const b = Buffer.alloc(135); b[0] = 0x04; back.copy(b, 1);
  try { feature(b); } catch {}
  try { dev.close(); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => { try { tap.kill("SIGKILL"); } catch {} });
tap.stdout.on("data", d => {
  for (const line of d.toString().split("\n"))
    if (line.startsWith("KEY:")) onKey(parseInt(line.slice(4)));
});
tap.stderr.on("data", d => console.error(String(d).trim()));

const cfg = getPerf(); cfg[38] = 0; cfg[39] = 11;
const sp = Buffer.alloc(135); sp[0] = 0x04; cfg.copy(sp, 1);
feature(sp);
console.log(`лампа [${MODE}]: ` + (MODE === "fire" ? "горит огонь"
  : MODE === "live" ? "риплл от скорости, грелка, индикатор раскладки"
  : "печатай — live; замри на 15с — огонь") + ". Ctrl+C — выход.");
setInterval(frame, 1000 / FPS);
