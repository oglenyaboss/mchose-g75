const hid = require("node-hid");
const crypto = require("crypto");
const fs = require("fs");
const VID=0x258a, PID=0x010c, RID=6, TOTAL=520;
const path = hid.devices().find(d=>d.vendorId===VID&&d.productId===PID&&d.usagePage===0xff00)?.path;
const dev = new hid.HID(path);
function read(cmd) {
  const out = Buffer.alloc(TOTAL); out[0]=RID; out[1]=cmd;
  out[6]=0x00; out[7]=0x02;
  dev.sendFeatureReport(out);
  return Buffer.from(dev.getFeatureReport(RID, TOTAL)).subarray(8);
}
const N=300;
const blocks=[];
for (let i=0;i<N;i++) blocks.push(read(0x9d));
fs.writeFileSync('stream/seq9d.bin', Buffer.concat(blocks));
const stats=blocks.map((b,i)=>{
  let ff=0,z=0; for(const x of b){if(x===0xff)ff++;if(x===0)z++;}
  return {i,ff,z,hash:crypto.createHash('md5').update(b).digest('hex').slice(0,10)};
});
const byHash={};
stats.forEach(s=>{(byHash[s.hash]??=[]).push(s)});
Object.entries(byHash).filter(([h,l])=>l.length>1).forEach(([h,l])=>console.log('dup:',h,l.map(x=>x.i+`(${x.ff}ff)`).join(',')));
const blank=stats.filter(s=>s.ff>500).length, semi=stats.filter(s=>s.ff>250&&s.ff<=500).length;
console.log(`blocks: ${N}, >98%FF: ${blank}, 50-98%FF: ${semi}, code-ish: ${N-blank-semi}`);
dev.close();
