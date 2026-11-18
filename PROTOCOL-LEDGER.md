# LogiOptions+ RE — Finding Ledger

Target: Logitech Options+ (logioptionsplus), macOS, version 2.9.1013853 (Electron UI bundle).
RE = reverse engineering; REA = the static-analysis tool used on the binaries.

**Outcome (current):** the working path is **direct HID++ to the mouse**
(`logihid`) — DPI get/set, battery, and button remap verified live on an
MX Master 3S (see HID++ DIRECT at the bottom). The original goal of driving
Logi Options+ was dropped: the kiros agent locks unsigned clients out (code
signature check), and the LogiPluginService WebSocket only gets as far as the
handshake. This ledger is an append-only chronology; sections headed
SUPERSEDED/HISTORIC are overturned by later entries, and `[UNK]`/`[TODO]` lines
inside them are no longer open — they belong to the dropped Logi Options+ goal.

Method: static analysis (REA) + live process/socket inspection, then
user-approved device writes over HID++ (DPI set, button remap). No Frida/gdb
instrumentation of the Logitech processes.
Tags: [OBS] observed from bytes/run · [DER] derived from observed · [ASM] assumed ·
[VERIFIED] re-confirmed live · [CORRECTED] supersedes an earlier entry ·
[HYP] hypothesis · [UNK] open question · [OPTIONS] approaches weighed ·
[TODO] follow-up · [NOTE] method note · [TOOL] code artifact ·
[SUPERSEDED]/[HISTORIC] (in a heading) overturned or abandoned by a later entry.

## Component inventory
- [OBS] UI: `/Applications/logioptionsplus.app`, Electron. Info.plist CFBundleShortVersionString 2.9.1013853. Main executable 102 KB (shell only).
- [OBS] app code: `Contents/Resources/app.asar` (61,850,330 bytes). Copied to scratchpad `logi-re/asar/app.asar` for analysis.
- [OBS] Electron Framework universal (x86_64+arm64), sha256 1570e33a...3776.
- [OBS] Native agent: `/Library/Application Support/Logitech.localized/LogiOptionsPlus/logioptionsplus_agent.app`, bundle id `com.logi.cp-dev-mgr`, universal Mach-O. Qt-based ([OBS] `Contents/MacOS/platforms/` = Qt QPA plugin dir).
- [OBS] Crash handler: `logi_crashpad_handler` (Crashpad).
- [OBS] Updater: `.../logioptionsplus_agent.app/Contents/Frameworks/logioptionsplus_updater.app` (`logioptionsplus_updater`).
- [OBS] Separate service: `LogiPluginService` (a distinct process at inspection) — plugin host.
- [OBS] Related data dirs: `~/Library/Application Support/{logioptionsplus, LogiOptionsPlus, Logi, com.logitech.logiaipromptbuilder}`. NOT read (user data/tokens).

## Launch topology
- [OBS] `/Library/LaunchAgents/com.logi.optionsplus.plist`: Label `com.logi.cp-dev-mgr`, Program = agent, args `--launchd`, RunAtLoad true, KeepAlive{SuccessfulExit=false}, LimitLoadToSessionType Aqua. Per-user login agent.
- [OBS] `/Library/LaunchDaemons/com.logi.optionsplus.updater.plist`: Program = `logioptionsplus_updater`. Root daemon.
- [OBS] Running at inspection: the agent (`--launchd`), the updater, the Electron main process (+ GPU/network/renderer helpers), and LogiPluginService (concrete pids redacted — they vary per boot).
- [OBS] Renderer registers custom URL scheme `poster` (`--standard-schemes=poster --fetch-schemes=poster`).

## Electron hardening (fuses, both slices identical)
- [OBS] RunAsNode disabled; EnableNodeCliInspectArguments disabled; EnableCookieEncryption enabled; EnableNodeOptionsEnvironmentVariable enabled; EnableEmbeddedAsarIntegrityValidation enabled; OnlyLoadAppFromAsar enabled; GrantFileProtocolExtraPrivileges enabled; WasmTrapHandlers enabled.
- [DER] Cannot attach Node Inspector or ELECTRON_RUN_AS_NODE to the shipped build; asar integrity enforced. Static analysis is the right path; runtime of the UI would need a repack (out of scope unless asked).

## IPC seams (OBS, live sockets)
- [OBS] Agent listens on a `TCP *:<port> (LISTEN)` — bound to all interfaces, not just loopback.
- [OBS] Agent unix domain socket path `/tmp/logitech_kiros_agent-<md5(username)>` ("kiros" = Logitech internal codename for the device-manager agent).
- [OBS] LogiPluginService listens on several `127.0.0.1:<dynamic>` loopback ports (ephemeral, vary per run).
- [DER] Electron UI ↔ backend bridge is one of: websocket to LogiPluginService loopback ports, and/or the kiros unix socket / agent TCP port. Exact UI-side channel pending app.asar main-process analysis.

