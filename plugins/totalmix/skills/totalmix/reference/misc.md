# misc: status, undo/redo, window, level meters

Requires the core conventions in SKILL.md. This file has no common theme
beyond "small, rarely needed, not part of building a mixing command". Read it
only for the specific address you need, do not read it speculatively.

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

## Undo / redo

```
/undo   trigger
/redo   trigger
```

Write-only triggers, global. "Mach das rückgängig" right after a mixer
change is one `/undo`. There is no way to read the undo history.

## Show/hide the TotalMix window

```
/showwindow   value: 0 (hide) | 1 (show)
```

Write-only, global, not tied to any channel.

## Level meters (read only)

Lowest priority in this file, included last on purpose: rarely asked for and
rarely actionable in a chat context.

Peak meters are send-only, in dB:

```
/level/in/<n>    /level/pb/<n>    /level/out/<n>
```

These cannot be set (read-only, the server rejects write attempts). To read
them after a sync, query via `osc_read`. Meters change constantly, and
TotalMix only pushes a meter address when its value actually changes, so the
cached value is only a snapshot in time, not a guaranteed recent one.
