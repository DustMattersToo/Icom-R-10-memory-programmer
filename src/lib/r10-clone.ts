// Independently implemented from the protocol facts in tk10 0.4 (api10.tcl,
// gui10.tcl), https://parnass.com/tk10/, and Icom's manual, pp. 2, 23, 71.
// IC-R10 differs from generic Icom cloning: no E0 query or E2 clone-out;
// the user starts output with FUNC. PC TX: EE EF; radio TX: EE EE.
export const MODES = ["FM", "WFM", "AM", "LSB", "USB", "CW", "AUTO"] as const;
export type Mode = (typeof MODES)[number];
export interface Channel { loc: number; name: string; freq: string; mode: Mode; skip: boolean; comment: string }
export const CLONE_BAUD = 9600;
export const IMAGE_SIZE = 0x3f00; // 504 blocks of 32 bytes
export const BLOCK_SIZE = 32;
export const CHANNEL_COUNT = 1000;
export const MODEL = [0x18, 0x91, 0x00, 0x01] as const;
const END = new TextEncoder().encode("Icom Inc.");
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export interface CloneFrame { to: number; from: number; command: number; payload: number[] }
export interface CloneImage { data: Uint8Array; model: number[] }
export interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number; dataBits: 8; stopBits: 1; parity: "none"; flowControl: "none" }): Promise<void>;
  close(): Promise<void>;
}

export function cloneFrame(command: number, payload: readonly number[] | Uint8Array = []): Uint8Array {
  return new Uint8Array([0xfe, 0xfe, 0xee, 0xef, command, ...payload, 0xfd]);
}

// Incremental framing: retain partial frames, consume complete frames once.
export class CloneParser {
  private bytes: number[] = [];
  push(bytes: Uint8Array): CloneFrame[] {
    this.bytes.push(...bytes);
    const frames: CloneFrame[] = [];
    for (;;) {
      const start = this.bytes.findIndex((b, i) => b === 0xfe && this.bytes[i + 1] === 0xfe);
      if (start < 0) { this.bytes = this.bytes.slice(-1).filter((b) => b === 0xfe); break; }
      if (start > 0) this.bytes.splice(0, start);
      let k = 2;
      while (this.bytes[k] === 0xfe) k++;
      const end = this.bytes.indexOf(0xfd, k);
      if (end < 0) {
        if (this.bytes.length > 512) throw new Error("Oversized clone frame; check cable and CLONE MODE.");
        break;
      }
      const body = this.bytes.splice(0, end + 1).slice(k, -1);
      const [to, from, command, ...payload] = body;
      if (to === undefined || from === undefined || command === undefined) throw new Error("Truncated clone frame.");
      frames.push({ to, from, command, payload });
    }
    return frames;
  }
}

export function encodeBlock(address: number, data: Uint8Array): number[] {
  const bytes = [address >> 8, address & 255, data.length, ...data];
  const sum = bytes.reduce((a, b) => a + b, 0);
  bytes.push((-sum) & 255);
  return Array.from(new TextEncoder().encode(bytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("")));
}

export function decodeBlock(payload: number[]): { address: number; data: Uint8Array } {
  const hex = new TextDecoder().decode(new Uint8Array(payload));
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) throw new Error("Invalid ASCII-hex clone data.");
  const bytes = Array.from({ length: hex.length / 2 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  const [hi, lo, length] = bytes;
  if (hi === undefined || lo === undefined || length !== BLOCK_SIZE || bytes.length !== length + 4) throw new Error("Invalid IC-R10 block length.");
  if ((bytes.reduce((a, b) => a + b, 0) & 255) !== 0) throw new Error("Clone checksum failed; no channels were changed.");
  const address = hi * 256 + lo;
  if (address % BLOCK_SIZE !== 0 || address + length > IMAGE_SIZE) throw new Error("Invalid clone block address.");
  return { address, data: new Uint8Array(bytes.slice(3, -1)) };
}

function assertModel(model: readonly number[]) {
  if (model.length !== MODEL.length || model.some((b, i) => b !== MODEL[i])) throw new Error("Unsupported radio model; expected IC-R10 (18910001). Nothing will be uploaded.");
}
function assertImage(image: CloneImage) {
  assertModel(image.model);
  if (image.data.length !== IMAGE_SIZE) throw new Error("A complete IC-R10 download is required before upload.");
}
export function assertRange(from: number, to: number) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to >= CHANNEL_COUNT || from > to) throw new Error("Channel range must be between 0 and 999, with From no higher than To.");
}

