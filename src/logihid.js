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

const { HidppDevice, FEATURES } = require("./hidpp");
const { DPI, BATTERY, BUTTONS } = require("./features");

function usage(code = 0) {
  process.stdout.write(`logihid - direct HID++ mouse control

  logihid info
  logihid dpi                           show DPI (current, default, range)
  logihid dpi set <n>                   set DPI, validated and read back
  logihid battery
  logihid buttons                       list controls
  logihid buttons remap <cid> <target>  remap control to another (hex or dec)
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
