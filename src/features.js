// Feature decoders for HID++ 2.0, built on HidppDevice.call().
// Byte offsets: a reply is [0x11, devIdx, featIdx, funcByte, PAYLOAD...], so the
// feature payload starts at r[4]. Offsets below are stated relative to r.
//
// Sources: AdjustableDPI (0x2201) layout derived from live MX Master 3S replies;
// battery (0x1004) and reprogrammable keys (0x1b04) layouts from the open-source
// Solaar project (logitech_receiver/hidpp20.py, GPL-2.0-or-later).

// ---------------------------------------------------------------- AdjustableDPI
// func 1 getSensorDpiList(sensor), func 2 getSensorDpi(sensor),
// func 3 setSensorDpi(sensor, hi, lo).
const DPI = {
  async feature(dev) {
    const idx = await dev.getFeatureIndex(0x2201);
    if (!idx) throw new Error("AdjustableDPI (0x2201) not supported by this device");
    return idx;
  },
  // Returns {current, default} for the given sensor.
  async get(dev, sensor = 0) {
    const idx = await DPI.feature(dev);
    const r = await dev.call(idx, 0x02, [sensor]);
    return { current: (r[5] << 8) | r[6], default: (r[7] << 8) | r[8] };
  },
  // Returns {values:[...], range:{min,step,max}|null, sensor}. A list value
  // >= 0xE000 is a step marker (step = value - 0xE000) describing a continuous
  // range between its neighbours; a plain list has no markers. 0x0000 ends it.
  async list(dev, sensor = 0) {
    const idx = await DPI.feature(dev);
    const r = await dev.call(idx, 0x01, [sensor]);
    const vals = [];
    for (let off = 5; off + 1 < r.length; off += 2) {
      const v = (r[off] << 8) | r[off + 1];
      if (v === 0) break;
      vals.push(v);
    }
    let range = null;
    const stepAt = vals.findIndex((v) => v >= 0xe000);
    if (stepAt !== -1) {
      range = { min: vals[stepAt - 1], step: vals[stepAt] - 0xe000, max: vals[stepAt + 1] };
    }
    return { sensor, values: vals, range };
  },
  // Validate dpi against the device's list/range, then write it. Returns the
  // post-write readback so the caller can confirm what the device accepted.
  async set(dev, dpi, sensor = 0) {
    const idx = await DPI.feature(dev);
    const { values, range } = await DPI.list(dev, sensor);
    if (range) {
      if (dpi < range.min || dpi > range.max || (dpi - range.min) % range.step !== 0) {
        throw new Error(`DPI ${dpi} invalid: allowed ${range.min}..${range.max} step ${range.step}`);
      }
    } else if (values.length && !values.includes(dpi)) {
      throw new Error(`DPI ${dpi} invalid: allowed ${values.join(", ")}`);
    }
    await dev.call(idx, 0x03, [sensor, (dpi >> 8) & 0xff, dpi & 0xff]);
    return DPI.get(dev, sensor);
  },
};

// --------------------------------------------------------------- UnifiedBattery
// func 1 getStatus -> payload: [0]=percent, [1]=level mask, [2]=charging status.
const LEVELS = { 8: "full", 4: "good", 2: "low", 1: "critical" };
const CHARGE = { 0: "discharging", 1: "charging", 2: "almost full", 3: "full", 4: "slow charge", 5: "error" };
const BATTERY = {
  async get(dev) {
    const idx = await dev.getFeatureIndex(0x1004);
    if (!idx) throw new Error("UnifiedBattery (0x1004) not supported by this device");
    const r = await dev.call(idx, 0x01, []);
    const percent = r[4];
    return {
      percent: percent || null, // 0 means "unknown, use level instead"
      level: LEVELS[r[5]] || "empty",
      status: CHARGE[r[6]] ?? `0x${r[6].toString(16)}`,
    };
  },
};