## Open unknowns (HISTORIC — belong to the dropped Logi Options+ goal; not open work)
- [UNK] How the UI discovers the dynamic backend port(s) (port file? fixed handshake?). Resolve from app.asar main JS or a port/config file.
- [UNK] Why the agent binds its TCP port on all interfaces (`*`) vs loopback — security-relevant; confirm bind addr + any auth.
- [UNK] app.asar module graph / main+preload+renderer entry points. (The JS-graph analysis was dropped — see REA note under CORRECTION.)

## Feature areas (HISTORIC — Logi Options+ surface map, never pursued once HID++ direct shipped)
Device management, key/button remapping, Flow (multi-device), Smart Actions, firmware update, AI Prompt Builder (com.logitech.logiaipromptbuilder), plugin system (LogiPluginService).

## PROTOCOL (socket/connection facts stand; the FRAMING below is SUPERSEDED)
Only the framing at :62-63 is superseded — it conflated the pluginService socket's `channelName` form with kiros; the kiros frame is the literal `"json"` form in CORRECTION. The socket path, peer, and md5 facts (:57-60) are still valid and are cited by the README. (Historic goal: build a CLI/MCP/skill to drive LogiOptions+.)
- [DER] Drive-the-device seam = kiros unix socket, NOT LogiPluginService TCP (that loopback pair is internal, both Logitech processes).
- [OBS] The Electron main process connects (unix fd) to the agent's kiros listener. Confirmed peer.
- [OBS] main.js path builder N(t): macOS/unix `/tmp/<t>-<MD5(username)>`; Windows `\\.\pipe\<t>-<MD5(username)>`. t="logitech_kiros_agent" (device/control), "logitech_kiros_logivoice" (voice).
- [DER][VERIFIED] md5(username) == the live socket suffix. CLI computes the path at runtime, no hardcode. (Concrete username/hash redacted — it is a per-user identifier.)
- [OBS] Transport = net.createConnection(path); reconnectInterval 100ms.
- [OBS][SUPERSEDED by CORRECTION] Framing guess: [totalLen UInt32LE][channelName-len UInt32BE][channelName][msgLen UInt32BE][message]. Wrong for kiros — this is the pluginService form; the kiros frame uses the literal `"json"` field (see CORRECTION / GATE RESULT).
- [OBS][SUPERSEDED by CORRECTION] "channelName field" belongs to the pluginService socket, not kiros.

## BLOCKER for message vocabulary (HISTORIC — moot once kiros proved code-sign-gated; the OPTIONS below were never pursued)
- [OBS] Renderer app.min.js (11.6MB) is string-array obfuscated (_0x hex ids; strings decoded at runtime, e.g. 'method','SET_BOLT_D'). channelName values + per-command payload schemas are built there.
- [OPTIONS] (a) de-obfuscate app.min.js string array (static, safe, heavy); (b) observe real frames on live socket (fast, but writes/instrumentation touch privileged agent — needs user OK); (c) hybrid: de-obfuscate enough to find channelName enum, confirm with one read-only frame.

## SAFETY GATE
- [NOTE] Agent is a login-privileged device-control daemon. Do NOT send frames (even read requests) until frame variant pinned + user OK. Malformed frames could crash it. Replies may carry device serials/account data -> keep out of chat.
- [NOTE] GATE CLEARED: user approved sending one well-formed read frame; result recorded in GATE RESULT below (agent accepted-then-closed, 0 bytes, no crash). Later device writes (HID++ DPI set, button remap) were separately user-approved and are on the mouse, not this agent.


## CORRECTION (supersedes the PROTOCOL section above)
- [ASM] The `configui` + `{messageType:Request,channelName}` + `name-id` key belong to `pluginServiceSocket` module (16-byte-header LE, two-arg v.send(p,msg)), NOT the kiros agent.
- [ASM] kiros agent uses the `"json"` network module: one-arg send(t); 2nd frame field is literal string "json", not a channel name. Frame candidate: [total u32LE][4 u32BE]["json"][msgLen u32BE][message].
- [TODO→DONE] Resolve the kiros send module: done — the `"json"` framing was confirmed from module 2824 and sent live (see GATE RESULT). The envelope was reconstructed but never acked (agent is code-sign-gated), so no further vocabulary work followed.
- [NOTE] REA dropped for JS graph: whole-asar analyze timed out at 300s. Used direct reads of extracted modules instead.

