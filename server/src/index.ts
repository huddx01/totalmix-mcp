// Entry point. Long-running daemon, typically on an always-on LAN host.
// Holds ONE OSC connection and cache for the whole process, and exposes the
// MCP tools over Streamable HTTP so several clients can talk to
// the same cache at once. This is the core change from the old stdio build,
// where every client spawned its own process and fought over the UDP port.

import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "./config.js";
import { TotalMixOscClient } from "./oscClient.js";
import { registerTools } from "./tools.js";

// HTTP listen settings, separate from the OSC connection settings in config.
const HTTP_PORT = Number.parseInt(process.env.MCP_HTTP_PORT ?? "8765", 10);
const HTTP_BIND = process.env.MCP_HTTP_BIND ?? "0.0.0.0";
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "";
const TLS_CERT = process.env.MCP_TLS_CERT ?? "";
const TLS_KEY = process.env.MCP_TLS_KEY ?? "";
// Off by default. The /debug/cache route is bearer-protected regardless, but
// this is a second, explicit opt-in: when false, the route does not exist at
// all (404), not just 401. Meant for humans (curl/browser) inspecting the
// daemon directly, never called by Claude.
const DEBUG_ENABLED = (process.env.MCP_DEBUG_ENABLED ?? "false").toLowerCase() === "true";

// Build a fresh McpServer with the tools registered against the shared OSC
// client. In stateless mode one of these is created per request and torn
// down with the response, but they all close over the same osc singleton,
// so they all read and write the same cache and the same UDP socket.
function buildServer(osc: TotalMixOscClient): McpServer {
  const server = new McpServer({ name: "totalmix-mcp-http", version: "0.7.2" });
  registerTools(server, osc);
  return server;
}

// Reject anything without the right bearer token. The daemon binds on all
// interfaces so LAN clients can reach it; without this, any host on the LAN
// could drive the console. Constant-time-ish compare is overkill here but
// cheap, so we still avoid the trivial early-exit length leak.
function authorized(req: Request): boolean {
  if (!AUTH_TOKEN) return true; // no token configured = open, for local dev only
  const header = req.header("authorization") ?? "";
  const expected = `Bearer ${AUTH_TOKEN}`;
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function main(): Promise<void> {
  // One OSC connection for the whole daemon, opened once.
  const osc = new TotalMixOscClient(loadConfig());
  await osc.open();

  // Cold start hydration. Fire /sendall once so the cache fills with the
  // current console state, but do NOT await it: the values stream back
  // asynchronously over UDP, and we want the HTTP server accepting clients
  // immediately rather than blocking on a dump that has no completion signal.
  osc.send("/sendall", 1.0);

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Liveness probe, unauthenticated on purpose so a monitor or systemd can
  // check the daemon without holding the token. Reports cache size as a
  // rough "is hydration working" signal.
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, cached: osc.cacheSize() });
  });

  // Raw debug dump of the cache, for humans inspecting the daemon directly
  // (curl, browser), not for Claude. Deliberately NOT an MCP tool: dumping
  // ~30000 entries through the model would be a token disaster. This is a
  // plain authenticated HTTP route the model never sees or calls, and it
  // only exists at all when MCP_DEBUG_ENABLED=true.
  // GET /debug/cache            -> entire cache
  // GET /debug/cache?prefix=/input/2/  -> only matching addresses
  if (DEBUG_ENABLED) {
    app.get("/debug/cache", (req: Request, res: Response) => {
      if (!authorized(req)) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const prefix = typeof req.query.prefix === "string" ? req.query.prefix : "";
      const entries = osc.getByPrefix(prefix).map(({ address, value }) => ({
        address,
        args: value.args,
        ageMs: Date.now() - value.receivedAt,
      }));
      res.json({ count: entries.length, entries });
    });
  }

  // Single MCP endpoint, stateless. Each POST gets its own server and
  // transport so there is no per-client session to track; the shared state
  // that matters lives in the osc singleton, not in MCP session state.
  app.post("/mcp", async (req: Request, res: Response) => {
    if (!authorized(req)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const server = buildServer(osc);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[totalmix-mcp] request error:", err instanceof Error ? err.message : err);
      if (!res.headersSent) res.status(500).json({ error: "internal error" });
    }
  });

  // Stateless mode has no server-initiated stream and no session to delete,
  // so GET and DELETE on the endpoint are simply not supported.
  const methodNotAllowed = (_req: Request, res: Response) =>
    res.status(405).json({ error: "method not allowed" });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  // TLS if a cert and key are configured (e.g. a self-signed cert trusted
  // on the clients), plain HTTP otherwise (handy for local testing). Same
  // code path either way.
  const useTls = TLS_CERT && TLS_KEY;
  const httpServer = useTls
    ? https.createServer({ cert: readFileSync(TLS_CERT), key: readFileSync(TLS_KEY) }, app)
    : http.createServer(app);

  httpServer.listen(HTTP_PORT, HTTP_BIND, () => {
    const scheme = useTls ? "https" : "http";
    console.error(
      `[totalmix-mcp] listening on ${scheme}://${HTTP_BIND}:${HTTP_PORT}/mcp ` +
        `(OSC to ${osc.getConfig().remoteAddress}:${osc.getConfig().remotePort}, ` +
        `auth ${AUTH_TOKEN ? "on" : "OFF"}, debug endpoint ${DEBUG_ENABLED ? "on" : "off"})`
    );
  });

  // Clean shutdown so the UDP port is released promptly on restart.
  const shutdown = () => {
    console.error("[totalmix-mcp] shutting down");
    httpServer.close();
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
