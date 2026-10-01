const hid = require("node-hid");
const fs = require("fs");
const VID=0x258a, PID=0x010c, RID=6, TOTAL=520;
const path = hid.devices().find(d=>d.vendorId===VID&&d.productId===PID&&d.usagePage===0xff00)?.path;
const dev = new hid.HID(path);
function read9d() {
  const out = Buffer.alloc(TOTAL); out[0]=RID; out[1]=0x9d;
  out[6]=0x00; out[7]=0x02;
  dev.sendFeatureReport(out);
  return Buffer.from(dev.getFeatureReport(RID, TOTAL)).subarray(8, 8+512);
}
const N=1500;
const parts=[];
for (let i=0;i<N;i++) parts.push(read9d());
fs.writeFileSync('stream/big.bin', Buffer.concat(parts));
console.log("collected", N, "blocks");
dev.close();
