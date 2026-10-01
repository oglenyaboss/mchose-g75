const hid = require("node-hid");
const VID=0x258a, PID=0x010c, RID=6, TOTAL=520;
const path = hid.devices().find(d=>d.vendorId===VID&&d.productId===PID&&d.usagePage===0xff00)?.path;
const dev = new hid.HID(path);
function read(cmd, hdr) {
  const out = Buffer.alloc(TOTAL); out[0]=RID; out[1]=cmd;
  hdr.forEach((b,i)=>out[2+i]=b);
  out[6]=0x00; out[7]=0x02; // len 512 LE
  dev.sendFeatureReport(out);
  return Buffer.from(dev.getFeatureReport(RID, TOTAL)).subarray(1,9+32).toString('hex');
}
for (const cmd of [0x89,0x9d,0x9e,0x9f]) {
  console.log(`--- cmd 0x${cmd.toString(16)}`);
  for (const pos of [0,1,2,3]) {
    const z = read(cmd,[0,0,0,0]);
    const f = read(cmd, pos===0?[1,0,0,0]:pos===1?[0,1,0,0]:pos===2?[0,0,1,0]:[0,0,0,1]);
    console.log(`hdr[${pos}] 0->1: ${z===f?'SAME':'DIFF'}  val1=${f}`);
    const g = read(cmd,[0,0,0,0]);
    console.log(`  repeat0 same: ${z===g}`);
  }
}
dev.close();