## GATE RESULT + BLOCKER (observed + derived)
- [OBS] CLI connects to /tmp/logitech_kiros_agent-<md5(user)>, sends a well-formed "json" frame (GET /application, hex verified: total=62, proto="json", msg=50B).
- [OBS] Agent reads the frame, sends FIN, closes, 0 bytes returned. Same for passive (no-data) connect. Agent file logs are 0 bytes (logging off) - no reason captured there.
- [OBS] Agent binary contains macOS code-signing requirement string: `anchor apple generic and certificate leaf[subject.O] = "`.
- [OBS] Agent source paths: logi/api/src/server_named_pipes/server_impl.cpp (+ subscriptions.cpp), logi/api/src/server_websocket/server_endpoint.cpp, server_impl.cpp.
- [DER] The kiros named-pipe/unix-socket server validates the connecting peer's code signature (SecCode requirement pinned to Apple + Logitech org leaf). Unsigned node client -> accepted then dropped before reply. A standalone userland CLI CANNOT drive the kiros agent socket. Confidence: high (requirement string + server source + accept-then-close behavior), not a full accept()-path trace.
- [OBS] Transport + "json" framing + 723 resource routes solved from the binary. [DER] The request envelope {msgId,verb,resource,payload} and the reply envelope {msgId,status,result,error} + verb enum are reconstructed from `app.asar` static analysis; NO reply was ever observed on the wire (the agent closes with 0 bytes), so the reply shape is derived, not observed.

## VIABLE ALTERNATIVE (explored; SUPERSEDED by HID++ direct as the shipped path)
- [OBS] A separate service/app, `LogiPluginService.app` (server_websocket), exposes a WebSocket server on loopback TCP (dynamic ports) and integration routes: /api/v1/integration/register, /api/v1/actions/{register,invoke}, /api/v1/integration/sdk/action/invoke, /lps/start_icons_api_session, /api/websocket_server.
- [HYP] This is Logitech's sanctioned third-party integration/plugin API; likely token/registration-based (NOT code-sign-pinned, since it is meant for third parties). It was a candidate CLI target, but only connect+handshake were solved; HID++ direct became the shipped path instead.

## LogiPluginService WebSocket (observed, loopback capture)
- [OBS] ws upgrade: GET /logiPluginServiceNative HTTP/1.1 to 127.0.0.1:<dynamic>; ws13; Sec-WebSocket-Extensions: permessage-deflate. Server -> 101 Switching Protocols, negotiates permessage-deflate; client_no_context_takeover; server_no_context_takeover. NO Authorization/token on upgrade -> upgrade is open (not code-sign gated).
- [OBS] My own unsigned Node ws client upgraded successfully (101). Server then sends nothing: Duplex handshake is CLIENT-initiated.
- [OBS] Duplex message schema (server Response decoded via inflateRaw): {responseTime, failed, errorMessage, errorCode, clientId, createdTicks, data, parameters, messageType:"Request"|"Response", id, name}.
- [OBS] First exchange name="Handshake". Server Response: clientId=null, data=<27-byte hex, per-session nonce>, failed=false.
- [UNK→RESOLVED below] Client's Handshake Request content (its first msg didn't inflate here - pcap truncated at 2166B). Whether an unsigned 3rd-party client can complete the Handshake — RESOLVED in "WS HANDSHAKE SOLVED": yes, tokenBase is client-chosen, no secret.
- [TOOL] src/ws_probe.js (minimal ws client+inflate), src/parse_pcap.js (pcap->inflated Duplex msgs).

## WS HANDSHAKE SOLVED (observed, verified live)
- [OBS] Client Handshake Request: {"parameters":{"tokenBase":"<client GUID, upper>"},"id":1,"name":"Handshake"}
- [OBS] Server Response: {responseTime,failed:false,errorMessage:"",errorCode:0,clientId:null,createdTicks:<int>,data:"<27-byte hex, per-session>",parameters:{},messageType:"Response",id:1,name:"Handshake"}
- [OBS][VERIFIED] My own unsigned Node ws client (src/ws_client.js) connected to ws://127.0.0.1:<dynamic>/logiPluginServiceNative, sent Handshake with a random GUID tokenBase, got failed:false + a data token. tokenBase is client-chosen -> NO embedded secret; handshake is OPEN to third-party clients.
- [OBS] Frames: client->server masked; permessage-deflate with *_no_context_takeover (inflate each msg with trailing 00 00 ff ff, finishFlush Z_SYNC_FLUSH). Client may send uncompressed (rsv1=0); server accepts.
- [UNK] Post-handshake request `name` vocabulary + whether `data`/clientId token is required on subsequent calls. Next.

