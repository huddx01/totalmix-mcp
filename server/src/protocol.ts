// Single source of truth for the TotalMix Global OSC protocol.
//
// Structure is based on the per-bus tables from the oscmix wiki
// (https://github.com/huddx01/oscmix/wiki/TotalMix-FX-OSC-API), reconciled
// against the current spec (OSCProtocoll_260626.xls, TotalMix FX 2.1
// alpha 8 "Global OSC", 26.06.26) which is authoritative. All three sheets
// were checked: Protocol (address table), Description (legend, examples,
// history) and Fader curve (official dB<->faderlin conversion, preserved in
// docs/fader-curve.md). Cell font colors were inspected too: nothing in the
// 260626 table is marked red ("not implemented yet"), so every address
// below is live. Differences applied versus the previous reconciliation
// (OSCProtocoll_260605.xlsx, alpha 7, 2026-06-05):
//   - added "color" (read-only) on input/playback/output channels
//   - snapshot/load is now rw: TotalMix sends 0 (off) / 2 (active) /
//     3 (changed), receives only the value 1 to trigger a load
//   - added snapshot/save (trigger)
//   - added sendmix and sendsubmix/{n} (value 1 = all nodes, 2 = only nodes
//     with fader above -65dB); sendall gained the same value-2 option
//   - added showwindow (0 hide, 1 show the TotalMix window)
//   - added controlroom/talkchannel, controlroom/extinchannel,
//     controlroom/extingain
//   - removed layout/save: it does not exist anywhere in the 260626 spec
//     (only layout/load does); it had been carried over from the older wiki
//     reconciliation and was never confirmed on a device
//   - mutegroup/sologroup/fadergroup: the spec table marks them Rec.-only,
//     but a UFX III device test showed all three states ARE sent on
//     /sendsettings, so they stay rw here (spec table considered wrong)
//   - controlroom mainout/mainoutb/phones1-4/talkchannel/cuechan/
//     extinchannel are channel ASSIGNMENTS (index into the output list,
//     e.g. mainout 0.0 = channel 1+2 per the spec example), NOT levels
//   - "(f)" legend, general: a trigger needs no value, but if one is sent
//     and it is below 0.5 the message is ignored (documented per-address
//     only for durec before; it applies to every (f) address)
//
// Differences applied versus the older 2026-02-28 wiki:
//   - sendchan buses written out: input/playback/output (not in/pb/out)
//   - snapshot path order: /snapshot/load/{n} (not /snapshot/{n}/load)
//   - added dynamics/gain on input, playback, output
//   - added loadpreset (receive only) on eq, dynamics, roomeq, reverb, echo
//   - added /sendsettings
//   - added durec/time and durec/state (string, send only)
//   - balpan is the confirmed parameter name for balance/pan
//   - documented the general write-only rule (any [-w] address never appears
//     in the cache, structural, not specific to any one command)
//   - roomeq/loadpreset verified by hands-on testing: 0-based wire numbering
//     (UI preset N = wire value N-1). The 260626 Description sheet clarifies
//     this is the general rule, not a quirk: "Index values ... represent the
//     selection in TotalMix list boxes starting with 0", while only path
//     'numbers' (snapshot/layout/group) count from 1. So eq/loadpreset and
//     dynamics/loadpreset are expected to be 0-based too (untested)
//   - documented that channel names are user-renamable, resolve via live
//     sync instead of any hardcoded name-to-index mapping
//
// Key fact this encodes: input and playback channels have NO standalone
// fader. Their level only exists as a matrix send under /mix/in|pb/.
// Only output channels have a directly addressable fader (/output/{n}/faderlin).

export type ValueType = "float" | "string" | "trigger";

// Scale hints describe how a float value maps to a human meaning.
//   db       absolute dB on the wire
//   lin      0..1 linear fader position, needs the fader curve
//   balpan   -1.0..+1.0
//   bitfield packed group flags
//   index    selection index into a device dependent list box
//   bool     0.0 / 1.0 toggle
//   raw      plain float, no special interpretation
export type Scale = "db" | "lin" | "balpan" | "bitfield" | "index" | "bool" | "raw";