// --------------------------------------------------- ReprogrammableKeysV4 0x1b04
// func 0 getCount, func 1 getCtrlIdInfo(index), func 2 getCidReporting(cid),
// func 3 setCidReporting(cid, bfield, remapHi, remapLo).
const CTRL_FLAGS = { mouse: 0x01, fkey: 0x02, hotkey: 0x04, fntoggle: 0x08, reprogrammable: 0x10, divertable: 0x20, persistentlyDivertable: 0x40, virtual: 0x80 };
const BUTTONS = {
  async feature(dev) {
    const idx = await dev.getFeatureIndex(0x1b04);
    if (!idx) throw new Error("ReprogrammableKeysV4 (0x1b04) not supported by this device");
    return idx;
  },
  async count(dev) {
    const idx = await BUTTONS.feature(dev);
    return (await dev.call(idx, 0x00, []))[4];
  },
  // Static capability info for the control at list index `i`.
  async info(dev, i) {
    const idx = await BUTTONS.feature(dev);
    const r = await dev.call(idx, 0x01, [i]);
    const flags = r[8] | (r[12] << 8);
    const caps = Object.keys(CTRL_FLAGS).filter((k) => flags & CTRL_FLAGS[k]);
    return {
      cid: (r[4] << 8) | r[5],
      taskId: (r[6] << 8) | r[7],
      pos: r[9],
      group: r[10],
      groupMask: r[11],
      caps,
    };
  },
  // Current runtime mapping for a control id.
  async reporting(dev, cid) {
    const idx = await BUTTONS.feature(dev);
    const r = await dev.call(idx, 0x02, [(cid >> 8) & 0xff, cid & 0xff]);
    return { cid: (r[4] << 8) | r[5], flags: r[6], mappedTo: (r[7] << 8) | r[8] || cid };
  },
  // List every control with its capabilities and current mapping.
  async list(dev) {
    const n = await BUTTONS.count(dev);
    const out = [];
    for (let i = 0; i < n; i++) {
      const info = await BUTTONS.info(dev, i);
      let mappedTo = info.cid;
      try {
        mappedTo = (await BUTTONS.reporting(dev, info.cid)).mappedTo;
      } catch {}
      out.push({ ...info, mappedTo });
    }
    return out;
  },
  // Remap one physical control to another control id.
  // setCidReporting(cid, bfield, remap): the remap field is always applied, so a
  // plain remap sends bfield = 0x00 (no divert flags changed). In this call
  // remap = 0 would KEEP the current mapping; to reset a control, remap it to
  // its own cid. Validates: source must be `reprogrammable`, and the target's
  // group must be allowed by the source's groupMask (bit (group-1)).
  async remap(dev, cid, targetCid) {
    const idx = await BUTTONS.feature(dev);
    const ctrls = await BUTTONS.list(dev);
    const src = ctrls.find((c) => c.cid === cid);
    const dst = ctrls.find((c) => c.cid === targetCid);
    if (!src) throw new Error(`source control 0x${cid.toString(16)} not found on this device`);
    if (!dst) throw new Error(`target control 0x${targetCid.toString(16)} not found on this device`);
    if (!src.caps.includes("reprogrammable")) throw new Error(`source 0x${cid.toString(16)} is not reprogrammable`);
    if (targetCid !== cid && !(src.groupMask & (1 << (dst.group - 1)))) {
      throw new Error(`target 0x${targetCid.toString(16)} (group ${dst.group}) not allowed by source groupMask 0x${src.groupMask.toString(16)}`);
    }
    await dev.call(idx, 0x03, [(cid >> 8) & 0xff, cid & 0xff, 0x00, (targetCid >> 8) & 0xff, targetCid & 0xff]);
    return BUTTONS.reporting(dev, cid);
  },
};

