// ws client for LogiPluginService Duplex protocol. Upgrade + Handshake + optional request.
const net=require("node:net"),crypto=require("node:crypto"),zlib=require("node:zlib");
const PORT=+ (process.argv[2]||53902), PATH="/logiPluginServiceNative";
const sendName=process.argv[3], sendParams=process.argv[4];
function inflate(b){try{return zlib.inflateRawSync(Buffer.concat([b,Buffer.from([0,0,0xff,0xff])]),{finishFlush:zlib.constants.Z_SYNC_FLUSH});}catch(e){return Buffer.from("<inflate "+e.code+">");}}
function frame(txt){ // client->server, masked, uncompressed text
  const p=Buffer.from(txt,"utf8"); const mask=crypto.randomBytes(4);
  const m=Buffer.alloc(p.length); for(let k=0;k<p.length;k++)m[k]=p[k]^mask[k&3];
  let hdr; if(p.length<126){hdr=Buffer.from([0x81,0x80|p.length]);} else {hdr=Buffer.alloc(4);hdr[0]=0x81;hdr[1]=0x80|126;hdr.writeUInt16BE(p.length,2);}
  return Buffer.concat([hdr,mask,m]);
}
const key=crypto.randomBytes(16).toString("base64");
const s=net.createConnection(PORT,"127.0.0.1",()=>s.write(`GET ${PATH} HTTP/1.1\r\nHost:127.0.0.1:${PORT}\r\nUpgrade:websocket\r\nConnection:Upgrade\r\nSec-WebSocket-Key:${key}\r\nSec-WebSocket-Version:13\r\nSec-WebSocket-Extensions:permessage-deflate\r\n\r\n`));
let buf=Buffer.alloc(0),up=false,id=1;
function send(obj){const m=JSON.stringify(obj);console.log("-> "+m);s.write(frame(m));}
function frames(){while(buf.length>=2){const b0=buf[0],b1=buf[1],rsv1=b0&0x40,op=b0&0x0f;let len=b1&0x7f,o=2;if(len===126){if(buf.length<4)return;len=buf.readUInt16BE(2);o=4;}else if(len===127){if(buf.length<10)return;len=Number(buf.readBigUInt64BE(2));o=10;}if(buf.length<o+len)return;let pay=buf.slice(o,o+len);buf=buf.slice(o+len);if(op===8){console.log("<- [close]");s.destroy();return;}if(op===9||op===10)continue;if(rsv1)pay=inflate(pay);console.log("<- "+pay.toString("utf8"));}}
s.on("data",d=>{if(!up){buf=Buffer.concat([buf,d]);const i=buf.indexOf("\r\n\r\n");if(i<0)return;up=true;console.log("UPGRADE 101");buf=buf.slice(i+4);
  send({parameters:{tokenBase:crypto.randomUUID().toUpperCase()},id:id,name:"Handshake"});
  frames();return;}buf=Buffer.concat([buf,d]);frames();});
s.on("error",e=>console.log("error:",e.code||e.message));
s.on("close",()=>console.log("closed"));
// after handshake reply, optionally send a second request
if(sendName)setTimeout(()=>send({parameters:sendParams?JSON.parse(sendParams):{},id:++id,name:sendName}),1200);
setTimeout(()=>{s.destroy();process.exit(0);},4000);