export interface ParamDef {
  // Last path segment(s). May contain a subgroup, e.g. "eq/band1gain".
  name: string;
  valueType: ValueType;
  // read: device sends this out, so we can read it (Send column in the spec).
  read: boolean;
  // write: device receives this, so we can set or trigger it (Rec column).
  write: boolean;
  // L/R: value differs per side for stereo channels.
  lr?: boolean;
  scale?: Scale;
  comment?: string;
}

export type ChannelBus = "input" | "playback" | "output";
export type MatrixBus = "in" | "pb";

// ---- shared sub blocks ----------------------------------------------------

function eqParams(): ParamDef[] {
  return [
    { name: "eq/enable", valueType: "float", read: true, write: true, scale: "bool" },
    { name: "eq/band1gain", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "eq/band1freq", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "eq/band1q", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "eq/band2gain", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "eq/band2freq", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "eq/band2q", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "eq/band3gain", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "eq/band3freq", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "eq/band3q", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "eq/band1type", valueType: "float", read: true, write: true, scale: "index" },
    { name: "eq/band3type", valueType: "float", read: true, write: true, scale: "index" },
    { name: "eq/loadpreset", valueType: "trigger", read: false, write: true, comment: "Includes low-cut settings. 16 presets (UI 1..16), wire values 0-based per the list-box rule, so 0..15. Preset names are not exposed over OSC." },
  ];
}

function dynamicsParams(): ParamDef[] {
  return [
    { name: "dynamics/enable", valueType: "float", read: true, write: true, scale: "bool" },
    { name: "dynamics/gain", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "dynamics/attack", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "dynamics/release", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "dynamics/compthres", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "dynamics/compratio", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "dynamics/expthres", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "dynamics/expratio", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "dynamics/loadpreset", valueType: "trigger", read: false, write: true, comment: "Includes autolevel settings. 16 presets (UI 1..16), wire values 0-based per the list-box rule, so 0..15. Preset names are not exposed over OSC." },
  ];
}

function autolevelParams(): ParamDef[] {
  return [
    { name: "autolevel/enable", valueType: "float", read: true, write: true, scale: "bool" },
    { name: "autolevel/maxgain", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "autolevel/headroom", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "autolevel/risetime", valueType: "float", read: true, write: true, scale: "raw" },
  ];
}

function lowcutParams(): ParamDef[] {
  return [
    { name: "lowcut/enable", valueType: "float", read: true, write: true, scale: "bool" },
    { name: "lowcut/freq", valueType: "float", read: true, write: true, scale: "raw" },
    { name: "lowcut/slope", valueType: "float", read: true, write: true, scale: "raw" },
  ];
}

function roomeqParams(): ParamDef[] {
  const out: ParamDef[] = [
    { name: "roomeq/enable", valueType: "float", read: true, write: true, scale: "bool" },
  ];
  for (let band = 1; band <= 9; band++) {
    out.push({ name: `roomeq/band${band}gain`, valueType: "float", read: true, write: true, lr: true, scale: "raw" });
    out.push({ name: `roomeq/band${band}freq`, valueType: "float", read: true, write: true, lr: true, scale: "raw" });
    out.push({ name: `roomeq/band${band}q`, valueType: "float", read: true, write: true, lr: true, scale: "raw" });
  }
  out.push({ name: "roomeq/band1type", valueType: "float", read: true, write: true, lr: true, scale: "index" });
  out.push({ name: "roomeq/band8type", valueType: "float", read: true, write: true, lr: true, scale: "index" });
  out.push({ name: "roomeq/band9type", valueType: "float", read: true, write: true, lr: true, scale: "index" });
  out.push({
    name: "roomeq/loadpreset",
    valueType: "trigger",
    read: false,
    write: true,
    comment:
      "Verified by hands-on testing: never appears in the cache, not even after a full /sendall sync " +
      "(TotalMix sends nothing back for it, as expected for any write-only address, see the general " +
      "write-only rule). Also verified: preset numbering on the wire is 0-based (UI preset N = wire " +
      "value N-1). Per the 260626 Description sheet this is the general list-box rule (index values " +
      "count from 0; only path 'numbers' like snapshot/layout/group count from 1), so eq/loadpreset " +
      "and dynamics/loadpreset are expected to behave the same, though only roomeq is device-tested. " +
      "16 presets each (UI 1..16, wire 0..15); preset names are not exposed over OSC.",
  });
  return out;
}

