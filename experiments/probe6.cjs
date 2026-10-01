const hid = require("node-hid");
const crypto = require("crypto");
const VID=0x258a, PID=0x010c, RID=6, TOTAL=520;
const path = hid.devices().find(d=>d.vendorId===VID&&d.productId===PID&&d.usagePage===0xff00)?.path;
const dev = new hid.HID(path);
function read(cmd) {
  const out = Buffer.alloc(TOTAL); out[0]=RID; out[1]=cmd;
  out[6]=0x00; out[7]=0x02;
  dev.sendFeatureReport(out);
  return Buffer.from(dev.getFeatureReport(RID, TOTAL)).subarray(8); // data only
}
const N=200;
const hashes=[];
for (let i=0;i<N;i++){
  const d=read(0x9d);
  hashes.push(crypto.createHash('md5').update(d).digest('hex').slice(0,12));
}
// ищем повторение первого блока позже
const first=hashes[0];
const repeats=hashes.map((h,i)=>[h,i]).filter(([h,i])=>h===first&&i>0).map(([,i])=>i);
console.log("block0 hash:",first,"repeats at:",repeats);
const uniq=new Set(hashes).size;
console.log(`unique blocks: ${uniq}/${N}`);
console.log("hashes:", hashes.slice(0,20).join(' '));
dev.close();
