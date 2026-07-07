---
name: totalmix
description: Control an RME TotalMix FX mixer (UFX III) via OSC through the totalmix-mcp-server. Use for levels, mute, solo, pan, routing, submixes, headphone mixes, EQ, dynamics, monitoring. Deutsch Trigger: Pegel, Kanal stumm, Solo, Panorama, Routing, Submixe, Kopfhoerermix, EQ, Dynamics, Monitoring (Dim, Mono, Gruppen, Snapshots).
---

# TotalMix Control

This skill turns audio commands into exact OSC addresses for the
totalmix-mcp-server. The server is deliberately dumb: it builds no addresses and
converts nothing, it only validates and forwards. You build the exact address
and the dB-native value yourself, then call a tool. Users speak German, parse
accordingly. This file holds the core conventions that apply everywhere. For
detailed tasks, also read the matching reference file.

## Fast path: do this first

Most requests are direct: one or more channels named by number, with an absolute
target. For these, build the address from the cheat sheet below and send it in a
single `send_osc_commands` batch. Do not read, do not sync, do not check stereo.
That is the whole job, it should feel instant.

Why this is safe and worth it: you are addressing exactly the index the person
named, so there is nothing to look up first. A `get_channel` read blocks 250 ms
on the server while it waits for TotalMix to push values back, so a needless read
is the single most expensive habit. Skip it. If `send_osc_commands` returns no
error, the command went out, there is no need to read anything back to confirm.

### Cheat sheet (intent to address)

Indices are 0-based, that is UI number minus 1. Levels are dB-direct.

```
output level (submix master)   /output/<n>/volume          value: <dB>
mute (any bus)                 /<bus>/<n>/mute             value: true | false
rename (any bus)               /<bus>/<n>/name             value: "<text>"
in/pb level into submix s      /mix/<in|pb>/<src>/<s>/fader value: <dB>
pan in/pb into submix s        /mix/<in|pb>/<src>/<s>/balpan value: -1.0 .. +1.0
balance of an output           /output/<n>/balpan          value: -1.0 .. +1.0
solo a crosspoint              /mix/<in|pb>/<src>/<s>/solo  value: true | false
```

`<bus>` is input, playback, or output. `<in|pb>` selects the matrix source side.
dB scale: max +6, lowest audible -64.5, off -300. For "stumm" use `mute`, not
-300. Input and playback have no fader of their own, their level is always a
matrix send (`/mix/...`), only outputs have a strip fader (`volume`).

### Batches and ranges

Several channels go in one call, build the whole array and send it once. A range
or "alle Kanaele" is one batch, not one call per channel, and you do not reason
per item. Example, "nenne alle Outs OUT 01 bis OUT 94, jeden Channel, egal ob
stereo oder mono": one batch of 94 name commands on indices 0 to 93. The "egal ob
stereo oder mono" is the normal case here, name every index explicitly.

### When the fast path does not apply

Drop into the sections below only for these:

- **Relative or percentage level** ("3 dB lauter", "halb so laut"): the fader
  scale is not linear, so read the current value with `osc_read` first, then
  compute and send. See `reference/mixing.md`.
- **Channel named, not numbered** ("der Gesang", "die Snare"): resolve the name
  to an index once with `get_channel_names`, then send. See Names below.
- **Per-side parameters** `gain`, `roomeq`, `phase`, `delay`: these do not
  follow the stereo master, set per side. See `reference/channelstrip.md`.
- **A whole stereo pair or "beide Seiten"** where you must decide about the
  partner index: see Stereo below.
- **EQ, dynamics, routing builds, monitoring, snapshots**: load the matching
  reference file.
- **Reverb or echo** ("Hall", "Delay/Echo", FX send/return): these are global,
  not per-channel. See `reference/fx.md`.

## Which reference file when

- `reference/mixing.md` levels, mute, solo, pan, relative changes. The everyday work.
- `reference/routing.md` matrix, submixes, building headphone mixes.
- `reference/channelstrip.md` gain, EQ, dynamics, low cut, room EQ per channel.
- `reference/monitoring.md` control room, dim, mono, groups, snapshots, resend/resync.
- `reference/fx.md` reverb and echo, the two global send effects, plus fxsend/fxreturn.
- `reference/durec.md` DURec record transport (UFX/UCX with a USB stick only).
- `reference/misc.md` device status, undo/redo, show/hide window, level meters.
  Small, unrelated odds and ends, read only for the one address you need.

