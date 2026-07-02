# monitoring: control room, dim, mono, groups, snapshots

Requires the core conventions in SKILL.md. This is the global monitor section
plus groups and snapshots. Much of it is global, not per channel.

## Important indexing exception

Unlike channels, groups and snapshots are **1-based**, not 0-based:

- `/mutegroup/<n>` n starts at 1
- `/sologroup/<n>` n starts at 1
- `/fadergroup/<n>` n starts at 1
- `/snapshot/load/<n>` n starts at 1
- `/layout/load/<n>` n starts at 1

Do **not** subtract 1 here. "Mute Group 1" is `/mutegroup/1`.

## Control room (global)

All under `/controlroom/<param>`, float.

**Careful, assignments, not levels:** `mainout`, `mainoutb`, `phones1` to
`phones4`, `talkchannel`, `cuechan` and `extinchannel` are channel
**selectors** (index into the output list, 0-based). The spec's own example:
`/controlroom/mainout 0.0` assigns channel 1+2 as Main Out. They do NOT set
a volume. "Main Out auf -10 dB" is `/output/<mainout-index>/volume`, never
`/controlroom/mainout`.

Toggles and amounts:

- `/controlroom/dim` bool, dim on/off
- `/controlroom/dimreduction` raw, how much dim attenuates
- `/controlroom/mainmono` bool, main out to mono
- `/controlroom/talkback` bool, talkback on/off
- `/controlroom/recallvolume` raw, recall volume
- `/controlroom/recall` trigger, recall the volume
- `/controlroom/externalin` bool
- `/controlroom/extingain` raw, external input gain
- `/controlroom/linkab` bool, link A/B
- `/controlroom/speakerb` bool, switch to speaker B
- `/controlroom/mutefx` bool, mute FX (reverb/echo)

Assignments (index, 0-based output channel; `-1` means unassigned / not
active, device-verified):

- `/controlroom/mainout` which output pair is Main Out
- `/controlroom/mainoutb` which output pair is Main Out B
- `/controlroom/phones1` to `phones4` which output pairs are Phones 1-4
- `/controlroom/talkchannel` which channel carries talkback (-1 none)
- `/controlroom/cuechan` which submix is cued to the main out (-1 no cue)
- `/controlroom/extinchannel` which channel the external input uses

Example, "Dim an":

```json
[{ "address": "/controlroom/dim", "value": true }]
```

Example, "Main auf Mono und Dim an":

```json
[
  { "address": "/controlroom/mainmono", "value": true },
  { "address": "/controlroom/dim", "value": true }
]
```

## Global mute and solo

```
/globalmute   bool
/globalsolo   bool
```

## Undo / redo

```
/undo   trigger
/redo   trigger
```

Write-only triggers, global. "Mach das rückgängig" right after a mixer
change is one `/undo`. There is no way to read the undo history.

## Groups

Mute/solo/fader groups as bool, 1-based. Despite the spec table, all three
ARE readable: their on/off states arrive with a settings sync
(device-verified). So for "ist Mutegroup 1 aktiv?" run `osc_sync` with
`settings` once if the cache is stale, then `osc_read` the group address.

```json
[{ "address": "/mutegroup/2", "value": true }]
```

Group **membership** of a matrix crosspoint is readable via the bitfield
`/mix/<in|pb>/<src>/<submix>/groupflags`: bits 1-4 mute groups 1-4, bits 6-9
solo groups 1-4, bits 12-16 fader groups 1-5. Read it with `osc_read` when
someone asks which group a channel send belongs to; writing it edits the
membership.

## Snapshots and layouts

```
/snapshot/load/<n>   rw, n starts at 1, see below
/snapshot/save       trigger
/layout/load/<n>     trigger, n starts at 1
```

There is **no** `/layout/save` — layouts are saved in the TotalMix UI only,
the protocol has just `load`. All triggers here follow the general rule:
value optional; if you do send one, it must be at least 0.5 (send 1.0), or
TotalMix ignores the message.

`/snapshot/load/<n>` is the one exception to "triggers are write-only": it is
read AND write. On write it accepts only the value `1`, which loads that
snapshot slot. TotalMix separately reports back the state of each slot: `0`
off, `2` active, `3` changed. This is what enables simple on/off snapshot-key
behavior, read the slot's cached value if you need to know whether it is
currently active before deciding to load it.

`/snapshot/save` saves the current mixer state into the currently active
snapshot slot and, per the protocol, triggers a `/snapshot/load` message
reporting the newly active snapshot back.

"Lade Snapshot 3":

```json
[{ "address": "/snapshot/load/3", "value": 1 }]
```

