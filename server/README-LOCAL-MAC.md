# TotalMix MCP, local install on a Mac

Control RME TotalMix FX by voice or text through Claude, running entirely on
your Mac. Nothing goes over the internet: Claude talks to a small local helper,
and that helper talks to TotalMix on the same machine over OSC.

This is the local single-machine setup. TotalMix FX and Claude Desktop run on
the same Mac. (For a shared, over-the-network setup on a separate server, see
the main README and the HTTP daemon instead.)

## What you need first

1. **TotalMix FX** (RME driver) installed and running.
2. **Claude Desktop** app installed.
3. **Node.js 18 or newer**, once. If you do not have it, install the LTS
   version from https://nodejs.org (the `.pkg` installer, just click through).

## Install

1. Unzip this folder somewhere you will keep it, for example your Documents
   folder. Do not run it from inside the Downloads "unzipped once" temp area.
2. Double-click **`install-mac.command`**.
   - The first time, macOS may block it. If so: right-click the file, choose
     Open, then confirm. Or allow it under System Settings, Privacy & Security.
   - It checks Node, installs dependencies, builds, and registers the server
     with Claude Desktop automatically.
3. In **TotalMix FX**, enable OSC: Options, then OSC, enable Remote
   Controller 1. Set In Port `7001`, Out Port `9001`, and the host/IP to
   `127.0.0.1`.
4. In the **Claude app**, upload the TotalMix skill: Settings, Customize,
   Skills, and upload `totalmix-skill.zip` (included alongside this folder).
   This gives Claude the mixing knowledge (dB conventions, channel mapping,
   stereo handling). Without it the tools still work, but Claude is far more
   capable with it.
5. **Fully quit and reopen** Claude Desktop.

Then try, in a chat: "mute output 1", or "set input 3 to -6 dB in the main
mix", or "make a headphone mix on Phones 1 from vocals and guitar".

## How it fits together

```
Claude Desktop  --(stdio, local)-->  totalmix-mcp  --(OSC/UDP, 127.0.0.1)-->  TotalMix FX
```

The app starts and stops the helper for you; there is no server to keep running,
no port to open, no password. The config entry the installer adds looks like:

```json
{
  "mcpServers": {
    "totalmix": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/dist/stdio.js"],
      "env": { "TOTALMIX_HOST": "127.0.0.1", "TOTALMIX_SEND_PORT": "7001", "TOTALMIX_LISTEN_PORT": "9001" }
    }
  }
}
```

You can preview that block without changing anything:

```bash
node setup-local.mjs --print
```

## If TotalMix runs on a different machine on your LAN

Edit the `env` block the installer wrote (in the Claude Desktop config) and set
`TOTALMIX_HOST` to that machine's IP. Everything else stays the same. Note the
UDP status port (9001) must be reachable from that machine to your Mac.

## Uninstall

Double-click **`uninstall-mac.command`**. It removes only the `totalmix` entry
from the Claude Desktop config and backs the config up first. Delete the folder
afterwards if you like.

## Troubleshooting

- **Claude does not see the tools.** Make sure you fully quit Claude Desktop
  (not just closed the window) and reopened it. Check that the config entry
  exists via `node setup-local.mjs --print` and compare paths.
- **Tools appear but nothing happens in TotalMix.** OSC is probably not enabled
  in TotalMix, or the ports do not match (In 7001, Out 9001). Confirm under
  Options, OSC.
- **"node: command not found" when the app launches the server.** The installer
  writes the absolute path to node to avoid this. If you moved or reinstalled
  node, run `install-mac.command` again to refresh the path.
- **Reading back state seems empty right after start.** The first `/sendall`
  fills the cache over a moment. Ask again, or ask Claude to resync.
