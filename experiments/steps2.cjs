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
function bestShift(a,b){
  let best=-1,bs=0;
  for (let s=-512;s<512;s+=1){
    let m=0,n=0;
    for (let i=Math.max(0,s);i<Math.min(512,512+s);i+=4){ n++; if(a[i]===b[i-s])m++; }
    if (n>0 && m/n>best){ best=m/n; bs=s; }
  }
  return {s:bs,r:best};
}
const bs=[]; for(let i=0;i<30;i++) bs.push(read9d());
const out=[];
for(let i=1;i<30;i++){ const {s,r}=bestShift(bs[i-1],bs[i]); out.push(`${s}:${r.toFixed(2)}`); }
console.log(out.join(' '));
dev.close();
