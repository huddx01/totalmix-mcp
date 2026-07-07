# durec: record transport

Requires the core conventions in SKILL.md.

DURec (Direct USB Recording) only exists on some RME Fireface models (UFX
and UCX series), and even there only while a USB stick is actually plugged
into the device's front port. On devices or setups without DURec, these
addresses are simply not present in the cache and any command below is a
no-op at best. Do not assume DURec exists just because the device is an RME
Fireface; confirm with the person or check `/durec/state` first if unsure.

Triggers, some with quirks:

- `/durec/play` ignores values below 0.5
- `/durec/record` `/durec/stop` (to stop recording send twice or value above
  10.0) `/durec/pause` `/durec/next` `/durec/previous`
- `/durec/state` and `/durec/time` are send-only status
