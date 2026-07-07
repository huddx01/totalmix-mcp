// Local stdio entry point, for the common single-machine case: TotalMix FX and
// the AI client (e.g. Claude Desktop) on the same Mac. The desktop app launches
// this process over stdio and manages its lifecycle, so there is no HTTP
// server, no port, no bearer token, and no TLS to configure. For the shared,
// multi-client, over-the-network setup use index.ts (the HTTP daemon) instead.
//
// This reuses the exact same OSC client, protocol map, and tool layer as the
// HTTP daemon; only the transport differs. Everything the model sees (the five
// tools, their behaviour) is identical.
//
// Important: stdout is the MCP protocol channel here, so all human-readable
// logging MUST go to stderr (console.error), never console.log.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { TotalMixOscClient } from "./oscClient.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  // One OSC connection and cache for this process, opened once. On a single
  // machine the defaults (TOTALMIX_HOST=127.0.0.1, send 7001, listen 9001)
  // usually need no .env at all; the desktop app can still pass overrides via
  // the "env" block of its config entry.
  const osc = new TotalMixOscClient(loadConfig());
  await osc.open();

  // Cold start hydration: fire /sendall once so the cache fills with the
  // current console state. Not awaited; values stream back asynchronously
  // over UDP while the server is already answering tool calls. The UDP
  // receive buffer sizing (TOTALMIX_UDP_RECV_BUFFER) applies here too, though
  // on a fast local Mac the default is rarely a problem.
  osc.send("/sendall", 1.0);

  const server = new McpServer({ name: "totalmix-mcp-stdio", version: "0.7.2" });
  registerTools(server, osc);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `[totalmix-mcp] stdio server ready ` +
      `(OSC to ${osc.getConfig().remoteAddress}:${osc.getConfig().remotePort}, ` +
      `listening on ${osc.getConfig().localAddress}:${osc.getConfig().localPort})`
  );

  const shutdown = () => {
    console.error("[totalmix-mcp] shutting down");
    osc.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[totalmix-mcp] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
