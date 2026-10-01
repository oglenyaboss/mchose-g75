const hid = require("node-hid");
const VID=0x258a, PID=0x010c, RID=6, TOTAL=520;
const path = hid.devices().find(d=>d.vendorId===VID&&d.productId===PID&&d.usagePage===0xff00)?.path;
const dev = new hid.HID(path);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function read(cmd, hdr, gapMs=0, len=0x0200) {
  const out = Buffer.alloc(TOTAL); out[0]=RID; out[1]=cmd;
  hdr.forEach((b,i)=>out[2+i]=b);
  out[6]=len&0xff; out[7]=(len>>8)&0xff;
  dev.sendFeatureReport(out);
  if (gapMs) await sleep(gapMs);
  return Buffer.from(dev.getFeatureReport(RID, TOTAL)).subarray(1);
}
function diff(a,b){let d=0;for(let i=7;i<a.length;i++)if(a[i]!==b[i])d++;return (100*d/(a.length-7)).toFixed(1);}
(async()=>{
  console.log("== 0x88 stability:");
  const x1 = await read(0x88,[0,0,0,0],50);
  const x2 = await read(0x88,[0,0,0,0],50);
  console.log("0x88 twice:", diff(x1,x2)+"%");
  console.log("== 0x9d with 100ms gap:");
  const a = await read(0x9d,[0,0,0,0],100);
  const b = await read(0x9d,[0,0,0,0],100);
  console.log("same addr twice:", diff(a,b)+"%");
  console.log("data[7:71]:", a.subarray(7,71).toString('hex'));
  console.log("data[7:71]:", b.subarray(7,71).toString('hex'));
  console.log("== 0x9d len=0x80:");
  const c = await read(0x9d,[0,0,0,0],100,0x80);
  const d = await read(0x9d,[0,0,0,0],100,0x80);
  console.log("same addr twice:", diff(c,d)+"%");
  console.log("data[7:71]:", c.subarray(7,71).toString('hex'));
  console.log("data[7:71]:", d.subarray(7,71).toString('hex'));
  dev.close();
})();
