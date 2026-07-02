# Protocol coverage audit: OSCProtocoll_260626 vs implementation

Cross-check of every address in the `OSCProtocoll_260626.xls` spec (TotalMix
FX 2.1 alpha 8 "Global OSC", all three sheets: Protocol, Description, Fader
curve) against two things: whether `src/protocol.ts` validates it (server can
send it and, where marked rw/r-, read it back), and whether the `totalmix`
skill (`SKILL.md` or `reference/*.md`) tells the model the address exists and
how to use it. An address can be in protocol.ts but still practically
unusable if the skill never mentions it, since the skill is what builds
addresses, protocol.ts only validates them.

Updated 2026-07-01 after the alpha-8 reconciliation AND a live UFX III
device-test session. Everything below reflects that state; the earlier
version of this file predates the device tests and had two errors (cuechan
marked as documented when it was not; mutegroup readability unknown).

## Spec sources checked

- Protocol sheet: full address table (also cross-checked as PDF export).
- Description sheet: legend ((f) semantics, 0-based channels, 1-based
  'numbers', 0-based list-box indices, L/R addressing), examples (proved
  controlroom/mainout & co. are channel assignments, not levels), history.
- Fader curve sheet: preserved verbatim in `docs/fader-curve.md`.
- Cell font colors inspected: nothing in the 260626 table is red
  ("not implemented yet"), so the whole table counts as live.

## Coverage result

Every address in the 260626 spec is present in protocol.ts and documented in
the skill. Notable per-area facts:

- **Matrix**: fader/faderlin/balpan/solo/groupflags all covered; groupflags
  (group-membership bitfield) documented in `reference/monitoring.md`.
  faderlin deliberately not promoted by the skill (dB-native `fader`
  preferred; official conversion kept in `docs/fader-curve.md`).
- **Channel strip**: full coverage including the long tail (record,
  playchan, msproc, phase, width, pfl, crossfeed, talkbacksel, delay,
  output reflevel) in `reference/channelstrip.md`, `mixing.md` (pfl) and
  `monitoring.md` (crossfeed, talkbacksel).
- **EQ / lowcut / dynamics / autolevel / roomeq**: complete, in
  `channelstrip.md`. loadpreset values are 0-based list-box indices per the
  Description legend (roomeq device-verified; eq/dynamics expected same,
  untested).
- **Reverb / echo**: complete, in `fx.md` (enums from the oscmix project).
- **Control room**: complete, in `monitoring.md`. mainout/mainoutb/
  phones1-4/talkchannel/cuechan/extinchannel are channel ASSIGNMENTS
  (0-based output index, -1 = unassigned, device-verified), not levels.
- **DURec, global toggles (globalmute/globalsolo/undo/redo), snapshot,
  layout, showwindow, send triggers, level meters, status**: complete, in
  `monitoring.md`.
- **layout/save**: REMOVED. It does not exist in the 260626 spec (only
  layout/load), confirmed by the maintainer against the doc; it had been carried over
  from the older wiki reconciliation and was never device-confirmed.

## Device-test findings (UFX III, TotalMix 2.1 alpha 8, 2026-07-01)

Live results that override or refine the spec table:

- **mutegroup/sologroup/fadergroup are readable.** The spec marks them
  Rec.-only, but all three states arrive in response to /sendsettings.
  protocol.ts keeps them rw; skill documents the settings-sync-then-read
  pattern.
- **Playback channels are minimal.** A /sendchan dump returns only stereo,
  name, mute, phase, msproc, width, color. No eq/dynamics/autolevel, no
  lowcut, no fxsend on playback. msproc was missing from PLAYBACK_PARAMS
  and has been added. The maintainer confirmed (2026-07-02) that playback channels
  lack eq/lowcut/dynamics/autolevel on EVERY RME device, not just the
  UFX III, so the FX blocks were removed from PLAYBACK_PARAMS in 0.5.1 and
  the server now rejects those addresses.
- **record, playchan, pfl, delay, pad: never observed on any bus.** In the
  spec and in protocol.ts, but no UFX III channel reports them; treat as
  untested.
- **Channel-type dependence on inputs**: line inputs report reflevel; mic
  inputs (8-11) report 48v/instrument/autoset instead; pad not seen.
- **Controlroom assignment values**: 0-based output index, -1 = unassigned
  (phones2/cuechan/talkchannel all -1 on the test device).
- **Echo semantics verified with "Re-send received" + "Re-send if
  different" both enabled**: TotalMix echoes a received value back ONLY
  when it had to correct it. Sending EQ band gain 99 produced an echo with
  the clamped value 20; sending a valid in-range value produced no echo at
  all. So: no echo = applied exactly as sent, echo = correction report.
  "Send changes" alone never echoes OSC-originated writes back to the
  sender. The send_osc_commands `confirm` option builds on exactly this
  correction-echo behavior.
- **Status cadence ~1 param/s** confirmed (status ages 1-3 s in a quiet
  cache).
- **settle_ms 100 is enough on the LAN** for a full strip dump via
  /sendchan (all values present ~137 ms after the trigger). Default stays
  250 ms; set GET_CHANNEL_SETTLE_MS to tune per host.
- **/sendchan does not refresh matrix crosspoints**, only strip params;
  matrix rows arrive via /sendsettings, /sendall, /sendmix, /sendsubmix.

## Still open (needs a dedicated device session)

- eq/loadpreset and dynamics/loadpreset wire numbering (expected 0-based
  per the list-box rule, only roomeq verified). Preset COUNT is settled:
  16 presets each for eq, dynamics and roomeq (maintainer, 2026-07-02), so
  UI 1..16 = wire 0..15; TotalMix does not expose the preset names over
  OSC.
- Behavior of a mono pair when both halves are meant (which values the
  partner inherits on a stereo->mono switch) — the last stereo TODO in
  SKILL.md.
- Echo behavior with "Re-send received" enabled but "Re-send if different"
  DISABLED (presumably echoes every received value, keeping the cache fresh
  after own writes) — untested, both options were on during the session.