// ---- matrix sends (the only fader for input and playback) -----------------

export const MATRIX_PARAMS: ParamDef[] = [
  { name: "fader", valueType: "float", read: true, write: true, scale: "db", comment: "[dB], under-range until -300dB for off" },
  { name: "faderlin", valueType: "float", read: true, write: true, scale: "lin", comment: "0..1 fader position, see fader curve" },
  { name: "balpan", valueType: "float", read: true, write: true, scale: "balpan", comment: "-1.0..+1.0" },
  { name: "groupflags", valueType: "float", read: true, write: true, scale: "bitfield", comment: "Bit1..4 Mute1..4, Bit6..9 Solo1..4, Bit12..16 Fader1..4" },
  { name: "solo", valueType: "float", read: true, write: true, scale: "bool" },
];

// ---- per channel parameter sets -------------------------------------------

export const INPUT_PARAMS: ParamDef[] = [
  { name: "mute", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "fxsend", valueType: "float", read: true, write: true, scale: "raw" },
  { name: "stereo", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "record", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "name", valueType: "string", read: true, write: true },
  { name: "playchan", valueType: "float", read: true, write: true, scale: "raw", comment: "For stereo channels: consecutive channels in file" },
  { name: "msproc", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "phase", valueType: "float", read: true, write: true, lr: true, scale: "bool" },
  { name: "width", valueType: "float", read: true, write: true, scale: "raw" },
  { name: "pfl", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "gain", valueType: "float", read: true, write: true, lr: true, scale: "raw" },
  { name: "reflevel", valueType: "float", read: true, write: true, scale: "index", comment: "Index, depends on device" },
  { name: "48v", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "instrument", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "pad", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "autoset", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "delay", valueType: "float", read: true, write: true, lr: true, scale: "raw" },
  { name: "color", valueType: "float", read: true, write: false, scale: "index", comment: "0 for hidden, 1..n color index (1 for default), send only" },
  ...lowcutParams(),
  ...eqParams(),
  ...dynamicsParams(),
  ...autolevelParams(),
];

// Playback channels have no eq/lowcut/dynamics/autolevel on ANY RME device
// (maintainer-confirmed, 2026-07-02; matches the UFX III /sendchan dump which
// reports only stereo, name, mute, phase, msproc, width, color). The FX
// blocks carried over from the wiki reconciliation have therefore been
// removed: the server now rejects e.g. /playback/0/eq/enable instead of
// forwarding a dead write. record/playchan/pfl/delay were never observed on
// ANY bus; they stay in the maps as spec-listed but untested.
export const PLAYBACK_PARAMS: ParamDef[] = [
  { name: "mute", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "msproc", valueType: "float", read: true, write: true, scale: "bool", comment: "device-verified on playback (was missing from the wiki tables)" },
  { name: "stereo", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "record", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "name", valueType: "string", read: true, write: true },
  { name: "playchan", valueType: "float", read: true, write: true, scale: "raw", comment: "For stereo channels: consecutive channels in file" },
  { name: "phase", valueType: "float", read: true, write: true, lr: true, scale: "bool" },
  { name: "width", valueType: "float", read: true, write: true, scale: "raw" },
  { name: "pfl", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "delay", valueType: "float", read: true, write: true, lr: true, scale: "raw" },
  { name: "color", valueType: "float", read: true, write: false, scale: "index", comment: "0 for hidden, 1..n color index (1 for default), send only" },
];

