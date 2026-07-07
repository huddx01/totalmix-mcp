# monitoring: control room, dim, mono, groups, snapshots

Requires the core conventions in SKILL.md. This is the global monitor section
plus groups and snapshots. Much of it is global, not per channel.

For device status, undo/redo, showing/hiding the TotalMix window, and level
meters, see `reference/misc.md`. For DURec record transport, see
`reference/durec.md`. For channel color, see the "Names and color to
indices" section in SKILL.md. Recommended TotalMix OSC settings live in the
server README, not here, since they are a one-time app setup step, not
address-building knowledge.

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
- `/controlroom/mutefx` bool, mutes reverb/echo but only on Main Out /
  Speaker B, not globally and not the effects themselves (device-clarified;
  do not confuse with an FX enable/disable, see `reference/fx.md`)

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
/layout/save         trigger
```

`/layout/save` is a plain write-only trigger (saves the current layout), like
`/snapshot/save`. It is not explicit in the spec table but confirmed on the
UFX III: accepted, nothing sent back. All triggers here follow the general
rule: value optional; if you do send one, it must be at least 0.5 (send 1.0),
or TotalMix ignores the message.

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

"Speichere das aktuelle Layout":

```json
[{ "address": "/layout/save" }]
```

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

## Output-Monitor-Extras

Two output strip parameters that belong to the monitoring workflow:

- `/output/<n>/crossfeed` raw, crossfeed amount for headphone outputs
  (blends L/R for a more speaker-like image).
- `/output/<n>/talkbacksel` bool, whether THIS output receives the talkback
  signal when `/controlroom/talkback` goes on. Per output, unlike the global
  talkback toggle.

## Stereo

Control room parameters are global and have no stereo-pair problem. The stereo
rule from SKILL.md only applies here when you address individual output
channels in the monitor chain directly, e.g. the Output-Monitor-Extras above.
