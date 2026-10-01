// Калибровка мапы музыкальной таблицы: слот i окрашен в hue(i/126).
// Запуск: node calib.cjs [сек] — по умолчанию 90с, затем вернёт режим 1.
const hid = require("node-hid");
const VID=0x258a, PID=0x010c, RID=6, TOTAL=520, LEDS=126;
const secs = parseInt(process.argv[2]||"90",10);
const path = hid.devices().find(d=>d.vendorId===VID&&d.productId===PID&&d.usagePage===0xff00)?.path;
const dev = new hid.HID(path);
function feature(p){const o=Buffer.alloc(TOTAL);o[0]=RID;Buffer.from(p).copy(o,1);dev.sendFeatureReport(o);}
function getPerf(){const p=Buffer.alloc(519);p[0]=0x84;p[3]=1;p[5]=0x80;feature(p);return Buffer.from(dev.getFeatureReport(RID,TOTAL)).slice(2,136);}
function hsv(h,s,v){const i=Math.floor(h*6),f=h*6-i;const p=v*(1-s),q=v*(1-f*s),t=v*(1-(1-f)*s);const m=[[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i%6];return m.map(x=>Math.round(x*255));}
function gradFrame(){
  const out=Buffer.alloc(TOTAL); out[0]=RID;
  out[1]=0x08;out[2]=0;out[3]=0;out[4]=1;out[5]=0;out[6]=0x7A;out[7]=1;
  for(let i=0;i<LEDS;i++){
    const [r,g,b]=hsv(i/LEDS,1,1);
    out[8+i*3]=r;out[9+i*3]=g;out[10+i*3]=b;
  }
  return out;
}
const cfg=getPerf(); cfg[38]=0; cfg[39]=11;
const sp=Buffer.alloc(135); sp[0]=0x04; cfg.copy(sp,1); feature(sp);
setTimeout(()=>{},0);
const t0=Date.now();
const iv=setInterval(()=>{
  try{dev.sendFeatureReport(gradFrame());}catch(e){console.error(e.message);}
  if(Date.now()-t0>secs*1000){
    clearInterval(iv);
    const back=getPerf(); back[39]=1; back[38]=0;
    const b=Buffer.alloc(135); b[0]=0x04; back.copy(b,1); feature(b);
    dev.close(); console.log("калибровка завершена");
  }
},500);
console.log("радуга по слотам: слот0=красный ... слот63=циан ... слот125=почти красный");
console.log("скажи цвет клавиш: Esc, Space, F6, Enter, ←, ↑");
