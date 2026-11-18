# logictl

Set a Logitech mouse's **DPI**, read its **battery**, and **remap its buttons**
(control-to-control) **directly over HID++ 2.0** — no Logitech software, no
code-signing, SIP left on. Plus a reverse-engineered study of two other
Logitech control surfaces (from Logi Options+ 2.9.1013853, macOS).

The working CLI is **`logihid`**. `logictl` is the blocked kiros client, kept
for reference. Three surfaces were investigated (one works, two don't):

| Surface | Status | Why |
| --- | --- | --- |
| **HID++ 2.0 direct** (`logihid`) | **working** | talks to the mouse itself; no code-sign, no Logitech software |
| kiros agent (`logictl`) | blocked | agent drops unsigned clients (inferred code-signature check) |
| LogiPluginService WebSocket | partial | can connect and handshake; command vocabulary not finished |

The commands below assume `logihid`/`logictl` are on your `PATH` — run
`npm link` (or `npm install -g .`) after install, or call them as
`node src/logihid.js …`. See [Install](#install).

## HID++ direct — the working path (`logihid`)

Logitech mice speak the **HID++ 2.0** protocol over USB/Bluetooth HID. You own
the device, so there is no code-sign gate — unlike the kiros agent. Verified
live on an **MX Master 3S (Bluetooth LE, 0x046d:0xb034)** on macOS with SIP
enabled and no special entitlement; other HID++ mice are expected to work but
are untested. Directly-connected devices only (USB cable or the mouse's own
Bluetooth) — a mouse paired through a Logitech Unifying/Bolt USB receiver uses
device indices 1-6 and is not handled.

```
logihid info                          ping, protocol, feature inventory
logihid dpi                           current DPI, default, allowed range
logihid dpi set <n>                   set DPI (validated, then read back)
logihid battery                       charge % / level / charging status
logihid buttons                       list controls, capabilities, mapping
logihid buttons remap <cid> <target>  remap one control to another (prefix hex with 0x)
logihid smartshift                    show ratchet/freespin mode + threshold
logihid smartshift ratchet|freespin   set wheel mode
logihid smartshift threshold <1-50>   auto-shift torque (1=easiest free-spin, 50=always ratcheted)
logihid wheel                         show hi-res wheel state
logihid wheel hires on|off            toggle hi-res smooth scrolling
logihid wheel invert on|off           toggle scroll direction
logihid raw <featureId> <func> [b..]  low-level HID++ call (integers; prefix hex with 0x)
logihid --pid <0xNNNN> <cmd>          select a productId (default: first HID++ device)
```

`dpi set`, `buttons remap`, and `raw` **write to the device**. Outputs
(`info`, `buttons`, replies) may carry device identifiers — redirect to a file
rather than pasting into shared channels.

Example, verified on the MX Master 3S:

```
$ logihid dpi
current : 1000 dpi
default : 1000 dpi
range   : 200..8000 dpi, step 50

$ logihid dpi set 1000          # validated against the range, then read back
current : 1000 dpi
set     : 1000 dpi -> readback 1000 dpi

$ logihid battery
charge  : 90%
level   : full
status  : discharging
```

### Transport facts

- HID++ control collection: usagePage `0xFF43`. Reported protocol version 4.5
  (the `2.0` above names the feature-protocol family).
- This BLE device accepts only **20-byte long reports (report id `0x11`)**; short
  `0x10` reports and `sendFeatureReport()` are rejected. Device index `0xFF`.
- Request: `[0x11, devIdx, featureIndex, (func<<4)|0x05, params...]` padded to
  20 (`0x05` is the HID++ software id). The reply echoes `featureIndex` and the
  function byte. An error reply is `[0x11, devIdx, 0xFF, featureIndex, funcByte,
  errorCode, ...]` (layout per the HID++ spec; not triggered during testing).
- Feature indices are discovered at runtime via the root feature (`0x0000`).

### Features implemented

- **AdjustableDPI (`0x2201`)** — `get` (func 2: current + default), `list`
  (func 1: a value `>= 0xE000` is a step marker for a continuous range), `set`
  (func 3), validated against the range before writing. **Set is verified to
  take effect and hold** (1050 dpi held across a 3 s re-read, then restored).
  The Logi Options+ background agent (`logioptionsplus_agent` + `LogiPluginService`)
  **was running** during the test and did not override the value in that window,
  but it may re-apply its own settings on device reconnect or app switch —
  persistence is not guaranteed; a mouse power cycle was not tested.
- **UnifiedBattery (`0x1004`)** — func 1: charge percent, level, charging status.
- **SmartShift (`0x2110`)** — `get` (func 0: mode + auto-disengage threshold +
  default), set mode (func 1 `[mode,0]`, 1=freespin/2=ratchet) and threshold
  (func 1 `[0,n]`, 1-50; `0` in a field means "leave unchanged", confirmed live).
  Verified self-restoring: threshold 12↔13 with mode held; mode ratchet↔freespin
  confirmed by the `0x2121` ratchet bit flipping.
- **HiResWheel (`0x2121`)** — `get` (func 1 mode byte: bit0 target, bit1 hi-res,
  bit2 invert; func 3 ratchet). `wheel hires/invert on|off` read-modify-write the
  mode byte via func 2, **preserving bit0 (target)** so wheel scroll delivery is
  never diverted. `invert` is gated on caps bit `0x08`. Verified self-restoring
  (invert toggled, target+hi-res preserved, mode byte restored to `0x03`).
- **ReprogrammableKeysV4 (`0x1b04`)** — list controls (cid, task, capability
  flags, current mapping) and remap one control to a target **allowed by the
  source's groupMask** (not necessarily the same group; a group-2 control with
  mask `0x3` can target groups 1 and 2). The source must be `reprogrammable`
  and the target cid must exist on the device. Verified: remapped
  `0x0056`→`0x0053`, read back, restored. Mapping a button to an arbitrary
  keystroke or macro needs the button *diverted* (its events sent to software
  instead of acted on by the mouse) and a resident daemon to handle them; that
  is **not** implemented here (a one-shot CLI cannot stay resident).

To reset a remapped control, remap it to its own cid.

Feature semantics were cross-checked against the open-source **Solaar** project
(<https://github.com/pwr-Solaar/Solaar>, `logitech_receiver/hidpp20.py`); the
`0x2201` layout was derived from live device replies.

## kiros agent protocol (reconstructed, but client is blocked)

The native device-control daemon (`com.logi.cp-dev-mgr`; "kiros" is Logitech's
internal codename for it). `logictl` sends a frame built to the format below,
but the agent **rejects unsigned clients**, so a plain Node process gets no
replies. The frame format is read from `app.asar`; the reply envelope is
reconstructed from the same static analysis and was **never acknowledged on the
wire** (the frame's structure was never validated by a peer). HID++ above avoids
this surface entirely.

- **Transport**
  - macOS/Linux unix socket: `/tmp/logitech_kiros_agent-<md5(username)>`
  - Windows named pipe: `\\.\pipe\logitech_kiros_agent-<md5(username)>`
  - the `md5(username)` suffix is confirmed against the live socket.
- **Framing** (`"json"` protocol, from `app.asar` main.js webpack module 2824):
  ```
  [uint32 LE total = protoLen + msgLen + 8]
  [uint32 BE protoLen (= 4)]
  [bytes    "json"]
  [uint32 BE msgLen]
  [bytes    message (UTF-8 JSON)]
  ```
- **Envelope** (reconstructed from `app.asar`, not observed):
  - request: `{ msgId, verb, resource:"/...", payload? }`
  - reply:   `{ msgId, status, result?, error? }`
  - verbs: `GET SET SUBSCRIBE UNSUBSCRIBE DELETE POST UPDATE`
- **Routes**: 723 resource paths in `routes.txt` (e.g. `/devices/list`,
  `/application`, `/accounts/is_authenticated`).

**Blocker.** The agent embeds a macOS code-signing requirement
(`anchor apple generic and certificate leaf[subject.O] = …`; the captured string
was truncated at the org value, inferred to be Logitech). The socket is closed
with zero bytes returned — the same on a passive connect that sends nothing,
which is what points to rejection by peer identity rather than frame content.
Inference (high confidence, not a full `accept()`-path trace): the agent drops
peers without the required Apple-issued Logitech signature, so a standalone
unsigned CLI cannot get replies. An appropriately signed process, or the signed
Electron app itself, would work (untested).

```
logictl path                          print the agent socket path
logictl routes [filter]               list known resources
logictl get <resource> [json]         (connects, but see Blocker)
logictl set|post|update|delete <resource> [json]
logictl raw <VERB> <resource> [json]
logictl watch <resource>              SUBSCRIBE stream
```

## LogiPluginService WebSocket (connect + handshake only)

A separate app (`/Applications/Utilities/LogiPluginService.app`, Mono/.NET,
Loupedeck engine) hosts a WebSocket plugin API on loopback TCP. Per the binary,
ports are picked dynamically (`TryGetFreeTcpPort`) and the server banner is
`websocket-sharp/1.0`. Only connect + handshake work so far; no post-handshake
command has been issued.

- **Upgrade (open, no auth):** `GET /logiPluginServiceNative HTTP/1.1` to
  `127.0.0.1:<dynamic>`, ws13, `permessage-deflate`. Returns `101`; no
  token/code-sign gate on the upgrade.
- **Frames:** client→server masked; compressed frames (RSV1) are
  permessage-deflate — inflate each message as raw DEFLATE with a trailing
  `00 00 ff ff` and `finishFlush: Z_SYNC_FLUSH`.
- **Schema:** `{ messageType:"Request"|"Response", id, name, parameters, data?,
  clientId?, failed, errorCode, errorMessage, ... }`
- **Handshake (verified open):** client sends
  `{"name":"Handshake","id":1,"parameters":{"tokenBase":"<GUID>"}}`; server
  replies `failed:false` with a per-session `data` token. `tokenBase` is a
  client-chosen GUID with no embedded secret, so an unsigned client completes
  the handshake (verified with `src/ws_client.js`).
- **Still open:** the post-handshake command (`name`) vocabulary; the handler
  names live in `LoupedeckService.dll`
  (`DuplexWebSocketServerMessageHandler`, `ExecuteRegisteredAction`).
- **Port discovery:** `lsof -nP -iTCP -sTCP:LISTEN | grep LogiPlugin`.

```
node src/ws_client.js <port>          upgrade + Handshake, print reply
node src/parse_pcap.js <file.pcap>    decode a captured session (tcpdump the loopback port)
```

## Files

- `src/hidpp.js` — HID++ 2.0 client (transport, feature discovery, ping).
- `src/features.js` — AdjustableDPI, UnifiedBattery, ReprogrammableKeysV4, SmartShift, HiResWheel decoders.
- `src/logihid.js` — the `logihid` CLI.
- `src/protocol.js` / `src/cli.js` — kiros transport and the `logictl` CLI.
- `src/ws_client.js` — LogiPluginService upgrade + Handshake client.
- `src/ws_probe.js` — raw WebSocket probe used during discovery.
- `src/parse_pcap.js` — decode a captured Duplex WebSocket session.
- `routes.txt` — 723 kiros resource routes.
- `PROTOCOL-LEDGER.md` — evidence ledger (tagged observed / derived / assumed …).

## Install

Requires Node >= 18.

```
git clone <this-repo> logictl && cd logictl
npm install            # pulls node-hid (the only dependency)
npm link               # puts logihid and logictl on your PATH (optional)
logihid info           # or: node src/logihid.js info
```

The kiros and WebSocket tools (`src/cli.js`, `src/ws_client.js`,
`src/ws_probe.js`, `src/parse_pcap.js`) use Node built-ins only; `logihid`
needs `node-hid`. (The output-redaction caution is under the HID++ commands
above.)
