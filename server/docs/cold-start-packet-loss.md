# Cold-start packet loss: investigation and root cause

This documents a real debugging session, because the result is broadly useful
for anyone driving TotalMix FX over OSC — first proven on a Linux host, later
confirmed (milder, but real) on macOS as well. It explains a surprising
symptom, how it was narrowed down step by step, the wrong turns taken, and the
proven root cause with the exact measurements. The short version lives in the
README; this is the full trail.

## Summary (for the impatient)

- Symptom: after a cold-start `/sendall`, the server cached only ~1000 of the
  device's ~27000 values, with no error anywhere.
- It is NOT a network problem, NOT a TotalMix bug, and NOT a bug in this
  server's receive/cache logic.
- Root cause: the OS-level UDP socket receive buffer overflows. TotalMix sends
  the entire `/sendall` reply as one dense burst (~2100 UDP datagrams in
  ~80 ms). If the receiving process does not drain the socket fast enough,
  the kernel silently discards every datagram that does not fit in the
  buffer. Proven via the kernel's own drop counters, first on a Raspberry
  Pi 3B (catastrophic: ~95% lost), later on a 2010 MacBook Pro (sporadic:
  ~7% lost) — see "Second confirmed case" below.
- Fix: raise the OS receive buffer for the OSC socket. This server requests it
  per-socket via setsockopt (default 4 MiB, 16 MiB on a detected Raspberry
  Pi); on Linux the kernel ceiling `net.core.rmem_max` must be raised for the
  request to take full effect. Alternatively/additionally, leave TotalMix's
  OSC bandwidth limit enabled to pace the burst.

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

## Second confirmed case: macOS / the BSD family (2010 MacBook Pro, over WiFi)

Months later the same signature showed up on a very different host: a 2010
MacBook Pro (8 GB RAM) running the server under macOS, receiving the OSC
stream from the TotalMix host elsewhere on the LAN — **over WiFi**. After
`/sendall`, the cache was sometimes complete and sometimes short, again with
no error anywhere. The narrowing followed the same playbook as on the Pi.

### 1. Counter snapshots around a single /sendall

macOS counts socket-buffer drops in `netstat -s -p udp` as "dropped due to
full socket buffers" (the Darwin equivalent of Linux's `RcvbufErrors`).
Snapshots taken immediately before and after one `/sendall`:

```
datagrams received:                  154003  ->  156111   (+2108)
dropped due to full socket buffers:   17775  ->   17920   (+145)
delivered:                           126434  ->  128396   (+1962)
```

Three things follow directly:

- `+2108` received is the full burst (~2100 datagrams) — even over WiFi the
  entire dump reaches the kernel intact. The radio link is not the problem,
  and neither is the network in general (same exoneration as tcpdump gave the
  wire on the Pi).
- `+145` dropped at the socket buffer during that one sync ≈ 7% of the burst.
  That is the milder, sporadic version of the Pi's ~95% loss: a 2010-era CPU
  usually drains fast enough, but loses whenever the process is briefly busy
  at the wrong moment — which is exactly why the symptom came and went.
- received − dropped ≈ delivered; the accounting closes.

### 2. Which knob is the default buffer?

Suspecting `net.inet.udp.recvspace` (786896 bytes ≈ 768 KB) as the macOS
per-socket default, this was confirmed live: raising the sysctl and
restarting the server made the logged "OS default" follow it exactly —

```bash
sudo sysctl -w net.inet.udp.recvspace=1286896
```
```
Continuing with the OS default buffer size (1286896 bytes).
```

(then reverted). So an untuned socket on macOS gets ~768 KB — bigger than
Linux's ~208 KB default, but still too small for the burst plus per-datagram
kernel overhead. `net.inet.udp.maxdgram` (9216) looked related but is not:
it caps the size of a single *outgoing* datagram, send side only.

### 3. The ceiling: why 16 MiB fails on macOS

Requesting the Pi's 16 MiB via `TOTALMIX_UDP_RECV_BUFFER` on the MacBook was
flatly rejected:

```
Requested UDP receive buffer 16777216 bytes was rejected by the OS
(uv_recv_buffer_size returned ENOBUFS). Continuing with the OS default (786896 bytes).
```

