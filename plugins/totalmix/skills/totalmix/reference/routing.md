# routing: matrix, submixes, headphone mixes

Requires the core conventions in SKILL.md. This is about the matrix itself: who
sends where, building submixes, setting up headphone mixes. Conceptually the
hardest part, so plenty of examples.

## Mental model

The matrix is a grid. Rows are sources (input and playback), columns are
submixes (output). Each intersection (crosspoint) is its own send with its own
level and pan.

```
/mix/<in|pb>/<source>/<submix>/<param>
```

A submix is just an output channel viewed as a target. "Kopfhoerermix 1" is the
submix of the Phones 1 output, on this setup output 8.

Important: a send always exists conceptually, even when set to -300 (off).
Building a routing means bringing the right crosspoints to audible levels and
leaving all others off.

## Activating a send

"Schick input 3 auf Kopfhoerer 1" (Phones 1 = output 8), moderate level:

```json
[{ "address": "/mix/in/2/8/fader", "value": -6 }]
```

## Removing a send

"Nimm input 3 aus Kopfhoerer 1 raus":

```json
[{ "address": "/mix/in/2/8/fader", "value": -300 }]
```

off is -300, not 0. 0 dB would be full on.

## Building a complete headphone mix

"Bau mir auf Kopfhoerer 1 einen Mix aus Gesang (input 5), Gitarre (input 6) und
der Playback-Summe (playback 0)." Phones 1 = output 8, 0-based indices:

```json
[
  { "address": "/mix/in/4/8/fader", "value": -3 },
  { "address": "/mix/in/5/8/fader", "value": -8 },
  { "address": "/mix/pb/0/8/fader", "value": -6 }
]
```

Pan on top, vocals centered, guitar slightly left:

```json
[
  { "address": "/mix/in/4/8/balpan", "value": 0 },
  { "address": "/mix/in/5/8/balpan", "value": -0.3 }
]
```

## Copying a mix to another (manual)

There is no copy command. Read the source submix sends per `get_channel` on the
source sides or via `osc_read`, and write the same values to the target
submix's crosspoints. Example procedure for "kopiere Hauptmix (Submix 0) nach
Kopfhoerer 2 (Output 10)": for each relevant source `s` read
`/mix/in/<s>/0/fader` and write the same value to `/mix/in/<s>/10/fader`.

## Loopback

`/output/<n>/loopback` as bool sends the output signal back as a record source.
Outputs only.

```json
[{ "address": "/output/0/loopback", "value": true }]
```

## Stereo sources

If the source is a stereo pair, the master rule from SKILL.md applies: set on
the left source index and the right usually follows. If unsure, read
`/<bus>/<n>/stereo`. Pan on a stereo send acts as balance.

## Hidden channels

Whether channels hidden in the TotalMix Channel Layout react to OSC depends
on the TotalMix option "Receive to hidden channels" (Global OSC Detailed
Settings): with it on, hidden channels accept commands and answer syncs;
with it off they return nothing on `get_channel` and accept no sends. If a
routing seems to go nowhere, check both the channel's visibility and that
option.