Read the relevant file as soon as a request falls into its area. The conventions
here apply everywhere and are not repeated in the reference files.

## The five tools

- `send_osc_commands` takes `{ commands: [{ address, value? }], confirm? }`.
  Many commands in one call. Omit `value` only for trigger addresses (all
  others are rejected without one). Unknown or read-only addresses are
  rejected per item, the rest still goes out. `confirm: true` detects value
  corrections: TotalMix (with "Re-send received" + "Re-send if different"
  on) echoes a value back only when it had to correct it, e.g. clamping an
  out-of-range dB — no echo means applied exactly as sent. Use it only when
  a correction actually matters; the default fire-and-forget is the fast
  path.
- `get_channel` `{ bus, channel, settle_ms? }`. Triggers a resend, waits the
  settle window (250 ms default), returns the cached state of that one index.
  The expensive read, use it only when you actually need a channel's values.
- `osc_read` `{ addresses: [...] }`. Direct cache read, no resend, no wait. For
  focused questions when the cache is fresh, and for relative changes.
- `get_channel_names` `{ bus? }`. Lists channel names per bus from the cache, no
  resend. Call once per session to map spoken names to indices.
- `osc_sync` `{ scope: "all" | "settings" }`. Wide resync for the rare case
  where the whole cache is stale. Read back with `osc_read` afterwards.

## Device discovery

The server pushes a full `/sendall` at startup and caches all parameters. To
discover what a device has (e.g., how many outputs), just `osc_read` on the
relevant addresses. No sync, no resend needed — the cache is complete from
boot:

```json
{ "addresses": ["/output/0/volume", "/output/50/volume", "/output/93/volume"] }
```

Whichever addresses exist in the cache (are present in the response), that
device has. A UFX III with 94 outputs: query a few scattered indices to
confirm the range, or read all 94 in one call. Much faster than polling
with `get_channel` in a loop.

## Bus model

Three channel buses plus the matrix.

- **input** hardware inputs. They have a channel strip (gain, EQ, dynamics,
  phantom) but no fader of their own.
- **playback** software playback channels from the DAW. Also no fader.
- **output** hardware outputs, these are the submixes. Only they have their own
  strip fader (`volume`).
- **matrix** every crosspoint, that is how much an input or playback sends into a
  given output. The send level of an input or playback exists only here.

So "input 3 leiser" almost always means its send into the relevant submix, set
through `/mix/in/3/<submix>/fader`, not a channel fader (there is none).

## Address forms

No `/1/` bank prefix on the wire.

Channel strip (a parameter of the channel itself):

```
/<bus>/<n>/<param>
```

Examples: `/input/2/48v`, `/output/8/volume`, `/playback/0/mute`.

Matrix crosspoint (send from an input or playback source into an output submix):

```
/mix/<in|pb>/<source>/<submix>/<param>
```

`<submix>` is the target output. Examples: `/mix/in/3/2/fader` (input 3 into
submix 2, dB), `/mix/pb/0/8/balpan` (playback 0 in headphone submix 8, pan).

Level is `fader` (dB) at a crosspoint and `volume` (dB) at an output strip. Pan
is `balpan` everywhere. The reference files hold the full address list per area.

## Indexing

Channel and submix indices are 0-based, the TotalMix UI shows 1-based. "Kanal 1"
means OSC index 0. Convert: OSC index = UI number minus 1.

Exception: groups and snapshots are 1-based, see `reference/monitoring.md`. Do
not subtract 1 there.

## Levels in dB

`fader` (matrix) and `volume` (output) are dB-direct, no conversion. "auf -5 dB"
becomes `value: -5`. For a real mute use `mute`, not -300. Relative or percentage
requests need the current value first (`osc_read`), the scale is not linear.

## Pan (balpan)

`balpan` runs from -1.0 (left) through 0 (center) to +1.0 (right). For an
absolute pan ("hart links" -1, "zentrieren" 0) just send it. Only for a relative
pan read the current value first.

## Stereo pairs

This matters only sometimes, not on every command. On a stereo pair the left
(even) index is master, and `volume`, `mute`, `name` and `balpan` follow the
master. So addressing the index the person named is correct, no read needed.

You need to think about the partner index only in two cases:

