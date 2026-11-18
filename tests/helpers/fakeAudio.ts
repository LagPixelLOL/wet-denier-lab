import { vi } from "vitest";

/** One scheduled automation event on a FakeAudioParam. */
export type ParamEvent =
  | { type: "setValueAtTime"; value: number; time: number }
  | { type: "linearRampToValueAtTime"; value: number; time: number }
  | { type: "exponentialRampToValueAtTime"; value: number; time: number }
  | { type: "setTargetAtTime"; value: number; time: number; timeConstant: number };

export class FakeAudioParam {
  value: number;
  readonly events: ParamEvent[] = [];
  /** Nodes connected into this param (LFOs). */
  readonly inputs: FakeAudioNode[] = [];
  constructor(value = 0) {
    this.value = value;
  }
  setValueAtTime(value: number, time: number): this {
    this.events.push({ type: "setValueAtTime", value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ type: "linearRampToValueAtTime", value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    if (value <= 0) {
      throw new RangeError("exponentialRampToValueAtTime needs a positive value");
    }
    this.events.push({ type: "exponentialRampToValueAtTime", value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number, timeConstant: number): this {
    this.events.push({ type: "setTargetAtTime", value, time, timeConstant });
    return this;
  }
  cancelScheduledValues(): this {
    this.events.length = 0;
    return this;
  }
  /** Target of the most recent setTargetAtTime. */
  get target(): number | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (event.type === "setTargetAtTime") {
        return event.value;
      }
    }
    return undefined;
  }
}

export type AudioNodeKind =
  | "destination"
  | "gain"
  | "compressor"
  | "biquad"
  | "bufferSource"
  | "oscillator"
  | "panner"
  | "convolver";

export class FakeAudioNode {
  readonly kind: AudioNodeKind;
  readonly context: FakeAudioContext;
  outputs: (FakeAudioNode | FakeAudioParam)[] = [];
  constructor(context: FakeAudioContext, kind: AudioNodeKind) {
    this.context = context;
    this.kind = kind;
  }
  connect<T extends FakeAudioNode | FakeAudioParam>(destination: T): T {
    if (destination instanceof FakeAudioParam) {
      destination.inputs.push(this);
    }
    this.outputs.push(destination);
    return destination;
  }
  disconnect(): void {
    for (const output of this.outputs) {
      if (output instanceof FakeAudioParam) {
        output.inputs.splice(output.inputs.indexOf(this), 1);
      }
    }
    this.outputs = [];
  }
}

export class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam(1);
  constructor(context: FakeAudioContext) {
    super(context, "gain");
  }
}

export class FakeCompressorNode extends FakeAudioNode {
  readonly threshold = new FakeAudioParam(-24);
  readonly ratio = new FakeAudioParam(12);
  readonly attack = new FakeAudioParam(0.003);
  readonly release = new FakeAudioParam(0.25);
  constructor(context: FakeAudioContext) {
    super(context, "compressor");
  }
}

export class FakeBiquadNode extends FakeAudioNode {
  type = "lowpass";
  readonly frequency = new FakeAudioParam(350);
  readonly Q = new FakeAudioParam(1);
  constructor(context: FakeAudioContext) {
    super(context, "biquad");
  }
}

export class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array[];
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }
}

export class FakeBufferSourceNode extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  readonly playbackRate = new FakeAudioParam(1);
  started: number[] | null = null;
  constructor(context: FakeAudioContext) {
    super(context, "bufferSource");
  }
  start(...args: number[]): void {
    this.started = args;
  }
  stop(): void {}
}

export class FakeOscillatorNode extends FakeAudioNode {
  type = "sine";
  readonly frequency = new FakeAudioParam(440);
  started: number | null = null;
  stopped: number | null = null;
  constructor(context: FakeAudioContext) {
    super(context, "oscillator");
  }
  start(time = 0): void {
    this.started = time;
  }
  stop(time = 0): void {
    this.stopped = time;
  }
}

export class FakePannerNode extends FakeAudioNode {
  readonly pan = new FakeAudioParam(0);
  constructor(context: FakeAudioContext) {
    super(context, "panner");
  }
}

export class FakeConvolverNode extends FakeAudioNode {
  normalize = true;
  buffer: FakeAudioBuffer | null = null;
  constructor(context: FakeAudioContext) {
    super(context, "convolver");
  }
}

export interface FakeAudioOptions {
  sampleRate?: number;
  initialState?: AudioContextState;
  /** Remove createStereoPanner (older Safari). */
  noPanner?: boolean;
  /** Make createConvolver throw (reverb unavailable). */
  convolverFails?: boolean;
  /** Make createBufferSource throw after the graph is built (exercises the unlock try/catch). */
  bufferSourceFailsAfter?: number;
}

export class FakeAudioContext {
  static options: FakeAudioOptions = {};
  static instances: FakeAudioContext[] = [];
  readonly sampleRate: number;
  currentTime = 0;
  state: AudioContextState;
  readonly destination: FakeAudioNode;
  /** Every node created, in order. */
  readonly nodes: FakeAudioNode[] = [];
  readonly buffers: FakeAudioBuffer[] = [];
  resumeCalls = 0;
  createStereoPanner?: () => FakePannerNode;
  private readonly options: FakeAudioOptions;
  private sources = 0;

  constructor() {
    const options = FakeAudioContext.options;
    this.options = options;
    this.sampleRate = options.sampleRate ?? 8000;
    this.state = options.initialState ?? "suspended";
    this.destination = new FakeAudioNode(this, "destination");
    if (!options.noPanner) {
      this.createStereoPanner = () => this.add(new FakePannerNode(this));
    }
    FakeAudioContext.instances.push(this);
  }

  private add<T extends FakeAudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  createGain(): FakeGainNode {
    return this.add(new FakeGainNode(this));
  }
  createDynamicsCompressor(): FakeCompressorNode {
    return this.add(new FakeCompressorNode(this));
  }
  createBiquadFilter(): FakeBiquadNode {
    return this.add(new FakeBiquadNode(this));
  }
  createOscillator(): FakeOscillatorNode {
    return this.add(new FakeOscillatorNode(this));
  }
  createConvolver(): FakeConvolverNode {
    if (this.options.convolverFails) {
      throw new Error("NotSupportedError");
    }
    return this.add(new FakeConvolverNode(this));
  }
  createBufferSource(): FakeBufferSourceNode {
    const limit = this.options.bufferSourceFailsAfter;
    if (limit !== undefined && this.sources >= limit) {
      throw new Error("InvalidStateError");
    }
    this.sources++;
    return this.add(new FakeBufferSourceNode(this));
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    const buffer = new FakeAudioBuffer(channels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }
  resume(): Promise<void> {
    this.resumeCalls++;
    this.state = "running";
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = "suspended";
    return Promise.resolve();
  }

  /** Nodes of one kind created so far. */
  count(kind: AudioNodeKind): number {
    return this.nodes.filter((node) => node.kind === kind).length;
  }
}

/** Installs FakeAudioContext as window.AudioContext (or webkitAudioContext). Undo with vi.unstubAllGlobals(). */
export function installFakeAudio(options: FakeAudioOptions = {}, name = "AudioContext"): typeof FakeAudioContext {
  FakeAudioContext.options = options;
  FakeAudioContext.instances = [];
  vi.stubGlobal(name, FakeAudioContext);
  return FakeAudioContext;
}

/** The context the last install created. */
export function lastContext(): FakeAudioContext {
  const ctx = FakeAudioContext.instances.at(-1);
  if (!ctx) {
    throw new Error("no AudioContext was created");
  }
  return ctx;
}