## HID++ DIRECT (THE WORKING PATH) — verified live on MX Master 3S
- [OBS] Device: Logitech MX Master 3S, Bluetooth Low Energy, VID 0x046d PID 0xb034. HID++ collection usagePage 0xff43 / usage 0x0202, 20-byte I/O reports.
- [OBS] node-hid opens the 0xff43 collection on macOS (SIP on, no special entitlement). WRITES MUST be 20-byte long reports (report id 0x11); short reports (0x10) rejected ("Cannot write"). Device index 0xff. sendFeatureReport unsupported (MaxFeatureReportSize=1).
- [OBS][VERIFIED] Ping (feat 0x00 func 0x1 sw 0x5, data 00 00 AA) -> 11ff0015 04 05 aa: HID++ protocol 4.5, echo 0xAA. Two-way comms confirmed.
- [OBS][VERIFIED] FeatureSet 0x0001 enumeration: 36 features (idx 0..35). Relevant: 0x1004 UnifiedBattery v3 (idx 8), 0x1b04 ReprogrammableKeysV4 v5 (idx 9), 0x2201 AdjustableDPI v2 (idx 13), plus 0x2110 SmartShift, 0x2121 HiResWheel, 0x2150 Thumbwheel, 0x1814/0x1815 host switch.
- [OBS][CORRECTED] Feature 0x2201 (Adjustable DPI) index = 13. Function numbers were initially SWAPPED in notes. Correct, confirmed by raw bytes:
    - func 1 getSensorDpiList(sensor): raw 11ff0d15 00 00c8 e032 1f40 -> sensor 0, then 16-bit BE values; a value >= 0xE000 is a step marker (0xE032 = step 50). Decodes to range 200..8000 dpi step 50.
    - func 2 getSensorDpi(sensor): raw 11ff0d25 00 03e8 03e8 -> sensor 0, current = 0x03E8 = 1000 dpi, default = 0x03E8 = 1000 dpi.
    - (The earlier "current 200 / default 57394" reading was the list decoded with the getSensorDpi layout — 57394 = 0xE032, the step marker. Bogus; discarded.)
- [OBS][VERIFIED] Feature 0x2201 func 3 setSensorDpi(sensor, hi, lo): live self-restoring round trip set 1000 -> 1050, readback 1050, held across a 3 s re-read, then restored to 1000. DPI set works and takes effect. NOTE: Logi Options+ was NOT running during the test (pgrep empty), so override-by-Options+ was not exercised; power-cycle persistence not tested. CLI `dpi set 1000` -> exit 0; `dpi set 1025` -> rejected (not on step 50), exit 1, no write.
- [OBS][VERIFIED] Feature 0x1004 UnifiedBattery (idx 8) func 1 getStatus: payload [0]=percent, [1]=level mask (8 full/4 good/2 low/1 critical), [2]=charging status. Live read: 90% / full / discharging.
- [OBS][VERIFIED] Feature 0x1b04 ReprogrammableKeysV4 (idx 9): func 0 getCount, func 1 getCtrlIdInfo(index) -> cid(2) tid(2) flags1(1) pos group gmask flags2, func 2 getCidReporting(cid). Live list: 8 controls. groups: 0x0050/0x0051 grp1 gmask0x1 (mouse, left/right, NOT reprogrammable); 0x0052/0x0053/0x0056/0x00c3/0x00c4 grp2 gmask0x3 (reprogrammable+divertable); 0x00d7 grp3 gmask0x0 (divertable+virtual). Layout per Solaar hidpp20.py.
- [OBS][VERIFIED] Feature 0x1b04 func 3 setCidReporting(cid, bfield=0x00, remap(2)): live self-restoring round trip remapped 0x0056 -> 0x0053 (readback 0x0053), then restored 0x0056 -> 0x0056. Remap-only uses bfield 0x00 (no divert flags changed); the remap field is always applied, remap=0 would KEEP current, reset = remap to own cid. Validation: source must be reprogrammable, and the target's group bit must be set in the source's groupMask (i.e. `groupMask & (1 << (targetGroup - 1))`) — this can span groups, it is not same-group-only.
- [DER] Button->arbitrary-key/macro mapping requires DIVERT + a resident daemon to handle events; a one-shot CLI cannot do it. Control->control remap is one-shot and is implemented + verified — the target need only be allowed by the source's groupMask (NOT same-group: a group-2 source with gmask 0x3 can target groups 1 and 2).
- [DER] HID++ is the CLI path that works: no Logitech code-sign gate (we own the device), no SIP change, no agent. This bypasses the code-sign-locked kiros agent entirely.
- [TOOL] src/hidpp.js (client: call/getFeatureIndex/ping/listFeatures), src/features.js (DPI/BATTERY/BUTTONS decoders), src/logihid.js (CLI: info/dpi/battery/buttons/raw). dep: node-hid@3.1.2.
