#!/usr/bin/env bash
# Run this ON THE MAC, from inside the server/ folder:
#   ./build-mcpb.sh
#
# Builds a .mcpb natively with the official Anthropic toolchain, so native
# dependencies (serialport bindings) and the manifest match this machine and
# the current MCPB spec exactly. Output: ../totalmix-mcp.mcpb
set -euo pipefail
cd "$(dirname "$0")"

echo "== 1/5 install official MCPB CLI (global, one-time) =="
npm install -g @anthropic-ai/mcpb

echo "== 2/5 full install (need devDependencies to compile TypeScript) =="
rm -rf node_modules dist
npm ci

echo "== 3/5 compile TypeScript =="
npm run build

echo "== 4/5 strip down to production-only deps for the bundle =="
rm -rf node_modules
npm ci --omit=dev

echo "== 5/5 validate manifest and pack =="
mcpb validate manifest.json
mcpb pack . ../totalmix-mcp.mcpb

echo
echo "Done: ../totalmix-mcp.mcpb"
mcpb info ../totalmix-mcp.mcpb

echo
echo "Restoring dev dependencies for your local dev environment..."
npm ci
