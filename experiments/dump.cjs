// Дамп памяти прошивки через read-команды feature report 6.
// Основа: xevrion (AULA F75 = наш 258a:010c) подтвердил, что read-команды
// 0x88/0x89/0x9d/0x9e/0x9f возвращают 8051-машкод из памяти клавиатуры.
// Формат адресации подбираем перебором: header тот же, что у 0x84:
//   [CMD, A0, A1, A2, A3, L0, L1, ...]  (адрес BE 00 00 01 00 = регион конфига)
// Безопасно: только чтение. Запуск: node dump.cjs
const fs = require("fs");
const hid = require("node-hid");

const VID = 0x258a, PID = 0x010c, REPORT_ID = 6, TOTAL = 520;
const READ_CMDS = [0x88, 0x89, 0x9d, 0x9e, 0x9f];
// адреса для перебора: 0, 0x100, 0x1000, 0x8000 и «конфиг» 0x10000 как контроль
const ADDRS = [
  [0x00, 0x00, 0x00, 0x00],
  [0x00, 0x00, 0x10, 0x00],
  [0x00, 0x80, 0x00, 0x00],
  [0x00, 0x00, 0x01, 0x00], // регион конфига (контроль: тут 0x84/0x86 заведомо читаются)
];
const LEN = 0x0200; // 512

function findPath() {
  return hid.devices().find(d => d.vendorId === VID && d.productId === PID && d.usagePage === 0xff00)?.path || null;
}

function main() {
  const path = findPath();
  if (!path) { console.error("клава не найдена (USB?)"); process.exit(1); }
  const dev = new hid.HID(path);
  const out = Buffer.alloc(TOTAL);
  out[0] = REPORT_ID;
  try {
    for (const cmd of READ_CMDS) {
      for (const addr of ADDRS) {
        out.fill(0, 1);
        out[1] = cmd;
        out[2] = addr[0]; out[3] = addr[1]; out[4] = addr[2]; out[5] = addr[3];
        out[6] = LEN & 0xff; out[7] = LEN >> 8;
        let resp = null;
        try {
          dev.sendFeatureReport(out);
          resp = Buffer.from(dev.getFeatureReport(REPORT_ID, TOTAL));
        } catch (e) {
          console.log(`cmd ${cmd.toString(16)} addr ${addr.map(a=>a.toString(16)).join(' ')}: IO error ${e.message}`);
          continue;
        }
        const body = resp.subarray(1);
        const nonzero = body.reduce((s, b) => s + (b !== 0 ? 1 : 0), 0);
        const name = `dump_${cmd.toString(16)}_${addr.map(a=>a.toString(16).padStart(2,'0')).join('')}.bin`;
        fs.writeFileSync(name, body);
        console.log(`cmd 0x${cmd.toString(16)} addr ${addr.map(a=>a.toString(16)).join(' ')}: resp[0..8]=${body.subarray(0,9).toString('hex')} nonzero=${nonzero}/${body.length} -> ${name}`);
      }
    }
  } finally {
    dev.close();
  }
}
main();
