// BT-лампа: риплл на нажатия через беспроводной музыкальный канал (report 0x13, cmd 0x88 RLE).
// Нажатия берутся прямо из input-отчётов клавы — keytap и Accessibility не нужны.
// BT HID держит bluetoothd, поэтому root:  sudo node btlamp.cjs
// Выход Ctrl+C: гасит оверлей.
const hid = require("node-hid");
const VID = 0x3554, PID = 0xfa07, RID = 0x13, FPS = 25, KEYS = 96, CHUNK = 14, Q = 8;

// HID usage → позиция keyList G75 Pro (82 клавиши; Fn по HID не передаётся)
const USAGE2LED = {
  0x29: 0, 0x35: 1, 0x2b: 2, 0x39: 3, 0xe1: 4, 0xe0: 5, 0x3a: 6, 0x1e: 7, 0x14: 8, 0x04: 9,
  0x1d: 10, 0xe3: 11, 0x3b: 12, 0x1f: 13, 0x1a: 14, 0x16: 15, 0x1b: 16, 0xe2: 17, 0x3c: 18,
  0x20: 19, 0x08: 20, 0x07: 21, 0x06: 22, 0x3d: 24, 0x21: 25, 0x15: 26, 0x09: 27, 0x19: 28,
  0x3e: 30, 0x22: 31, 0x17: 32, 0x0a: 33, 0x05: 34, 0x2c: 35, 0x3f: 36, 0x23: 37, 0x1c: 38,
  0x0b: 39, 0x11: 40, 0x40: 42, 0x24: 43, 0x18: 44, 0x0d: 45, 0x10: 46, 0x41: 48, 0x25: 49,
  0x0c: 50, 0x0e: 51, 0x36: 52, 0x42: 54, 0x26: 55, 0x12: 56, 0x0f: 57, 0x37: 58, 0xe4: 59,
  0x43: 60, 0x27: 61, 0x13: 62, 0x33: 63, 0x38: 64, 0x44: 66, 0x2d: 67, 0x2f: 68, 0x34: 69,
  0x45: 72, 0x2e: 73, 0x30: 74, 0x49: 78, 0x2a: 79, 0x31: 80, 0x28: 81, 0xe5: 82, 0x50: 83,
  0x52: 88, 0x51: 89, 0x4c: 90, 0x4a: 91, 0x4b: 92, 0x4e: 93, 0x4d: 94, 0x4f: 95,
};
const MODS = [0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7];   // биты байта модификаторов

const d = hid.devices().find(x => x.vendorId === VID && x.productId === PID && x.usagePage === 0xff02);
if (!d) { console.error("BT-клава не найдена (usagePage 0xff02)"); process.exit(1); }
const dev = new hid.HID(d.path);

function mk(cmd, seq, total, yy, data = []) {
  const p = [cmd, total, seq, yy, ...data];
  while (p.length < 19) p.push(0);
  let sum = RID;
  for (const b of p) sum += b;
  return Buffer.from([RID, ...p.slice(0, 18), sum & 0xff]);
}

// музыкальный кадр: группы [r,g,b,[positions]] → чанки по 14 байт
let chunks = 0, writeMs = 0;
function frame(groups) {
  const data = groups.flatMap(([r, g, b, pos]) => [r, g, b, pos.length, ...pos]);
  if (!data.length) return 0;
  const total = Math.ceil(data.length / CHUNK);
  const t0 = process.hrtime.bigint();
  for (let c = 0; c < total; c++) {
    const part = data.slice(c * CHUNK, c * CHUNK + CHUNK);
    while (part.length < CHUNK) part.push(0);
    let last = -1;
    part.forEach((v, i) => { if (v) last = i; });
    dev.write(mk(0x88, c, total, 0x10 + last + 1, part));
  }
  chunks += total;
  writeMs += Number(process.hrtime.bigint() - t0) / 1e6;
  return total;
}

