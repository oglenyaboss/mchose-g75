// Реалтайм-риппл: нажатая клавиша вспыхивает и гаснет шлейфом.
// Канал 0x08 (музыкальный оверлей) + lightMode 11 — не блокирует опрос матрицы,
// печать не лагает (проверено руками 2026-09-09 на 25fps).
// Запуск: node ripple.cjs
const { spawn, execSync } = require("child_process");
const hid = require("node-hid");
const VID = 0x258a, PID = 0x010c, REPORT_ID = 6, TOTAL = 520, LEDS = 126;
const FPS = 25;
const DECAY = 0.82;          // затухание за кадр
const SPLASH = [120, 220, 255]; // цвет вспышки (голубой лёд)
const BASE = [10, 8, 14];    // фон

// vkey -> позиция в DIY keyList (как в predict.cjs);
// музыкальная таблица 0x08 сдвинута на -1: слот = keyList - 1 (Esc keyList 0 -> слот 125).
// мапа 0x08 совпадает с keyList (слот = позиция; калибровка радугой 2026-09-09: Esc красный=слот0, Space зелёный=слот35, Enter/стрелки синие=75-90).
const VKEY2LED = {
  0: 9, 1: 15, 2: 21, 3: 27, 4: 39, 5: 33, 6: 10, 7: 16, 8: 22, 9: 28, 11: 34,
  12: 8, 13: 14, 14: 20, 15: 26, 16: 38, 17: 32,
  18: 7, 19: 13, 20: 19, 21: 25, 22: 37, 23: 31, 25: 55, 26: 43, 28: 49, 29: 61,
  31: 56, 32: 44, 34: 50, 35: 62, 36: 81, 37: 57, 38: 45, 40: 51, 43: 52, 44: 64,
  45: 40, 46: 46, 47: 58, 49: 35, 53: 0, 48: 2,
};
const toSlot = idx => idx;

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

// состояние LED: [r,g,b] float
const led = Array.from({ length: LEDS }, () => [...BASE]);

function sendFrame() {
  const out = Buffer.alloc(TOTAL);
  out[0] = REPORT_ID;
  out[1] = 0x08; out[2] = 0; out[3] = 0; out[4] = 1; out[5] = 0; out[6] = 0x7A; out[7] = 1;
  for (let i = 0; i < LEDS; i++) {
    led[i][0] = Math.max(BASE[0], led[i][0] * DECAY);
    led[i][1] = Math.max(BASE[1], led[i][1] * DECAY);
    led[i][2] = Math.max(BASE[2], led[i][2] * DECAY);
    out[8 + i * 3] = Math.round(led[i][0]);
    out[9 + i * 3] = Math.round(led[i][1]);
    out[10 + i * 3] = Math.round(led[i][2]);
  }
  try { dev.sendFeatureReport(out); } catch (e) { console.error("send:", e.message); }
}

function onKey(code) {
  const idx = VKEY2LED[code];
  if (idx === undefined) return;
  const s = toSlot(idx);
  led[s] = [...SPLASH];
  // лёгкий подсвет соседей для шлейфа
  if (s > 0) led[s - 1] = led[s - 1].map((v, k) => Math.max(v, SPLASH[k] * 0.25));
}

// --- keytap lifecycle (как в predict.cjs) ---
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

// включить режим музыки и погнать
const cfg = getPerf(); cfg[38] = 0; cfg[39] = 11;
const sp = Buffer.alloc(135); sp[0] = 0x04; cfg.copy(sp, 1);
feature(sp);
console.log("Риалтайм-риппл: печатай. Ctrl+C — выход (вернёт постоянный режим).");
setInterval(sendFrame, 1000 / FPS);
