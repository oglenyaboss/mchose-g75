const hid = require("node-hid");
const crypto = require("crypto");
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
const N=768; // 6 полных циклов
const blocks=[];
for (let i=0;i<N;i++) blocks.push(read9d());
const h=b=>crypto.createHash('md5').update(b).digest('hex').slice(0,12);
const hashes=blocks.map(h);
// голосование преемников
const succ={}; // hash -> {nexthash: count}
for (let i=0;i<N-1;i++){
  (succ[hashes[i]] ??= {});
  succ[hashes[i]][hashes[i+1]] = (succ[hashes[i]][hashes[i+1]]||0)+1;
}
const uniq={}; hashes.forEach((x,i)=>{uniq[x] ??= blocks[i];});
const uniqCount=Object.keys(uniq).length;
console.error(`blocks=${N} unique=${uniqCount}`);
// строим цепь: стартуем с блока, у которого есть преемник с макс счётчиком, идём по мажоритарным преемникам
function bestNext(hx){ const s=succ[hx]; if(!s) return null; let bh=null,bc=0; for(const [k,v] of Object.entries(s)) if(v>bc){bc=v;bh=k;} return {h:bh,c:bc}; }
// кандидат на старт: блок, чей мажоритарный преемник имеет высокий счёт и сам он часто встречается
const freq={}; hashes.forEach(x=>freq[x]=(freq[x]||0)+1);
let start=Object.entries(freq).sort((a,b)=>b[1]-a[1])[0][0];
const chain=[start];
const seen=new Set([start]);
let cur=start;
while(true){
  const nx=bestNext(cur);
  if(!nx || seen.has(nx.h) || nx.c<2) break;
  chain.push(nx.h); seen.add(nx.h); cur=nx.h;
}
console.error(`chain length: ${chain.length}, coverage: ${chain.length}/${uniqCount}`);
const img=Buffer.concat(chain.map(x=>uniq[x]));
fs.writeFileSync('flash_stitched.bin', img);
// статистика встречаемости переходов в цепи (для контроля)
const conf=chain.slice(0,-1).map((x,i)=>bestNext(x).c);
console.error('successor votes (min/med/max):', Math.min(...conf), conf.sort((a,b)=>a-b)[conf.length>>1], Math.max(...conf));
dev.close();
