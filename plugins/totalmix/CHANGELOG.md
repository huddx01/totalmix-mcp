# Changelog

All notable changes to the totalmix plugin are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/).

Versioning tiers (see ../../RELEASING.md): 0.0.x alpha, 0.x.0 beta, 1.0.0+
release. The version here must match the `version` field in
`.claude-plugin/plugin.json`.

## [0.7.3] - 2026-08-04

### Changed
- make dependabot happy

## [0.7.2] - 2026-07-05

### Changed
- restructure skills

## [0.7.1] - 2026-07-05

### Changed
- monitoring.md: documented `/layout/save` as a write-only trigger and dropped the incorrect "there is no /layout/save" note; fixed to match the server protocol map.
- SKILL.md: removed the dead `totalmix://protocol` resource reference (the resource no longer exists; the reference files hold the address list).

## [0.7.0] - 2026-07-03

### Added
- Second connector `totalmix-mcp-http` in `.mcp.json`: a URL reference to a
  running totalmix-mcp HTTP daemon (Streamable HTTP + bearer token). The
  bundled local server is now registered as `totalmix-mcp-stdio` (was:
  `totalmix`). Both appear individually under `/mcp` and can be enabled and
  disabled separately.
- `userConfig` dialog in `plugin.json`: TotalMix host, OSC send/listen port
  (for stdio), daemon URL and bearer token (for http; the token goes to the
  system keychain). Replaces having to export env vars by hand. The expert
  knobs (`TOTALMIX_BIND_ADDRESS`, `GET_CHANNEL_SETTLE_MS`,
  `TOTALMIX_UDP_RECV_BUFFER`) still pass through from the environment.

### Changed
- Author metadata: SnDTek -> huddx01 (aka meg33).

## [0.6.0] - 2026-07-02

### Changed
- Moved into the `totalmix-mcp` monorepo alongside the MCP server. The plugin
  now bundles the stdio server (`.mcp.json` + `server/totalmix-mcp-stdio.mjs`),
  so `/plugin install totalmix` needs no separate server setup.
- Version unified with the server (0.4.3 -> 0.6.0).
- Author metadata switched to SnDTek.

## [0.4.3] - 2026-07-02

### Added
- `SKILL.md`: Device discovery section. The server caches a full `/sendall`
  at startup, so to find out what a device has (number of outputs, inputs,
  etc.), just `osc_read` on the relevant addresses. No sync, no resend
  needed — much faster than polling with `get_channel`.

## [0.4.2] - 2026-07-02

### Added
- `reference/channelstrip.md`: loadpreset preset count for eq, dynamics and
  roomeq — 16 presets each, UI 1..16 = wire 0..15 (0-based list-box rule),
  preset names not exposed over OSC, so presets are addressable by number
  only.

### Changed
- `reference/channelstrip.md`: playback channels lack eq/lowcut/dynamics/
  autolevel on EVERY RME device (confirmed), not just the UFX III; server
  0.5.1 rejects those addresses. The skill now says to offer the target
  output's EQ instead.

## [0.4.1] - 2026-07-01

### Added
- `reference/monitoring.md`: color index map for the read-only `color`
  parameter (picker order: 1 white/default, 2 grey, 3 orange, 4 red, 5 blue,
  6 green, 7 yellow, 8 pink; 0 = hidden). Device-verified anchor: a channel
  showing pink in the UI reads index 8. Note on the picker's "(various)"
  entry (multi-selection display value, never an OSC value).

## [0.4.0] - 2026-07-01

### Fixed
- `reference/monitoring.md`: control room `mainout`/`mainoutb`/`phones1-4`
  were wrongly documented as levels. They are channel ASSIGNMENTS (0-based
  output index, -1 = unassigned, device-verified); levels belong on
  `/output/<n>/volume`. `talkchannel`/`cuechan`/`extinchannel` reclassified
  the same way.
- Groups (`/mutegroup` etc.) are readable after a settings sync
  (device-verified against the spec table, which wrongly says Rec.-only).
- `/layout/save` removed: it does not exist in the 260626 spec.
- `/layout/load` is a normal (f) trigger (value optional), not a
  value-required special case.

### Added
- Previously undocumented addresses: `cuechan`, `/undo`, `/redo`, matrix
  `groupflags` (group-membership bitfield), `pfl` (mixing.md), and the
  channel-settings tail in channelstrip.md: `phase`, `width`, `msproc`,
  `delay`, `record`, `playchan`, output `reflevel`, plus `crossfeed` and
  `talkbacksel` in monitoring.md.
- Recommended TotalMix OSC settings section (monitoring.md): Re-send
  received + Re-send if different (correction-echo semantics,
  device-verified: echo only when TotalMix corrected the value), Follow
  Submix off, bandwidth None, Receive to hidden channels; status cadence
  ~1 param/s.
- Device-reality notes (UFX III): playback channels carry only
  stereo/name/mute/phase/msproc/width/color (no EQ/dynamics/lowcut/fxsend);
  record/playchan/pfl/delay/pad never observed on any bus; line vs mic
  input differences.
- SKILL.md: per-side parameter list settled by the spec legend
  (gain/roomeq/phase/delay, right side = left index + 1); `confirm` option
  of `send_osc_commands` documented (correction detection, not needed on
  the fast path).

## [0.3.0] - 2026-07-01

### Changed
- SKILL.md restructured around a "fast path": a cheat sheet mapping intent
  straight to address for the common, absolute, numbered-channel case, so
  the model can skip reading/syncing/stereo-checking when nothing about the
  request actually requires it. Reworded core sections (bus model, address
  forms, indexing, pan, stereo) for brevity; removed the personal "my
  device" framing in favor of a generic Fireface UFX III channel map.

### Added
- `reference/monitoring.md` brought in line with the totalmix-mcp-server
  0.4.0 protocol reconciliation (OSCProtocoll_260626, TotalMix 26.06.26):
  `/snapshot/load/<n>` documented as read+write with its 0/2/3 send values
  and on/off snapshot-key use, `/snapshot/save`, read-only channel `color`,
  `/sendmix` and `/sendsubmix/<n>` resend commands (with the ping-pong/lag
  caution from the device changelog), `/showwindow`, and the three new
  control room parameters (`talkchannel`, `extinchannel`, `extingain`).
- New `reference/fx.md`: documents the global reverb and echo effects
  (previously not covered by any reference file despite being fully defined
  in the totalmix-mcp-server protocol map), plus the input `fxsend` / output
  `fxreturn` addresses that connect channels to them. Enum names (reverb's 15
  types, echo's 3 types, echo's 6 highcut steps) and value ranges/units
  sourced from the oscmix project's own mapping of TotalMix's native
  protocol (https://github.com/huddx01/oscmix), not yet round-tripped
  against a live OSC read. Linked from SKILL.md's fast-path exceptions and
  reference-file list.

## [0.2.0] - 2026-06-26

### Changed
- Skill content rewritten in English (body and structure) to match the dev
  convention. Example user utterances kept in German as few-shot grounding,
  description made bilingual with German trigger keywords. No behaviour change.

## [0.1.0] - 2026-06-26

First beta. Functional and in real-world use; a few protocol details still to
be verified on the device (stereo per-param exception catalog, percent-to-dB
mapping, layout/load value).

### Added
- Core conventions (SKILL.md): bus model, address forms, 0-based indexing,
  dB-native levels, balpan, stereo-pair behaviour, UFX III output map,
  two-step read flow.
- Reference playbooks: mixing, routing, channelstrip, monitoring.
- Name-to-index resolution workflow backed by the get_channel_names tool.
- layout/load documented (1-based, value 1.0).
