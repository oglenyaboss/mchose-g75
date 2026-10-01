const hid = require("node-hid");
const VID=0x258a, PID=0x010c, RID=6, TOTAL=520;
const path = hid.devices().find(d=>d.vendorId===VID&&d.productId===PID&&d.usagePage===0xff00)?.path;
const dev = new hid.HID(path);
function read(cmd, hdr) {
  const out = Buffer.alloc(TOTAL); out[0]=RID; out[1]=cmd;
  hdr.forEach((b,i)=>out[2+i]=b);
  out[6]=0x00; out[7]=0x02;
  dev.sendFeatureReport(out);
  return Buffer.from(dev.getFeatureReport(RID, TOTAL)).subarray(1); // 519 payload
}
function diffPct(a,b){let d=0;for(let i=7;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])d++;return (100*d/(a.length-7)).toFixed(1);}
for (const cmd of [0x89,0x9d]) {
  console.log(`--- cmd 0x${cmd.toString(16)}`);
  const a1 = read(cmd,[0,0,0,0]);
  const b  = read(cmd,[0,0,0x10,0]);
  const a2 = read(cmd,[0,0,0,0]);
  const a3 = read(cmd,[0,0,0,0]);
  console.log("a1 vs b(addr0x1000):", diffPct(a1,b)+"% differ");
  console.log("a1 vs a2(same addr):", diffPct(a1,a2)+"% differ");
  console.log("a2 vs a3(same addr):", diffPct(a2,a3)+"% differ");
  const b2 = read(cmd,[0,0,0x10,0]);
  console.log("b  vs b2(same addr):", diffPct(b,b2)+"% differ");
}
dev.close();
