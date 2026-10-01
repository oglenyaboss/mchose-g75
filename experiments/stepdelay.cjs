const hid = require("node-hid");
const VID=0x258a, PID=0x010c, RID=6, TOTAL=520;
const path = hid.devices().find(d=>d.vendorId===VID&&d.productId===PID&&d.usagePage===0xff00)?.path;
const dev = new hid.HID(path);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
function read9d() {
  const out = Buffer.alloc(TOTAL); out[0]=RID; out[1]=0x9d;
  out[6]=0x00; out[7]=0x02;
  dev.sendFeatureReport(out);
  return Buffer.from(dev.getFeatureReport(RID, TOTAL)).subarray(8, 8+512);
}
function bestStep(a,b){
  let best={r:0,s:0};
  for (let s=-512;s<=512;s++){
    let m=0,n=0;
    for (let i=Math.max(0,s);i<Math.min(512,512+s);i+=2){ n++; if(a[i]===b[i-s])m++; }
    if (n>=200 && m/n>best.r) best={r:m/n,s};
  }
  return best;
}
(async()=>{
  const bs=[];
  for(let i=0;i<20;i++){ bs.push(read9d()); await sleep(15); }
  for(let i=1;i<20;i++){
    const {s,r}=bestStep(bs[i-1],bs[i]);
    console.log(`${i}: step=${s>0?'+':''}${s} r=${r.toFixed(2)}`);
  }
  dev.close();
})();