export const OUTPUT_PARAMS: ParamDef[] = [
  { name: "mute", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "fxreturn", valueType: "float", read: true, write: true, scale: "raw" },
  { name: "stereo", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "record", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "name", valueType: "string", read: true, write: true },
  { name: "msproc", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "phase", valueType: "float", read: true, write: true, lr: true, scale: "bool" },
  { name: "width", valueType: "float", read: true, write: true, scale: "raw" },
  { name: "pfl", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "gain", valueType: "float", read: true, write: true, lr: true, scale: "raw", comment: "On outputs with Room EQ: volume correction" },
  { name: "reflevel", valueType: "float", read: true, write: true, scale: "index", comment: "Index, depends on device" },
  { name: "volume", valueType: "float", read: true, write: true, scale: "db", comment: "dB-direct counterpart to faderlin (the output strip fader); unit not explicitly stated in the spec sheet, confirmed by hands-on testing" },
  { name: "faderlin", valueType: "float", read: true, write: true, scale: "lin", comment: "Output strip fader (submix master), 0..1, see fader curve" },
  { name: "balpan", valueType: "float", read: true, write: true, scale: "balpan", comment: "-1.0..+1.0" },
  { name: "crossfeed", valueType: "float", read: true, write: true, scale: "raw" },
  { name: "loopback", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "talkbacksel", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "delay", valueType: "float", read: true, write: true, lr: true, scale: "raw" },
  { name: "color", valueType: "float", read: true, write: false, scale: "index", comment: "0 for hidden, 1..n color index (1 for default), send only" },
  ...lowcutParams(),
  ...eqParams(),
  ...dynamicsParams(),
  ...autolevelParams(),
  ...roomeqParams(),
];

export function channelParams(bus: ChannelBus): ParamDef[] {
  if (bus === "input") return INPUT_PARAMS;
  if (bus === "playback") return PLAYBACK_PARAMS;
  return OUTPUT_PARAMS;
}

// ---- global / fixed addresses ---------------------------------------------

// Entries here are matched as templates. {n} is a 0-based channel number,
// {bus} is one of input|playback|output, {mbus} is one of in|pb|out.
export interface GlobalDef extends ParamDef {
  // Full address template, may include {n}/{bus}/{mbus} placeholders.
  template: string;
}

function fx(prefix: string, names: Array<[string, Scale] | [string, Scale, string]>): GlobalDef[] {
  return names.map(([n, scale, comment]) => ({
    name: n,
    template: `/${prefix}/${n}`,
    valueType: "float" as ValueType,
    read: true,
    write: true,
    scale,
    comment,
  }));
}

