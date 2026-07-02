import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TotalMixOscClient, OscArgValue } from "./oscClient.js";
import { validateAddress } from "./protocol.js";

// Dumb pipe tool layer. No dB conversion, no address building. The skills
// build exact addresses and dB-native values; the server only validates,
// forwards, and reads the cache back. Three tools cover everything:
//   send_osc_commands  write one or many addresses in a single call
//   get_channel        trigger sendchan, settle, return the channel prefix
//   osc_read           direct cache read for known addresses, no trigger

// Default settle window for get_channel, configurable via env since how long
// values take to arrive depends on TotalMix's own OSC bandwidth limit
// setting and general LAN conditions. The settle_ms tool argument still
// overrides this per call.
const SETTLE_MS_DEFAULT = Number.parseInt(process.env.GET_CHANNEL_SETTLE_MS ?? "250", 10);

// How long a confirmed send waits for TotalMix to echo the value back.
// Echoes only happen when "Re-send received" is enabled in TotalMix's
// Global OSC detailed settings; on a LAN they arrive within a few ms, so
// this stays short. A timeout is not an error (see the confirm handling).
// Device-verified semantics with "Re-send if different" also enabled (the
// recommended combination): TotalMix echoes ONLY when the applied value
// differs from the received one (e.g. clamped 99 -> 20 for an EQ gain);
// an accepted in-range value produces no echo at all.
const CONFIRM_TIMEOUT_MS = Number.parseInt(process.env.SEND_CONFIRM_TIMEOUT_MS ?? "400", 10);

