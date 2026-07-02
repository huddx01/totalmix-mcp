# mixing: levels, mute, solo, pan

Requires the core conventions in SKILL.md. This is the everyday work: volume,
muting, solo, pan. When the user names no submix, the main mix is almost always
meant, that is the submix of the main output.

## Which submix is meant

input and playback have no fader, their level is always a send into a submix.
"mach den Gesang leiser" with no further detail means quieter in the main mix.
The main mix is the submix of the main output. On this setup that is usually
output 0 (TRS 1/2), unless the user explicitly names a headphone or other
mix. If the user names a headphone mix, the submix is the relevant Phones
output (8 or 10).

## Setting levels

**input/playback into a submix** (dB-direct):

```
/mix/<in|pb>/<source>/<submix>/fader   value: <dB>
```

**output strip** (submix master, dB-direct):

```
/output/<n>/volume   value: <dB>
```

dB rules from SKILL.md: max +6, lowest audible -64.5, off -300. For "stumm"
prefer `mute` over -300.

Example, "Gesang auf input 5 im Hauptmix auf -3 dB":

```json
[{ "address": "/mix/in/4/0/fader", "value": -3 }]
```

Example, "Hauptausgang auf -10 dB" (output strip):

```json
[{ "address": "/output/0/volume", "value": -10 }]
```

### Relative

"3 dB lauter" needs the current value. Read first, then compute:

```
osc_read: ["/mix/in/4/0/fader"]   ->  e.g. -3
then send: /mix/in/4/0/fader value: 0
```

## Mute

`mute` as bool, on the channel or the crosspoint.

```json
[{ "address": "/input/4/mute", "value": true }]
```

Mute on input/playback affects the channel globally across all submixes. To
mute only a single send, use the crosspoint mute `/mix/in/<src>/<submix>/mute`
or pull that crosspoint's `fader` to -300.

## Solo

`solo` as bool at the crosspoint, `globalsolo` globally.

```json
[{ "address": "/mix/in/4/0/solo", "value": true }]
```

For pre-fader listening use `/<bus>/<n>/pfl` (bool) on the channel strip
instead of a crosspoint solo — "hör mal Input 3 ab, egal wie der Fader
steht" is PFL, not solo.

## Pan

`balpan` from -1.0 (left) through 0 (center) to +1.0 (right). At the crosspoint
for input/playback, at the strip for outputs.

```json
[{ "address": "/mix/in/4/0/balpan", "value": -0.5 }]
```

"hart links" is -1, "leicht rechts" about +0.3, "zentrieren" 0.

## Mind stereo

Before a per-channel mute or pan on a stereo pair, apply the stereo rule from
SKILL.md: the left index is master. For mono, set both sides explicitly when
both are meant.

## Reading

"Wie laut ist input 5 im Hauptmix" ->

```json
osc_read: ["/mix/in/4/0/fader"]
```

"Status von Output 3 komplett" ->

```json
get_channel: { "bus": "output", "channel": 2 }
```
