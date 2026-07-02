// Platform detection, used to decide whether enlarging the UDP receive
// buffer is worth attempting at all. See docs/cold-start-packet-loss.md: the
// problem this addresses is specific to slow hosts (proven on a Raspberry Pi
// 3B) that cannot drain a dense OSC burst fast enough. On a fast host (a
// Mac, a modern PC) the OS default buffer has never shown this problem, and
// on macOS specifically, requesting a large buffer can be flatly refused by
// the kernel (ERR_SOCKET_BUFFER_SIZE / ENOBUFS), which is an OS behavior
// difference, not a signal that the buffer needs raising there too. Simplest
// and most robust: only attempt the larger buffer where it is known to help.

import { platform } from "node:os";
import { readFileSync } from "node:fs";

// Reads /proc/cpuinfo (Linux-only) and checks for a Raspberry Pi model
// string. Returns the model string if found, otherwise null. Accepts
// optional injected content for testing.
export function detectRaspberryPiModel(cpuinfo?: string): string | null {
  if (platform() !== "linux") return null;
  let content = cpuinfo;
  if (content === undefined) {
    try {
      content = readFileSync("/proc/cpuinfo", "utf8");
    } catch {
      return null;
    }
  }
  const match = content.match(/^Model\s*:\s*(Raspberry Pi.+)$/m);
  return match ? match[1].trim() : null;
}

// Whether to attempt a larger-than-default UDP receive buffer by default.
// Only true on a detected Raspberry Pi. Anywhere else, TOTALMIX_UDP_RECV_BUFFER
// still works if a person sets it explicitly, this only controls the DEFAULT.
export function shouldTuneRecvBufferByDefault(): boolean {
  return detectRaspberryPiModel() !== null;
}
