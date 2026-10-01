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
const CYCLES=3, PERIOD=128, SZ=64*1024;
const cycles=[];
for (let c=0;c<CYCLES;c++){
  const blocks=[];
  for (let i=0;i<PERIOD;i++) blocks.push(read9d());
  cycles.push(Buffer.concat(blocks));
  console.error(`cycle ${c} done`);
}
function rot(x,s){ return Buffer.concat([x.subarray(s*512), x.subarray(0,s*512)]); }
function score(a,b){ let s=0; for(let i=0;i<a.length;i+=8) if(a[i]===b[i]) s++; return s; }
const ref=cycles[0];
let results=[];
for (let s=0;s<PERIOD;s++) results.push({s,sc:score(ref,rot(cycles[1],s))});
results.sort((a,b)=>b.sc-a.sc);
console.error('top shifts:', results.slice(0,3).map(r=>`${r.s}:${r.sc}`).join(' '));
const best=results[0].s;
const img=Buffer.from(ref), stable=Buffer.alloc(SZ,1);
for (let c=1;c<CYCLES;c++){
  const sh=rot(cycles[c],best);
  for (let i=0;i<SZ;i++) if (sh[i]!==ref[i]) stable[i]=0;
}
let mism=0; for(let i=0;i<SZ;i++) if(!stable[i])mism++;
fs.writeFileSync('flash.bin', img);
fs.writeFileSync('flash_stable.mask', stable);
console.log(`unstable: ${mism}/${SZ} (${(100*mism/SZ).toFixed(1)}%), shift=${best}`);
dev.close();
