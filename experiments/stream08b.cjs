// Тест видимости кадров 0x08: фаза 1 — строб красный/синий 2Гц, фаза 2 — бегущая точка.
const hid = require("node-hid");
const VID=0x258a, PID=0x010c, RID=6, TOTAL=520, LEDS=126;
const fps=25, secs=24;
const path = hid.devices().find(d=>d.vendorId===VID&&d.productId===PID&&d.usagePage===0xff00)?.path;
const dev = new hid.HID(path);
function feature(p){const o=Buffer.alloc(TOTAL);o[0]=RID;Buffer.from(p).copy(o,1);dev.sendFeatureReport(o);}
function getPerf(){const p=Buffer.alloc(519);p[0]=0x84;p[3]=1;p[5]=0x80;feature(p);return Buffer.from(dev.getFeatureReport(RID,TOTAL)).slice(2,136);}
function frame(t){
  const out=Buffer.alloc(TOTAL); out[0]=RID;
  out[1]=0x08;out[2]=0;out[3]=0;out[4]=1;out[5]=0;out[6]=0x7A;out[7]=1;
  const phase = Math.floor(t/25); // 1 сек на фазу
  if (t < 25*10) {
    // строб: 2 переключения в секунду
    const on = Math.floor(t/12.5)%2===0;
    const c = on?[255,0,0]:[0,0,255];
    for(let i=0;i<LEDS;i++){out[8+i*3]=c[0];out[9+i*3]=c[1];out[10+i*3]=c[2];}
  } else {
    // бегущая точка: 5 проходов в секунду
    const pos = Math.floor((t%25)*LEDS/5 % LEDS);
    for(let i=0;i<LEDS;i++){out[8+i*3]=i===pos?255:0;out[9+i*3]=i===pos?255:0;out[10+i*3]=i===pos?255:0;}
  }
  return out;
}
(async()=>{
  const cfg=getPerf(); cfg[38]=0; cfg[39]=11;
  const sp=Buffer.alloc(135); sp[0]=0x04; cfg.copy(sp,1); feature(sp);
  await new Promise(r=>setTimeout(r,300));
  let t=0,sent=0;
  const t0=Date.now();
  const iv=setInterval(()=>{
    try{dev.sendFeatureReport(frame(t++));sent++;}catch(e){console.error(e.message);}
    if(Date.now()-t0>secs*1000){
      clearInterval(iv);
      console.log(`done ${sent} frames`);
      const back=getPerf(); back[39]=1; back[38]=0;
      const b=Buffer.alloc(135); b[0]=0x04; back.copy(b,1); feature(b);
      dev.close();
    }
  },1000/fps);
})();
