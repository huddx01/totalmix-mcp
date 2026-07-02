# totalmix-mcp

Control an RME **TotalMix FX** mixer with Claude — by text or voice, entirely
local over OSC. Set levels, mute and solo channels, build headphone mixes,
adjust EQ and dynamics, manage monitoring (dim, mono, snapshots), all by just
asking.

```
"Set output 1 to -6 dB."
"Mute channel 12."
"Give me more vocals on headphone mix 1."
"Setz alle Outs auf -10 dB."
```

Nothing leaves your machine or LAN: the MCP server talks plain OSC (UDP) to
TotalMix FX on the same computer or another host on your network.

One motivation for publishing this: for people with visual impairments, a
mixer you can operate entirely by voice or a screen-reader-friendly chat is a
big step up from a dense mixer GUI. Feedback and accessibility improvements
are very welcome.

## What is in this repo

Two parts that belong together — the server carries no mixing knowledge, the
skill carries no transport code:

- **`server/`** — the MCP server. Deliberately dumb: it validates OSC
  addresses against a protocol map, forwards them over UDP, and caches the
  state TotalMix pushes back. Runs in two modes: stdio (single machine, used
  by the plugin and the Claude Desktop bundle) and HTTP daemon (shared cache
  for several clients, e.g. on a Raspberry Pi). See [server/README.md](server/README.md).
- **`plugins/totalmix/`** — the Claude Code plugin: the mixing skill (dB
  conventions, 0-based indexing, stereo-pair rules, routing, submixes, EQ,
  dynamics, monitoring) plus a bundled copy of the stdio server, so one
  plugin install gives you everything.

## Requirements

- An RME audio interface and **TotalMix FX 2.1 or newer** — this project uses
  the **Global OSC** protocol introduced in 2.1, not the older banked
  (`/1/...`) OSC of earlier versions. See below for setup.
- **Node.js 18+** for the Claude Code plugin path. The Claude Desktop `.mcpb`
  path brings its own runtime.

## Install: Claude Code

Two commands:

```
/plugin marketplace add huddx01/totalmix-mcp
/plugin install totalmix
```

That installs the skill and starts the bundled MCP server automatically. If
TotalMix runs on another machine, set `TOTALMIX_HOST` in your environment
before starting Claude Code.

## Install: Claude Desktop

1. Download `totalmix-mcp.mcpb` from the latest
   [GitHub release](../../releases) and open it — Claude Desktop installs the
   server with a double click and asks for host/port settings in a dialog.
2. Download `totalmix-skill.zip` from the same release. In Claude Desktop open
   **Settings**, then **Capabilities**, then **Skills**, and upload the zip.

Both steps are required: the server provides the tools, the skill provides
the mixing knowledge.

## Enable Global OSC in TotalMix FX (2.1+)

1. In TotalMix FX open the **Options** menu, choose **Settings**, then the
   **OSC** tab.
2. Enable a remote controller (Remote Controller Select 1), check **In Use**,
   and make sure it uses the **Global OSC** protocol (TotalMix 2.1+).
3. Leave the default ports: TotalMix listens on **7001** (incoming) and sends
   replies to port **9001** on the controlling host.
4. If Claude runs on a different machine than TotalMix, set the controller's
   IP address to that machine and set `TOTALMIX_HOST` there accordingly.

Then, under **Detailed Settings** for that remote, the settings this project
is built for:

- **Send changes**: on — keeps the server's cache current when you change
  something in the TotalMix UI.
- **Follow Submix**: off — RME's own recommendation for Global OSC; with it
  on, mix addresses can land on a different submix than the one addressed.
- **Bandwidth Limitation**: None — syncs settle fastest, and the server's
  UDP buffer handling is built for the resulting burst. Only on a slow host
  (e.g. a Raspberry Pi 3) combine a mild limit with a larger receive buffer,
  see `server/README.md` ("Cold-start packet loss").
- **Re-send received** and **Re-send if different**: both on — TotalMix then
  echoes a value back only when it had to correct it (e.g. clamping an
  out-of-range dB), which the server surfaces via `confirm: true`.
- **Receive to hidden channels**: on if channels hidden in the TotalMix UI
  should stay controllable via Claude.

## How it works

The skill turns a spoken or typed request into exact OSC addresses
(`/output/0/volume`, `/mix/in/2/0/fader`, …) and dB-native values, then calls
one of five small tools on the server (`send_osc_commands`, `get_channel`,
`osc_read`, `get_channel_names`, `osc_sync`). The server validates each
address against the protocol map reconciled with RME's OSC spec (see
`server/docs/protocol-coverage-260626.md`) and keeps an in-memory cache of
everything TotalMix pushes back.

The skill's reference docs currently assume a Fireface UFX III channel layout
as the worked example; the protocol map itself covers TotalMix FX generally.
Reports from other interfaces are welcome.

## Development

```bash
cd server
npm ci
npm run typecheck   # tsc --noEmit
npm run build       # compile to dist/
npm run bundle      # rebuild the single-file server bundled into the plugin
```

The bundled server at `plugins/totalmix/server/totalmix-mcp-stdio.mjs` is a
committed build artifact; CI fails if it is out of date, so run `npm run
bundle` after changing server code. Releases are cut from tags, see
[RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE)
