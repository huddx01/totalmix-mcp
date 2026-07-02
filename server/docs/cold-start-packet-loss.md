# Cold-start packet loss: investigation and root cause

This documents a real debugging session, because the result is broadly useful
for anyone driving TotalMix FX over OSC from a Linux host (and likely other
non-macOS hosts). It explains a surprising symptom, how it was narrowed down
step by step, the wrong turns taken, and the proven root cause with the exact
measurements. The short version lives in the README; this is the full trail.

## Summary (for the impatient)

- Symptom: after a cold-start `/sendall`, the server cached only ~1000 of the
  device's ~27000 values, with no error anywhere.
- It is NOT a network problem, NOT a TotalMix bug, and NOT a bug in this
  server's receive/cache logic.
- Root cause: the OS-level UDP socket receive buffer overflows. TotalMix sends
  the entire `/sendall` reply as one dense burst (~2100 UDP datagrams in
  ~80 ms). A slow host (Raspberry Pi 3B) cannot drain the socket fast enough,
  so the kernel silently discards every datagram that does not fit in the
  buffer. Proven via the kernel's own `RcvbufErrors` counter.
- Fix: raise the OS receive buffer for the OSC socket (this server now requests
  it per-socket via setsockopt, plus the kernel ceiling `net.core.rmem_max`
  must be raised), and/or leave TotalMix's OSC bandwidth limit enabled to pace
  the burst.

## Setup under test

- TotalMix FX on a Mac (RME Fireface UFX III), sending OSC to a Raspberry Pi 3B
  over wired LAN, unicast, no multicast.
- The Pi runs this server; it triggers `/sendall` once on startup and caches
  every value TotalMix pushes back. `/health` reports the number of distinct
  cached addresses.
- The device exposes on the order of 27000 OSC values; a full cache should land
  near that number.

## Symptom

With TotalMix's OSC bandwidth limit DISABLED, a fresh start produced:

```
{"ok":true,"cached":1192}
```

About 1000 values instead of ~27000. No error in the server log, no error in
TotalMix. Re-running gave similar but not identical low numbers (~1145, ~1192,
~975), which itself turned out to be a clue.

## Step-by-step narrowing

### 1. Does TotalMix actually send everything?

TotalMix's OSC Message Infos counter showed Sent = 26984 with only 19 S-Errors,
and the Pi row showing it was receiving. So TotalMix sends the full set. (Later
confirmed again with a local Wireshark capture on the Mac: the entire burst
leaves the Mac.) TotalMix is exonerated.

### 2. Do the packets reach the Pi?

```bash
sudo tcpdump -i any -n udp port 9001 -w /tmp/sendall.pcap
# ... start the server, then Ctrl-C ...
# 2111 packets captured, 0 packets dropped by kernel
```

This looked at first like "the Pi receives everything, so the loss must be
inside the server." That conclusion was WRONG, and the mistake is worth
recording:

> tcpdump's "0 packets dropped by kernel" refers to tcpdump's own capture
> buffer, not to the application's UDP socket. tcpdump taps packets at the
> device layer, before they pass through the socket's receive buffer. A packet
> can be seen by tcpdump and still be dropped afterwards by the UDP socket if
> that socket's buffer is full.

So tcpdump confirmed packets arrive at the host, but said nothing about whether
the application socket accepted them.

### 3. Packet sizes: is it fragmentation / MTU?

```bash
tcpdump -r /tmp/sendall.pcap -nn | awk '{print $NF}' | sort -n | tail
# all 480
```

Largest datagrams are ~480 bytes, far below the ~1472-byte MTU. No
fragmentation. MTU is not the cause. The constant 480 also tells us TotalMix
bundles a fixed handful of messages per datagram (~13), so ~2100 datagrams
carry ~27000 messages. The packet count is expected; nothing is missing on the
wire.

### 4. The smoking gun: union growth across repeated /sendall

With the bandwidth limit still OFF, `/sendall` was triggered three times in a
row. The cache grew:

```
1192  ->  ...  ->  2992
```

