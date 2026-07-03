# Changelog

All notable changes to totalmix-mcp-server are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/).

Versioning tiers (see [RELEASING.md](../RELEASING.md)): `0.0.x` alpha, `0.x.0`
beta, `1.0.0+` release. The version here must match `version` in
`package.json`.

## [0.7.0] - 2026-07-03

### Changed
- MCP server names split by transport: the stdio entry point now announces
  itself as `totalmix-mcp-stdio` and the HTTP daemon as `totalmix-mcp-http`
  (both were `totalmix-mcp`). Matches the two connector entries the plugin
  now registers, so both can be told apart when active side by side.
- Author metadata: SnDTek -> huddx01 (aka meg33) (manifest.json,
  plugin.json, marketplace.json).
- UDP receive buffer default: 4 MiB is now requested on **all** platforms
  (was: OS default everywhere except a detected Raspberry Pi). Trigger: the
  cold-start `/sendall` loss was reproduced and measured on macOS too (2010
  MacBook Pro, ~7% of the burst dropped at the 768 KB `net.inet.udp.recvspace`
  default, proven via `netstat -s -p udp` "dropped due to full socket
  buffers"). 4 MiB stays under the macOS/BSD `kern.ipc.maxsockbuf` rejection
  ceiling (8 MB; FreeBSD's effective max is slightly below via `sb_max_adj`)
  and is granted in full there and on
  Windows; Linux still clamps to `net.core.rmem_max`. A detected Raspberry Pi
  keeps 16 MiB. `TOTALMIX_UDP_RECV_BUFFER` still overrides everywhere;
  `0` now explicitly forces the OS default.
- `docs/cold-start-packet-loss.md`: added the macOS case (measured over WiFi —
  the full burst reaches the kernel; the loss is at the socket buffer) and an
  OS reference for Linux/macOS/BSD/Windows: buffer defaults, ceiling
  semantics (clamp vs. ENOBUFS-reject vs. no ceiling), sysctl/registry
  locations, drop counters, and FreeBSD/XNU source links for the
  `sb_max_adj` ceiling math.

## [0.6.0] - 2026-07-02

### Changed
- Moved into the `totalmix-mcp` monorepo (`server/`), alongside the Claude
  Code plugin. Server and plugin now share one version and one release tag.
- New `bundle` script: esbuild single-file build of the stdio server into
  `plugins/totalmix/server/`, so the plugin ships the server with it.
- Author metadata switched to SnDTek / meg33@sndtek.de.

## [0.5.1] - 2026-07-02

### Changed
- Playback channels: eq/lowcut/dynamics/autolevel blocks removed from
  `PLAYBACK_PARAMS`. Playback channels lack these on every RME device
  (confirmed by the maintainer), so the server now rejects those addresses instead
  of forwarding dead writes.
- loadpreset documentation (eq, dynamics, roomeq): 16 presets each, UI
  numbering 1..16, wire values 0-based (0..15) per the list-box rule
  (roomeq device-verified). Preset names are not exposed over OSC.
- `manifest.json` version synced to the package version (was stale at
  0.3.0).

## [0.5.0] - 2026-07-01

### Added
- `confirm` option on `send_osc_commands`: detects value corrections.
  Device-verified semantics with TotalMix's alpha-8 options "Re-send
  received" + "Re-send if different" enabled: TotalMix echoes a value back
  only when it had to correct it (e.g. EQ gain 99 clamped and echoed as
  20); no echo means the value was applied exactly as sent. Timeout via
  `SEND_CONFIRM_TIMEOUT_MS` (default 400 ms).
- `docs/fader-curve.md`: RME's official dB<->faderlin conversion from the
  spec's "Fader curve" Excel sheet (the sheet exists only in the .xls, not
  in the PDF exports).

### Changed
- Protocol map reconciled against `OSCProtocoll_260626.xls` (TotalMix FX 2.1
  alpha 8) including the Description sheet and a live UFX III test session:
  - controlroom `mainout`/`mainoutb`/`phones1-4`/`talkchannel`/`cuechan`/
    `extinchannel` are channel assignments (index scale, 0-based output
    index, -1 = unassigned), not levels.
  - `mutegroup`/`sologroup`/`fadergroup` are readable after a settings sync
    (device-verified; the spec table wrongly marks them Rec.-only).
  - `msproc` added to playback channels (device sends it; writes were
    wrongly rejected before). Playback device reality documented: no
    eq/dynamics/autolevel/lowcut/fxsend on UFX III playback channels.
  - `layout/load` is a plain (f) trigger (value optional), matching the
    general trigger rule now stated in the protocol reference.
  - roomeq/loadpreset comment: 0-based preset values are the general
    list-box rule per the Description legend, not a roomeq quirk.
- Non-trigger addresses now require a value in `send_osc_commands`; before,
  a valueless float/string command was sent and silently ignored by
  TotalMix.
- Protocol reference text: removed references to tools that no longer exist
  (`set_submix`, `set_output_fader`, `get_*`, `osc_get`); the fader-curve
  section now points to the dumb-pipe design and `docs/fader-curve.md`.

### Removed
- `layout/save`: not in the 260626 spec (only `layout/load`), carried over
  from an older wiki reconciliation and never device-confirmed.

## [0.4.0] - 2026-07-01

### Added
- Local single-machine mode: a stdio entry point (`dist/stdio.js`, via
  `src/stdio.ts`) that Claude Desktop launches directly, no HTTP, port, token,
  or TLS. Reuses the same OSC client, protocol map, and tools as the HTTP
  daemon. See README-LOCAL-MAC.md.
- macOS local install tooling: `setup-local.mjs` (registers the stdio server in
  the Claude Desktop config, idempotent, backs up first), `install-mac.command`
  and `uninstall-mac.command` double-click wrappers, and README-LOCAL-MAC.md.
- MCPB (one-click Claude Desktop extension) packaging: `manifest.json`,
  `.mcpbignore`, `build-mcpb.sh` (builds natively with the official
  `@anthropic-ai/mcpb` CLI, so native dependencies and the manifest match the
  building machine and current spec exactly).

### Fixed
- **Crash on macOS at startup** (`SystemError [ERR_SOCKET_BUFFER_SIZE]`,
  `ENOBUFS`): requesting the UDP receive buffer via `dgram.createSocket()`'s
  `recvBufferSize` option fails inside Node's internal bind flow on a later
  event-loop tick, which is not catchable by wrapping the call in try/catch;
  it surfaced as an uncaught exception that killed the whole process on any
  host where the OS refuses the requested size (macOS does this whenever the
  request exceeds `kern.ipc.maxsockbuf`; Linux instead silently clamps, which
  is why this only showed up on macOS). Fixed by binding the socket with OS
  defaults first, then calling `socket.setRecvBufferSize()` explicitly
  afterwards, a call made synchronously in our own code and therefore
  genuinely catchable.
- **Buffer tuning is now platform-gated instead of always-on.** New
  `src/platform.ts` detects a Raspberry Pi via `/proc/cpuinfo`. The larger
  UDP receive buffer (previously requested unconditionally, defaulting to
  16 MiB everywhere) is now only requested by default on a detected Raspberry
  Pi, since that is the only case it was ever shown to matter (see
  `docs/cold-start-packet-loss.md`); everywhere else, including Macs, the OS
  default is used and `setRecvBufferSize` is not even attempted, eliminating
  the failure mode above by construction rather than only catching it.
  `TOTALMIX_UDP_RECV_BUFFER` still overrides this explicitly on any host.

### Changed
- Protocol map reconciled against `OSCProtocoll_260626.xlsx` (TotalMix
  26.06.26): added read-only `color` on input/playback/output channels;
  `/snapshot/load/{n}` is now modeled as read+write (TotalMix sends
  0/off, 2/active, 3/changed; only accepts 1 on write); added
  `/snapshot/save`, `/sendmix`, `/sendsubmix/{n}`, `/showwindow`; added
  `controlroom/talkchannel`, `controlroom/extinchannel`,
  `controlroom/extingain`; `/sendall` now documents its value-2
  ("active nodes only") option. See `src/protocol.ts` header comment for
  the full list.


## [0.3.0] - 2026-06-27

### Added
- Configurable UDP receive buffer (`TOTALMIX_UDP_RECV_BUFFER`) for the OSC
  listen socket, requested per-socket via setsockopt(SO_RCVBUF). Fixes a large
  silent packet loss during the cold-start `/sendall` burst on slower hosts
  (verified on a Raspberry Pi 3B): the default OS socket buffer is far too
  small to absorb the burst, and the kernel drops the overflow without any
  error. Requested vs OS-granted size is logged at startup. See README, the
  "Cold-start packet loss" investigation, for the full root-cause analysis
  and the required kernel sysctl.
- `GET_CHANNEL_SETTLE_MS` env var for the default `get_channel` settle window
  (per-call `settle_ms` still overrides it).
- `MCP_DEBUG_ENABLED` flag gating `GET /debug/cache` entirely (not just
  bearer-protecting it): when false, the route does not exist (404). The
  endpoint returns the raw cache as JSON for human inspection (curl/browser),
  with an optional `?prefix=` filter; it is deliberately not an MCP tool.

### Changed
- The OSC client now binds its own dgram socket so it can size the receive
  buffer, instead of letting osc.js create one internally with no options.

### Fixed
- Idempotent socket teardown: closing the OSC client no longer throws
  ERR_SOCKET_DGRAM_NOT_RUNNING from double-closing the dgram socket.

## [0.2.0] - 2026-06-26

First tracked beta of the rearchitected server: a long-running HTTP daemon with
a shared OSC state cache, replacing the old per-client stdio model.

### Added
- Streamable HTTP daemon (Express), stateless, bearer-token auth, optional TLS.
- Shared OSC singleton with in-memory cache and cold-start `/sendall` hydration.
- Five tools: `send_osc_commands`, `get_channel`, `osc_read`,
  `get_channel_names`, `osc_sync`.
- `layout/load` added to the protocol map (1-based, value 1.0).
- `/health` liveness endpoint reporting cache size.
