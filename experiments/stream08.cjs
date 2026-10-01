// Тест реалтайма: музыкальный канал 0x08 при lightMode=11 (музыка).
// Запуск: node stream08.cjs [fps] [сек] [mode]
const hid = require("node-hid");
const VID = 0x258a, PID = 0x010c, REPORT_ID = 6, TOTAL = 520;
const LEDS = 126;

const fps = parseInt(process.argv[2] || "25", 10);
const secs = parseInt(process.argv[3] || "20", 10);
const MODE = parseInt(process.argv[4] || "11", 10);

const path = hid.devices().find(d => d.vendorId === VID && d.productId === PID && d.usagePage === 0xff00)?.path;
if (!path) { console.error("клава не найдена"); process.exit(1); }
const dev = new hid.HID(path);

function feature(payload) {
  const out = Buffer.alloc(TOTAL);
  out[0] = REPORT_ID;
  Buffer.from(payload).copy(out, 1);
  dev.sendFeatureReport(out);
}
function getPerformance() {
  const p = Buffer.alloc(519);
  p[0] = 0x84; p[3] = 0x01; p[5] = 0x80;
  feature(p);
  const r = Buffer.from(dev.getFeatureReport(REPORT_ID, TOTAL));
  return r.slice(2, 2 + 134);
}

function frame(t) {
  const out = Buffer.alloc(TOTAL);
  out[0] = REPORT_ID;
  out[1] = 0x08; out[2] = 0; out[3] = 0; out[4] = 1; out[5] = 0; out[6] = 0x7A; out[7] = 1;
  for (let i = 0; i < LEDS; i++) {
    const h = ((t / 8 + i * 8) % 256) / 255;
    const [r, g, b] = hsv(h, 1, 1);
    out[8 + i * 3] = r; out[9 + i * 3] = g; out[10 + i * 3] = b;
  }
  return out;
}
function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const m = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i % 6];
  return m.map(x => Math.round(x * 255));
}

(async () => {
  const cfg = getPerformance();
  console.log(`было: lightType=${cfg[38]} lightMode=${cfg[39]}`);
  cfg[38] = 0; cfg[39] = MODE;
  const setP = Buffer.alloc(1 + 134);
  setP[0] = 0x04; cfg.copy(setP, 1);
  feature(setP);
  await new Promise(r => setTimeout(r, 300));
  const cfg2 = getPerformance();
  console.log(`стало: lightType=${cfg2[38]} lightMode=${cfg2[39]} — если не ${MODE}, режим не встал`);

  const period = Math.max(1000 / fps, 5);
  let t = 0, sent = 0, lagMax = 0, lagSum = 0;
  const t0 = Date.now();
  const iv = setInterval(() => {
    const ts = Date.now();
    try { dev.sendFeatureReport(frame(t++)); sent++; } catch (e) { console.error("send fail:", e.message); }
    const lag = Date.now() - ts;
    lagSum += lag; if (lag > lagMax) lagMax = lag;
    if (Date.now() - t0 > secs * 1000) {
      clearInterval(iv);
      console.log(`done: ${sent} кадров ${fps}fps, send avg=${(lagSum/sent).toFixed(1)}ms max=${lagMax}ms`);
      // вернуть исходный режим
      const back = getPerformance();
      back[39] = 1; back[38] = 0; // постоянный, тихо
      const sp = Buffer.alloc(1 + 134); sp[0] = 0x04; back.copy(sp, 1);
      feature(sp);
      dev.close();
    }
  }, period);
})();
