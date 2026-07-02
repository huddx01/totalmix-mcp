// Minimal ambient declaration for the "osc" package, which ships no types.
// Only the surface this server actually uses is declared.

declare module "osc" {
  import type { Socket } from "node:dgram";

  export interface UDPPortOptions {
    localAddress?: string;
    localPort?: number;
    remoteAddress?: string;
    remotePort?: number;
    metadata?: boolean;
    // Hand osc.js an already-created (and, for our use, already-bound)
    // dgram socket instead of letting it create its own. Used to control
    // the OS-level receive buffer size, which osc.js's own socket creation
    // path does not expose. See oscClient.ts.
    socket?: Socket;
  }

  export interface OscArg {
    type: string;
    value: number | string;
  }

  export interface OscMessage {
    address: string;
    args: Array<OscArg | number | string>;
  }

  export class UDPPort {
    constructor(options: UDPPortOptions);
    open(): void;
    close(): void;
    send(message: OscMessage): void;
    on(event: "message", listener: (message: { address: string; args: any[] }) => void): this;
    on(event: "ready", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    once(event: "ready", listener: () => void): this;
    once(event: "error", listener: (err: Error) => void): this;
    removeListener(event: string, listener: (...args: any[]) => void): this;
  }

  const osc: { UDPPort: typeof UDPPort };
  export default osc;
}
