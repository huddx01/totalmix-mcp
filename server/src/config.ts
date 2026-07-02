// Configuration for the TotalMix OSC connection.
// Defaults match TotalMix FX "Global OSC" out of the box settings.
// Override via environment variables, e.g. in claude_desktop_config.json "env" block.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { detectRaspberryPiModel } from "./platform.js";

export interface TotalMixConfig {
  // IP address of the machine running TotalMix FX
  remoteAddress: string;
  // Port TotalMix listens on for incoming OSC (we send here)
  remotePort: number;
  // Local port we bind to receive OSC status messages from TotalMix
  localPort: number;
  // Local address to bind the listener to
  localAddress: string;
  // Requested OS-level UDP receive buffer (SO_RCVBUF) in bytes for the OSC
  // listen socket, 0 = OS default. Larger values help absorb the /sendall
  // cold-start burst (~30000 messages) without dropped packets, especially
  // with TotalMix's own OSC bandwidth limit disabled. The OS may clamp this
  // below the kernel max; the actual granted size is logged at startup.
  udpRecvBufferBytes: number;
}

const ENV_KEYS: Record<keyof TotalMixConfig, string> = {
  remoteAddress: "TOTALMIX_HOST",
  remotePort: "TOTALMIX_SEND_PORT",
  localPort: "TOTALMIX_LISTEN_PORT",
  localAddress: "TOTALMIX_BIND_ADDRESS",
  udpRecvBufferBytes: "TOTALMIX_UDP_RECV_BUFFER",
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): TotalMixConfig {
  // The larger receive buffer only helps on a host slow enough that a dense
  // OSC burst can outrun it (proven on a Raspberry Pi 3B, see
  // docs/cold-start-packet-loss.md). Attempting it anywhere else is at best
  // pointless and at worst actively harmful: macOS can outright refuse an
  // oversized request (ERR_SOCKET_BUFFER_SIZE / ENOBUFS). So the default is
  // conditional: 16 MiB on a detected Raspberry Pi, 0 (OS default, do not
  // even attempt setRecvBufferSize) everywhere else. TOTALMIX_UDP_RECV_BUFFER
  // still overrides this explicitly on any host, Raspberry Pi or not.
  const piModel = detectRaspberryPiModel();
  const defaultRecvBuffer = piModel !== null ? 16777216 : 0;

  return {
    remoteAddress: process.env.TOTALMIX_HOST ?? "127.0.0.1",
    remotePort: envInt("TOTALMIX_SEND_PORT", 7001),
    localPort: envInt("TOTALMIX_LISTEN_PORT", 9001),
    localAddress: process.env.TOTALMIX_BIND_ADDRESS ?? "0.0.0.0",
    udpRecvBufferBytes: envInt("TOTALMIX_UDP_RECV_BUFFER", defaultRecvBuffer),
  };
}

// Project root (one level up from dist/ or src/, this file lives directly
// under one of those), used to locate .env regardless of cwd.
function projectRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..");
}

function envPath(): string {
  return join(projectRoot(), ".env");
}

// Persist a partial config update into .env, preserving any lines this
// server does not manage (comments, unrelated vars) and any TotalMix vars
// not being changed in this call. Used by the set_connection_config tool
// when the person asks for the change to survive a restart.
export function persistConfig(partial: Partial<TotalMixConfig>): void {
  const path = envPath();
  const existingLines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  // Drop trailing blank lines up front, otherwise a file ending in a
  // newline would leave a stray blank line in the middle once new keys
  // are appended after it.
  while (existingLines.length > 0 && existingLines[existingLines.length - 1] === "") {
    existingLines.pop();
  }

  const updates = new Map<string, string>();
  for (const [key, value] of Object.entries(partial)) {
    const envKey = ENV_KEYS[key as keyof TotalMixConfig];
    if (envKey && value !== undefined) {
      updates.set(envKey, String(value));
    }
  }

  const seen = new Set<string>();
  const newLines = existingLines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (match && updates.has(match[1])) {
      seen.add(match[1]);
      return `${match[1]}=${updates.get(match[1])}`;
    }
    return line;
  });

  for (const [key, value] of updates) {
    if (!seen.has(key)) {
      newLines.push(`${key}=${value}`);
    }
  }

  // Drop trailing blank lines from the join, then ensure exactly one
  // trailing newline at the end of the file.
  while (newLines.length > 0 && newLines[newLines.length - 1] === "") {
    newLines.pop();
  }
  writeFileSync(path, newLines.join("\n") + "\n", "utf8");
}
