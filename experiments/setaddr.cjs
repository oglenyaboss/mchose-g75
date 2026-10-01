const hid = require("node-hid");
const VID=0x258a, PID=0x010c, RID=6, TOTAL=520;
const path = hid.devices().find(d=>d.vendorId===VID&&d.productId===PID&&d.usagePage===0xff00)?.path;
const dev = new hid.HID(path);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
function xfer(cmd, hdr) {
  const out = Buffer.alloc(TOTAL); out[0]=RID; out[1]=cmd;
  hdr.forEach((b,i)=>out[2+i]=b);
  out[6]=0x00; out[7]=0x02;
  dev.sendFeatureReport(out);
  return Buffer.from(dev.getFeatureReport(RID, TOTAL)).subarray(1);
}
function diff(a,b){let d=0;for(let i=7;i<a.length;i++)if(a[i]!==b[i])d++;return 100*d/(a.length-7);}
(async()=>{
  for (const setCmd of [0x1d,0x1e,0x1f,0x0d]) {
    for (const addr of [[0,0,0,0],[0,0,0x10,0]]) {
      xfer(setCmd, addr); await sleep(30);
      const r1 = xfer(0x9d, addr); await sleep(30);
      const r2 = xfer(0x9d, addr);
      console.log(`set 0x${setCmd.toString(16)} addr=${addr.map(x=>x.toString(16)).join(' ')}: 0x9d stable=${diff(r1,r2)===0?'YES':'no'} head=${r1.subarray(7,39).toString('hex')}`);
    }
  }
  dev.close();
})().catch(e=>{console.error(e);process.exit(1)});
