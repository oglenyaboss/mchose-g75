const hid = require("node-hid");
const VID=0x258a, PID=0x010c, RID=6, TOTAL=520;
const path = hid.devices().find(d=>d.vendorId===VID&&d.productId===PID&&d.usagePage===0xff00)?.path;
const dev = new hid.HID(path);
function read9d() {
  const out = Buffer.alloc(TOTAL); out[0]=RID; out[1]=0x9d;
  out[6]=0x00; out[7]=0x02;
  dev.sendFeatureReport(out);
  return Buffer.from(dev.getFeatureReport(RID, TOTAL)).subarray(8, 8+512);
}
function shiftMatch(a,b,s){ // b начинается на s позже a
  let m=0,n=0;
  for (let i=Math.max(0,s);i<Math.min(512,512+s);i++){ n++; if(a[i]===b[i-s])m++; }
  return {m,n,r:n?m/n:0};
}
const bs=[]; for(let i=0;i<12;i++) bs.push(read9d());
for(let i=1;i<12;i++){
  let best={r:0,s:0};
  for (let s=-100;s<=100;s++){
    const {n,r}=shiftMatch(bs[i-1],bs[i],s);
    if (n>=300 && r>best.r) best={r,s,n};
  }
  console.log(`read${i-1}->${i}: step=+${best.s} ratio=${best.r.toFixed(3)} n=${best.n}`);
}
dev.close();