- **Per-side parameters** `gain`, `roomeq`, `phase` and `delay` do not follow
  the master, set each side explicitly (right side = left index + 1). Per the
  spec legend these four are exactly the L/R-capable parameters. See
  `reference/channelstrip.md`.
- **A mono pair where both halves are meant**: the partner inherits nothing, set
  both indices explicitly. If the person says "beide Seiten" or the pair mode is
  unclear and the distinction changes the result, read `/<bus>/<n>/stereo` first.

Note: when a pair is switched mono to stereo, the right channel takes over the
left master's settings and keeps them even after switching back.

<!-- Addressing is settled by the spec legend: only gain/roomeq/phase/delay
     are per-side (right = left index + 1), everything else goes through the
     left index. Still open for device testing: how a MONO pair behaves when
     both halves are meant (which values the partner inherits on the
     stereo->mono switch). -->

## Example channel map (for Fireface UFX III)

Indices are 0-based and per channel, so a stereo pair takes two consecutive
indices and starts on the even one. The index is the same for input and output,
but the physical label differs in the Phones region, so mind which bus you are
on.

Analog, indices 0 to 11:

- 0 to 7: analog 1 to 8. On the output side these are the TRS line outs 1 to 8,
  on the input side the analog line inputs 1 to 8.
- 8 and 9: physical channels 9/10. Output side is Phones 1, input side is the
  Mic/Inst inputs.
- 10 and 11: physical channels 11/12. Output side is Phones 2, input side is the
  Mic/Inst inputs.

Everything from index 12 up is digital: one AES/SPDIF pair, then ADAT, then
MADI. The exact digital index assignment is device and config dependent, so
confirm it on the unit before addressing a digital channel by number rather than
trusting a remembered value.

The main mix is the submix of output 0 unless a headphone or other mix is named.

## Names and color to indices

When the person uses a name ("der Gesang") instead of a number, call
`get_channel_names` once (a cheap cache read), map the name to its 0-based index,
and remember the mapping for the rest of the session. If the name is not found,
run `osc_sync` with `all` once, then `get_channel_names` again, since the cache
may be stale.

Channel color follows the same shape as names (a per-channel identifying
attribute, resolved once and remembered), but is read-only:

```
/input/<n>/color   /playback/<n>/color   /output/<n>/color
```

Send only, cannot be set via OSC, that has to happen in the TotalMix UI. `0`
means hidden, `1..8` is a color index in the picker's order (device-verified
against a UFX III):

```
1 white (default)   3 orange   5 blue    7 yellow
2 grey              4 red      6 green   8 pink
```

The picker's "(various)" entry is not a color: the TotalMix UI shows it on a
multi-channel selection whose channels have differing colors. It never
appears as an OSC value. Use this for "welche Farbe hat Kanal X" questions,
via `osc_read` once the cache holds the address (no dedicated resend needed
beyond the usual `osc_sync` if the cache looks stale).

## Reading

TotalMix answers a resend asynchronously over UDP, not inline, so reading is two
steps. Use the cheaper path when you can:

- Whole channel, values needed: `get_channel`. Trigger plus 250 ms wait plus read
  in one call. The expensive option.
- A few known addresses when the cache is fresh, or for a relative change:
  `osc_read`. No wait.
- Do not read just to confirm a write. A clean `send_osc_commands` result means
  it went out.
- With TotalMix's "Re-send received" + "Re-send if different" on (the
  recommended combination, documented in the server README), corrected
  values are echoed back into the cache. An accepted in-range write is NOT
  echoed, so after your own writes the cache holds your sent value's
  predecessor — trust what you sent instead of re-reading; only a
  correction echo (readable via `confirm: true`) overrides that.

If `get_channel` comes back empty, the settle window was too short (raise
`settle_ms`) or that channel is hidden from OSC control in TotalMix.

## Worked examples

"Setze Out 1 auf -6 dB." (output, UI 1)

```json
[{ "address": "/output/0/volume", "value": -6 }]
```

"Mute Kanal 12." (output, UI 12)

```json
[{ "address": "/output/11/mute", "value": true }]
```

"Input 3 auf -5 dB im Hauptmix." (main mix = submix 0)

```json
[{ "address": "/mix/in/2/0/fader", "value": -5 }]
```

"Ist Kanal 12 gemutet?" (output, UI 12): read it, then report `/output/11/mute`.

```
get_channel: { "bus": "output", "channel": 11 }
```
