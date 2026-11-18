# Goldfish Annotated Review Report

**Status: resolved** — Round 1 auto-accepted. PROPOSE FIX items 1-18 (lead) + 21 applied to README.md, PROTOCOL-LEDGER.md, and src/logihid.js. CONTEST #18 (full rename) and DECLINE #19/#20 left as-is.

## Round 2 (fresh swarm on the edited docs) — auto-accepted

All 5 reviewers: **zero Blockers.** codebase_details re-verified every byte
offset, function number, feature ID, and example output against the code; the
`num()` hex fix confirmed correct. Majors were consistency/calibration, applied:

- **Button-remap group rule** (4 reviewers): `ledger:120` said "within a group",
  contradicting the code (`features.js:141` groupMask) and the corrected README.
  Fixed — ledger now states the groupMask rule (can span groups).
- **Ledger supersession sweep** (3 reviewers): stale `[UNK]`/`[TODO]`/OPTIONS for
  the dropped Logi Options+ goal read as live. Marked HISTORIC/SUPERSEDED; the
  `[TODO]` frame item closed; the WS `[UNK]` back-marked RESOLVED.
- **Over-marked PROTOCOL section**: the blanket "SUPERSEDED" discarded the still-
  valid, README-cited md5/connection facts. Narrowed the mark to the framing only.
- **kiros overclaim**: "sends well-formed frames / framing confirmed" → "frame
  built to the format below / never acknowledged on the wire"; passive-close note
  added; double-hedge and "presumably" trimmed.
- **Lede overclaim**: "Configure … battery … buttons" → "Set DPI, read battery,
  remap buttons (control-to-control)"; "Logi Options+ surfaces" → "Logitech
  control surfaces".
- **"receiver" defined**; `git clone`/Node>=18 added to Install; duplicated
  privacy warning removed; `logictl get [json]`; WS binary-string provenance
  tagged; `ledger:9` "locked to" inverted; SAFETY GATE tagged `[NOTE]`;
  `[SUPERSEDED]/[HISTORIC]` added to the tag legend.

Remaining (not fixed, by judgment): section volume of the two blocked surfaces
(reference detail, kept after the working path); internal RE breadcrumbs in the
ledger (`N(t)`, `g=…`) — acceptable in a chronology; a few minor undocumented CLI
edge cases (timeouts, exit codes).

**Target:** `README.md` (1-171) + `PROTOCOL-LEDGER.md` (1-106), full file
**Reviewers:** codebase_details, comprehension, style, structural, zoom_out (Round 1)

codebase_details verified every byte offset, function number, feature ID, flag
mask, and example output in the docs against `src/*.js` and found them accurate.
The findings below are about calibration, provenance, scope, structure, and
hygiene — not wrong protocol facts. Findings are deduplicated across reviewers.

## Prioritized Findings & AI Suggestions

### [1] Ledger method line contradicts the device writes — Severity: Blocker
*   **Reviewers:** style, structural, comprehension
*   **Scope:** `PROTOCOL-LEDGER.md:3-4`, SAFETY GATE `:54-55`
*   **Discrepancy:** Front matter says "static-only … read-only. No instrumentation", but `:65` sends a frame and `:100/:103` perform DPI/button writes. The SAFETY GATE ("Do NOT send frames … until user OK") is never marked cleared.
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:** Rewrite `:3-4` to "static analysis + live read, then user-approved device writes (DPI set, button remap)". Add a dated entry recording the gate was cleared with user "ok".

### [2] kiros reply envelope/verbs mistagged [OBS] and called "complete" — Severity: Blocker
*   **Reviewers:** style (x2), comprehension, zoom_out
*   **Scope:** `PROTOCOL-LEDGER.md:70`; `README.md:84` ("complete"), `:87` ("speaks its protocol correctly"), `:102-105` (envelope/verbs)
*   **Discrepancy:** Reply envelope + verbs tagged observed, but `:66/:69` record zero reply bytes ever returned. Shape is from `app.asar` static analysis, never seen on the wire.
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:** Retag ledger `:70` [DER]. README: "complete, verified" → "reconstructed from `app.asar` static analysis; request framing sent, no reply ever observed". Soften `:87`.

### [3] Two incompatible kiros framings in the ledger, superseded not marked — Severity: Blocker
*   **Reviewers:** comprehension (Blocker), structural, style
*   **Scope:** `PROTOCOL-LEDGER.md:41-49` (channelName layout) vs `:58-60` ("json" layout)
*   **Discrepancy:** `:47` gives a `channelName` frame; `:60` gives the literal `"json"` frame. The `:41` heading says "ASSUMED … two sockets conflated" but nothing marks which is current. A reader cannot tell.
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:** Prefix `:41-49` with "SUPERSEDED by the CORRECTION at :58 — this conflated the pluginService socket; the kiros framing is the `json` form below." Point to it explicitly.

