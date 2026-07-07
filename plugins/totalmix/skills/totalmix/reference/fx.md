# fx: reverb and echo (global effects)

Requires the core conventions in SKILL.md. Reverb and echo are the two global
send effects: one instance of each for the whole device, not per channel.
Controlled entirely through global addresses under `/reverb/...` and
`/echo/...`, with sends and returns tying them to individual channels.

## How channels connect

- `/input/<n>/fxsend` raw, send level from that input into the global FX bus.
  Per the protocol this exists on input channels only, not on playback.
- `/output/<n>/fxreturn` raw, how much of the FX return is mixed into that
  output.

Example, "FX-Send von Input 5 auf 20":

```json
[{ "address": "/input/4/fxsend", "value": 20 }]
```

## Reverb

```
/reverb/enable       bool
/reverb/type         index 0-14, see Reverb types below
/reverb/predelay     raw, ms
/reverb/lowcut       raw, Hz
/reverb/roomscale    raw, 0.0-1.0
/reverb/attack       raw, ms
/reverb/hold         raw, ms
/reverb/release      raw, ms
/reverb/highcut      raw, Hz
/reverb/time         raw, seconds
/reverb/highdamp     raw, 0.0-1.0
/reverb/smooth       raw, 0.0-1.0
/reverb/volume       raw, dB, -65.0 to +6.0
/reverb/width        raw, 0.0-1.0
/reverb/loadpreset   trigger, write-only, never appears in the cache
```

### Reverb types (`/reverb/type`, index 0-14)

```
0 Small Room     4 Shorty      8 Echoistic   12 Envelope
1 Medium Room    5 Attack      9 8plus9      13 Gated
2 Large Room     6 Swagger    10 Grand Wide  14 Space
3 Walls          7 Old School 11 Thicker
```

Example, "Reverb an, Large Room, Time auf 2.5":

```json
[
  { "address": "/reverb/enable", "value": true },
  { "address": "/reverb/type", "value": 2 },
  { "address": "/reverb/time", "value": 2.5 }
]
```

## Echo

```
/echo/enable       bool
/echo/type         index 0-2, see Echo types below
/echo/delay        raw, seconds, 0.0 to 2.0
/echo/feedback     raw
/echo/highcut      index 0-5, stepped filter, see Echo highcut steps below
/echo/volume       raw, dB, -65.0 to +6.0
/echo/width        raw, 0.0-1.0
/echo/loadpreset   trigger, write-only, never appears in the cache
```

### Echo types (`/echo/type`, index 0-2)

```
0 Stereo Echo   1 Stereo Cross   2 Pong Echo
```

### Echo highcut steps (`/echo/highcut`, index 0-5)

Unlike reverb's highcut, echo's highcut is a stepped filter selection, not a
continuous Hz value:

```
0 Off   1 16kHz   2 12kHz   3 8kHz   4 4kHz   5 2kHz
```

Example, "Echo an, Pong Echo, Feedback auf 30":

```json
[
  { "address": "/echo/enable", "value": true },
  { "address": "/echo/type", "value": 2 },
  { "address": "/echo/feedback", "value": 30 }
]
```

## Notes

- Enum names, indices, and the ranges/units above come from the oscmix
  project's own mapping of TotalMix's native protocol
  (https://github.com/huddx01/oscmix), the same source `protocol.ts` is
  reconciled against elsewhere. High confidence, but not round-tripped
  against a live OSC read in this session: if a value looks off on the
  device, read it back with `osc_read` before trusting a range here.
- `volume` on both reverb and echo follows the same dB convention as the
  rest of TotalMix (see SKILL.md): max +6, floor around -65. Neither has a
  documented dedicated "off" sentinel the way channel faders use -300, use
  `enable` to turn the effect off instead.
- Fields listed with an explicit range above (`roomscale`, `highdamp`,
  `smooth`, `width`, echo `delay`, reverb/echo `volume`) are the ones with a
  confirmed scale or min/max in the oscmix source. Fields listed only with a
  unit (`predelay`, `lowcut`, `attack`, `hold`, `release`, reverb `highcut`,
  echo `feedback`) have a known unit but no confirmed numeric range yet,
  read the current value first if the range matters for a request.
- `loadpreset` is a write-only trigger, same pattern as the per-channel
  loadpreset addresses in `reference/channelstrip.md`. Never appears in the
  cache, not even after a full `osc_sync`, that is expected, not a bug.
- `/controlroom/mutefx` is NOT a mute for reverb/echo themselves, it only
  mutes the FX signal on Main Out / Speaker B. See `reference/monitoring.md`
  (Control room) for that address, it does not belong in this file.
