# totalmix-mcp-server

MCP server for RME **TotalMix FX** via Global OSC. It runs as a long-running
HTTP daemon, holds a single OSC connection plus an in-memory state cache, and
exposes a small set of tools over Streamable HTTP. Several clients (desktop,
mobile) can talk to the same cache at once.

Status: beta. Functional and in real-world use; a few protocol details are
still being verified on the device.

## Companion skill

This server provides the raw tools; it carries no domain knowledge on purpose.
The matching `totalmix` skill provides that knowledge (dB ranges, 0-based
indexing, the stereo-pair behaviour, how to build a headphone mix) and turns
spoken audio commands into exact OSC addresses for these tools. The skill lives in
this repo under `plugins/totalmix` and is installed as a Claude Code plugin
(which bundles a copy of this server) or uploaded as a skill zip for Claude
Desktop; see the top-level README. Server and skill share one version.

## Design

The daemon owns one UDP socket to TotalMix and one cache for the whole
process. This is the key difference from a stdio MCP server, where every
client spawns its own process and they fight over the local OSC listen port.

The tools are deliberately dumb. They forward exact OSC addresses and
dB-native values, validate against the protocol map in `src/protocol.ts`, and
read the cache back. All domain knowledge (dB ranges, 0-based indices, the
stereo-pair behaviour, how to build a headphone mix) lives in the skills that
sit in front of this server, not in the server code.

### Tools

- `send_osc_commands` Send one or many OSC messages in a single call. Each
  item is an address plus an optional value. Values are dB-native for level
  addresses (`+6` to `-64.5`, use `-300` for off). Unknown or read-only
  addresses are rejected per item.
- `get_channel` Read the full parameter set of one channel. Triggers
  `/sendchan`, waits a settle window, then returns the cached values for that
  channel. Returns only the requested index; query a stereo partner
  separately.
- `osc_read` Direct cache read for known exact addresses, no resend. Use for
  focused questions when the cache is already fresh.
- `get_channel_names` List all channel names per bus, read straight from the
  cache, no resend. Call once per session to learn the name-to-index mapping,
  then resolve spoken channel names to indices. Optionally limited to one bus.
- `osc_sync` Wide resync, `all` (`/sendall`) or `settings` (`/sendsettings`).
  For a single channel prefer `get_channel`.

### Configuration

All settings come from `.env` (see `.env.example`).

- `TOTALMIX_HOST` / `TOTALMIX_SEND_PORT` where TotalMix listens for OSC.
- `TOTALMIX_LISTEN_PORT` / `TOTALMIX_BIND_ADDRESS` where this daemon receives
  status pushes.
- `TOTALMIX_UDP_RECV_BUFFER` requested OS receive buffer for the OSC socket,
  see "Tuning the cold-start burst" below.
- `GET_CHANNEL_SETTLE_MS` default wait window for `get_channel` (per-call
  `settle_ms` still overrides this).
- `MCP_HTTP_PORT` / `MCP_HTTP_BIND` the HTTP endpoint.
- `MCP_AUTH_TOKEN` required bearer token. If empty, the endpoint is open
  (local dev only, never on a daemon that binds `0.0.0.0`).
- `MCP_DEBUG_ENABLED` enables `GET /debug/cache` (see below). Off by default.
- `MCP_TLS_CERT` / `MCP_TLS_KEY` set both to serve https with your
  self-signed cert. Leave empty for plain http.

### Cold-start packet loss (required kernel tuning on slower hosts)

On a host like a Raspberry Pi 3B, a cold-start `/sendall` can land far fewer
values in the cache than the device actually has (for example ~1000 of ~27000),
with no error anywhere. This is **not** a bug in this server and **not** packet
loss on the network. It is the OS-level UDP receive buffer overflowing: the
whole `/sendall` reply arrives as one dense burst (measured here: ~2100 UDP
datagrams in ~80 ms), and a slow CPU cannot drain the socket fast enough, so
the kernel silently discards everything past the buffer's capacity.

This only matters on a slow host. This server auto-detects a Raspberry Pi
(`src/platform.ts`, via `/proc/cpuinfo`) and only requests a larger receive
buffer by default there; on anything else, including a Mac, the OS default is
used and nothing extra is requested. Requesting a large buffer unconditionally
used to be the default here, but on macOS specifically an oversized request can
be flatly refused by the kernel (`ERR_SOCKET_BUFFER_SIZE` / `ENOBUFS`) rather
than clamped like on Linux, so it is now gated to where it is actually needed.
`TOTALMIX_UDP_RECV_BUFFER` still overrides this explicitly on any host, Pi or
not, if you want to force it.

Two settings address this, and on Linux you generally need both:

1. Raise the kernel ceiling for socket receive buffers (so the per-socket
   request below is allowed through):
   ```bash
   # inspect and back up current values first
   sysctl net.core.rmem_max net.core.rmem_default

   # persist across reboots (raise only the ceiling; leave rmem_default alone
   # so other sockets on the host are not enlarged unnecessarily)
   echo "net.core.rmem_max=16777216" | sudo tee /etc/sysctl.d/99-totalmix-udp.conf
   sudo sysctl --system
   ```
