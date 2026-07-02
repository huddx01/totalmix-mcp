# channelstrip: gain, EQ, dynamics, low cut, room EQ

Requires the core conventions in SKILL.md. This is per-channel processing, not
level or routing. All addresses are channel strip addresses of the form
`/<bus>/<n>/<param>`.

## Preamp and input (input only)

- `/input/<n>/gain` preamp gain. This parameter is L/R independent, so it
  applies per channel side and does **not** follow the stereo master. For a
  stereo pair set both sides if both are meant.
- `/input/<n>/48v` phantom power, bool.
- `/input/<n>/instrument` Hi-Z/instrument, bool.
- `/input/<n>/pad` pad, bool.
- `/input/<n>/reflevel` reference level, index (device dependent).
- `/input/<n>/autoset` bool.

Example, "Phantom auf input 2 an, Gain 24 dB":

```json
[
  { "address": "/input/1/48v", "value": true },
  { "address": "/input/1/gain", "value": 24 }
]
```

## EQ

Three bands plus enable, per channel. Parameters (all float, gain/freq/q as
raw, type as index):

```
/<bus>/<n>/eq/enable
/<bus>/<n>/eq/band1gain   band1freq   band1q   band1type
/<bus>/<n>/eq/band2gain   band2freq   band2q
/<bus>/<n>/eq/band3gain   band3freq   band3q   band3type
/<bus>/<n>/eq/loadpreset   (trigger, also contains low cut)
```

Only band 1 and 3 have a `type` (shelf/peak/etc.), band 2 is fixed peak.
`gain`, `freq`, `q` are raw values in the units of the TotalMix UI (gain in dB,
freq in Hz, q as a factor).

`loadpreset` loads one of 16 presets. The UI numbers them 1..16, the wire
value is 0-based (0..15, UI preset N = value N-1, same list-box rule as
roomeq). TotalMix does not expose preset NAMES over OSC, so a preset can only
be addressed by number; if the person names a preset, ask for its slot
number.

Example, "EQ auf input 5 an, Band 2 plus 3 dB bei 2 kHz":

```json
[
  { "address": "/input/4/eq/enable", "value": true },
  { "address": "/input/4/eq/band2gain", "value": 3 },
  { "address": "/input/4/eq/band2freq", "value": 2000 }
]
```

## Low cut

```
/<bus>/<n>/lowcut/enable   lowcut/freq   lowcut/slope
```

`slope` is the filter steepness (index/raw depending on the UI). Example, "Low
Cut auf input 5 bei 80 Hz":

```json
[
  { "address": "/input/4/lowcut/enable", "value": true },
  { "address": "/input/4/lowcut/freq", "value": 80 }
]
```

## Dynamics

```
/<bus>/<n>/dynamics/enable
/<bus>/<n>/dynamics/gain   attack   release
/<bus>/<n>/dynamics/compthres   compratio
/<bus>/<n>/dynamics/expthres    expratio
/<bus>/<n>/dynamics/loadpreset   (trigger, also contains autolevel)
```

`loadpreset` behaves like the EQ one: 16 presets, UI 1..16 = wire 0..15, no
preset names over OSC.

Example, "leichte Kompression auf input 5, Threshold -18, Ratio 3":

```json
[
  { "address": "/input/4/dynamics/enable", "value": true },
  { "address": "/input/4/dynamics/compthres", "value": -18 },
  { "address": "/input/4/dynamics/compratio", "value": 3 }
]
```

## Autolevel

```
/<bus>/<n>/autolevel/enable   maxgain   headroom   risetime
```

## Further channel settings

All `/<bus>/<n>/<param>` on the strip:

- `phase` bool, polarity invert. **Per-side** (L/R): right channel of a
  stereo pair is addressed as index + 1.
- `width` raw, stereo width of the channel (1 = full stereo, 0 = mono,
  negative swaps sides).
- `msproc` bool, mid/side processing (input and output).
- `delay` raw, channel delay in ms. **Per-side** like `phase`.
- `record` bool, record-arm of the channel for DURec.
- `playchan` raw, which file channel a playback channel plays (stereo pairs
  use consecutive channels in the file).
- `reflevel` index, reference level. Exists on inputs AND outputs (device
  dependent list, 0-based index). On the UFX III only line channels report
  it; mic channels (8-11) report `48v`/`instrument`/`autoset` instead.

Device reality check: playback channels carry only `stereo`, `name`,
`mute`, `phase`, `msproc`, `width`, `color` — **no** EQ, dynamics,
autolevel, low cut or fxsend on playback. That is not a UFX III quirk but
true of every RME device, and since server 0.5.1 those playback addresses
are rejected outright. So "EQ auf Playback X" cannot be done on the
playback channel; offer the EQ of the target output (or of an input)
instead. `record`, `playchan`, `pfl`, `delay` and `pad` were never observed
on any bus; treat them as untested rather than reliable.

## Room EQ (mostly on outputs)

```
/<bus>/<n>/roomeq/enable
/<bus>/<n>/roomeq/band<1..9>gain   band<1..9>freq   band<1..9>q
/<bus>/<n>/roomeq/band1type   band8type   band9type
/<bus>/<n>/roomeq/loadpreset   (trigger)
```

Stereo note: `roomeq` like `gain` is deliberately L/R independent and does
**not** follow the master. For a stereo output set per side. `roomeq/loadpreset`
is write-only and never appears in the cache, even after a full sync. 16
presets, preset numbers on the wire are 0-based (UI preset N is wire value
N minus 1, so UI 1..16 = wire 0..15); names are not exposed over OSC.

## General stereo note

The spec's legend settles which parameters are per-side: exactly the ones
marked L/R in the protocol table, that is `gain`, `roomeq`, `phase` and
`delay`. For these the right channel of a stereo pair is addressed as
index + 1; **all** other parameters are addressed via the left (master)
index. How a mono pair behaves when both halves are meant is still the open
question from SKILL.md — be conservative there and set both sides
explicitly.