The limiter is `kern.ipc.maxsockbuf` (8388608): on this MacBook at most 8 MB
was settable, anything above is **rejected with ENOBUFS** — unlike Linux,
which silently clamps to `net.core.rmem_max`. This is BSD-lineage behavior,
readable in the kernel sources: FreeBSD
[`sys/kern/uipc_sockbuf.c`](https://github.com/freebsd/freebsd-src/blob/master/sys/kern/uipc_sockbuf.c)
computes an *adjusted* ceiling that also accounts mbuf overhead,

```c
sb_max_adj = (quad_t)sb_max * MCLBYTES / (MSIZE + MCLBYTES);  /* ~88.9% */
```

and `sbreserve_locked()` refuses anything larger (so on FreeBSD the effective
maximum is even a bit below `maxsockbuf`, ~7.4 MB at the 8 MB default).
Darwin/XNU shares the lineage with its own variant in
[`bsd/kern/uipc_socket2.c`](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/uipc_socket2.c)
(`sbreserve` enforcing `sb_max`); details differ per release, the observable
behavior on macOS matches: 8 MB max, hard rejection above.

### 4. The fix, verified

Requesting 4 MiB instead — comfortably under the ceiling on every platform —
was granted in full:

```
UDP receive buffer: requested 4194304 bytes, OS granted 4194304 bytes
```

which is why 4 MiB is now the server's default on non-Pi hosts. The rejection
path above stays as the safety net: if an OS ever refuses, the server logs
and continues on the OS default instead of failing.

## OS reference: buffer defaults, ceilings, drop counters

What actually limits SO_RCVBUF, what the defaults are, and where the kernel
admits it dropped datagrams — side by side.

### Default per-socket buffer and ceiling

| Platform | Default (untuned socket) | Ceiling for setsockopt | Above the ceiling |
|---|---|---|---|
| Linux | `net.core.rmem_default` — 212992 (~208 KB) | `net.core.rmem_max` — also 212992 by default | **silently clamped**, no error; only the granted size reveals it |
| macOS / FreeBSD | `net.inet.udp.recvspace` — macOS 786896 (~768 KB), FreeBSD smaller | `kern.ipc.maxsockbuf` — 8388608 (8 MB); FreeBSD effective max ~88.9% of it (`sb_max_adj`, see above) | **rejected with ENOBUFS** |
| Windows | Winsock/AFD default — ~64 KB, smallest of the three | none in practice | granted as requested, no admin rights needed |

### Inspect and raise the system limits

| Platform | Inspect | Raise |
|---|---|---|
| Linux | `sysctl net.core.rmem_default net.core.rmem_max` | `sudo sysctl -w net.core.rmem_max=16777216`; persist via `/etc/sysctl.d/99-totalmix-udp.conf` + `sudo sysctl --system`. Raise only the ceiling, leave `rmem_default` alone so other sockets stay small |
| macOS / FreeBSD | `sysctl net.inet.udp.recvspace kern.ipc.maxsockbuf` | `sudo sysctl -w kern.ipc.maxsockbuf=16777216` (not persistent on macOS) — normally unnecessary, the 4 MiB default fits under the stock 8 MB |
| Windows | registry `HKLM\SYSTEM\CurrentControlSet\Services\AFD\Parameters` (`DefaultReceiveWindow`) | normally unnecessary: per-socket `setsockopt` overrides the AFD defaults anyway |

### Where the kernel admits the drops

| Platform | Command | Counter to watch |
|---|---|---|
| Linux | `netstat -su` or `cat /proc/net/snmp` | "receive buffer errors" / `RcvbufErrors` column |
| macOS / FreeBSD | `netstat -s -p udp` | "dropped due to full socket buffers" |
| Windows | `netstat -s -p udp` | "Receive Errors" under UDP statistics |

All three are system-wide counters, not per-socket: take a snapshot before
and after a single `/sendall` (as in both cases above) and read the delta.

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
  `TOTALMIX_UDP_RECV_BUFFER`. Default: **4 MiB** everywhere (granted in full
  on macOS/BSD and Windows, see the OS reference above), **16 MiB** on a
  detected Raspberry Pi (the measured requirement there). This is per-socket:
  only this server gets the large buffer, the rest of the host is untouched.
- On Linux the OS clamps the request to `net.core.rmem_max`, so that ceiling
  must be raised for the request to take full effect:
  ```bash
  echo "net.core.rmem_max=16777216" | sudo tee /etc/sysctl.d/99-totalmix-udp.conf
  sudo sysctl --system
  ```
  Raising only `rmem_max` (the ceiling) and leaving `rmem_default` alone keeps
  every other socket on the host at its normal small size.
- A rejected request (macOS/BSD ceiling) falls back to the OS default with a
  log line instead of failing; startup always logs requested vs granted so a
  clamp or rejection is visible:
  ```
  [totalmix-mcp] UDP receive buffer: requested 4194304 bytes, OS granted 4194304 bytes
  ```

## Alternative / complementary: TotalMix bandwidth limit

Leaving TotalMix's OSC bandwidth limit ENABLED paces the dump into smaller
bursts spread over time, which a slow host can keep up with. Measured with the
limit on, the cache reached ~25911 even before any buffer tuning. The limit and
the buffer attack the same root cause (burst density) from opposite ends.

Most robust setup: a generous per-socket receive buffer AND a mild TotalMix
bandwidth limit, so there is headroom on both sides.

## Takeaways for other OSC clients

- A full-state OSC dump from a large device is bursty. Any receiver should
  size its UDP receive buffer accordingly (setsockopt SO_RCVBUF) and not rely
  on the OS default — "fast host" is not a defense, as the MacBook case
  shows; it only turns total loss into sporadic loss.
- Mind the per-OS ceiling semantics when requesting: Linux clamps silently,
  macOS/BSD reject with ENOBUFS (catch and fall back), Windows just grants.
- Do not trust tcpdump's "0 dropped" as evidence the application received the
  packets. Check the socket layer with the kernel's own counters (see the OS
  reference above): `RcvbufErrors` in `/proc/net/snmp` / `netstat -su` on
  Linux, `netstat -s -p udp` "dropped due to full socket buffers" on macOS,
  "Receive Errors" on Windows.
- The loss is silent: no send error on the device side, no receive error in
  the application, only a short-counted result. The kernel counter is the only
  honest witness.
