// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCENE_ORDER } from "../../../src/engine/stage/scenes";
import { SoundEngine } from "../../../src/engine/audio/SoundEngine";
import { digest, digestRounded } from "../../helpers/digest";
import {
  FakeAudioBuffer,
  FakeAudioContext,
  FakeAudioParam,
  FakeBufferSourceNode,
  FakeConvolverNode,
  FakeGainNode,
  FakeOscillatorNode,
  FakePannerNode,
  asAudioContext,
  fake,
  installFakeAudio,
  lastContext,
} from "../../helpers/fakeAudio";
import type { FakeAudioOptions } from "../../helpers/fakeAudio";
import { seedRandom } from "../../helpers/random";

let restoreRandom: () => void;
beforeEach(() => {
  restoreRandom = seedRandom(11);
});
afterEach(() => {
  restoreRandom();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** An unlocked engine on a fresh fake context. */
function unlocked(options: FakeAudioOptions = {}): { sound: SoundEngine; ctx: FakeAudioContext } {
  installFakeAudio(options);
  const sound = new SoundEngine();
  sound.unlock();
  return { sound, ctx: lastContext() };
}

const gainsOf = (sound: SoundEngine) => ({
  street: fake(sound.beds?.street, FakeGainNode),
  pool: fake(sound.beds?.pool, FakeGainNode),
  bath: fake(sound.beds?.bath, FakeGainNode),
});
const param = (value: AudioParam) => fake(value, FakeAudioParam);

describe("SoundEngine before unlock", () => {
  it("starts idle and enabled", () => {
    const sound = new SoundEngine();
    expect([sound.ctx, sound.enabled, sound.running, sound.scene, sound.raining]).toEqual([
      null,
      true,
      false,
      "studio",
      false,
    ]);
    // nothing to play into yet
    sound.splash(1);
    sound.drip();
    sound.setRain(true);
    sound.setScene("bath");
    sound.setEnabled(false);
    expect(sound.raining).toBe(true);
    expect(sound.scene).toBe("bath");
  });

  it("stays silent when the browser has no Web Audio", () => {
    const sound = new SoundEngine();
    sound.unlock();
    expect(sound.ctx).toBeNull();
  });

  it("falls back to the webkit-prefixed context", () => {
    installFakeAudio({}, "webkitAudioContext");
    const sound = new SoundEngine();
    sound.unlock();
    expect(sound.ctx).toBe(lastContext());
  });
});

describe("unlock", () => {
  it("creates the context and resumes it with a one-sample kick", () => {
    const { sound, ctx } = unlocked();
    expect(sound.ctx).toBe(ctx);
    expect(ctx.resumeCalls).toBe(1);
    expect(sound.running).toBe(true);
    const kick = ctx.nodes.at(-1) as FakeBufferSourceNode;
    expect(kick.kind).toBe("bufferSource");
    expect(kick.buffer?.length).toBe(1);
    expect(kick.outputs).toEqual([ctx.destination]);
    expect(kick.started).toEqual([0]);
    sound.unlock();
    expect(ctx.resumeCalls).toBe(1);
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it("stays suspended (and retries on the next unlock) when autoplay is blocked", async () => {
    const { sound, ctx } = unlocked({ resumeFails: true });
    await Promise.resolve();
    expect(sound.running).toBe(false);
    sound.unlock();
    expect(ctx.resumeCalls).toBe(2);
  });

  it("reuses a context passed to _create and survives a failing kick", () => {
    installFakeAudio({ bufferSourceFailsAfter: 6 });
    const ctx = new FakeAudioContext();
    const sound = new SoundEngine();
    sound._create(asAudioContext(ctx));
    expect(sound.ctx).toBe(ctx);
    expect(() => sound.unlock()).not.toThrow();
    expect(ctx.resumeCalls).toBe(1);
  });
});

describe("the audio graph", () => {
  it("routes everything through a compressed master bus", () => {
    const { sound, ctx } = unlocked();
    const master = fake(sound.master, FakeGainNode);
    expect(master.gain.value).toBe(0.9);
    const [compressor] = master.outputs;
    expect(compressor).toMatchObject({ kind: "compressor" });
    expect(compressor).toMatchObject({
      threshold: { value: -14 },
      ratio: { value: 4 },
      attack: { value: 0.002 },
      release: { value: 0.12 },
      outputs: [ctx.destination],
    });
  });

  it("builds two seconds of white noise and sparse crackle", () => {
    const { sound, ctx } = unlocked();
    const noise = ctx.buffers[0].getChannelData(0);
    expect(sound.noise).toBe(ctx.buffers[0]);
    expect(noise).toHaveLength(16000);
    expect(Math.min(...noise)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...noise)).toBeLessThanOrEqual(1);
    const dust = ctx.buffers[1].getChannelData(0);
    expect(dust).toHaveLength(16000);
    expect(dust.some((v) => v !== 0)).toBe(true);
    expect(digest(noise)).toMatchInlineSnapshot(`"5d7e849c"`);
    expect(digest(dust)).toMatchInlineSnapshot(`"6a80982b"`);
  });

  it("feeds a normalized stereo reverb from a 0.9 s impulse", () => {
    const { sound, ctx } = unlocked();
    const impulse = ctx.buffers[2];
    expect([impulse.numberOfChannels, impulse.length]).toEqual([2, 7200]);
    // silent for the first 7 ms
    expect(
      impulse
        .getChannelData(0)
        .subarray(0, 56)
        .every((v) => v === 0),
    ).toBe(true);
    expect(impulse.getChannelData(1)[56]).not.toBe(0);
    const verb = fake(sound.verb, FakeConvolverNode);
    expect(verb.normalize).toBe(true);
    expect(verb.buffer).toBe(impulse);
    expect(verb.outputs).toEqual([sound.master]);
    expect(fake(sound.verbIn, FakeGainNode).outputs).toEqual([sound.verb]);
    expect(digestRounded(impulse.getChannelData(1), 6)).toMatchInlineSnapshot(`"89ce8916"`);
  });

  it("runs without reverb when the convolver is unavailable", () => {
    const { sound } = unlocked({ convolverFails: true });
    expect(sound.verb).toBeNull();
    expect(sound.verbIn).toBeUndefined();
    expect(fake(sound.rainGain, FakeGainNode).outputs).toEqual([sound.master]);
    sound.splash(0.5);
    sound.setScene("bath");
  });

  it("loops filtered noise for the rain and the three ambience beds, with slow swells", () => {
    const { sound, ctx } = unlocked();
    const rain = fake(sound.rainGain, FakeGainNode);
    expect(rain.gain.value).toBe(0);
    expect(rain.outputs).toEqual([sound.master, sound.verbIn]);
    const loops = ctx.nodes.filter((n): n is FakeBufferSourceNode => n instanceof FakeBufferSourceNode && n.loop);
    expect(
      loops.map((n) => [n.buffer === fake(sound.noise, FakeAudioBuffer) ? "noise" : "dust", n.playbackRate.value]),
    ).toEqual([
      ["noise", 1],
      ["dust", 0.85],
      ["noise", 0.5],
      ["noise", 0.7],
      ["noise", 0.6],
    ]);
    expect(loops.every((n) => n.started !== null)).toBe(true);
    const beds = gainsOf(sound);
    const swell = { street: fake(sound.bedSwell.street, FakeGainNode), pool: fake(sound.bedSwell.pool, FakeGainNode) };
    expect(beds.street.outputs).toEqual([swell.street]);
    expect(beds.pool.outputs).toEqual([swell.pool]);
    expect(beds.bath.outputs).toEqual([sound.master]);
    expect(swell.street.gain.value).toBe(0.6);
    const lfos = ctx.nodes.filter((n): n is FakeOscillatorNode => n instanceof FakeOscillatorNode);
    expect(lfos.map((osc) => osc.frequency.value)).toEqual([0.07, 0.23]);
    expect(swell.street.gain.inputs).toHaveLength(1);
    expect((swell.street.gain.inputs[0] as FakeGainNode).gain.value).toBe(0.3);
  });

  it("starts muted when disabled before the context exists", () => {
    installFakeAudio();
    const sound = new SoundEngine();
    sound.setEnabled(false);
    sound.unlock();
    expect(fake(sound.master, FakeGainNode).gain.value).toBe(0);
  });
});

describe("setScene", () => {
  it("fades in only the scene's ambience bed and sets its reverb", () => {
    vi.useFakeTimers();
    const { sound, ctx } = unlocked();
    const levels: Record<string, number[]> = {};
    for (const key of SCENE_ORDER) {
      ctx.currentTime += 1;
      sound.setScene(key);
      const beds = gainsOf(sound);
      levels[key] = [
        beds.street.gain.target!,
        beds.pool.gain.target!,
        beds.bath.gain.target!,
        param(sound.verbIn!.gain).target!,
      ];
      expect(beds.bath.gain.events.at(-1)).toMatchObject({ time: ctx.currentTime, timeConstant: 0.6 });
    }
    expect(levels).toEqual({
      studio: [0, 0, 0, 0.2],
      bath: [0, 0, 0.012, 0.5],
      street: [0.05, 0, 0, 0.12],
      pool: [0, 0.035, 0, 0.2],
    });
  });

  it("keeps the rain level in step with the scene", () => {
    const { sound } = unlocked();
    const rain = param(sound.rainGain.gain);
    sound.setRain(true);
    expect(rain.target).toBe(0.075);
    expect(rain.events.at(-1)).toMatchObject({ timeConstant: 0.4 });
    sound.setScene("bath");
    expect(rain.target).toBe(0.11);
    sound.setRain(false);
    expect(rain.target).toBe(0);
    expect(sound.raining).toBe(false);
  });

  it("drips a tap now and then in the bath while running, visible and enabled", () => {
    vi.useFakeTimers();
    const { sound, ctx } = unlocked();
    const oscillators = () => ctx.count("oscillator");
    sound.setScene("bath");
    const before = oscillators();
    vi.advanceTimersByTime(7000);
    const afterOne = oscillators();
    expect(afterOne).toBeGreaterThan(before);
    // muted or suspended: the timer keeps ticking but plays nothing
    sound.enabled = false;
    vi.advanceTimersByTime(14000);
    expect(oscillators()).toBe(afterOne);
    sound.enabled = true;
    ctx.state = "suspended";
    vi.advanceTimersByTime(14000);
    expect(oscillators()).toBe(afterOne);
    ctx.state = "running";
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    vi.advanceTimersByTime(14000);
    expect(oscillators()).toBe(afterOne);
    vi.restoreAllMocks();
    restoreRandom = seedRandom(11);
    vi.advanceTimersByTime(14000);
    expect(oscillators()).toBeGreaterThan(afterOne);
    // leaving the bath stops the dripping
    sound.setScene("pool");
    const left = oscillators();
    vi.advanceTimersByTime(30000);
    expect(oscillators()).toBe(left);
  });

  it("doubles some tap drips (pinned by the engine's own seed)", () => {
    vi.useFakeTimers();
    const { sound, ctx } = unlocked();
    sound.setScene("bath");
    // first drip after 2.7 s (one bloop), second after another 5.3 s (two bloops)
    vi.advanceTimersByTime(2700);
    expect(ctx.count("oscillator")).toBe(2 + 1);
    vi.advanceTimersByTime(5300);
    expect(ctx.count("oscillator")).toBe(2 + 1 + 2);
  });

  it("stops the drip loop if the scene changes before the timer fires", () => {
    vi.useFakeTimers();
    const { sound, ctx } = unlocked();
    sound.setScene("bath");
    sound.scene = "street";
    vi.advanceTimersByTime(20000);
    expect(ctx.count("oscillator")).toBe(2);
  });

  it("schedules tap drips from its own seeded generator", () => {
    const sound = new SoundEngine();
    expect([sound._rand(), sound._rand(), sound._rand()]).toMatchInlineSnapshot(`
      [
        0.02040266990661621,
        0.016547799110412598,
        0.5431557893753052,
      ]
    `);
    expect(sound.seed).toMatchInlineSnapshot(`-1962130922`);
  });
});

describe("setEnabled", () => {
  it("ramps the master gain down and back up", () => {
    const { sound, ctx } = unlocked();
    const gain = param(sound.master.gain);
    ctx.currentTime = 3;
    sound.setEnabled(false);
    expect(gain.events.at(-1)).toEqual({ type: "setTargetAtTime", value: 0, time: 3, timeConstant: 0.05 });
    sound.splash(1);
    sound.drip(1);
    expect(ctx.count("oscillator")).toBe(2);
    sound.setEnabled(true);
    expect(gain.target).toBe(0.9);
  });
});

describe("splash", () => {
  it("layers noise bursts, a thump and bubbles, scaled by energy", () => {
    const { sound, ctx } = unlocked();
    const nodesBefore = ctx.nodes.length;
    ctx.currentTime = 1;
    sound.splash(1, 0.5);
    const voice = ctx.nodes.slice(nodesBefore);
    const kinds = voice.map((n) => n.kind);
    // voice input + panner, four bursts (source, filter(s), gain), a thump and up to six bubbles
    expect(kinds.filter((k) => k === "bufferSource")).toHaveLength(4);
    expect(kinds.filter((k) => k === "oscillator").length).toBeGreaterThanOrEqual(2);
    const panner = voice.find((n): n is FakePannerNode => n instanceof FakePannerNode)!;
    expect(panner.pan.value).toBeGreaterThan(0.4);
    expect(panner.outputs).toEqual([sound.master, sound.verbIn]);
    const sources = voice.filter((n): n is FakeBufferSourceNode => n instanceof FakeBufferSourceNode);
    expect(sources.map((s) => (s.buffer === fake(sound.dust, FakeAudioBuffer) ? "dust" : "noise"))).toEqual([
      "noise",
      "noise",
      "dust",
      "noise",
    ]);
    for (const source of sources) {
      expect(source.started![0]).toBeGreaterThanOrEqual(1.004);
      expect(source.started![1]).toBeLessThan(1.5);
    }
    const envelope = (voice.find((n) => n.kind === "gain" && n !== voice[0]) as FakeGainNode).gain.events;
    expect(envelope.map((e) => e.type)).toEqual([
      "setValueAtTime",
      "exponentialRampToValueAtTime",
      "exponentialRampToValueAtTime",
    ]);
    expect(envelope[1].value).toBeCloseTo(0.54, 12);
    expect(
      digestRounded(
        voice.flatMap((n) => (n instanceof FakeOscillatorNode ? [n.started!, n.stopped!] : [])),
        9,
      ),
    ).toMatchInlineSnapshot(`"fa67af6a"`);
  });

  it("stays light for soft hits: no thump, no hiss tail", () => {
    const { sound, ctx } = unlocked();
    const nodesBefore = ctx.nodes.length;
    ctx.currentTime = 1;
    sound.splash(0.1);
    const voice = ctx.nodes.slice(nodesBefore);
    expect(voice.filter((n) => n.kind === "bufferSource")).toHaveLength(3);
    const bubbles = voice.filter((n) => n.kind === "oscillator").length;
    expect(bubbles).toBeGreaterThanOrEqual(1);
    expect(bubbles).toBeLessThanOrEqual(2);
  });

  it("throttles splashes within 50 ms unless the energy surges", () => {
    const { sound, ctx } = unlocked();
    ctx.currentTime = 1;
    sound.splash(0.2);
    const count = ctx.nodes.length;
    ctx.currentTime = 1.03;
    sound.splash(0.3);
    expect(ctx.nodes.length).toBe(count);
    sound.splash(0.9);
    expect(ctx.nodes.length).toBeGreaterThan(count);
    expect(sound.lastEnergy).toBe(0.9);
    // a quick follow-up that is not fresh plays at 70% intensity
    ctx.currentTime = 1.2;
    const before = ctx.nodes.length;
    sound.splash(1);
    const envelope = (ctx.nodes.slice(before).find((n, i) => i > 0 && n.kind === "gain") as FakeGainNode).gain.events;
    expect(envelope[1].value).toBeCloseTo(0.16 + 0.7 * 0.38, 12);
  });

  it("skips the panner on browsers without one", () => {
    const { sound, ctx } = unlocked({ noPanner: true });
    sound.splash(0.5);
    expect(ctx.count("panner")).toBe(0);
    expect(
      ctx.nodes.filter((n) => n.kind === "gain").some((n) => n.outputs.includes(fake(sound.master, FakeGainNode))),
    ).toBe(true);
  });
});

describe("drip", () => {
  it("plays a click and a falling bloop, with a wetter reverb send", () => {
    const { sound, ctx } = unlocked();
    ctx.currentTime = 2;
    const before = ctx.nodes.length;
    sound.drip(0.5, -0.3);
    const voice = ctx.nodes.slice(before);
    expect(voice.filter((n) => n.kind === "bufferSource")).toHaveLength(1);
    expect(voice.filter((n) => n.kind === "oscillator").length).toBeGreaterThanOrEqual(1);
    const send = voice.find((n): n is FakeGainNode => n instanceof FakeGainNode && n.gain.value === 1.4);
    expect(send?.outputs).toEqual([sound.verbIn]);
    const osc = voice.find((n): n is FakeOscillatorNode => n instanceof FakeOscillatorNode)!;
    expect(osc.frequency.events[0]).toMatchObject({ type: "setValueAtTime", time: expect.closeTo(2.007, 9) });
    expect(osc.frequency.events[1].value).toBeGreaterThan(osc.frequency.events[0].value * 1.45);
  });

  it("throttles drips to one per 60 ms", () => {
    const { sound, ctx } = unlocked();
    ctx.currentTime = 2;
    sound.drip();
    const count = ctx.nodes.length;
    ctx.currentTime = 2.05;
    sound.drip();
    expect(ctx.nodes.length).toBe(count);
    ctx.currentTime = 2.07;
    sound.drip();
    expect(ctx.nodes.length).toBeGreaterThan(count);
  });

  it("sometimes adds a second, higher bloop", () => {
    const { sound, ctx } = unlocked();
    const counts: number[] = [];
    for (let i = 0; i < 12; i++) {
      ctx.currentTime = 3 + i;
      const before = ctx.count("oscillator");
      sound.drip(0.2);
      counts.push(ctx.count("oscillator") - before);
    }
    expect(new Set(counts)).toEqual(new Set([1, 2]));
  });
});

describe("audio session", () => {
  it("switches the Audio Session type where the API exists", () => {
    const session = { type: "auto" as const };
    Object.defineProperty(navigator, "audioSession", { value: session, configurable: true, writable: true });
    try {
      installFakeAudio();
      const sound = new SoundEngine();
      sound.unlock();
      expect(navigator.audioSession?.type).toBe("playback");
      sound.setEnabled(false);
      expect(navigator.audioSession?.type).toBe("auto");
    } finally {
      Reflect.deleteProperty(navigator, "audioSession");
    }
  });

  it("ignores a throwing Audio Session API", () => {
    Object.defineProperty(navigator, "audioSession", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      installFakeAudio();
      expect(() => new SoundEngine().unlock()).not.toThrow();
    } finally {
      Reflect.deleteProperty(navigator, "audioSession");
    }
  });
});

describe("iOS silent-audio keepalive", () => {
  class FakeAudioElement {
    static created: FakeAudioElement[] = [];
    src: string;
    loop = false;
    paused = true;
    attributes: Record<string, string> = {};
    plays = 0;
    pauses = 0;
    constructor(src: string) {
      this.src = src;
      FakeAudioElement.created.push(this);
    }
    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    }
    play() {
      this.plays++;
      this.paused = false;
      return Promise.reject(new Error("NotAllowedError"));
    }
    pause() {
      this.pauses++;
      this.paused = true;
    }
  }

  function stubObjectUrl(create: (blob: Blob) => string): void {
    Object.defineProperty(URL, "createObjectURL", { value: create, configurable: true, writable: true });
  }

  afterEach(() => {
    Reflect.deleteProperty(URL, "createObjectURL");
  });

  async function loadOnIos(): Promise<typeof SoundEngine> {
    vi.resetModules();
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
      configurable: true,
    });
    try {
      return (await import("../../../src/engine/audio/SoundEngine")).SoundEngine;
    } finally {
      Reflect.deleteProperty(navigator, "userAgent");
    }
  }

  it("plays a looping silent WAV while sound is enabled and pauses it when disabled", async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal("Audio", FakeAudioElement);
    stubObjectUrl((blob) => {
      blobs.push(blob);
      return "blob:silence";
    });
    FakeAudioElement.created = [];
    installFakeAudio();
    const IosSoundEngine = await loadOnIos();
    const sound = new IosSoundEngine();
    sound.unlock();
    const [element] = FakeAudioElement.created;
    expect(element.src).toBe("blob:silence");
    expect(element.loop).toBe(true);
    expect(element.attributes).toEqual({ playsinline: "" });
    expect(element.plays).toBe(1);
    expect(blobs[0].type).toBe("audio/wav");
    expect(blobs[0].size).toBe(4044);
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    expect(String.fromCharCode(...bytes.subarray(0, 4), ...bytes.subarray(8, 16))).toBe("RIFFWAVEfmt ");
    expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(8000);
    expect(bytes.subarray(44).every((b) => b === 128)).toBe(true);
    // already playing: no second play(), and the element is reused
    sound.unlock();
    expect(element.plays).toBe(1);
    sound.setEnabled(false);
    expect(element.pauses).toBe(1);
    sound.setEnabled(true);
    expect(FakeAudioElement.created).toHaveLength(1);
    expect(element.plays).toBe(2);
  });

  it("treats touch Macs (iPadOS) as iOS", async () => {
    vi.resetModules();
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
    Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true });
    let IpadSoundEngine: typeof SoundEngine;
    try {
      IpadSoundEngine = (await import("../../../src/engine/audio/SoundEngine")).SoundEngine;
    } finally {
      Reflect.deleteProperty(navigator, "platform");
      Reflect.deleteProperty(navigator, "maxTouchPoints");
    }
    FakeAudioElement.created = [];
    vi.stubGlobal("Audio", FakeAudioElement);
    stubObjectUrl(() => "blob:ipad");
    new IpadSoundEngine().setEnabled(true);
    expect(FakeAudioElement.created).toHaveLength(1);
  });

  it("does nothing on disable before any element exists, and survives a broken Audio", async () => {
    vi.stubGlobal("Audio", function BrokenAudio() {
      throw new Error("no media");
    });
    stubObjectUrl(() => "blob:x");
    const IosSoundEngine = await loadOnIos();
    const sound = new IosSoundEngine();
    expect(() => sound.setEnabled(false)).not.toThrow();
    expect(() => sound.setEnabled(true)).not.toThrow();
    expect(sound.silentEl).toBeNull();
  });
});