// --- состояние ---
const target = Array.from({ length: KEYS }, () => [0, 0, 0]);   // цвет, который хотим показать
const sent = Array.from({ length: KEYS }, () => [-1, -1, -1]);  // что уже улетело в клаву
const ripple = Array.from({ length: KEYS }, () => [0, 0, 0]);   // вспышка, decay 0.82/кадр
const warm = new Float32Array(KEYS);                            // грелка, остывает минуты
const stamps = [];
let wpm = 0, keys = 0;

function grad(stops, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++)
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], k = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  return [...stops[stops.length - 1][1]];
}
const WPMC = t => grad([[0, [70, 150, 255]], [0.5, [255, 110, 50]], [1, [255, 255, 235]]], t);
const HEAT = t => grad([[0, [0, 0, 0]], [0.35, [120, 20, 2]], [0.7, [220, 90, 15]], [1, [255, 190, 90]]], t);

// --- нажатия из input-отчётов ---
const held = new Set();
dev.on("data", b => {
  if (b[0] !== 0x01) return;                       // boot keyboard: [RID,mods,res,6 кодов]
  const now = Date.now();
  const cur = new Set();
  for (let i = 0; i < 8; i++) if (b[1] & (1 << i)) cur.add(MODS[i]);
  for (let i = 3; i < 9 && b[i]; i++) cur.add(b[i]);
  for (const code of cur) if (!held.has(code)) onKey(code, now);
  for (const code of held) if (!cur.has(code)) held.delete(code);
  for (const code of cur) held.add(code);
});
dev.on("error", e => console.error("err:", e.message));

function onKey(code, now) {
  const s = USAGE2LED[code];
  if (s === undefined) return;
  keys++;
  stamps.push(now);
  const t = Math.max(0, Math.min(1, (wpm - 10) / 50));
  const splash = WPMC(t).map(v => 40 + v * 0.8);
  ripple[s] = [...splash];
  warm[s] = Math.min(1, warm[s] + 0.3);
}

// --- кадр: считаем цель, шлём только дельту, сгруппированную по цвету ---
function tick() {
  const now = Date.now();
  while (stamps.length && stamps[0] < now - 12000) stamps.shift();
  wpm += (stamps.length - wpm) * 0.2;

  const changed = new Map();                        // "r,g,b" → [позиции]
  for (let s = 0; s < KEYS; s++) {
    const rp = ripple[s], w = warm[s];
    const hc = w > 0.01 ? HEAT(w) : [0, 0, 0];
    for (let k = 0; k < 3; k++) target[s][k] = Math.round(Math.max(hc[k], rp[k]) / Q) * Q;
    for (let k = 0; k < 3; k++) { rp[k] *= 0.82; if (rp[k] < 1) rp[k] = 0; }
    warm[s] *= 0.9992;
    if (target[s][0] !== sent[s][0] || target[s][1] !== sent[s][1] || target[s][2] !== sent[s][2]) {
      const key = target[s].join(",");
      if (!changed.has(key)) changed.set(key, []);
      changed.get(key).push(s);
    }
  }
  if (changed.size) {
    frame([...changed].map(([key, pos]) => [...key.split(",").map(Number), pos]));
    for (const [, pos] of changed) for (const s of pos) sent[s] = [...target[s]];
  }
}

function shutdown() {
  try { frame([[0, 0, 0, Array.from({ length: KEYS }, (_, i) => i)]]); } catch {}
  try { dev.close(); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

frame([[0, 0, 0, Array.from({ length: KEYS }, (_, i) => i)]]);   // сброс оверлея
console.log("BT-лампа: риплл + грелка, дельта-стрим. Ctrl+C — выход.");
setInterval(tick, 1000 / FPS);
setInterval(() => {
  console.log(`нажатий ${keys} | wpm ${wpm.toFixed(0)} | чанков ${chunks} (${(chunks / 5).toFixed(1)}/с) | write ${writeMs.toFixed(0)}мс/5с`);
  chunks = 0; writeMs = 0;
}, 5000);