### [4] Core value buried; lead over-scopes to "Logi Options+" — Severity: Major
*   **Reviewers:** zoom_out, structural, comprehension
*   **Scope:** `README.md:1-6`
*   **Discrepancy:** The win (direct HID++ mouse control, no Logitech software, no code-sign, SIP on) appears only in a table cell. Lead frames the project as "control surfaces for Logi Options+", but the working path bypasses Logitech software entirely.
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:** New lead sentence: "Configure a Logitech mouse's DPI, battery read-out, and buttons directly over HID++ 2.0 — no Logitech software, no code-signing. Plus a reverse-engineered study of two Logi Options+ surfaces."

### [5] Install last + bare `logihid` vs `node src/logihid.js` mismatch — Severity: Major
*   **Reviewers:** comprehension, style, structural, codebase_details
*   **Scope:** `README.md:163-166` vs command blocks `:22-30,116-120,146-149`
*   **Discrepancy:** Examples use bare `logihid`/`logictl`, Install shows only `node src/logihid.js info` and no `npm link`. A reader following Install then typing `logihid dpi` gets command-not-found.
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:** In Install add `npm link` (or `npm install -g .`) to expose `logihid`/`logictl`, and state the examples assume that. Move the install note above the first command block.

### [6] Tag legend incomplete — Severity: Major
*   **Reviewers:** style, structural, comprehension
*   **Scope:** `PROTOCOL-LEDGER.md:5`, echoed `README.md:159`
*   **Discrepancy:** Legend defines OBS/DER/ASM; body also uses UNK, HYP, TODO, NOTE, TOOL, OPTIONS, VERIFIED, CORRECTED.
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:** Complete the legend with all tags used; update README:159.

### [7] Button remap "within its group" is wrong — Severity: Major
*   **Reviewers:** codebase_details, style, comprehension
*   **Scope:** `README.md:70-71`, `PROTOCOL-LEDGER.md:104` vs `features.js:137-143`
*   **Discrepancy:** Code validates `src.groupMask & (1 << (dst.group-1))`; group-2 controls carry gmask `0x3` (groups 1 and 2), so the target is NOT restricted to the same group. Also undocumented: target cid must already exist, source must be `reprogrammable`.
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:** "remap one control to another control id allowed by the source's groupMask (not necessarily the same group); the source must be reprogrammable and the target must exist on the device." Fix ledger `:104` to match `:103`.

### [8] `raw`/`buttons remap` silently truncate bare hex (CODE BUG) — Severity: Major
*   **Reviewer:** codebase_details
*   **Scope:** `README.md:29`, `logihid.js:30-36`
*   **Discrepancy:** Doc says "hex or dec args", but `num()` only treats `0x`-lowercase as hex; bare `1b04` → `parseInt(...,10)` = 1 (no error), uppercase `0X1A` = 0. Wrong feature/func/cid silently written to the device.
*   **AI Suggestion:** PROPOSE FIX (code + doc)
*   **Proposed Edit:** Harden `num()`: `0x`/`0X` → base 16; else require `/^\d+$/` and error otherwise (reject `1b04` instead of returning 1). Doc: "integers; prefix hex with `0x`".

### [9] Code-sign claim overstated vs truncated capture — Severity: Major
*   **Reviewers:** style (x2), comprehension, zoom_out
*   **Scope:** `README.md:109-114` vs `PROTOCOL-LEDGER.md:67-69`
*   **Discrepancy:** `:67` captured the requirement truncated at `= "`, so the org ("Logitech") is inferred, not read; `anchor apple generic` means an Apple-issued dev cert, not "signed by Apple". README states the [DER] conclusion and "would work from a signed process" as fact.
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:** "embeds a code-signing requirement (`anchor apple generic and certificate leaf[subject.O] = …`; the org value was captured truncated and is inferred to be Logitech). Inference (high confidence, not a full accept()-path trace): the agent drops peers without the required signature." Hedge the "signed process would work" line as untested.

### [10] "Transport facts (hardware-verified)" covers the never-observed error reply — Severity: Major
*   **Reviewer:** style
*   **Scope:** `README.md:50` heading over `:56-57`
*   **Discrepancy:** Only ping, feature-enum, DPI, battery reads were observed; the error-reply layout was not. "hardware-verified" over-asserts.
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:** Mark the error-reply bullet "(layout per HID++ spec; not triggered in testing)".

### [11] `logictl` command list incomplete — Severity: Major
*   **Reviewer:** codebase_details
*   **Scope:** `README.md:116-120` vs `cli.js:69-87`
*   **Discrepancy:** Doc shows only `path`, `routes`, `get`; code also has `set`, `post`, `update`, `delete`, `raw <VERB> <resource>`, `watch`.
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:** List the remaining verbs (or "set/post/update/delete/raw/watch — see `logictl --help`").

### [12] Working result is last in the ledger, no top status summary — Severity: Major
*   **Reviewers:** zoom_out, structural
*   **Scope:** `PROTOCOL-LEDGER.md:91` (after 90 lines of blocked/superseded work); stale goal `:41`
*   **Discrepancy:** The one working outcome (HID++ direct) is last; the stale "drive LogiOptions+" goal is never corrected at the top.
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:** Add an "Outcome" line at the top: working path = direct HID++ (DPI/battery/buttons verified); the drive-LogiOptions+ goal was dropped (kiros code-sign blocked).

