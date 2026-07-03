// OSC transport layer for TotalMix Global OSC.
// Wraps osc.js UDPPort, keeps an in-memory cache of the last received value
// per address, and exposes helpers for sending and polling.
//
// Why a cache instead of request/response: OSC over UDP has no correlation
// between a send and a reply. TotalMix pushes status messages whenever a
// value changes (or once on /sendall), not as a direct answer to a query.
// So the pattern here is: send a value (fire and forget), or trigger a
// resync command (/sendall, /sendsettings, /sendchan/...) and then read
// whatever lands in the cache afterwards.
//
// UDP receive buffer: osc.js creates its own dgram socket internally with no
// way to size its receive buffer (it calls dgram.createSocket("udp4") with no
// options). A cold-start /sendall on a ~30000-parameter device pushes that
// many UDP datagrams back in a very short burst, especially with TotalMix's
// own OSC bandwidth limit disabled; if they arrive faster than the OS buffer
// can hold while Node drains it, the kernel silently drops the overflow, with
// no error anywhere, just a smaller-than-expected cache after warmup. To fix
// this we bind our own dgram socket with a configurable receive buffer size
// and hand it to osc.js via its "socket" option, which it will use as-is
// instead of creating its own. See README for the matching OS-level sysctl.

import dgram from "node:dgram";
import osc from "osc";
import type { TotalMixConfig } from "./config.js";
import { detectRaspberryPiModel } from "./platform.js";

export type OscArgValue = number | string | boolean;

export interface CachedValue {
  // Raw OSC argument values as received, in order
  args: OscArgValue[];
  // Local timestamp (ms since epoch) when this address last updated
  receivedAt: number;
}

export class TotalMixOscClient {
  private port!: InstanceType<typeof osc.UDPPort>;
  private socket!: dgram.Socket;
  private cache = new Map<string, CachedValue>();
  private ready = false;
  private rawListeners: Array<(address: string, args: OscArgValue[]) => void> = [];

  constructor(private config: TotalMixConfig) {}

  // Bind a plain dgram socket ourselves first, with the configured receive
  // buffer size, and wait for it to actually be listening. Binding it
  // ourselves (rather than letting osc.js do it) is the only way to control
  // the OS-level receive buffer, since osc.js's own socket creation path
  // takes no options at all.
  private async createBoundSocket(config: TotalMixConfig): Promise<dgram.Socket> {
    const sock = dgram.createSocket({
      type: "udp4",
      reuseAddr: true,
      // Deliberately NOT passing recvBufferSize here. When Node is asked to
      // set the receive buffer as part of createSocket()/bind(), it does so
      // from inside its own internal bind flow, on a later event-loop tick
      // (visible in a crash stack as "at process.processTicksAndRejections").
      // A throw from there is NOT catchable by wrapping our own call to
      // bind() in try/catch, it just becomes an uncaught exception and takes
      // the whole process down. Confirmed on macOS: requesting a receive
      // buffer above kern.ipc.maxsockbuf crashes the server outright via
      // that path, even with error handlers in place.
      //
      // Fix: bind first with OS defaults (always succeeds), then call
      // socket.setRecvBufferSize() ourselves afterwards. That call runs
      // synchronously in OUR code, so a rejection throws right here and is
      // genuinely catchable, see below.
    });

    await this.bindSocket(sock, config);

    if (config.udpRecvBufferBytes > 0) {
      try {
        sock.setRecvBufferSize(config.udpRecvBufferBytes);
      } catch (err) {
        // Not fatal: the server still works with the OS default, it may just
        // drop part of a cold-start /sendall burst (measured even on a Mac,
        // see docs/cold-start-packet-loss.md). Log and continue with
        // whatever buffer size the OS default bind already gave us.
        console.error(
          `[totalmix-mcp] Requested UDP receive buffer ${config.udpRecvBufferBytes} bytes was rejected by the OS ` +
            `(${(err as Error).message}). Continuing with the OS default buffer size (${sock.getRecvBufferSize()} ` +
            `bytes). This is usually fine on a fast host; see README ("Cold-start packet loss") if you do see ` +
            `dropped values after a cold-start /sendall.`
        );
      }
    }

    return sock;
  }