// ------------------------------------------------------------- SmartShift 0x2110
// func 0 getRatchetControlMode -> [0]=mode (1=freespin, 2=ratchet),
//        [1]=autoDisengage threshold, [2]=default threshold.
// func 1 set -> [mode, threshold]. Per Solaar, a field sent as 0 is left
// unchanged, so set mode with [mode,0] and threshold with [0,threshold].
// Threshold range 1..50; >=50 is sent as 255 ("always ratcheted").
const SMARTSHIFT = {
  async feature(dev) {
    const idx = await dev.getFeatureIndex(0x2110);
    if (!idx) throw new Error("SmartShift (0x2110) not supported by this device");
    return idx;
  },
  async get(dev) {
    const idx = await SMARTSHIFT.feature(dev);
    const r = await dev.call(idx, 0x00, []);
    const raw = r[5];
    return {
      mode: r[4] === 1 ? "freespin" : "ratchet",
      modeByte: r[4],
      threshold: raw === 255 ? 50 : raw,
      default: r[6],
    };
  },
  async setMode(dev, mode /* "freespin"|"ratchet" */) {
    const idx = await SMARTSHIFT.feature(dev);
    const b = mode === "freespin" ? 1 : 2;
    await dev.call(idx, 0x01, [b, 0]);
    return SMARTSHIFT.get(dev);
  },
  async setThreshold(dev, n) {
    if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error(`threshold must be 1..50, got ${n}`);
    const idx = await SMARTSHIFT.feature(dev);
    await dev.call(idx, 0x01, [0, n >= 50 ? 255 : n]);
    return SMARTSHIFT.get(dev);
  },
};

// ------------------------------------------------------------ HiResWheel 0x2121
// func 0 caps -> [1] flags: 0x08 has_invert, 0x04 has_ratchet.
// func 1 getMode -> [0] mode byte: bit0 target (divert to HID++), bit1 res
//        (hi-res smooth scroll), bit2 invert.
// func 2 setMode -> [modeByte]. Read-modify-write; bit0 (target) is left
// untouched to avoid breaking the wheel's scroll delivery.
const WHEEL_RES = 0x02;
const WHEEL_INV = 0x04;
const WHEEL_TARGET = 0x01;
const HIRESWHEEL = {
  async feature(dev) {
    const idx = await dev.getFeatureIndex(0x2121);
    if (!idx) throw new Error("HiResWheel (0x2121) not supported by this device");
    return idx;
  },
  async caps(dev) {
    const idx = await HIRESWHEEL.feature(dev);
    const r = await dev.call(idx, 0x00, []);
    return { hasInvert: !!(r[5] & 0x08), hasRatchet: !!(r[5] & 0x04), raw: r[5] };
  },
  async get(dev) {
    const idx = await HIRESWHEEL.feature(dev);
    const m = (await dev.call(idx, 0x01, []))[4];
    const ratchet = (await dev.call(idx, 0x03, []))[4] & 0x01;
    return {
      modeByte: m,
      target: !!(m & WHEEL_TARGET),
      hires: !!(m & WHEEL_RES),
      invert: !!(m & WHEEL_INV),
      ratchet: !!ratchet,
    };
  },
  // Set or clear the hi-res (res) or invert bit, preserving every other bit
  // (notably target). Returns the post-write read.
  async setBit(dev, which /* "hires"|"invert" */, on) {
    const idx = await HIRESWHEEL.feature(dev);
    if (which === "invert") {
      const c = await HIRESWHEEL.caps(dev);
      if (!c.hasInvert) throw new Error("this wheel does not support invert (caps bit 0x08 clear)");
    }
    const bit = which === "invert" ? WHEEL_INV : WHEEL_RES;
    const cur = (await dev.call(idx, 0x01, []))[4];
    const next = on ? cur | bit : cur & ~bit;
    await dev.call(idx, 0x02, [next & 0xff]);
    return HIRESWHEEL.get(dev);
  },
};

module.exports = { DPI, BATTERY, BUTTONS, SMARTSHIFT, HIRESWHEEL, CTRL_FLAGS };