### [13] Ledger leaks identifiers it tells readers to redact — Severity: Major (hygiene)
*   **Reviewers:** zoom_out, style, structural, comprehension
*   **Scope:** `PROTOCOL-LEDGER.md:20,29-30,45` (username `nurbekdev`, `md5(username)=7176b66a…`, live pids, dynamic ports)
*   **Discrepancy:** README `:170` warns to keep identifiers out of shared channels; the ledger embeds them.
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:** Replace the username with `<user>`, the hash with `<md5(username)>`, and drop the concrete pids/ports (keep "dynamic port").

### [14] Over-broad scope claim — Severity: Major
*   **Reviewers:** comprehension, codebase_details, zoom_out
*   **Scope:** `README.md:3,17`
*   **Discrepancy:** "Logitech mice speak HID++ 2.0 over USB/Bluetooth" — verified only on one MX Master 3S over BLE; the client fixes `deviceIndex=0xff`, so receiver-paired devices (index 1-6) are unreachable.
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:** Scope to "verified on an MX Master 3S over BLE; other HID++ mice are expected to work but untested. Directly-connected devices only (receiver-paired indices not handled)."

### [15] `ws_probe.js` / `ws_client.js` drift — Severity: Nit
*   **Reviewers:** all five
*   **Scope:** `README.md:151-159` (lists only ws_client.js) vs `PROTOCOL-LEDGER.md:82` (cites ws_probe.js). Both files exist on disk.
*   **AI Suggestion:** PROPOSE FIX
*   **Proposed Edit:** List both in README Files (`ws_client.js` = handshake client, `ws_probe.js` = probe), or remove the unused one. Reconcile the ledger reference.

### [16] Undefined terms / jargon — Severity: Nit
*   **Reviewers:** comprehension, zoom_out, style
*   **Scope:** RE/REA (`LG:1,4`), kiros (`RM:84`), group/divert (`RM:69-74`), SW `0x05` (`RM:55`)
*   **AI Suggestion:** PROPOSE FIX (selective)
*   **Proposed Edit:** Expand on first use: "kiros (Logitech's internal codename for the device-manager agent)"; one line on divert/group for remap; "`0x05` = software id". Leave REA session provenance in the ledger only.

### [17] Residue, adjectives, minor provenance — Severity: Nit
*   **Reviewers:** style, structural, comprehension, codebase_details
*   **Items:** "fully"/"clean" adjectives (`RM:5`, `LG:105`); `--pid` undocumented; `raw` is also a write path; Solaar link missing; "2.0" vs reported "4.5"; "(advisor)", "Next.", session-note residue in ledger.
*   **AI Suggestion:** PROPOSE FIX (batch, trivial) for adjectives/`--pid`/`raw`-write/Solaar link/residue; DECLINE battery-fallback and request-timeout documentation (internal detail).

### [18] Rename the repo/H1 from `logictl` to the working tool — Severity: Nit/Major (split)
*   **Reviewers:** zoom_out, structural, style, comprehension
*   **Scope:** `README.md:1`
*   **AI Suggestion:** PROPOSE FIX the *lead clarification*; CONTEST the *full rename*.
*   **Justification (contest):** `package.json` `bin` ships both `logihid` and `logictl`; the package name is a container, not a claim that `logictl` works. A full repo rename is churn.
*   **Proposed Edit:** Keep the name; add to the lead: "the working CLI is `logihid`; `logictl` is the blocked kiros client, kept for reference."

### [19] flags2 capability bits can never surface — Severity: Nit
*   **Reviewer:** codebase_details
*   **Scope:** `features.js:96` folds `flags2<<8`, but `CTRL_FLAGS` (`:81`) defines no bit above `0x80`.
*   **AI Suggestion:** DECLINE (record)
*   **Justification:** Latent only — every observed control reports flags2 = 0, so no capability is currently hidden. Worth a code comment, not a doc change.

### [20] No reproducible test harness — Severity: Nit
*   **Reviewer:** codebase_details
*   **AI Suggestion:** DECLINE (accepted risk)
*   **Justification:** The "verified" claims are live-hardware observations; a unit test cannot exercise a physical mouse in CI. Recorded as a known limitation, not a defect to fix.

### [21] LogiPluginService "separate app" vs ledger "same backend" — Severity: Nit
*   **Reviewer:** style
*   **Scope:** `README.md:124` vs `PROTOCOL-LEDGER.md:73`
*   **AI Suggestion:** PROPOSE FIX
*   **Justification:** `/Applications/Utilities/LogiPluginService.app` is observably a distinct bundle (`README:57`), so "separate app" is correct; ledger `:73` "same backend" was a loose early note.
*   **Proposed Edit:** Fix ledger `:73` to "a separate service/app (LogiPluginService.app)".

## Summary

- PROPOSE FIX: 1-18 (18 issues), 21 — calibration, scope, structure, hygiene, one code bug (#8).
- CONTEST: #18 (full rename only).
- DECLINE: #19, #20 (recorded, no change).
- No ESCALATE items — every finding is checkable in the docs or `src/`.

Round is **not clean** (multiple unsettled Blocker/Major), so after fixes a
second review round is warranted to converge.
