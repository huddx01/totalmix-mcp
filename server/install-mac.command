#!/bin/bash
# Double-clickable local installer for macOS.
# Builds the server and registers it with Claude Desktop.
set -e

cd "$(dirname "$0")"

echo "=== totalmix-mcp local install ==="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  echo "Install the LTS version from https://nodejs.org (the .pkg installer),"
  echo "then double-click this file again."
  echo
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18 or newer is required (found $(node -v))."
  echo "Please update from https://nodejs.org, then run this again."
  echo
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi

echo "Using node $(node -v)"
echo
echo "Installing dependencies (this can take a minute)..."
npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

echo
echo "Building..."
npm run build

echo
echo "Registering with Claude Desktop..."
node setup-local.mjs

echo
echo "Done."
echo
read -n 1 -s -r -p "Press any key to close."
