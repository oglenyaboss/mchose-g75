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
function bestOverlap(a,b){ // b сдвинут относительно a на shift: ищем максимум совпадений
  let best=-1,bestS=0;
  for (let s=0;s<512;s+=16){
    let m=0;
    for (let i=s;i<512;i+=16) if(a[i]===b[i-s])m++;
    if(m>best){best=m;bestS=s;}
  }
  return {shift:bestS,match:best};
}
const bs=[]; for(let i=0;i<8;i++) bs.push(read9d());
for(let i=1;i<8;i++){
  const r=bestOverlap(bs[i-1],bs[i]);
  console.log(`block${i-1}->${i}: shift=${r.shift} match=${r.match}/32`);
}
dev.close();