export const GLOBAL_DEFS: GlobalDef[] = [
  // reverb
  ...fx("reverb", [
    ["enable", "bool"], ["type", "index"], ["predelay", "raw"], ["lowcut", "raw"],
    ["roomscale", "raw"], ["attack", "raw"], ["hold", "raw"], ["release", "raw"],
    ["highcut", "raw"], ["time", "raw"], ["highdamp", "raw"], ["smooth", "raw"],
    ["volume", "raw"], ["width", "raw"],
  ]),
  { name: "reverb/loadpreset", template: "/reverb/loadpreset", valueType: "trigger", read: false, write: true },
  // echo
  ...fx("echo", [
    ["enable", "bool"], ["type", "index"], ["delay", "raw"], ["feedback", "raw"],
    ["highcut", "raw"], ["volume", "raw"], ["width", "raw"],
  ]),
  { name: "echo/loadpreset", template: "/echo/loadpreset", valueType: "trigger", read: false, write: true },
  // control room. The output-assignment parameters are channel selectors
  // (index into the output channel list), NOT levels: the spec example is
  // "/controlroom/mainout 0.0 sets main out to channel 1+2". Levels live on
  // the output strips (/output/{n}/volume). Device-verified on a UFX III:
  // the value is the 0-based output channel index, and -1 means unassigned
  // (e.g. no Phones 2 assignment, no cue active, no talk channel).
  ...fx("controlroom", [
    ["mainout", "index", "which output channel is Main Out (0.0 = channel 1+2), an assignment, not a level"],
    ["mainoutb", "index", "which output channel is Main Out B, an assignment, not a level"],
    ["phones1", "index", "which output channel is Phones 1, an assignment, not a level"],
    ["phones2", "index", "which output channel is Phones 2, an assignment, not a level"],
    ["phones3", "index", "which output channel is Phones 3, an assignment, not a level"],
    ["phones4", "index", "which output channel is Phones 4, an assignment, not a level"],
    ["mainmono", "bool"], ["dimreduction", "raw"],
    ["dim", "bool"], ["recallvolume", "raw"],
    ["talkchannel", "index", "which channel carries talkback, an assignment"],
    ["talkback", "bool"],
    ["cuechan", "index", "which submix is cued to the main out, an assignment"],
    ["externalin", "bool"],
    ["extinchannel", "index", "which channel the external input uses, an assignment"],
    ["extingain", "raw"],
    ["linkab", "bool"], ["speakerb", "bool"], ["mutefx", "bool"],
  ]),
  { name: "controlroom/recall", template: "/controlroom/recall", valueType: "trigger", read: false, write: true },
  // durec transport (trigger, receive only). The "(f)" rule (value optional,
  // ignored if a sent value is < 0.5) applies to every trigger, not just durec.
  { name: "durec/play", template: "/durec/play", valueType: "trigger", read: false, write: true, comment: "ignored if value < 0.5" },
  { name: "durec/pause", template: "/durec/pause", valueType: "trigger", read: false, write: true, comment: "ignored if value < 0.5" },
  { name: "durec/stop", template: "/durec/stop", valueType: "trigger", read: false, write: true, comment: "to stop record: send 2x or value > 10.0" },
  { name: "durec/record", template: "/durec/record", valueType: "trigger", read: false, write: true },
  { name: "durec/next", template: "/durec/next", valueType: "trigger", read: false, write: true },
  { name: "durec/previous", template: "/durec/previous", valueType: "trigger", read: false, write: true },
  { name: "durec/time", template: "/durec/time", valueType: "string", read: true, write: false, comment: "Time in file, send only" },
  { name: "durec/state", template: "/durec/state", valueType: "string", read: true, write: false, comment: "Not ready/Stop/Record/Play/Pause, send only" },
  // global toggles
  { name: "globalmute", template: "/globalmute", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "globalsolo", template: "/globalsolo", valueType: "float", read: true, write: true, scale: "bool" },
  { name: "undo", template: "/undo", valueType: "trigger", read: false, write: true },
  { name: "redo", template: "/redo", valueType: "trigger", read: false, write: true },
  // groups (1-based number). The spec table marks all three Rec.-only, but
  // device-verified on a UFX III (alpha 8): their on/off states ARE sent in
  // response to /sendsettings, so they are readable after a settings sync.
  { name: "mutegroup", template: "/mutegroup/{n}", valueType: "float", read: true, write: true, scale: "bool", comment: "on/off, number starts at 1, readable after a settings sync (device-verified, spec table says Rec.-only)" },
  { name: "sologroup", template: "/sologroup/{n}", valueType: "float", read: true, write: true, scale: "bool", comment: "on/off, number starts at 1, readable after a settings sync (device-verified, spec table says Rec.-only)" },
  { name: "fadergroup", template: "/fadergroup/{n}", valueType: "float", read: true, write: true, scale: "bool", comment: "on/off, number starts at 1, readable after a settings sync (device-verified, spec table says Rec.-only)" },
  // send triggers
  { name: "sendall", template: "/sendall", valueType: "float", read: false, write: true, comment: "1 to trigger all parameters, 2 for mixer nodes with fader above -65dB only" },
  { name: "sendsettings", template: "/sendsettings", valueType: "trigger", read: false, write: true, comment: "triggers send of control parameters and FX settings" },
  { name: "sendchan", template: "/sendchan/{bus}/{n}", valueType: "trigger", read: false, write: true, comment: "triggers send for all parameters of the addressed channel" },
  { name: "sendmix", template: "/sendmix", valueType: "float", read: false, write: true, comment: "1 to trigger all mixer nodes, 2 for nodes with fader above -65dB only" },
  { name: "sendsubmix", template: "/sendsubmix/{n}", valueType: "float", read: false, write: true, comment: "same as sendmix, scoped to one submix (output channel number); use carefully, resend can trigger ping-pong transmissions and lag of faders/dials" },
  // snapshot and layout
  {
    name: "snapshot/load",
    template: "/snapshot/load/{n}",
    valueType: "trigger",
    read: true,
    write: true,
    comment:
      "number starts at 1. rw: TotalMix sends 0 (off) / 2 (active) / 3 (changed) for this snapshot " +
      "slot, but only accepts the value 1 on write to trigger a load. Enables simple on/off " +
      "snapshot-key signalling.",
  },
  { name: "snapshot/save", template: "/snapshot/save", valueType: "trigger", read: false, write: true, comment: "triggers a /snapshot/load message for the newly active snapshot" },
  { name: "layout/load", template: "/layout/load/{n}", valueType: "trigger", read: false, write: true, comment: "number starts at 1; (f) trigger, value optional (if sent, must be >= 0.5)" },
  { name: "showwindow", template: "/showwindow", valueType: "float", read: false, write: true, scale: "bool", comment: "0 to hide, 1 to show the TotalMix window" },
  // level meters (send only), peak dB
  { name: "level/in", template: "/level/in/{n}", valueType: "float", read: true, write: false, scale: "db", comment: "peak level dB, send only, only changing values are sent" },
  { name: "level/pb", template: "/level/pb/{n}", valueType: "float", read: true, write: false, scale: "db", comment: "peak level dB, send only, only changing values are sent" },
  { name: "level/out", template: "/level/out/{n}", valueType: "float", read: true, write: false, scale: "db", comment: "peak level dB, send only, only changing values are sent" },
  // status (send only)
  { name: "status/device", template: "/status/device", valueType: "string", read: true, write: false, comment: "device name" },
  { name: "status/connection", template: "/status/connection", valueType: "float", read: true, write: false, scale: "bool", comment: "0 disconnected, 1 connected" },
  { name: "status/dsp", template: "/status/dsp", valueType: "float", read: true, write: false, scale: "raw", comment: "DSP load" },
];

