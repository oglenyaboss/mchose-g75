const hid = require("node-hid");
const VID=0x258a, PID=0x010c, RID=6, TOTAL=520;
const path = hid.devices().find(d=>d.vendorId===VID&&d.productId===PID&&d.usagePage===0xff00)?.path;
const dev = new hid.HID(path);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
function read(cmd, hdr, len=0x0200) {
  const out = Buffer.alloc(TOTAL); out[0]=RID; out[1]=cmd;
  hdr.forEach((b,i)=>out[2+i]=b);
  out[6]=len&0xff; out[7]=(len>>8)&0xff;
  dev.sendFeatureReport(out);
  return Buffer.from(dev.getFeatureReport(RID, TOTAL)).subarray(1);
}
function diff(a,b){let d=0;for(let i=7;i<a.length;i++)if(a[i]!==b[i])d++;return 100*d/(a.length-7);}
(async()=>{
  const seen=new Map();
  for (const last of [1,2,3,4,8,0x10,0x40,0x80,0xff]) {
    const a=[0,0,0,last];
    const r1=read(0x9f,a); await sleep(20); const r2=read(0x9f,a);
    const stable=diff(r1,r2)===0;
    const key=r1.subarray(7,27).toString('hex');
    const sameAs1=seen.get(key)?'':'';
    console.log(`last=0x${last.toString(16).padStart(2,'0')} stable=${stable} uniq=${!seen.has(key)} head=${r1.subarray(7,31).toString('hex')}`);
    seen.set(key,(seen.get(key)||0)+1);
  }
  // теперь третий байт: 00 00 01 00
  for (const third of [1,2,0x10,0x80]) {
    const a=[0,0,third,1];
    const r1=read(0x9f,a); await sleep(20); const r2=read(0x9f,a);
    console.log(`third=0x${third.toString(16)} last=1 stable=${diff(r1,r2)===0} head=${r1.subarray(7,31).toString('hex')}`);
  }
  dev.close();
})().catch(e=>{console.error(e);process.exit(1)});