// Sleep helper. Used to wait out the async push window after a sendchan
// trigger, since TotalMix streams the channel values back over the next
// few milliseconds rather than answering inline.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerTools(server: McpServer, osc: TotalMixOscClient): void {
  // Write path. Accepts an array so a range like "channels 10 to 34" is one
  // tool call instead of 25. Each address is validated against the protocol
  // map; unknown or read-only addresses are rejected per item, and the whole
  // batch reports which items went out and which were refused.
  server.registerTool(
    "send_osc_commands",
    {
      title: "Send one or more OSC commands to TotalMix",
      description:
        "Send a batch of OSC messages to TotalMix in one call. Each item is an address and an " +
        "optional value. Values are sent dB-native for level addresses (e.g. fader/volume in dB, " +
        "+6 to -64.5, use -300 for off), float for everything numeric, string for text. Omit value " +
        "only for trigger-only addresses; every other address requires one. Every address is " +
        "validated against the protocol map first; unknown or read-only addresses are rejected " +
        "individually without blocking the rest. Set confirm=true to detect value corrections: " +
        "with TotalMix's 'Re-send received' + 'Re-send if different' options on, TotalMix echoes a " +
        "value back only when it had to correct it (e.g. clamping an out-of-range dB); no echo " +
        "means the value was applied exactly as sent.",
      inputSchema: {
        commands: z
          .array(
            z.object({
              address: z
                .string()
                .regex(/^\//, "OSC address must start with /")
                .describe("Exact OSC address, e.g. /mix/in/3/2/fader or /output/0/volume"),
              value: z
                .union([z.number(), z.string(), z.boolean()])
                .optional()
                .describe("Value to send. Omit for trigger-only addresses."),
            })
          )
          .min(1)
          .describe("One or more commands to send in order"),
        confirm: z
          .boolean()
          .optional()
          .describe(
            "Wait per readable value for a correction echo from TotalMix and report it. Needs " +
              "'Re-send received' (+ 'Re-send if different') in TotalMix; no echo means applied as sent."
          ),
      },
    },
    async ({ commands, confirm }) => {
      const sent: string[] = [];
      const rejected: string[] = [];

      for (const { address, value } of commands) {
        const check = validateAddress(address);
        if (!check.ok) {
          rejected.push(`${address}: ${check.reason}${check.hint ? " " + check.hint : ""}`);
          continue;
        }
        const def = check.def;
        if (def && def.write === false) {
          rejected.push(`${address}: read-only (status or meter), cannot be set`);
          continue;
        }
        // Non-trigger addresses carry a value on the wire ("f"/"s" in the
        // spec, as opposed to "(f)"); TotalMix ignores them without one, so
        // failing loudly here beats a silent no-op.
        if (def && def.valueType !== "trigger" && value === undefined) {
          rejected.push(
            `${address}: requires a value (${def.valueType}); only trigger addresses may omit it`
          );
          continue;
        }

        // Echo confirmation only makes sense for readable non-trigger
        // addresses: write-only commands are never echoed (see the
        // write-only rule in the protocol reference).
        if (confirm && def && def.read && def.valueType !== "trigger") {
          const echoed = await osc.sendAndAwait(
            address,
            value as OscArgValue | undefined,
            address,
            CONFIRM_TIMEOUT_MS
          );
          if (echoed) {
            sent.push(
              `${address} = ${String(value)} (TotalMix corrected the value to: ${JSON.stringify(echoed.args)})`
            );
          } else {
            sent.push(
              `${address} = ${String(value)} (no correction echo within ${CONFIRM_TIMEOUT_MS} ms; ` +
                `with 'Re-send if different' this means the value was applied exactly as sent)`
            );
          }
          continue;
        }

        osc.send(address, value as OscArgValue | undefined);
        sent.push(value === undefined ? address : `${address} = ${String(value)}`);
      }

      const lines: string[] = [];
      if (sent.length) lines.push(`Sent ${sent.length}:`, ...sent.map((s) => "  " + s));
      if (rejected.length) lines.push(`Rejected ${rejected.length}:`, ...rejected.map((s) => "  " + s));
      return {
        content: [{ type: "text", text: lines.join("\n") || "Nothing to send." }],
        isError: rejected.length > 0 && sent.length === 0,
      };
    }
  );

  // Read path, normal case. Triggers /sendchan for one channel, waits a
  // settle window for TotalMix to push the values, then returns everything
  // currently cached under that channel prefix. Strictly the requested
  // index only; stereo partner handling lives in the skills, not here.
  server.registerTool(
    "get_channel",
    {
      title: "Read all parameters of one channel",
      description:
        "Read the full parameter set of a single channel. Triggers TotalMix to resend the channel, " +
        "waits briefly for the values to arrive, then returns them. Returns only the requested " +
        "channel index; for a stereo pair, query the partner index separately if needed.",
      inputSchema: {
        bus: z.enum(["input", "playback", "output"]),
        channel: z.number().int().min(0).describe("0-based channel index"),
        settle_ms: z
          .number()
          .int()
          .min(0)
          .max(2000)
          .optional()
          .describe(`How long to wait for pushed values, default ${SETTLE_MS_DEFAULT} ms`),
      },
    },
    async ({ bus, channel, settle_ms }) => {
      osc.send(`/sendchan/${bus}/${channel}`, 1.0);
      await sleep(settle_ms ?? SETTLE_MS_DEFAULT);

      // Channel strip params live under /<bus>/<channel>/. Input and playback
      // also have matrix sends under /mix/in/<channel>/ and /mix/pb/<channel>/
      // (the source side of every crosspoint they feed). Outputs only have the
      // strip. No /1/ bank prefix on the wire.
      const prefixes =
        bus === "input"
          ? [`/input/${channel}/`, `/mix/in/${channel}/`]
          : bus === "playback"
          ? [`/playback/${channel}/`, `/mix/pb/${channel}/`]
          : [`/output/${channel}/`];

      const seen = new Map<string, { args: OscArgValue[]; ageMs: number }>();
      for (const prefix of prefixes) {
        for (const m of osc.getByPrefix(prefix)) {
          seen.set(m.address, { args: m.value.args, ageMs: Date.now() - m.value.receivedAt });
        }
      }

      const entries = [...seen.entries()].map(([address, v]) => ({ address, ...v }));
      if (entries.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No values cached for ${bus} ${channel} after ${settle_ms ?? SETTLE_MS_DEFAULT} ms. The channel may be hidden from OSC, or settle_ms too short.`,
            },
          ],
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(entries, null, 2) }] };
    }
  );

  // Read path, targeted. Direct cache read for one or more known addresses,
  // no trigger. Use when the cache is already fresh (e.g. right after a
  // get_channel or an osc_sync), for a focused question like one mute state.
  server.registerTool(
    "osc_read",
    {
      title: "Read cached values for exact addresses",
      description:
        "Read the last known value for one or more exact OSC addresses straight from the cache, " +
        "without triggering a resend. Use for focused questions when the cache is already current. " +
        "If a value is missing, run get_channel or osc_sync first.",
      inputSchema: {
        addresses: z.array(z.string()).min(1).describe("Exact OSC addresses to look up"),
      },
    },
    async ({ addresses }) => {
      const out = addresses.map((address) => {
        const cached = osc.get(address);
        return cached
          ? { address, args: cached.args, ageMs: Date.now() - cached.receivedAt }
          : { address, args: null, ageMs: null };
      });
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    }
  );

  // Name resolution. Pure cache read, no trigger: /sendall on cold start
  // already pushed every channel name into the cache, and TotalMix pushes
  // updates on rename, so the names are there. Returns all non-empty names
  // grouped per bus, so the model can map a spoken name to an index once per
  // session. No default-name classification (that would be device-specific
  // guessing); only literally empty strings are dropped.
  server.registerTool(
    "get_channel_names",
    {
      title: "List channel names per bus",
      description:
        "Return the names of all channels, grouped by bus, read straight from the cache. Use once to " +
        "learn the name-to-index mapping, then resolve spoken channel names (e.g. 'the vocal') to OSC " +
        "indices yourself. No resend is triggered. If names look stale, run osc_sync 'all' first. " +
        "Indices are 0-based.",
      inputSchema: {
        bus: z
          .enum(["input", "playback", "output"])
          .optional()
          .describe("Limit to one bus. Omit to get all three."),
      },
    },
    async ({ bus }) => {
      const buses = bus ? [bus] : (["input", "playback", "output"] as const);
      const result: Record<string, Array<{ index: number; name: string }>> = {};

      for (const b of buses) {
        const named: Array<{ index: number; name: string }> = [];
        for (const m of osc.getByPrefix(`/${b}/`)) {
          // Only /<bus>/<n>/name addresses, capture the channel index.
          const match = m.address.match(new RegExp(`^/${b}/(\\d+)/name$`));
          if (!match) continue;
          const value = m.value.args[0];
          if (typeof value !== "string" || value.length === 0) continue;
          named.push({ index: Number.parseInt(match[1], 10), name: value });
        }
        named.sort((a, b2) => a.index - b2.index);
        result[b] = named;
      }

      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  // Read path, fallback. Global or settings-wide resync for the rare case
  // where the whole cache needs refreshing rather than one channel.
  server.registerTool(
    "osc_sync",
    {
      title: "Trigger a wide TotalMix resync",
      description:
        "Trigger TotalMix to resend state into the cache. Scope 'all' sends /sendall (full dump), " +
        "'settings' sends /sendsettings. For a single channel use get_channel instead. After the " +
        "sync, allow a moment, then read with osc_read.",
      inputSchema: {
        scope: z.enum(["all", "settings"]),
      },
    },
    async ({ scope }) => {
      osc.send(scope === "all" ? "/sendall" : "/sendsettings", 1.0);
      return {
        content: [{ type: "text", text: `Sync triggered (${scope}). Allow a moment, then use osc_read.` }],
      };
    }
  );
}
