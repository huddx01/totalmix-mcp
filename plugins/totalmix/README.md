# totalmix plugin

Plugin for controlling an RME TotalMix FX mixer (Fireface UFX III) via OSC.
It ships the MCP server (bundled) plus the skill: all domain knowledge
(address building, dB conventions, stereo handling, routing, snapshots,
global FX) lives in `skills/totalmix/SKILL.md` and its `reference/*.md`
files, read by Claude directly.

> **Marketplace:** `totalmix-mcp` &nbsp;·&nbsp; **Plugin:** `totalmix`

---

## Quick start

`/plugin install totalmix` is all it takes; the plugin registers two
connectors (see `.mcp.json`), individually managed under `/mcp`:

- **totalmix-mcp-stdio** — the bundled local server
  (`server/totalmix-mcp-stdio.mjs`), launched by Claude Code itself. Only
  needs Node and a reachable TotalMix FX with OSC enabled. Configure host and
  ports in the plugin's config dialog (`userConfig`).
- **totalmix-mcp-http** — a URL reference to a running totalmix-mcp HTTP
  daemon (see `../../server/README.md`), for the shared multi-client setup.
  Configure URL and bearer token in the same dialog; disable this connector
  if you only use the local server.

Both expose the same five tools (`send_osc_commands`, `get_channel`,
`osc_read`, `get_channel_names`, `osc_sync`); enabling both at once means
Claude sees every tool twice.

---

## Repo layout

```
.claude-plugin/marketplace.json     # marketplace manifest (repo root)
plugins/totalmix/
├── .claude-plugin/plugin.json      # plugin manifest incl. userConfig dialog
├── .mcp.json                       # the two connectors (stdio + http)
├── CHANGELOG.md
├── server/totalmix-mcp-stdio.mjs   # bundled stdio server (built from ../../server)
└── skills/totalmix/
    ├── SKILL.md                    # core conventions, fast path, cheat sheet
    └── reference/
        ├── mixing.md                # levels, mute, solo, pan
        ├── routing.md                # matrix, submixes, headphone mixes
        ├── channelstrip.md           # gain, EQ, dynamics, low cut, room EQ
        ├── monitoring.md             # control room, groups, snapshots, meters, status, DURec
        └── fx.md                     # global reverb and echo
```

---

## Known limitations / TODO

The MCP server (`totalmix-mcp-server`) is deliberately a dumb pipe: it checks
that an address exists and whether it is readable/writable, but never
validates the value itself. All value semantics currently live only in the
skill's reference docs, which the model is expected to read before building
an address. Two related, deferred improvements came up while writing
`reference/fx.md` (server-side, do not touch without checking with the maintainer
first, see the conventions under `server/` in this repo):

- **Value validation for known enums/ranges.** `reverb/type` (0-14),
  `echo/type` (0-2), `echo/highcut` (0-5, stepped), and the min/max-bounded
  fields (`echo/delay` 0.0-2.0, reverb/echo `volume` -65.0 to +6.0) could be
  rejected synchronously in `send_osc_commands` if out of range, instead of
  silently going out over UDP and only surfacing as "nothing happened" on
  read-back. Would need `ParamDef` in `protocol.ts` extended with optional
  `min`/`max`/`enumNames`, plus a value check next to the existing address
  check in `tools.ts`.
- **Dead `totalmix://protocol` resource.** `protocol.ts`'s `validateAddress()`
  points rejected requests at a `totalmix://protocol` MCP resource
  ("See the totalmix://protocol resource for valid parameters") that is
  never actually registered anywhere in `index.ts` or `tools.ts`.
  `generateReference()` (which would back it) is dead code, never called.
  Fixing this is a `server.registerResource(...)` call away; test with
  `npx @modelcontextprotocol/inspector` or Claude Desktop's own resource
  picker once wired up.

Both are scoped to `totalmix-mcp-server`, not this plugin. Revisit after the
current 0.3.0 skill content (fast path, protocol reconciliation, fx.md) has
been tested against the real device.
