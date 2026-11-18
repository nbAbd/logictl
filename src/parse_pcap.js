const fs=require("node:fs"), zlib=require("node:zlib");
const buf=fs.readFileSync(process.argv[2]);
const magic=buf.readUInt32LE(0); const swap=(magic===0xd4c3b2a1); // big-endian pcap
const r16=(o)=>swap?buf.readUInt16BE(o):buf.readUInt16LE(o);
const r32=(o)=>swap?buf.readUInt32BE(o):buf.readUInt32LE(o);
let off=24; const streams=new Map(); // key srcport>dstport -> {segs:[{seq,data}]}
while(off+16<=buf.length){
  const incl=r32(off+8); const start=off+16; off=start+incl;
  if(start+4>buf.length)break;
  // DLT_NULL: 4-byte family, then IP
  let p=start+4;
  const ipVerIhl=buf[p]; if((ipVerIhl>>4)!==4){continue;} const ihl=(ipVerIhl&0x0f)*4;
  const proto=buf[p+9]; if(proto!==6){continue;}
  const totalLen=buf.readUInt16BE(p+2);
  const sport=buf.readUInt16BE(p+ihl); const dport=buf.readUInt16BE(p+ihl+2);
  const seq=buf.readUInt32BE(p+ihl+4);
  const dataOff=((buf[p+ihl+12]>>4)&0x0f)*4;
  const tcpStart=p+ihl+dataOff; const tcpEnd=p+totalLen;
  const plen=tcpEnd-tcpStart; if(plen<=0)continue;
  const data=buf.slice(tcpStart,tcpEnd);
  const key=sport+">"+dport;
  if(!streams.has(key))streams.set(key,[]);
  streams.get(key).push({seq,data});
}
function reassemble(key){
  const segs=streams.get(key); if(!segs)return Buffer.alloc(0);
  segs.sort((a,b)=>a.seq-b.seq);
  // dedup by seq, concat
  let out=[], last=null;
  for(const s of segs){ if(last!==null && s.seq<last)continue; out.push(s.data); last=s.seq+s.data.length; }
  return Buffer.concat(out);
}
function parseWS(stream,label){
  let i=stream.indexOf("\r\n\r\n"); if(i<0){console.log(label+": no http upgrade in stream");return;}
  console.log("\n### "+label+" (upgrade hdr "+ (i+4) +"B) ###");
  let b=stream.slice(i+4); let fragOp=null, fragParts=[], n=0;
  while(b.length>=2){
    const b0=b[0],b1=b[1]; const fin=b0&0x80, rsv1=b0&0x40, op=b0&0x0f; let len=b1&0x7f; const masked=b1&0x80; let o=2;
    if(len===126){ if(b.length<4)break; len=b.readUInt16BE(2); o=4; } else if(len===127){ if(b.length<10)break; len=Number(b.readBigUInt64BE(2)); o=10; }
    let mask=null; if(masked){ if(b.length<o+4)break; mask=b.slice(o,o+4); o+=4; }
    if(b.length<o+len)break;
    let pay=b.slice(o,o+len); b=b.slice(o+len);
    if(masked){ const u=Buffer.alloc(pay.length); for(let k=0;k<pay.length;k++)u[k]=pay[k]^mask[k&3]; pay=u; }
    const curOp = op===0?fragOp:op;
    if(op===0||!fin){ if(op!==0)fragOp=op; fragParts.push(pay); if(!fin) continue; }
    let full = (op===0||fragParts.length>1)?Buffer.concat(fragParts):pay; fragParts=[]; const fop=fragOp; fragOp=null;
    const realOp = (op===0)?fop:op;
    if(realOp===8){console.log(`  [close]`);continue;} if(realOp===9||realOp===10){continue;}
    if(rsv1){ try{ full=zlib.inflateRawSync(Buffer.concat([full,Buffer.from([0,0,0xff,0xff])])); }catch(e){ console.log("  inflate err:",e.message); } }
    const txt=full.toString("utf8");
    console.log(`  msg#${++n} (${txt.length}B): ${txt.slice(0,600).replace(/\s+/g," ")}`);
  }
}
for(const key of streams.keys()){
  const s=reassemble(key);
  if(s.indexOf("HTTP/1.1")>=0 || s.indexOf("GET /")>=0) parseWS(s,key);
}