"Ist Snapshot 2 gerade aktiv?":

```
osc_read: ["/snapshot/load/2"]
```

Read value `2` means active, `0` means off, `3` means it just changed.

"Speichere den aktuellen Zustand in den aktiven Snapshot":

```json
[{ "address": "/snapshot/save" }]
```

"Lade Layout 2":

```json
[{ "address": "/layout/load/2", "value": 1.0 }]
```

## Level meters (read only)

Peak meters are send-only, in dB:

```
/level/in/<n>    /level/pb/<n>    /level/out/<n>
```

These cannot be set (read-only, the server rejects write attempts). To read
them after a sync, query via `osc_read`. Meters change constantly, and
TotalMix only pushes a meter address when its value actually changes, so the
cached value is only a snapshot in time, not a guaranteed recent one.

## Channel color (read only)

```
/input/<n>/color   /playback/<n>/color   /output/<n>/color
```

Send only, cannot be set via OSC. `0` means hidden, `1..8` is a color index
in the order of the TotalMix color picker. Useful for "welche Farbe hat
Kanal X" style questions, not for changing colors, that has to happen in the
TotalMix UI.

Color index map (picker order, device-verified against a UFX III):

```
1 white (default)   3 orange   5 blue    7 yellow
2 grey              4 red      6 green   8 pink
```

The picker's "(various)" entry is not a color: the TotalMix UI shows it on a
multi-channel selection whose channels have differing colors. It never
appears as an OSC value.

## Resend / resync commands

Beyond `osc_sync` (which sends `/sendall` or `/sendsettings`), a few more
targeted resend triggers exist. All are write-only, value `1` resends every
node, value `2` resends only nodes with a fader above -65dB ("active" nodes):

```
/sendall              all parameters (value 2: active mixer nodes only)
/sendmix              all mixer nodes (value 2: active nodes only)
/sendsubmix/<n>       one submix's nodes (value 2: active nodes only), n is the output/submix index
```

Use these sparingly: resending is one-way and asynchronous like every other
sync, and the protocol notes that resend options used carelessly can trigger
ping-pong transmissions and visible lag on faders and dials. Prefer
`get_channel` or `osc_sync` for normal use, reach for `/sendmix` /
`/sendsubmix` only when specifically asked to resync a whole mix or one
submix.

## Show/hide the TotalMix window

```
/showwindow   value: 0 (hide) | 1 (show)
```

Write-only, global, not tied to any channel.

## Status (read only)

```
/status/device       device name
/status/connection   0 disconnected, 1 connected
/status/dsp          DSP load
```

Useful for "ist das Geraet verbunden" or "wie hoch ist die DSP-Last".
TotalMix sends status at roughly one parameter per second, so a cached
status value can be a couple of seconds old right after startup; that is
normal, no resync needed.

## Output-Monitor-Extras

Two output strip parameters that belong to the monitoring workflow:

- `/output/<n>/crossfeed` raw, crossfeed amount for headphone outputs
  (blends L/R for a more speaker-like image).
- `/output/<n>/talkbacksel` bool, whether THIS output receives the talkback
  signal when `/controlroom/talkback` goes on. Per output, unlike the global
  talkback toggle.

## DURec (record transport)

Triggers, some with quirks:

- `/durec/play` ignores values below 0.5
- `/durec/record` `/durec/stop` (to stop recording send twice or value above
  10.0) `/durec/pause` `/durec/next` `/durec/previous`
- `/durec/state` and `/durec/time` are send-only status

## Recommended TotalMix OSC settings

In TotalMix, Options > Settings > OSC > Detailed Settings for the Global
OSC remote. What this skill assumes:

- **Send changes** on (keeps the cache current on UI changes).
- **"Follow Submix" disabled** (RME's own recommendation for Global OSC;
  with it on, mix addresses can target a different submix than expected).
- **Bandwidth Limitation: None** (syncs settle fastest; the server's UDP
  buffer handling is built for this).
- **Receive to hidden channels** on if hidden channels should stay
  controllable, see `reference/routing.md`.
- **Re-send received** + **Re-send if different** on (alpha 8+,
  device-verified): with both on, TotalMix echoes a received value back
  ONLY when it had to correct it (e.g. clamping EQ gain 99 to +20);
  accepted in-range values produce no echo. Minimal traffic, ping-pong
  safe, and `send_osc_commands` with `confirm: true` reports exactly these
  corrections.

## Stereo

Control room parameters are global and have no stereo-pair problem. The stereo
rule from SKILL.md only applies here when you address individual output
channels in the monitor chain directly.
