(async()=>{
// G75 Pro: switch to custom light mode (21) + paint test LEDs via setDiyLight
const hid = require("node-hid");
const VID = 0x258a, PID = 0x010c;
const REPORT_ID = 6, TOTAL = 520;

const dev = new hid.HID(
  hid.devices().find(d => d.vendorId === VID && d.productId === PID && d.usagePage === 0xff00).path
);

function feature(payload) {
  // payload -> feature report: [id, ...payload, zeros to 520]
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
  return r.slice(2, 2 + 134); // 134-byte config
}

// 1. read config, set lightMode = 21 (custom), lightType = 0
const cfg = getPerformance();
console.log("before: lightType:", cfg[38], "lightMode:", cfg[39]);
cfg[38] = 0;
cfg[39] = 21;

const setP = Buffer.alloc(1 + 134);
setP[0] = 0x04;
cfg.copy(setP, 1);
feature(setP);
await new Promise(r => setTimeout(r, 100));

const cfg2 = getPerformance();
console.log("after:  lightType:", cfg2[38], "lightMode:", cfg2[39]);

// 2. DIY frame: [0x06, pre(6), rTable(126), gTable(126), bTable(126)]
const KEY = { Esc: 0, Q: 8, Space: 35, Enter: 81 };
const rT = Buffer.alloc(126), gT = Buffer.alloc(126), bT = Buffer.alloc(126);
rT[KEY.Esc] = 255;                                  // Esc = red
gT[KEY.Q] = 255;                                    // Q = green
bT[KEY.Space] = 255;                                // Space = blue
gT[KEY.Enter] = 255; bT[KEY.Enter] = 60;            // Enter = teal

const diy = Buffer.concat([
  Buffer.from([0x06, 0, 0, 1, 0, 128, 1]), // command + pre (как в дровах)
  rT, gT, bT,
]);
const diyPadded = Buffer.concat([diy, Buffer.alloc(519 - diy.length)]);
feature(diyPadded);
await new Promise(r => setTimeout(r, 200));

// 3. read back DIY to confirm
const getDiy = Buffer.alloc(519);
getDiy[0] = 0x86; getDiy[3] = 0x01; getDiy[5] = 0x7a; getDiy[6] = 0x01;
feature(getDiy);
const back = Buffer.from(dev.getFeatureReport(REPORT_ID, TOTAL));
const rb = back.slice(2); // skip [id, 0x86]
console.log("DIY rTable[0..8]:", Array.from(rb.slice(7, 16)).join(","));
console.log("DIY gTable[0..8]:", Array.from(rb.slice(7 + 126, 7 + 126 + 9)).join(","));
console.log("DIY bTable[0..8]:", Array.from(rb.slice(7 + 252, 7 + 252 + 9)).join(","));

dev.close();
console.log("done — смотри на клавиатуру: Esc=красный, Q=зелёный, Space=синий, Enter=бирюзовый");

})();