// logictl protocol client for the Logi Options+ "kiros" agent.
//
// Transport (reverse-engineered, verified against logioptionsplus 2.9.1013853):
//   - Unix domain socket:  /tmp/logitech_kiros_agent-<md5(username)>      (macOS/Linux)
//   - Windows named pipe:  \\.\pipe\logitech_kiros_agent-<md5(username)>
//
// Wire framing ("json" protocol, from app.asar main.js module 2824):
//   [uint32 LE  total = protoLen + msgLen + 8]
//   [uint32 BE  protoLen (= 4)]
//   [bytes      proto    (= "json")]
//   [uint32 BE  msgLen]
//   [bytes      message  (UTF-8 JSON)]
// The reader rejects any frame whose proto is not "json".
//
// Message envelope (JSON):
//   request : { msgId: <int>, verb: <VERB>, resource: "/...", payload?: <any> }
//   reply   : { msgId: <int>, status: <int>, result?: <any>, error?: <any>, ... }
// Verbs: GET SET SUBSCRIBE UNSUBSCRIBE DELETE POST UPDATE
// msgId correlates a reply to its request. SUBSCRIBE pushes further replies
// carrying the same resource over time.

const net = require("node:net");
const os = require("node:os");
const crypto = require("node:crypto");

const PROTO = "json";
const VERBS = ["GET", "SET", "SUBSCRIBE", "UNSUBSCRIBE", "DELETE", "POST", "UPDATE"];

function agentSocketPath(name = "logitech_kiros_agent") {
  const user = os.userInfo().username;
  const hash = crypto.createHash("md5").update(user).digest("hex");
  if (process.platform === "win32") return `\\\\.\\pipe\\${name}-${hash}`;
  return `/tmp/${name}-${hash}`;
}

function encodeFrame(messageString) {
  const msg = Buffer.from(messageString, "utf8");
  const proto = Buffer.from(PROTO, "utf8");
  const total = Buffer.alloc(4);
  total.writeUInt32LE(proto.length + msg.length + 8, 0); // excludes its own 4 bytes
  const protoLen = Buffer.alloc(4);
  protoLen.writeUInt32BE(proto.length, 0);
  const msgLen = Buffer.alloc(4);
  msgLen.writeUInt32BE(msg.length, 0);
  return Buffer.concat([total, protoLen, proto, msgLen, msg]);
}

// Incremental frame decoder. Feed it bytes; it calls onMessage(jsonString) per frame.
function createDecoder(onMessage) {
  let buf = Buffer.alloc(0);
  let state = "TOTAL";
  let protoLen = 0;
  let proto = null;
  let msgLen = 0;
  return function feed(chunk) {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (state === "TOTAL") {
        if (buf.length < 4) return;
        buf = buf.slice(4); // total length, not needed for parsing
        state = "PROTO_LEN";
      } else if (state === "PROTO_LEN") {
        if (buf.length < 4) return;
        protoLen = buf.readUInt32BE(0);
        buf = buf.slice(4);
        state = "PROTO";
      } else if (state === "PROTO") {
        if (buf.length < protoLen) return;
        proto = buf.slice(0, protoLen).toString("utf8");
        buf = buf.slice(protoLen);
        state = "MSG_LEN";
      } else if (state === "MSG_LEN") {
        if (buf.length < 4) return;
        msgLen = buf.readUInt32BE(0);
        buf = buf.slice(4);
        state = "MSG";
      } else if (state === "MSG") {
        if (buf.length < msgLen) return;
        const msg = buf.slice(0, msgLen).toString("utf8");
        buf = buf.slice(msgLen);
        state = "TOTAL";
        if (proto === PROTO) onMessage(msg);
        // else: unsupported protocol frame, dropped (matches agent behaviour)
      }
    }
  };
}

class KirosClient {
  constructor(opts = {}) {
    this.path = opts.path || agentSocketPath(opts.socketName);
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map(); // msgId -> {resolve, reject, timer}
    this.subscriptions = new Map(); // msgId -> handler(reply)
    this._onClose = opts.onClose || (() => {});
  }

  connect() {
    return new Promise((resolve, reject) => {
      const decoder = createDecoder((msgString) => this._dispatch(msgString));
      this.socket = net.createConnection(this.path, () => resolve(this));
      this.socket.on("data", decoder);
      this.socket.on("error", (e) => {
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(e);
        }
        this.pending.clear();
        reject(e);
      });
      this.socket.on("close", () => this._onClose());
    });
  }

  _dispatch(msgString) {
    let msg;
    try {
      msg = JSON.parse(msgString);
    } catch {
      return; // non-JSON reply ignored
    }
    const id = typeof msg.msgId === "string" ? parseInt(msg.msgId, 10) : msg.msgId;
    if (this.subscriptions.has(id)) {
      this.subscriptions.get(id)(msg);
      return;
    }
    const p = this.pending.get(id);
    if (p) {
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.resolve(msg);
    }
  }

  // One-shot request/reply. Returns the first reply with the matching msgId.
  request(verb, resource, payload, { timeoutMs = 5000 } = {}) {
    if (!VERBS.includes(verb)) {
      return Promise.reject(new Error(`unknown verb: ${verb} (one of ${VERBS.join(", ")})`));
    }
    const msgId = this.nextId++;
    const message = { msgId, verb, resource };
    if (payload !== undefined) message.payload = payload;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(msgId);
        reject(new Error(`timeout after ${timeoutMs}ms waiting for ${verb} ${resource}`));
      }, timeoutMs);
      this.pending.set(msgId, { resolve, reject, timer });
      this.socket.write(encodeFrame(JSON.stringify(message)));
    });
  }

  // SUBSCRIBE: handler(reply) is called for every push until unsubscribe().
  subscribe(resource, handler, payload) {
    const msgId = this.nextId++;
    this.subscriptions.set(msgId, handler);
    const message = { msgId, verb: "SUBSCRIBE", resource };
    if (payload !== undefined) message.payload = payload;
    this.socket.write(encodeFrame(JSON.stringify(message)));
    return msgId;
  }

  close() {
    if (this.socket) this.socket.destroy();
  }
}

module.exports = { KirosClient, agentSocketPath, encodeFrame, createDecoder, VERBS, PROTO };