If the server had a deterministic processing cap (for example "only the first
1000 messages are handled"), each `/sendall` would deliver the SAME subset and
the cache would stay around ~1145, because identical addresses overwrite each
other. Instead it GREW. That means each burst delivered a DIFFERENT, random
subset, and the union accumulated. Random loss of different datagrams each time
is the signature of a buffer overflowing, not of slow code.

### 5. Proof: the kernel's UDP receive-buffer error counter

```bash
cat /proc/net/snmp | grep Udp:
# Udp: ... RcvbufErrors ...
netstat -su | grep -iE "receive buffer|packet receive errors"
```

Before a run: 20036 receive buffer errors. After a single `/sendall`: 22032.
A jump of ~1996 dropped datagrams for one `/sendall`, while `/health` showed
`cached: 975`. The kernel is explicitly counting ~2000 datagrams discarded
because the socket receive buffer was full. Root cause confirmed.

### 6. Why a slow host specifically

The Mac-side Wireshark capture showed the whole burst (~2100 datagrams) leaving
within ~80 ms (first bundle at 33.8857 s, last at 33.9657 s). That is a peak of
~26000 datagrams/second. The Pi 3B cannot parse and drain the socket at that
rate, so the buffer fills and overflows. The same code on a fast Mac-to-Mac
setup never loses anything, because the Mac drains the socket faster than the
burst fills it. The problem is the combination of a small default buffer AND a
slow CPU under an unthrottled burst.

## The fix, measured

The Linux default `net.core.rmem_default` is 212992 bytes (~208 KB). An
application that does not call setsockopt(SO_RCVBUF) inherits that default, not
the higher `net.core.rmem_max`. The original server did not request a size, so
it ran with ~208 KB.

Raising the receive buffer was tested incrementally (cache count after a fresh
cold start, bandwidth limit OFF the whole time):

| Receive buffer            | `cached` result |
|---------------------------|-----------------|
| 212992 (OS default)       | ~1000           |
| 4 MiB                     | 16954           |
| 16 MiB                    | 26553           |

At 16 MiB the cache is effectively complete (the small remainder versus 26984
is addresses that legitimately overwrite under the same key, plus a few late
pushes). Note the per-datagram kernel overhead: 16 MiB does not mean "16 MiB /
480 bytes" datagrams; each datagram costs significantly more than its payload
in kernel socket-buffer accounting, which is why the buffer must be much larger
than the raw burst size.

## How this server applies the fix

- It binds its own UDP socket and calls setsockopt(SO_RCVBUF) with
  `TOTALMIX_UDP_RECV_BUFFER` (default 16 MiB). This is per-socket: only this
  server gets the large buffer, the rest of the host is untouched.
- The OS clamps the request to `net.core.rmem_max`. On Linux that ceiling must
  be raised for the request to take full effect:
  ```bash
  echo "net.core.rmem_max=16777216" | sudo tee /etc/sysctl.d/99-totalmix-udp.conf
  sudo sysctl --system
  ```
  Raising only `rmem_max` (the ceiling) and leaving `rmem_default` alone keeps
  every other socket on the host at its normal small size.
- Startup logs requested vs granted so a clamp is visible:
  ```
  [totalmix-mcp] UDP receive buffer: requested 16777216 bytes, OS granted 16777216 bytes
  ```

## Alternative / complementary: TotalMix bandwidth limit

Leaving TotalMix's OSC bandwidth limit ENABLED paces the dump into smaller
bursts spread over time, which a slow host can keep up with. Measured with the
limit on, the cache reached ~25911 even before any buffer tuning. The limit and
the buffer attack the same root cause (burst density) from opposite ends.

Most robust setup: a generous per-socket receive buffer AND a mild TotalMix
bandwidth limit, so there is headroom on both sides.

## Takeaways for other OSC clients

- A full-state OSC dump from a large device is bursty. Any receiver on a
  modest CPU should size its UDP receive buffer accordingly (setsockopt
  SO_RCVBUF) and not rely on the OS default.
- Do not trust tcpdump's "0 dropped" as evidence the application received the
  packets. Check the socket layer: `RcvbufErrors` in `/proc/net/snmp`, or
  `netstat -su` "receive buffer errors".
- The loss is silent: no send error on the device side, no receive error in
  the application, only a short-counted result. The kernel counter is the only
  honest witness.
