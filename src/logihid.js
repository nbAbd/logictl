#!/usr/bin/env node
// logihid - configure a Logitech mouse directly over HID++ 2.0, with no
// Logitech software and no code-signing. Verified on an MX Master 3S (BLE).
//
//   logihid info                 ping, protocol version, feature inventory
//   logihid dpi                  show current DPI, default, and allowed range
//   logihid dpi set <n>          set DPI (validated, then read back)
//   logihid battery              charge percent / level / charging status
//   logihid buttons              list controls with capabilities and mapping
//   logihid buttons remap <cid> <target>   remap one control to another (hex ok)
//   logihid raw <id> <func> [b..] low-level call; <id> feature id, bytes hex/dec
//
//   --pid <hex>                  pick a specific productId (default: first found)
//
// Replies can carry device identifiers; redirect to a file rather than pasting
// terminal output into shared channels.

const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { HidppDevice, FEATURES } = require("./hidpp");
const { DPI, BATTERY, BUTTONS, SMARTSHIFT, HIRESWHEEL, HOSTS, PROFILE } = require("./features");

// Warn if the Logi Options+ agent is running: it may silently re-apply its own
// values after a write. Best-effort; never fatal.
function optionsPlusRunning() {
  try {
    execFileSync("pgrep", ["-x", "logioptionsplus_agent"], { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}
function warnOptionsPlus() {
  if (optionsPlusRunning()) {
    process.stderr.write("note: Logi Options+ agent is running; it may re-apply its own settings on reconnect/app-switch.\n");
  }
}

function usage(code = 0) {
  process.stdout.write(`logihid - direct HID++ mouse control

  logihid info
  logihid dpi                           show DPI (current, default, range)
  logihid dpi set <n>                   set DPI, validated and read back
  logihid battery
  logihid buttons                       list controls
  logihid buttons remap <cid> <target>  remap control to another (hex or dec)
  logihid smartshift                    show ratchet/freespin mode + threshold
  logihid smartshift ratchet|freespin   set wheel mode
  logihid smartshift threshold <1-50>   set auto-shift torque threshold
  logihid wheel                         show hi-res wheel state
  logihid wheel hires on|off            toggle hi-res smooth scrolling
  logihid wheel invert on|off           toggle scroll direction
  logihid host                          list paired computers (slot, current, name)
  logihid host <n>                      switch mouse to paired computer n (0-based)
  logihid profile save <file>           snapshot settings to a JSON file
  logihid profile apply <file>          apply a profile, then report what stuck
  logihid raw <featureId> <func> [bytes...]

  --pid <hex>   select productId (default: first HID++ device found)
`);
  process.exit(code);
}

function num(s) {
  if (s === undefined) return undefined;
  let n;
  if (/^0x[0-9a-f]+$/i.test(s)) n = parseInt(s.slice(2), 16);
  else if (/^\d+$/.test(s)) n = parseInt(s, 10);
  else {
    // Reject ambiguous input (e.g. bare "1b04") instead of silently truncating.
    process.stderr.write(`not a number: ${s} (decimal, or hex with a 0x prefix)\n`);
    process.exit(2);
  }
  return n;
}

function parseArgs(argv) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--pid") opts.pid = num(argv[++i]);
    else rest.push(argv[i]);
  }
  return { opts, rest };
}

async function main() {
  const { opts, rest } = parseArgs(process.argv.slice(2));
  const [cmd, sub, ...args] = rest;
  if (!cmd || cmd === "-h" || cmd === "--help") usage(0);

  let dev;
  try {
    dev = new HidppDevice({ productId: opts.pid });
  } catch (e) {
    process.stderr.write(`${e.message}\nIs the mouse paired and awake? Try moving it, then retry.\n`);
    process.exit(1);
  }

  try {
    if (cmd === "info") {
      const ping = await dev.ping();
      console.log(`product   : ${dev.info.product} (0x${dev.info.productId.toString(16)})`);
      console.log(`protocol  : HID++ ${ping.protocol}`);
      const feats = await dev.listFeatures();
      console.log(`features  : ${feats.length}`);
      for (const f of feats) {
        console.log(`  idx ${String(f.index).padStart(2)}  0x${f.id.toString(16).padStart(4, "0")}  v${f.version}  ${f.name}`);
      }
    } else if (cmd === "dpi" && !sub) {
      const cur = await DPI.get(dev);
      const { values, range } = await DPI.list(dev);
      console.log(`current : ${cur.current} dpi`);
      console.log(`default : ${cur.default} dpi`);
      if (range) console.log(`range   : ${range.min}..${range.max} dpi, step ${range.step}`);
      else console.log(`steps   : ${values.join(", ")}`);
    } else if (cmd === "dpi" && sub === "set") {
      const n = num(args[0]);
      if (n === undefined) usage(2);
      warnOptionsPlus();
      const before = await DPI.get(dev);
      console.log(`current : ${before.current} dpi`);
      const after = await DPI.set(dev, n);
      console.log(`set     : ${n} dpi -> readback ${after.current} dpi`);
      if (after.current !== n) console.log(`WARNING : device reports ${after.current}, not ${n}`);
    } else if (cmd === "battery") {
      const b = await BATTERY.get(dev);
      console.log(`charge  : ${b.percent !== null ? b.percent + "%" : "(exact % unavailable)"}`);
      console.log(`level   : ${b.level}`);
      console.log(`status  : ${b.status}`);
    } else if (cmd === "buttons" && !sub) {
      const list = await BUTTONS.list(dev);
      for (const c of list) {
        const cid = "0x" + c.cid.toString(16).padStart(4, "0");
        const map = c.mappedTo === c.cid ? "self" : "0x" + c.mappedTo.toString(16).padStart(4, "0");
        console.log(
          `${cid}  task ${String(c.taskId).padStart(3)}  grp ${c.group} mask 0x${c.groupMask.toString(16)}  -> ${map.padEnd(6)}  [${c.caps.join(",")}]`
        );
      }
    } else if (cmd === "buttons" && sub === "remap") {
      const cid = num(args[0]);
      const target = num(args[1]);
      if (cid === undefined || target === undefined) usage(2);
      const r = await BUTTONS.remap(dev, cid, target);
      console.log(`remapped 0x${cid.toString(16)} -> 0x${r.mappedTo.toString(16)} (flags 0x${r.flags.toString(16)})`);
    } else if (cmd === "smartshift" && !sub) {
      const s = await SMARTSHIFT.get(dev);
      console.log(`mode      : ${s.mode}`);
      console.log(`threshold : ${s.threshold} (1=easiest free-spin .. 50=always ratcheted)`);
    } else if (cmd === "smartshift" && (sub === "ratchet" || sub === "freespin")) {
      const s = await SMARTSHIFT.setMode(dev, sub);
      console.log(`mode set  : ${s.mode}`);
    } else if (cmd === "smartshift" && sub === "threshold") {
      const n = num(args[0]);
      if (n === undefined) usage(2);
      const s = await SMARTSHIFT.setThreshold(dev, n);
      console.log(`threshold : ${s.threshold} (mode ${s.mode})`);
    } else if (cmd === "wheel" && !sub) {
      const w = await HIRESWHEEL.get(dev);
      console.log(`hires   : ${w.hires ? "on" : "off"}`);
      console.log(`invert  : ${w.invert ? "on" : "off"}`);
      console.log(`ratchet : ${w.ratchet ? "on (notched)" : "off (free)"}`);
      console.log(`target  : ${w.target ? "HID++ (diverted)" : "HID"}  (not changed by this CLI)`);
    } else if (cmd === "wheel" && (sub === "hires" || sub === "invert")) {
      const v = args[0];
      if (v !== "on" && v !== "off") usage(2);
      const w = await HIRESWHEEL.setBit(dev, sub, v === "on");
      console.log(`${sub} set : ${(sub === "hires" ? w.hires : w.invert) ? "on" : "off"}`);
      console.log(`wheel     : hires ${w.hires ? "on" : "off"}, invert ${w.invert ? "on" : "off"}`);
    } else if (cmd === "host" && !sub) {
      const { current, hosts } = await HOSTS.list(dev);
      for (const h of hosts) {
        const mark = h.current ? "*" : " ";
        const paired = h.paired === null ? "?" : h.paired ? "paired" : "unpaired";
        console.log(`${mark} ${h.index}  ${paired.padEnd(8)} ${h.name || ""}`.trimEnd());
      }
      console.log(`(current = ${current}; * marks it. Use the mouse's Easy-Switch button to come back.)`);
    } else if (cmd === "host") {
      const n = num(sub);
      if (n === undefined) usage(2);
      warnOptionsPlus();
      const r = await HOSTS.switch(dev, n);
      if (r.noop) console.log(`host ${n} is already the current host; nothing to do.`);
      else {
        console.log(`switching to host ${n} — the mouse will now disconnect from this machine. This is normal.`);
        console.log(`If it does not appear on host ${n}, press the mouse's Easy-Switch button to pick a host.`);
      }
    } else if (cmd === "profile" && sub === "save") {
      const file = args[0];
      if (!file) usage(2);
      const snap = await PROFILE.snapshot(dev);
      fs.writeFileSync(file, JSON.stringify(snap, null, 2) + "\n");
      console.log(`saved ${Object.keys(snap.settings).length} setting group(s) for ${snap.device.model} to ${file}`);
    } else if (cmd === "profile" && sub === "apply") {
      const file = args[0];
      if (!file) usage(2);
      let prof;
      try {
        prof = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (e) {
        process.stderr.write(`cannot read profile ${file}: ${e.message}\n`);
        process.exit(1);
      }
      if (prof.device && prof.device.productId && prof.device.productId !== dev.info.productId) {
        process.stderr.write(
          `warning: profile is for productId 0x${prof.device.productId.toString(16)} (${prof.device.model}), ` +
            `this device is 0x${dev.info.productId.toString(16)}. Applying best-effort.\n`
        );
      }
      warnOptionsPlus();
      const report = await PROFILE.apply(dev, prof);
      let reverted = 0;
      for (const r of report) {
        const status = r.error ? `error: ${r.error}` : r.stuck ? "ok" : "REVERTED/!=";
        if (!r.stuck) reverted++;
        console.log(`${r.setting.padEnd(11)} wanted ${JSON.stringify(r.wanted)} -> got ${JSON.stringify(r.got)}  [${status}]`);
      }
      if (reverted) {
        console.log(`\n${reverted} setting(s) did not stick — Logi Options+ may be re-applying its own values.`);
        process.exitCode = 1;
      }
    } else if (cmd === "raw") {
      const id = num(sub);
      const func = num(args[0]);
      const bytes = args.slice(1).map(num);
      const idx = await dev.getFeatureIndex(id);
      if (id !== 0x0000 && !idx) {
        process.stderr.write(`feature 0x${id.toString(16)} (${FEATURES[id] || "?"}) not supported\n`);
        process.exit(1);
      }
      const r = await dev.call(idx, func, bytes);
      console.log(r.toString("hex"));
    } else {
      usage(2);
    }
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exitCode = 1;
  } finally {
    dev.close();
  }
}

main();