  // Bind a socket and wait for it to actually be listening, or reject on a
  // bind error. Wrapped separately from createBoundSocket so the fallback
  // path (OS default buffer) can reuse the same wait logic.
  private async bindSocket(sock: dgram.Socket, config: TotalMixConfig): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        sock.removeListener("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        sock.removeListener("error", onError);
        resolve();
      };
      sock.once("error", onError);
      sock.once("listening", onListening);
      sock.bind(config.localPort, config.localAddress);
    });

    // Persistent error logging for the lifetime of the socket. osc.js only
    // wires up its own "error" -> port "error" forwarding when it creates
    // the socket itself; since we hand it an already-open socket, we keep
    // our own listener for runtime errors after the initial bind succeeds.
    sock.on("error", (err: Error) => {
      console.error("[totalmix-mcp] OSC socket error:", err.message);
    });
  }

  // Wrap an already-bound socket as an osc.js UDPPort. Passing "socket" here
  // makes osc.js use it as-is (no bind of its own) and, as an osc.js quirk,
  // it emits "ready" synchronously inside this constructor call, before any
  // listener could be attached from the outside. That is fine: by the time
  // this function returns, the port is genuinely ready, since we already
  // confirmed the socket is bound before reaching this point.
  private wrapPort(socket: dgram.Socket): InstanceType<typeof osc.UDPPort> {
    const port = new osc.UDPPort({
      socket,
      remoteAddress: this.config.remoteAddress,
      remotePort: this.config.remotePort,
      metadata: true,
    });

    port.on("message", (message: { address: string; args: any[] }) => {
      const args = (message.args ?? []).map((a) =>
        typeof a === "object" && a !== null && "value" in a ? a.value : a
      );
      this.cache.set(message.address, {
        args,
        receivedAt: Date.now(),
      });
      for (const listener of this.rawListeners) {
        listener(message.address, args);
      }
    });

    port.on("error", (err: Error) => {
      console.error("[totalmix-mcp] OSC port error:", err.message);
    });

    return port;
  }

  private async connect(config: TotalMixConfig): Promise<{
    port: InstanceType<typeof osc.UDPPort>;
    socket: dgram.Socket;
  }> {
    const socket = await this.createBoundSocket(config);
    const port = this.wrapPort(socket);

    const requested = config.udpRecvBufferBytes;
    const actual = socket.getRecvBufferSize();
    const piModel = detectRaspberryPiModel();
    if (requested > 0) {
      console.error(
        `[totalmix-mcp] UDP receive buffer: requested ${requested} bytes` +
          (piModel ? ` (detected ${piModel})` : "") +
          `, OS granted ${actual} bytes` +
          (actual < requested
            ? " (below request: the OS either clamped or rejected it and the OS default was used instead; " +
              "see README, \"Cold-start packet loss\", if you see dropped values after a cold-start /sendall)"
            : "")
      );
    } else {
      console.error(
        `[totalmix-mcp] UDP receive buffer: using OS default (${actual} bytes) as configured ` +
          `(TOTALMIX_UDP_RECV_BUFFER=0). Expect dropped values after a cold-start /sendall if the default ` +
          `is small; see README, "Cold-start packet loss".`
      );
    }

    return { port, socket };
  }

  async open(): Promise<void> {
    if (this.ready) return;
    const { port, socket } = await this.connect(this.config);
    this.port = port;
    this.socket = socket;
    this.ready = true;
  }

  // Tear down the current connection and open a new one with the given
  // config. Used by the set_connection_config tool to change host/ports at
  // runtime without restarting the whole MCP process. The cache is cleared
  // since values from a different TotalMix instance/port are not valid for
  // the new target. Throws (without affecting the old connection's state
  // tracking) if the new port fails to bind, e.g. port already in use.
  async reconnect(newConfig: TotalMixConfig): Promise<void> {
    const { port: newPort, socket: newSocket } = await this.connect(newConfig);

    // Only swap over once the new connection is confirmed working, so a
    // failed reconnect attempt leaves the old, working connection untouched.
    const oldPort = this.port;
    const oldSocket = this.socket;
    this.port = newPort;
    this.socket = newSocket;
    this.config = newConfig;
    this.cache.clear();
    try {
      oldPort.close();
    } catch {
      // already closed
    }
    try {
      oldSocket.close();
    } catch {
      // already closed by port.close(), expected
    }
  }

  getConfig(): TotalMixConfig {
    return { ...this.config };
  }

  // Actual OS-granted receive buffer size in bytes, for diagnostics. Null
  // before open() has completed.
  getActualRecvBufferBytes(): number | null {
    return this.socket ? this.socket.getRecvBufferSize() : null;
  }

  close(): void {
    // Closing the osc.js port also closes the underlying dgram socket we
    // handed it, so a subsequent socket.close() would throw
    // ERR_SOCKET_DGRAM_NOT_RUNNING. Close the port, then only close the
    // socket defensively in case a future osc.js version stops doing so.
    try {
      this.port.close();
    } catch {
      // already closed
    }
    try {
      this.socket.close();
    } catch {
      // already closed by port.close(), expected
    }
  }

  // Send a single OSC message. value can be omitted for trigger-only
  // addresses like /undo, /durec/play (the "(f)" type in the protocol sheet).
  send(address: string, value?: OscArgValue): void {
    const args = value === undefined ? [] : [toOscArg(value)];
    this.port.send({ address, args });
  }

  // Register a listener called for every incoming OSC message, after the
  // cache is updated. Intended for diagnostics (see scripts/watch-osc.mjs).
  onRaw(listener: (address: string, args: OscArgValue[]) => void): void {
    this.rawListeners.push(listener);
  }

  // Read the last cached value for an address, if any has arrived yet.
  get(address: string): CachedValue | undefined {
    return this.cache.get(address);
  }

  // Return all cached address/value pairs whose address starts with prefix.
  // Useful for e.g. dumping everything under /input/3 after a sendchan call.
  getByPrefix(prefix: string): Array<{ address: string; value: CachedValue }> {
    const out: Array<{ address: string; value: CachedValue }> = [];
    for (const [address, value] of this.cache.entries()) {
      if (address.startsWith(prefix)) {
        out.push({ address, value });
      }
    }
    return out;
  }

  // Send a trigger/value and wait until a matching address (exact or by
  // prefix) shows up in the cache with a timestamp newer than the call,
  // or until timeoutMs elapses. Returns null on timeout.
  // Use sparingly: most parameters are write only confirmations come back
  // as the same address echoed by TotalMix, but not all of them are.
  async sendAndAwait(
    address: string,
    value: OscArgValue | undefined,
    awaitAddress: string,
    timeoutMs = 1500
  ): Promise<CachedValue | null> {
    const before = Date.now();
    this.send(address, value);

    const pollIntervalMs = 25;
    const deadline = before + timeoutMs;

    while (Date.now() < deadline) {
      const cached = this.cache.get(awaitAddress);
      if (cached && cached.receivedAt >= before) {
        return cached;
      }
      await sleep(pollIntervalMs);
    }
    return null;
  }

  // Number of distinct addresses currently in the cache.
  cacheSize(): number {
    return this.cache.size;
  }
}

function toOscArg(value: OscArgValue): { type: string; value: number | string } {
  if (typeof value === "boolean") {
    return { type: "f", value: value ? 1.0 : 0.0 };
  }
  if (typeof value === "number") {
    return { type: "f", value };
  }
  return { type: "s", value };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
