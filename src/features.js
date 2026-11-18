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

module.exports = { DPI, BATTERY, BUTTONS, CTRL_FLAGS };
