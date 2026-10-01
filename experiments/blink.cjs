// Тест live-repaint: альтернируем кадры DIY каждые 700мс
const hid = require("node-hid");
const VID = 0x258a, PID = 0x010c, REPORT_ID = 6, TOTAL = 520;

const dev = new hid.HID(
  hid.devices().find(d => d.vendorId === VID && d.productId === PID && d.usagePage === 0xff00).path
);

function feature(payload) {
  const out = Buffer.alloc(TOTAL);
  out[0] = REPORT_ID;
  Buffer.from(payload).copy(out, 1);
  dev.sendFeatureReport(out);
}

function paint(ledIndex, r, g, b) {
  const rT = Buffer.alloc(126), gT = Buffer.alloc(126), bT = Buffer.alloc(126);
  rT[ledIndex] = r; gT[ledIndex] = g; bT[ledIndex] = b;
  const body = Buffer.concat([Buffer.from([0x06, 0, 0, 1, 0, 128, 1]), rT, gT, bT]);
  feature(Buffer.concat([body, Buffer.alloc(519 - body.length)]));
}

const frames = [[255, 0, 0], [0, 0, 255], [255, 0, 0], [0, 255, 0]];
let i = 0;
console.log("blink Esc 4s...");
const t = setInterval(() => {
  paint(0, ...frames[i % frames.length]);
  if (++i >= frames.length) { clearInterval(t); dev.close(); console.log("done"); }
}, 1000);