// Four-byte big-endian BCD, in 10 Hz units. The top nibble is 0..15,
// so e.g. 1234.567 MHz is C3 45 67 00, not five-byte CI-V BCD.
export function encodeFrequency(value: string): Uint8Array {
  if (!value) return new Uint8Array(4);
  const mhz = Number(value);
  const units = Math.round(mhz * 100000);
  if (!/^\d*\.?\d+$/.test(value) || !Number.isFinite(mhz) || mhz < 0.5 || mhz > 1300 || Math.abs(units - mhz * 100000) > 0.00001) throw new Error("Frequency must be 0.500000–1300.000000 MHz in 10 Hz increments.");
  const top = Math.floor(units / 10000000);
  const rest = (units % 10000000).toString().padStart(7, "0");
  const hex = top.toString(16) + rest;
  return new Uint8Array(Array.from({ length: 4 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)));
}
export function decodeFrequency(bytes: Uint8Array): string {
  if (bytes.length !== 4) throw new Error("Invalid frequency length.");
  if (bytes.every((b) => b === 0) || bytes.every((b) => b === 255)) return "";
  const first = bytes[0];
  if (first === undefined) throw new Error("Missing frequency.");
  // Regional 9 kHz broadcast encoding from tk10: first byte is an
  // index above .495 MHz, with an FF FF suffix. Preserve if unchanged.
  if (bytes[2] === 255 && bytes[3] === 255) return ((first * 9 + 495) / 1000).toFixed(6);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  if (!/^\d{7}$/.test(hex.slice(1))) throw new Error("Unrecognized frequency encoding.");
  const units = (first >> 4) * 10000000 + Number(hex.slice(1));
  return (units / 100000).toFixed(6);
}

export function decodeChannels(image: CloneImage): Channel[] {
  assertImage(image);
  return Array.from({ length: CHANNEL_COUNT }, (_, loc) => {
    const flags = image.data[0x3600 + loc] ?? 0;
    const name = new TextDecoder().decode(image.data.slice(0x1000 + loc * 8, 0x1000 + loc * 8 + 8)).replace(/[\x00 ]+$/, "");
    const freq = flags & 0x80 ? "" : decodeFrequency(image.data.slice(loc * 4, loc * 4 + 4));
    const mode = MODES[flags & 15];
    if (freq && mode === undefined) throw new Error(`Unknown mode in channel ${loc}; download not applied.`);
    return { loc, name: freq ? name : "", freq, mode: mode ?? "FM", skip: !!(flags & 0x40), comment: "" };
  });
}

// Clone whole image, patch ONLY requested channels. Other banks, settings,
// attenuator flags, and reserved bits remain byte-for-byte unchanged.
export function patchChannels(image: CloneImage, rows: Channel[], from: number, to: number): CloneImage {
  assertImage(image); assertRange(from, to);
  const original = decodeChannels(image);
  const data = image.data.slice();
  for (let loc = from; loc <= to; loc++) {
    const row = rows.find((r) => r.loc === loc);
    const old = original[loc];
    if (!row || !old) throw new Error(`Channel ${loc} is missing.`);
    if (row.name.length > 8 || !/^[\x20-\x7e]*$/.test(row.name)) throw new Error(`Channel ${loc}: name must be up to 8 printable ASCII characters.`);
    const mode = MODES.indexOf(row.mode);
    if (mode < 0) throw new Error(`Channel ${loc}: unsupported mode.`);
    if (row.freq !== old.freq) data.set(encodeFrequency(row.freq), loc * 4);
    if (row.name !== old.name || !row.freq) data.set(new TextEncoder().encode((row.freq ? row.name : "").padEnd(8, " ")), 0x1000 + loc * 8);
    const offset = 0x3600 + loc;
    const previous = data[offset] ?? 0;
    // Keep attenuator (0x20), reserved bit (0x10), and existing auto mode
    // unless the user edited it. Empty channels get the hidden bit (0x80).
    data[offset] = (previous & 0x30) | (row.freq ? 0 : 0x80) | (row.skip && row.freq ? 0x40 : 0) | mode;
  }
  return { data, model: [...image.model] };
}

async function requestPort(): Promise<SerialPortLike> {
  const serial = (navigator as Navigator & { serial?: { requestPort(): Promise<SerialPortLike> } }).serial;
  if (!serial) throw new Error("Use Chrome or Edge on Windows for OPC-478 programming.");
  return serial.requestPort();
}