// ---- address construction -------------------------------------------------

const MATRIX_BUS_FOR_CHANNEL: Record<"input" | "playback", MatrixBus> = {
  input: "in",
  playback: "pb",
};

// Build a matrix send address. source is an input or playback channel, dst
// is the destination submix, which is an output channel. This is the only
// fader for input and playback.
export function buildMatrixAddress(
  sourceBus: "input" | "playback",
  sourceChannel: number,
  submix: number,
  param: string
): string {
  const mbus = MATRIX_BUS_FOR_CHANNEL[sourceBus];
  return `/mix/${mbus}/${sourceChannel}/${submix}/${param}`;
}

export function buildChannelAddress(bus: ChannelBus, channel: number, param: string): string {
  return `/${bus}/${channel}/${param}`;
}

// ---- validation -----------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  def?: ParamDef;
  reason?: string;
  hint?: string;
}

const NUM = "(\\d+)";

function matchGlobal(address: string): ParamDef | undefined {
  for (const def of GLOBAL_DEFS) {
    const pattern = "^" + def.template.replace("{n}", NUM).replace("{bus}", "(input|playback|output)") + "$";
    if (new RegExp(pattern).test(address)) {
      return def;
    }
  }
  return undefined;
}

// Validate an OSC address against the protocol. Returns the matching
// parameter definition, or a reason plus an optional corrective hint.
export function validateAddress(address: string): ValidationResult {
  // matrix: /mix/(in|pb)/<src>/<dst>/<param>
  const matrix = address.match(/^\/mix\/(in|pb)\/\d+\/\d+\/([^/]+)$/);
  if (matrix) {
    const param = matrix[2];
    const def = MATRIX_PARAMS.find((p) => p.name === param);
    if (def) return { ok: true, def };
    return {
      ok: false,
      reason: `Unknown matrix parameter "${param}".`,
      hint: `Valid matrix params: ${MATRIX_PARAMS.map((p) => p.name).join(", ")}.`,
    };
  }

  // channel: /(input|playback|output)/<n>/<param...>
  const channel = address.match(/^\/(input|playback|output)\/\d+\/(.+)$/);
  if (channel) {
    const bus = channel[1] as ChannelBus;
    const param = channel[2];
    const def = channelParams(bus).find((p) => p.name === param);
    if (def) return { ok: true, def };

    // Most common mistake: trying to set a fader on input or playback.
    if ((bus === "input" || bus === "playback") && (param === "faderlin" || param === "fader")) {
      return {
        ok: false,
        reason: `${bus} channels have no standalone fader.`,
        hint: `Use a matrix send instead: /mix/${MATRIX_BUS_FOR_CHANNEL[bus]}/<${bus}>/<submix>/fader (dB-direct).`,
      };
    }
    return {
      ok: false,
      reason: `Unknown ${bus} parameter "${param}".`,
      hint: `See the totalmix://protocol resource for the valid ${bus} parameters.`,
    };
  }

  // global / fixed
  const g = matchGlobal(address);
  if (g) return { ok: true, def: g };

  return {
    ok: false,
    reason: `Address "${address}" does not match any known TotalMix OSC pattern.`,
    hint: "Check the totalmix://protocol resource for valid addresses.",
  };
}

