// Предикт «топ-3 следующих букв» — РЕАЛТАЙМ на каждое нажатие.
// Канал 0x08 (музыкальный оверлей) + lightMode 11: не блокирует опрос матрицы,
// печать не лагает. Нажатая буква вспыхивает, вероятные следующие подсвечены:
// яркая зелёная = самая вероятная, две тусклые — рангом ниже.
// Запуск: node predict.cjs (клава в USB; keytap должен быть в Accessibility)
const { spawn, execSync } = require("child_process");
const hid = require("node-hid");
const VID = 0x258a, PID = 0x010c, REPORT_ID = 6, TOTAL = 520, LEDS = 126;
const FPS = 25, DECAY = 0.80;

const SPLASH = [110, 200, 255]; // вспышка нажатой
const BASE = [8, 7, 12];        // фон
const P1 = [0, 230, 90];        // ранг 1
const P23 = [0, 110, 55];       // ранги 2-3

// macOS vkey -> LED (позиция keyList)
const VKEY2LED = {
  0: 9, 1: 15, 2: 21, 3: 27, 4: 39, 5: 33, 6: 10, 7: 16, 8: 22, 9: 28, 11: 34,
  12: 8, 13: 14, 14: 20, 15: 26, 16: 38, 17: 32,
  18: 7, 19: 13, 20: 19, 21: 25, 22: 37, 23: 31, 25: 55, 26: 43, 28: 49, 29: 61,
  31: 56, 32: 44, 34: 50, 35: 62, 36: 81, 37: 57, 38: 45, 40: 51, 43: 52, 44: 64,
  45: 40, 46: 46, 47: 58, 49: 35, 53: 0, 48: 2,
};
const VKEY2CHAR = {
  0: "a", 1: "s", 2: "d", 3: "f", 4: "h", 5: "g", 6: "z", 7: "x", 8: "c", 9: "v",
  11: "b", 12: "q", 13: "w", 14: "e", 15: "r", 16: "y", 17: "t",
  18: "1", 19: "2", 20: "3", 21: "4", 22: "6", 23: "5", 25: "9", 26: "7", 28: "8", 29: "0",
  31: "o", 32: "u", 34: "i", 35: "p", 37: "l", 38: "j", 40: "k", 45: "n", 46: "m",
  49: " ",
};
const CHAR2VKEY = {};
for (const [vk, ch] of Object.entries(VKEY2CHAR)) CHAR2VKEY[ch] = +vk;

const TOP3 = {
  a: "lrn", b: "elo", c: "ohe", d: "eio", e: "rns", f: "ori", g: "hea", h: "eao",
  i: "nts", j: "uoa", k: "eni", l: "eyl", m: "eao", n: "gts", o: "nrf", p: "erl",
  q: "uuu", r: "eao", s: "teh", t: "hio", u: "rnt", v: "eio", w: "aen", x: "pie",
  y: "toe", z: "eio",
};

const toSlot = idx => idx; // музыкальная таблица совпадает с keyList (слот = позиция);
// «пробел+F6» в риппле был bleed сплэша на соседа 36, не сдвиг карты

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

const trail = Array.from({ length: LEDS }, () => [...BASE]); // затухающие вспышки
let predict = []; // [[slot, color], ...] — держится до следующего нажатия

function sendFrame() {
  const out = Buffer.alloc(TOTAL);
  out[0] = REPORT_ID;
  out[1] = 0x08; out[2] = 0; out[3] = 0; out[4] = 1; out[5] = 0; out[6] = 0x7A; out[7] = 1;
  for (let i = 0; i < LEDS; i++) {
    trail[i] = trail[i].map(v => Math.max(BASE[0], v * DECAY));
    let [r, g, b] = trail[i];
    for (const [slot, c] of predict) if (slot === i) {
      r = Math.max(r, c[0]); g = Math.max(g, c[1]); b = Math.max(b, c[2]);
    }
    out[8 + i * 3] = Math.round(r); out[9 + i * 3] = Math.round(g); out[10 + i * 3] = Math.round(b);
  }
  try { dev.sendFeatureReport(out); } catch (e) { console.error("send:", e.message); }
}

function onKey(code) {
  const idx = VKEY2LED[code];
  if (idx !== undefined) trail[toSlot(idx)] = [...SPLASH];
  const ch = VKEY2CHAR[code];
  const top = ch && TOP3[ch];
  predict = [];
  if (top) for (let i = 0; i < 3; i++) {
    const vk = CHAR2VKEY[top[i]];
    if (vk !== undefined && VKEY2LED[vk] !== undefined)
      predict.push([toSlot(VKEY2LED[vk]), i === 0 ? P1 : P23]);
  }
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
console.log("Предикт в реалтайме: печатай. Яркая зелёная = следующая буква, тусклые = ранг 2-3. Ctrl+C — выход.");
setInterval(sendFrame, 1000 / FPS);
