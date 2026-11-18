// HID++ 2.0 client for Logitech devices over node-hid.
// Verified on macOS against an MX Master 3S (Bluetooth LE, 0x046d:0xb034).
//
// Transport notes (reverse-engineered, hardware-verified):
//   - The HID++ control collection is usagePage 0xFF43.
//   - This device accepts only 20-byte LONG reports (report id 0x11) over BLE;
//     short 0x10 reports and sendFeatureReport() are rejected.
//   - Device index is 0xFF for a directly-connected (non-receiver) device.
//   - A request is [0x11, devIdx, featureIndex, (func<<4)|swId, params...] padded
//     to 20 bytes. The matching reply echoes featureIndex and (func<<4)|swId.
//   - An HID++ 2.0 error reply is [0x11, devIdx, 0xFF, featureIndex, funcByte,
//     errorCode, ...].
//
// Feature indices are discovered at runtime via the root feature (0x0000):
// getFeature(featureId) returns the index to use in later calls.

const HID = require("node-hid");

const SW = 0x05; // software id, low nibble of the function byte
const LONG = 0x11; // long-report id
const ROOT = 0x00; // root feature is always index 0

// Human-readable names for the feature IDs this client knows about.
const FEATURES = {
  0x0000: "Root",
  0x0001: "FeatureSet",
  0x0003: "DeviceInfo",
  0x0005: "DeviceName",
  0x1000: "BatteryStatus",
  0x1001: "BatteryVoltage",
  0x1004: "UnifiedBattery",
  0x1814: "ChangeHost",
  0x1815: "HostsInfo",
  0x1b04: "ReprogrammableKeysV4",
  0x2110: "SmartShift",
  0x2121: "HiResWheel",
  0x2150: "Thumbwheel",
  0x2201: "AdjustableDPI",
};

class HidppError extends Error {
  constructor(code, featIdx, func) {
    super(`HID++ error 0x${code.toString(16)} (feature idx ${featIdx}, func ${func})`);
    this.code = code;
  }
}

class HidppDevice {
  constructor({ vendorId = 0x046d, productId, deviceIndex = 0xff } = {}) {
    const all = HID.devices().filter(
      (x) => x.vendorId === vendorId && x.usagePage === 0xff43 && (productId ? x.productId === productId : true)
    );
    if (!all.length) throw new Error("no Logitech HID++ (usagePage 0xFF43) collection found");
    const d = all[0];
    this.dev = new HID.HID(d.path);
    this.idx = deviceIndex;
    this.waiters = [];
    this.featureCache = new Map();
    this.dev.on("data", (b) => this._onData(Buffer.from(b)));
    this.dev.on("error", () => {});
    this.info = { vendorId, productId: d.productId, product: d.product };
  }

  _onData(b) {
    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i];
      const funcByte = (w.func << 4) | SW;
      // success: report id, device index, feature index, echoed function byte
      if (b[0] === LONG && b[1] === this.idx && b[2] === w.featIdx && b[3] === funcByte) {
        this.waiters.splice(i, 1);
        clearTimeout(w.t);
        return w.res(b);
      }
      // error: 0xFF feature, then the originating feature index and function byte
      if (b[0] === LONG && b[1] === this.idx && b[2] === 0xff && b[3] === w.featIdx && b[4] === funcByte) {
        this.waiters.splice(i, 1);
        clearTimeout(w.t);
        return w.rej(new HidppError(b[5], w.featIdx, w.func));
      }
    }
    // unmatched report is an event/notification; ignored
  }

  // Low-level call. featIdx is a feature INDEX (from getFeatureIndex), not an ID.
  // func is a function NUMBER 0..15 (it is shifted into the high nibble here).
  call(featIdx, func, params = [], timeoutMs = 2000) {
    if (!Number.isInteger(func) || func < 0 || func > 15) {
      return Promise.reject(new Error(`function number out of range 0..15: ${func}`));
    }
    if (!Number.isInteger(featIdx) || featIdx < 0 || featIdx > 255) {
      return Promise.reject(new Error(`feature index out of range 0..255: ${featIdx}`));
    }
    for (const p of params) {
      if (!Number.isInteger(p) || p < 0 || p > 255) {
        return Promise.reject(new Error(`param byte out of range 0..255: ${p}`));
      }
    }
    return new Promise((res, rej) => {
      const frame = [LONG, this.idx, featIdx, (func << 4) | SW, ...params];
      while (frame.length < 20) frame.push(0);
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.t !== t);
        rej(new Error(`HID++ timeout: feature idx ${featIdx}, func ${func}`));
      }, timeoutMs);
      this.waiters.push({ featIdx, func, res, rej, t });
      this.dev.write(frame);
    });
  }

  // Root feature getFeature(featureId) -> feature index (0 if unsupported). Cached.
  async getFeatureIndex(featureId) {
    if (this.featureCache.has(featureId)) return this.featureCache.get(featureId);
    const r = await this.call(ROOT, 0x00, [(featureId >> 8) & 0xff, featureId & 0xff, 0x00]);
    const idx = r[4];
    this.featureCache.set(featureId, idx);
    return idx;
  }

  // Root ping: returns the negotiated HID++ protocol version and the echoed byte.
  async ping() {
    const r = await this.call(ROOT, 0x01, [0, 0, 0xaa]);
    return { protocol: `${r[4]}.${r[5]}`, echo: r[6] };
  }

  // Enumerate every feature via FeatureSet (0x0001): [{index, id, name, version, flags}].
  async listFeatures() {
    const fsIdx = await this.getFeatureIndex(0x0001);
    if (!fsIdx) throw new Error("FeatureSet (0x0001) not supported");
    const count = (await this.call(fsIdx, 0x00, []))[4]; // excludes root
    const out = [];
    for (let i = 0; i <= count; i++) {
      const r = await this.call(fsIdx, 0x01, [i]);
      const id = (r[4] << 8) | r[5];
      out.push({ index: i, id, name: FEATURES[id] || "?", flags: r[6], version: r[7] });
    }
    return out;
  }

  close() {
    this.dev.close();
  }
}

module.exports = { HidppDevice, HidppError, FEATURES, SW };
