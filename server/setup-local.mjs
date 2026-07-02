#!/usr/bin/env node
// Local setup for Claude Desktop on macOS.
//
// Registers this server as a local stdio MCP server in the Claude Desktop
// config, so the app launches it automatically. Idempotent: re-running updates
// the existing "totalmix" entry rather than duplicating it. Does not touch any
// other server entries in the config.
//
// Run AFTER `npm ci && npm run build` (the install-mac.command wrapper does
// both). Usage:
//   node setup-local.mjs              # write into the real Claude config
//   node setup-local.mjs --print      # just print the block, change nothing
//   CLAUDE_CONFIG=/tmp/x.json node setup-local.mjs   # override target (tests)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STDIO_ENTRY = resolve(HERE, "dist", "stdio.js");
const NODE_BIN = process.execPath; // absolute path to the node that runs this

// The desktop app spawns MCP servers with a minimal PATH, so a bare "node"
// often fails with ENOENT (especially with nvm). Using the absolute node path
// and absolute script path avoids that entire class of problem.
const SERVER_ENTRY = {
  command: NODE_BIN,
  args: [STDIO_ENTRY],
  env: {
    // Single-machine defaults: TotalMix on the same Mac. Override here if the
    // driver runs elsewhere on the LAN.
    TOTALMIX_HOST: "127.0.0.1",
    TOTALMIX_SEND_PORT: "7001",
    TOTALMIX_LISTEN_PORT: "9001",
  },
};

function defaultConfigPath() {
  if (process.env.CLAUDE_CONFIG) return process.env.CLAUDE_CONFIG;
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  // Best-effort fallback for other platforms (not the target here).
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

function printBlock() {
  const block = { mcpServers: { totalmix: SERVER_ENTRY } };
  console.log(JSON.stringify(block, null, 2));
}

function main() {
  if (!existsSync(STDIO_ENTRY)) {
    console.error(`Build output not found at ${STDIO_ENTRY}`);
    console.error("Run: npm ci && npm run build  (or use install-mac.command)");
    process.exit(1);
  }

  if (process.argv.includes("--print")) {
    printBlock();
    return;
  }

  const cfgPath = defaultConfigPath();
  mkdirSync(dirname(cfgPath), { recursive: true });

  let cfg = {};
  if (existsSync(cfgPath)) {
    const raw = readFileSync(cfgPath, "utf8").trim();
    if (raw) {
      try {
        cfg = JSON.parse(raw);
      } catch (err) {
        console.error(`Existing config at ${cfgPath} is not valid JSON, refusing to overwrite.`);
        console.error("Fix or remove it, then re-run. Error:", err instanceof Error ? err.message : err);
        process.exit(1);
      }
    }
    // Back up before modifying, once per run.
    const backup = `${cfgPath}.backup-${Date.now()}`;
    writeFileSync(backup, raw + "\n", "utf8");
    console.error(`Backed up existing config to ${backup}`);
  }

  if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) {
    console.error("Existing config is not a JSON object, refusing to touch it.");
    process.exit(1);
  }

  cfg.mcpServers = cfg.mcpServers && typeof cfg.mcpServers === "object" ? cfg.mcpServers : {};
  const existed = Object.prototype.hasOwnProperty.call(cfg.mcpServers, "totalmix");
  cfg.mcpServers.totalmix = SERVER_ENTRY;

  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  console.error(`${existed ? "Updated" : "Added"} "totalmix" in ${cfgPath}`);
  console.error("");
  console.error("Next steps:");
  console.error("  1. In TotalMix FX: Options > OSC, enable Remote Controller 1,");
  console.error("     In Port 7001, Out Port 9001, host 127.0.0.1.");
  console.error("  2. Upload the totalmix skill in the Claude app");
  console.error("     (Settings > Customize > Skills), for the domain knowledge.");
  console.error("  3. Fully quit and reopen Claude Desktop.");
}

main();
