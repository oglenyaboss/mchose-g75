// Разведка BT-канала: открыть HID-over-GATT через node-hid, послушать input,
// спросить батарею (cmd 0x4a) и getPerformance (cmd 0x44). Ничего не красит.
// Запуск: node bt_hello.cjs
const hid = require("node-hid");
const VID = 0x3554, PID = 0xfa07, RID = 0x13;

const d = hid.devices().find(x => x.vendorId === VID && x.productId === PID && x.usagePage === 0xff02);
if (!d) { console.error("BT-клава не найдена (usagePage 0xff02)"); process.exit(1); }
console.log("нашёл:", d.product.trim(), "| path:", d.path);
const dev = new hid.HID(d.path);

const hex = b => [...b].map(x => x.toString(16).padStart(2, "0")).join(" ");
dev.on("data", b => console.log("IN  :", hex(b)));
dev.on("error", e => console.error("err:", e.message));

// пакет: [RID, cmd, total, seq, YY, ...data(<=14), pad, checksum], checksum включает RID
function pkt(cmd, seq, total, yy, data = []) {
  const p = [cmd, total, seq, yy, ...data];
  while (p.length < 19) p.push(0);
  let sum = RID;
  for (const b of p) sum += b;
  const buf = Buffer.from([RID, ...p.slice(0, 18), sum & 0xff]);
  console.log("OUT :", hex(buf));
  try { dev.write(buf); } catch (e) { console.error("write failed:", e.message); }
}

setTimeout(() => pkt(0x4a, 0, 1, 0x00), 300);          // getBattery
setTimeout(() => pkt(0x44, 0, 1, 0x00), 1500);         // getPerformance
setTimeout(() => { console.log("done"); try { dev.close(); } catch {} process.exit(0); }, 3500);
