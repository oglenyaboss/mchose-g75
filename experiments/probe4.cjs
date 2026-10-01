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
  const CMDS=[0x88,0x89,0x9d,0x9e,0x9f];
  const ADDRS=[];
  // перебор: каждый байт адреса по отдельности в ненулевое значение + известный конфиг
  const BASE=[0,0,0,0];
  for (const pos of [0,1,2,3]) for (const v of [1,0x80,0xff]) { const a=[...BASE]; a[pos]=v; ADDRS.push(a); }
  ADDRS.push([0,0,1,0], [0,0,0,1]);
  for (const cmd of CMDS) {
    const stables=[];
    for (const addr of ADDRS) {
      const r1=read(cmd,addr); await sleep(20);
      const r2=read(cmd,addr);
      const d=diff(r1,r2);
      if (d===0) stables.push(addr.map(x=>x.toString(16).padStart(2,'0')).join(' '));
    }
    console.log(`cmd 0x${cmd.toString(16)}: stable addrs: ${JSON.stringify(stables)}`);
  }
  dev.close();
})().catch(e=>{console.error(e);process.exit(1)});