// ---- reference text generation --------------------------------------------

function paramLine(p: ParamDef): string {
  const dir = p.read && p.write ? "rw" : p.read ? "r-" : "-w";
  const lr = p.lr ? " L/R" : "";
  const scale = p.scale && p.scale !== "raw" ? ` (${p.scale})` : "";
  const comment = p.comment ? `  // ${p.comment}` : "";
  return `  ${p.name}  [${dir}${lr}${scale}]${comment}`;
}

// Generate the full protocol reference from the data above, so the document
// the model reads can never drift from what the code actually validates.
export function generateReference(): string {
  const lines: string[] = [];
  lines.push("# TotalMix Global OSC Protocol Reference");
  lines.push("");
  lines.push("Generated from the MCP server protocol map (OSCProtocoll_260626, balpan confirmed).");
  lines.push("Direction: rw = read and write, r- = read only (status/meter),");
  lines.push("-w = write only (trigger/command). Channels are 0-based.");
  lines.push("");
  lines.push("## Important addressing rule");
  lines.push("");
  lines.push("Input and playback channels have NO standalone fader. Their level is a");
  lines.push("matrix send: /mix/in/<input>/<submix>/faderlin and");
  lines.push("/mix/pb/<playback>/<submix>/faderlin, where <submix> is an output channel.");
  lines.push("Only output channels have a direct fader: /output/<n>/faderlin.");
  lines.push("");
  lines.push("## Write-only addresses never appear in the cache");
  lines.push("");
  lines.push("Any address tagged [-w] below (direction = write only, no 'r') is a command");
  lines.push("TotalMix only ever receives, never sends back, not even in response to");
  lines.push("/sendall or /sendsettings. This is structural, not a quirk of any specific");
  lines.push("command: examples include /undo, /redo, all loadpreset triggers, durec");
  lines.push("transport commands (play/pause/stop/record/next/previous), snapshot/save,");
  lines.push("layout/load, mutegroup/sologroup/fadergroup, sendall/sendsettings/sendchan/");
  lines.push("sendmix/sendsubmix, showwindow, and controlroom/recall. Reading one of");
  lines.push("these with osc_read or looking for it in get_channel output will always");
  lines.push("come back empty, that is expected, not a bug. Do not retry, resync, or");
  lines.push("hunt for confirmation: if send_osc_commands did not return an error, treat");
  lines.push("the command as sent successfully and move on.");
  lines.push("");
  lines.push("## Trigger value rule");
  lines.push("");
  lines.push("Trigger addresses (valueType trigger, the spec's \"(f)\") need no value. If a");
  lines.push("value IS sent, it must be at least 0.5 or TotalMix ignores the message, so");
  lines.push("when in doubt send 1.0. Plain float commands like /sendmix, /sendsubmix and");
  lines.push("/showwindow are not triggers: they require a value and are rejected without");
  lines.push("one.");
  lines.push("");
  lines.push("## Exception: snapshot/load is read AND write");
  lines.push("");
  lines.push("Unlike the write-only commands above, /snapshot/load/<n> is rw: TotalMix");
  lines.push("sends back 0 (off) / 2 (active) / 3 (changed) for that snapshot slot, and");
  lines.push("accepts only the value 1 on write to trigger a load. This is the only");
  lines.push("trigger-style address that can be read back to check current state.");
  lines.push("");
  lines.push("## Discovering channel names");
  lines.push("");
  lines.push("Channel names (input/playback/output 'name' parameter) are free text the");
  lines.push("person can rename at any time in TotalMix, never assume a fixed name-to-");
  lines.push("index mapping. To resolve a name like \"Phones 1\" to a channel number,");
  lines.push("run osc_sync (scope all or settings) then osc_get_prefix on the relevant");
  lines.push("bus, e.g. /output, and read each channel's name field from the live cache.");
  lines.push("");
  lines.push("## Matrix sends: /mix/in/<src>/<submix>/<param> and /mix/pb/<src>/<submix>/<param>");
  lines.push("");
  for (const p of MATRIX_PARAMS) lines.push(paramLine(p));
  lines.push("");
  lines.push("## /input/<n>/<param>");
  lines.push("");
  for (const p of INPUT_PARAMS) lines.push(paramLine(p));
  lines.push("");
  lines.push("## /playback/<n>/<param>");
  lines.push("");
  for (const p of PLAYBACK_PARAMS) lines.push(paramLine(p));
  lines.push("");
  lines.push("## /output/<n>/<param>");
  lines.push("");
  for (const p of OUTPUT_PARAMS) lines.push(paramLine(p));
  lines.push("");
  lines.push("## Global and fixed addresses");
  lines.push("");
  for (const g of GLOBAL_DEFS) {
    const dir = g.read && g.write ? "rw" : g.read ? "r-" : "-w";
    const scale = g.scale && g.scale !== "raw" ? ` (${g.scale})` : "";
    const comment = g.comment ? `  // ${g.comment}` : "";
    lines.push(`  ${g.template}  [${dir}${scale}]${comment}`);
  }
  lines.push("");
  lines.push("## Fader curve");
  lines.push("");
  lines.push("faderlin is a 0..1 position, not dB. This server does no conversion (it is");
  lines.push("a dumb pipe): always prefer the dB-native addresses, /mix/.../fader for");
  lines.push("matrix sends and /output/<n>/volume for output strips, and send dB values");
  lines.push("directly. RME's official dB<->faderlin conversion code from the spec's");
  lines.push("\"Fader curve\" sheet is preserved in docs/fader-curve.md for the rare case");
  lines.push("a faderlin value must be interpreted.");
  return lines.join("\n");
}
