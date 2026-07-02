#!/bin/bash
# Removes the "totalmix" entry from the Claude Desktop config. Leaves the
# folder and any other MCP servers untouched.
set -e
cd "$(dirname "$0")"

CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
if [ ! -f "$CFG" ]; then
  echo "No Claude Desktop config found, nothing to remove."
  read -n 1 -s -r -p "Press any key to close."
  exit 0
fi

node - "$CFG" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const p = process.argv[2];
const cfg = JSON.parse(readFileSync(p, "utf8"));
if (cfg.mcpServers && cfg.mcpServers.totalmix) {
  writeFileSync(`${p}.backup-${Date.now()}`, readFileSync(p));
  delete cfg.mcpServers.totalmix;
  writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
  console.error('Removed "totalmix" from the Claude Desktop config.');
} else {
  console.error('No "totalmix" entry found, nothing to remove.');
}
NODE

echo "Fully quit and reopen Claude Desktop for the change to take effect."
read -n 1 -s -r -p "Press any key to close."