2. `TOTALMIX_UDP_RECV_BUFFER` in `.env` (bytes), which this server requests for
   its OSC socket via `setsockopt(SO_RCVBUF)`. Defaults to 16 MiB. Because it is
   per-socket, only this server gets the large buffer; the rest of the host is
   untouched.

The startup log shows whether the request was honored or clamped:

```
[totalmix-mcp] UDP receive buffer: requested 16777216 bytes, OS granted 16777216 bytes
```

If "granted" is far below "requested", the kernel ceiling (`net.core.rmem_max`)
is still too low. Verify end to end via `/health` after a fresh start: `cached`
should land close to the device's real parameter count.

A simpler alternative that needs no kernel or code change: leave TotalMix's own
**OSC bandwidth limit enabled**. It paces the burst into smaller bursts over
time, which a slow host can keep up with. The buffer approach and the bandwidth
limit attack the same root cause (burst density) from opposite ends; combining a
generous buffer with a mild bandwidth limit is the most robust setup.

Full root-cause analysis, with the exact measurements that pinned it down, is in
[`docs/cold-start-packet-loss.md`](docs/cold-start-packet-loss.md).

### Debugging the cache directly

`GET /debug/cache` returns the raw cache as JSON, for humans inspecting the
daemon (curl, browser), not for Claude. It is deliberately **not** an MCP tool:
dumping the full cache (tens of thousands of entries) through the model would
be a token disaster. This route is plain HTTP, bearer-protected like `/mcp`,
only exists when `MCP_DEBUG_ENABLED=true`, and the model never sees or calls it.

```bash
# entire cache
curl -s -H "Authorization: Bearer $MCP_AUTH_TOKEN" "https://<host>:8765/debug/cache" | jq

# filtered by prefix
curl -s -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  "https://<host>:8765/debug/cache?prefix=/input/2/" | jq
```

Response shape: `{"count": N, "entries": [{"address", "args", "ageMs"}, ...]}`.
`ageMs` is computed at request time (now minus last-received timestamp), so the
same address re-read later shows a larger age even if nothing changed.

## Setup

```bash
npm install
cp .env.example .env   # then edit it
npm run build
npm start              # uses node --env-file=.env
```

`/health` is unauthenticated and reports cache size, useful as a liveness
probe. `/mcp` is the MCP endpoint and requires the bearer token. See
"Configuration" above for all `.env` settings.

## Running as a systemd service (e.g. on a Raspberry Pi)

Sync this `server/` folder to the host as-is (not just the build output) and
build there:

```bash
# from the development machine
rsync -av --exclude='.git' --exclude='dist' \
  path/to/totalmix-mcp/server/ \
  <host>:/path/to/totalmix-mcp-server/

# on the host
cd /path/to/totalmix-mcp-server
npm install
npm run build
```

`.env` on the host is edited locally there and not overwritten by the sync
(keep it out of the rsync command, or exclude it explicitly if it lives
inside the synced folder). Then install a unit like:

```ini
# /etc/systemd/system/totalmix-mcp.service
[Unit]
Description=TotalMix MCP server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/totalmix-mcp-server
EnvironmentFile=/path/to/totalmix-mcp-server/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
```

systemd reads the env via `EnvironmentFile`, so the daemon is started with
plain `node dist/index.js` here, not the `--env-file` npm script.

First install:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now totalmix-mcp
```

Updating an existing install (after the rsync + build above), no need to
touch the unit file or re-enable:

```bash
sudo systemctl restart totalmix-mcp
```

## Registering in Claude

The daemon is a remote MCP server, so register it as a **Custom Connector**
pointing at `https://<host>:<port>/mcp` with the bearer token. It is not
installed via `plugin install`.

## Versioning

Versions follow the tiered scheme: `0.0.x` alpha, `0.x.0` beta, `1.0.0+`
release (then normal semver). See [RELEASING.md](RELEASING.md) for the release
workflow and [CHANGELOG.md](CHANGELOG.md) for the history. Keep the `version`
in `package.json` in sync with the changelog and any git tag.

## Known limitations

- **Read is two-step.** TotalMix answers a resend trigger by pushing values
  over UDP asynchronously, not inline. `get_channel` waits a fixed settle
  window (default 250 ms). With the TotalMix OSC bandwidth limit active,
  raise `settle_ms` if values arrive late.
- **Cold start.** On boot the daemon fires `/sendall` once, fire and forget.
  The cache fills over the next moment; `/health` cache size reflects this.
- **Stereo pairs.** The server is strictly per-index. For a stereo pair the
  left channel is master for most params while the right reacts to OSC too,
  with roomeq and gains as deliberate exceptions. That behaviour is handled
  in the skills, not here.
