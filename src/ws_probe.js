// Minimal RFC6455 ws client + permessage-deflate (server_no_context_takeover).
// Connects to the Logi plugin service, sends nothing, logs decompressed msgs.
const net=require("node:net"), crypto=require("node:crypto"), zlib=require("node:zlib");
const PORT=process.argv[2]||53902, PATH=process.argv[3]||"/logiPluginServiceNative";
const key=crypto.randomBytes(16).toString("base64");
const s=net.createConnection(PORT,"127.0.0.1",()=>{
  s.write(`GET ${PATH} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Extensions: permessage-deflate\r\n\r\n`);
});
let buf=Buffer.alloc(0), up=false, deflate=false, n=0;
function parseFrames(){
  while(buf.length>=2){
    const b0=buf[0],b1=buf[1]; const fin=b0&0x80, rsv1=b0&0x40, op=b0&0x0f; let len=b1&0x7f; let off=2;
    if(len===126){ if(buf.length<4)return; len=buf.readUInt16BE(2); off=4; }
    else if(len===127){ if(buf.length<10)return; len=Number(buf.readBigUInt64BE(2)); off=10; }
    if(buf.length<off+len)return;
    let payload=buf.slice(off,off+len); buf=buf.slice(off+len);
    if(op===8){ console.log(`frame#${++n} CLOSE code=`+(len>=2?payload.readUInt16BE(0):"?")); s.destroy(); return; }
    if(op===9){ console.log(`frame#${++n} PING`); continue; }
    if(op===10){ console.log(`frame#${++n} PONG`); continue; }
    if(rsv1 && deflate){ try{ payload=zlib.inflateRawSync(Buffer.concat([payload,Buffer.from([0,0,0xff,0xff])])); }catch(e){ console.log("inflate err",e.message); } }
    const txt=payload.toString("utf8");
    let keys="<non-json>"; try{const o=JSON.parse(txt); keys=Array.isArray(o)?"[array len "+o.length+"]":Object.keys(o).join(","); }catch(e){}
    console.log(`frame#${++n} op=${op} len=${len} keys=[${keys}]`);
    console.log("   raw:", txt.slice(0,300).replace(/\s+/g," "));
  }
}
s.on("data",d=>{
  if(!up){ buf=Buffer.concat([buf,d]); const i=buf.indexOf("\r\n\r\n"); if(i<0)return;
    const hdr=buf.slice(0,i).toString(); up=true; deflate=/permessage-deflate/i.test(hdr);
    console.log("UPGRADE ok; deflate="+deflate); buf=buf.slice(i+4); parseFrames(); return; }
  buf=Buffer.concat([buf,d]); parseFrames();
});
s.on("error",e=>console.log("error:",e.code||e.message));
s.on("close",()=>console.log("closed. frames:",n));
setTimeout(()=>{console.log("timeout; frames:",n); s.destroy(); process.exit(0);},5000);