export class R10CloneLink {
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private parser = new CloneParser();
  private queue: CloneFrame[] = [];
  private failure: Error | null = null;
  private pumping: Promise<void> | null = null;
  private active = false;
  constructor(private log: (text: string) => void, private portFactory = requestPort) {}
  async open() {
    const port = await this.portFactory();
    await port.open({ baudRate: CLONE_BAUD, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none" });
    this.port = port;
    if (!port.readable || !port.writable) { await this.close(); throw new Error("Serial port has no readable/writable connection."); }
    this.writer = port.writable.getWriter();
    this.reader = port.readable.getReader();
    const reader = this.reader;
    this.pumping = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) { this.failure = new Error("Serial port closed."); break; }
          this.queue.push(...this.parser.push(value));
        }
      } catch (e) { this.failure = e instanceof Error ? e : new Error(String(e)); }
    })();
    this.log("OPC-478 port opened at 9600 baud (8N1); scanner not yet verified.");
  }
  async close() {
    if (this.reader) { await this.reader.cancel().catch(() => {}); await this.pumping; this.reader.releaseLock(); }
    this.writer?.releaseLock();
    await this.port?.close();
    this.reader = null; this.writer = null; this.port = null;
  }
  private begin() {
    if (this.active) throw new Error("Another clone operation is running.");
    if (!this.writer || this.failure) throw this.failure ?? new Error("Serial port is not open.");
    this.active = true; this.queue = []; this.parser = new CloneParser();
  }
  private async next(timeout: number, signal?: AbortSignal): Promise<CloneFrame> {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (signal?.aborted) throw new Error("Download cancelled; channels unchanged.");
      if (this.failure) throw this.failure;
      const frame = this.queue.shift();
      if (frame) {
        if (frame.from === 0xef) continue; // OPC-478 local echo is not radio acknowledgement.
        if (frame.from !== 0xee || (frame.to !== 0xee && frame.to !== 0xef)) continue;
        return frame;
      }
      await delay(10);
    }
    throw new Error("No clone data from IC-R10. Check the external speaker [SP] jack, CLONE MODE, and press FUNC for download.");
  }
  private async send(command: number, payload: readonly number[] | Uint8Array) {
    if (!this.writer) throw new Error("Port disconnected.");
    await this.writer.write(cloneFrame(command, payload));
  }
  async download(progress: (done: number, total: number) => void, signal?: AbortSignal): Promise<CloneImage> {
    this.begin();
    try {
      this.log("Waiting for radio: CLONE MODE, then press FUNC on the IC-R10.");
      const start = await this.next(60000, signal);
      if (start.command !== 0xe3) throw new Error("Expected IC-R10 clone start. Restart in CLONE MODE and try again.");
      assertModel(start.payload);
      this.log("IC-R10 clone stream identified (18910001).");
      const data = new Uint8Array(IMAGE_SIZE);
      let received = 0;
      for (;;) {
        const frame = await this.next(5000, signal);
        if (frame.command === 0xe5) {
          if (new TextDecoder().decode(new Uint8Array(frame.payload)) !== "Icom Inc." || received !== IMAGE_SIZE) throw new Error("Incomplete clone image; channels unchanged.");
          return { data, model: [...start.payload] };
        }
        if (frame.command !== 0xe4) throw new Error("Unexpected command during clone download.");
        const block = decodeBlock(frame.payload);
        if (block.address !== received) throw new Error("Missing, repeated, or out-of-order clone block; channels unchanged.");
        data.set(block.data, block.address); received += block.data.length;
        progress(received, IMAGE_SIZE);
      }
    } finally { this.active = false; }
  }
  async upload(image: CloneImage, progress: (done: number, total: number) => void): Promise<void> {
    assertImage(image); this.begin();
    try {
      await this.send(0xe3, image.model);
      await delay(100);
      for (let address = 0; address < IMAGE_SIZE; address += BLOCK_SIZE) {
        await this.send(0xe4, encodeBlock(address, image.data.slice(address, address + BLOCK_SIZE)));
        // No per-block radio ACK. Drain local echoes, pace 78-byte wire
        // frames (81.25 ms at 9600 8N1), and wait for E6 after termination.
        await delay(90);
        if (this.failure) throw this.failure;
        while (this.queue[0]?.from === 0xef) this.queue.shift();
        if (this.queue.some((f) => f.from === 0xee)) throw new Error("Radio replied before clone transfer completed; upload stopped.");
        // Updating 1000 editor rows on every wire block would stall slower laptops.
        if ((address + BLOCK_SIZE) % (BLOCK_SIZE * 16) === 0 || address + BLOCK_SIZE === IMAGE_SIZE) progress(address + BLOCK_SIZE, IMAGE_SIZE);
      }
      await this.send(0xe5, END);
      const result = await this.next(10000);
      if (result.command !== 0xe6 || result.payload.length !== 1 || result.payload[0] !== 0) throw new Error("IC-R10 did not confirm a successful upload. Download again before further edits.");
      this.log("IC-R10 acknowledged clone upload (E6 00). Power the scanner off and on.");
    } finally { this.active = false; }
  }
}
