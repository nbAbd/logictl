# logihid — more terminal-driven mouse settings

* **Author:** nbAbd
* **Date:** 2026-11-18

## Overview

`logihid` is a terminal tool that configures a Logitech mouse directly over the
HID++ 2.0 protocol, with no Logitech software and no background process. It
already sets DPI, reports battery, lists and remaps buttons, controls SmartShift,
and toggles the hi-res wheel. The user wants to "fully use" the mouse but only
through terminal commands — explicitly no background daemon and no mapping of
buttons or gestures to actions (those cannot be set-and-forget and are therefore
out of scope by the user's own decision).

This concept adds the remaining settings that can be changed in one shot, and a
way to save and re-apply a whole configuration from a file.

## Analysis

A single-orchestrator pass (grounded in reading `src/hidpp.js`, `src/features.js`,
`src/logihid.js`) produced the findings below. The seven independent review
lenses did not return before the orchestrator was forced to hand back, so they
are recorded as "not run"; re-running the swarm would give true multi-lens
coverage. Nothing below is invented lens output.

**Central threat — Logi Options+ silently reverts settings.** The Options+
background agent (`logioptionsplus_agent` + `LogiPluginService`) is running on
this machine. It may re-apply its own values when the mouse reconnects or the
active app changes. A one-shot `set`, or a `profile apply`, can therefore report
success and then be overwritten. With no daemon, the tool cannot defend a setting
continuously. The design response is not to fight it but to make the loss
visible: after any write, read the value back and report whether it stuck or
reverted, and warn when Options+ is detected running.

**Host switch is a one-way door that looks like a failure.** HID++ `0x1814`
changes the mouse's active host. The instant it takes effect, the mouse drops its
Bluetooth link to this machine and connects to another, so the CLI never receives
the echoed reply and the normal 2000 ms read-back times out. Naive code would
report a false failure on a successful switch. Switching to a slot that is not
paired or whose target machine is offline could leave the mouse apparently
"stranded" (recoverable with the mouse's physical Easy-Switch button, but
confusing). This needs a pre-flight check and different success semantics.

**Thumbwheel is speculative.** It is not confirmed that the MX Master 3S even
reports feature `0x2150`, and its byte layout is not confirmed against Solaar.
"If it mirrors the main wheel" is an assumption, not a spec.

**A profile file is a new public contract.** "Snapshot every setting" is tied to
one device model. Applied to a different mouse it would error or write garbage, so
the file needs a device identity, a schema of semantic values (not raw bytes),
and a version field.

**Ideal Final Result.** `logihid` stays zero-config, no-daemon, single-device.
The highest-value add is profiles, reframed from "apply and hope" to "apply, then
read back and report drift" — which turns the Options+ threat into an observable
feature. Host switch is worth adding but only when gated. Thumbwheel waits for a
one-session spec check.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * `profile save <file>` / `profile apply <file>` — snapshot current DPI,
    SmartShift (mode + threshold), and wheel (hi-res, invert) to a JSON file and
    re-apply it. Apply reads every setting back and reports, per setting, whether
    it stuck or reverted (drift report). This is the main deliverable.
  * `host` — `logihid host` lists paired hosts and their state via `0x1815`
    HostsInfo; `logihid host <n>` switches to slot `n`, but only after validating
    the slot is paired, treating the post-write timeout as expected success, and
    printing that the disconnect is normal and the Easy-Switch button is the undo.
  * An "Options+ is running" warning shown by setters, and a `--verify` /
    read-back-diff behaviour as the norm for every write.
* **Out-of-Scope Non-Goals:**
  * Any background daemon or resident process.
  * Mapping buttons, gestures, or the thumbwheel to actions (keystrokes, app
    switch, scripts) — ruled out by the user.
  * Thumbwheel settings, until a spec spike confirms the device exposes `0x2150`
    and its layout.
  * Multi-device / receiver-paired support (indices 1-6) and non-MX-Master-3S
    models beyond best-effort.

## Alternatives Weighed

* **Build a resident daemon to catch button/gesture events and re-assert
  settings.** Rejected by author: they explicitly want terminal-only, no daemon.
* **Fight Options+ (kill or block its agent).** Rejected: fragile and hostile;
  detect-and-warn plus a drift report is safer and more honest.
* **Store profiles as raw HID++ bytes.** Rejected: not portable across models and
  unreadable; store semantic values with a version and device identity instead.
* **Add thumbwheel now.** Deferred: unconfirmed the device exposes `0x2150` and
  the layout is unverified; adding it now risks wrong writes.

## Key Decisions & Staging for Next Steps

* Profiles are the primary feature; a mandatory read-back drift report is part of
  the definition, not an option.
* Profile file is JSON: `version`, `device` {model, productId, firmware}, and
  semantic settings. Apply is best-effort per setting — skip what the target
  device lacks, report applied / skipped / reverted.
* Host switch ships only with `0x1815` pre-flight, confirmation (or `--force`),
  timeout-as-success, and Easy-Switch documented as the recovery.
* Thumbwheel is a separate spike: confirm `0x2150` in `logihid info`, then confirm
  layout against Solaar `settings_templates.py` before any write.
* All writes gain read-back-diff; setters warn when Options+ is detected.
* Open question for a true review: re-run the 7 lenses, since this brief is a
  single-orchestrator fallback.
