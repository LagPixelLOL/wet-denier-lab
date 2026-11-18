/**
 * All sound is synthesized with WebAudio: splashes, drips, rain, scene ambience and reverb.
 */

const IS_IOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function createSilentWavUrl() {
  const buffer = new ArrayBuffer(4044);
  const view = new DataView(buffer);
  const writeAscii = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 4036, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeAscii(36, "data");
  view.setUint32(40, 4000, true);
  new Uint8Array(buffer, 44).fill(128);
  return URL.createObjectURL(
    new Blob([buffer], {
      type: "audio/wav",
    }),
  );
}

const randRange = (min, max) => min + Math.random() * (max - min);

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.lastSplash = -1;
    this.lastEnergy = 0;
    this.lastDrip = -1;
    this.silentEl = null;
    this.scene = "studio";
    this.raining = false;
    this.beds = null;
    this.dripTimer = 0;
    this.seed = 12345;
  }
  get running() {
    return !!this.ctx && this.ctx.state === "running";
  }
  _session(active) {
    try {
      if (navigator.audioSession) {
        navigator.audioSession.type = active ? "playback" : "auto";
      }
    } catch {}
    if (!!IS_IOS && !navigator.audioSession) {
      try {
        if (active) {
          if (!this.silentEl) {
            this.silentEl = new Audio(createSilentWavUrl());
            this.silentEl.loop = true;
            this.silentEl.setAttribute("playsinline", "");
          }
          if (this.silentEl.paused) {
            this.silentEl.play().catch(() => {});
          }
        } else if (this.silentEl) {
          this.silentEl.pause();
        }
      } catch {}
    }
  }
  unlock() {
    if (this.enabled) {
      this._session(true);
    }
    if (!this.ctx) {
      this._create();
    }
    if (!!this.ctx && this.ctx.state !== "running") {
      this.ctx.resume().catch(() => {});
      try {
        const src = this.ctx.createBufferSource();
        src.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
        src.connect(this.ctx.destination);
        src.start(0);
      } catch {}
    }
  }
  _create(existingCtx) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor && !existingCtx) {
      return;
    }
    const ctx = (this.ctx = existingCtx || new AudioCtor());
    const sampleRate = ctx.sampleRate;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.12;
    this.master.connect(compressor).connect(ctx.destination);
    const length = Math.floor(sampleRate * 2);
    this.noise = ctx.createBuffer(1, length, sampleRate);
    const noiseData = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) {
      noiseData[i] = Math.random() * 2 - 1;
    }
    this.dust = ctx.createBuffer(1, length, sampleRate);
    const dustData = this.dust.getChannelData(0);
    for (let i = 0; i < length; i++) {
      if (Math.random() < 1100 / sampleRate) {
        const amp = (Math.random() < 0.5 ? -1 : 1) * Math.pow(Math.random(), 1.8);
        const damping = 0.55 + Math.random() * 0.3;
        for (let j = 0, v = amp; j < 40 && i + j < length; j++, v *= -damping) {
          dustData[i + j] += v;
        }
      }
    }
    this.verb = null;
    try {
      const irLength = Math.floor(sampleRate * 0.9);
      const impulse = ctx.createBuffer(2, irLength, sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const data = impulse.getChannelData(ch);
        let smooth = 0;
        for (let i = 0; i < irLength; i++) {
          const t = i / sampleRate;
          const lowpassAmt = 0.25 + Math.min(1, t / 0.6) * 0.7;
          smooth += (Math.random() * 2 - 1 - smooth) * (1 - lowpassAmt);
          data[i] = t < 0.007 ? 0 : smooth * Math.exp(-t / 0.22) * 0.9;
        }
      }
      this.verb = ctx.createConvolver();
      this.verb.normalize = true;
      this.verb.buffer = impulse;
      this.verbIn = ctx.createGain();
      this.verbIn.gain.value = 0.2;
      this.verbIn.connect(this.verb).connect(this.master);
    } catch {
      this.verb = null;
    }
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    const hissSrc = ctx.createBufferSource();
    hissSrc.buffer = this.noise;
    hissSrc.loop = true;
    const hissHighpass = ctx.createBiquadFilter();
    hissHighpass.type = "highpass";
    hissHighpass.frequency.value = 1800;
    const hissLowpass = ctx.createBiquadFilter();
    hissLowpass.type = "lowpass";
    hissLowpass.frequency.value = 7000;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.55;
    hissSrc.connect(hissHighpass).connect(hissLowpass).connect(hissGain).connect(this.rainGain);
    const patterSrc = ctx.createBufferSource();
    patterSrc.buffer = this.dust;
    patterSrc.loop = true;
    patterSrc.playbackRate.value = 0.85;
    const patterBandpass = ctx.createBiquadFilter();
    patterBandpass.type = "bandpass";
    patterBandpass.frequency.value = 3200;
    patterBandpass.Q.value = 0.5;
    patterSrc.connect(patterBandpass).connect(this.rainGain);
    this.rainGain.connect(this.master);
    if (this.verbIn) {
      this.rainGain.connect(this.verbIn);
    }
    hissSrc.start();
    patterSrc.start();
    const makeBed = (buf, filterType, freq, q, rate = 1) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = rate;
      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      return gain;
    };
    const addLfo = (target, freq, depth) => {
      const osc = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      osc.frequency.value = freq;
      lfoGain.gain.value = depth;
      osc.connect(lfoGain).connect(target.gain);
      osc.start();
    };
    this.beds = {
      street: makeBed(this.noise, "lowpass", 170, 0.4, 0.5),
      pool: makeBed(this.noise, "bandpass", 620, 0.8, 0.7),
      bath: makeBed(this.noise, "bandpass", 240, 0.5, 0.6),
    };
    this.bedSwell = {
      street: ctx.createGain(),
      pool: ctx.createGain(),
    };
    for (const key of ["street", "pool"]) {
      this.beds[key].disconnect();
      this.beds[key].connect(this.bedSwell[key]).connect(this.master);
      this.bedSwell[key].gain.value = 0.6;
    }
    addLfo(this.bedSwell.street, 0.07, 0.3);
    addLfo(this.bedSwell.pool, 0.23, 0.4);
    this.setScene(this.scene);
  }
  setScene(sceneName) {
    this.scene = sceneName;
    clearTimeout(this.dripTimer);
    if (!this.ctx) {
      return;
    }
    const now = this.ctx.currentTime;
    const bedLevels = {
      street: 0.05,
      pool: 0.035,
      bath: 0.012,
    };
    for (const key of Object.keys(this.beds)) {
      this.beds[key].gain.setTargetAtTime(key === sceneName ? bedLevels[key] : 0, now, 0.6);
    }
    if (this.verbIn) {
      this.verbIn.gain.setTargetAtTime(sceneName === "bath" ? 0.5 : sceneName === "street" ? 0.12 : 0.2, now, 0.3);
    }
    this.setRain(this.raining);
    if (sceneName === "bath") {
      this._tapDrip();
    }
  }
  _rand() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 8) / 16777216;
  }
  _tapDrip() {
    this.dripTimer = setTimeout(
      () => {
        if (this.scene === "bath") {
          if (this.running && this.enabled && !document.hidden) {
            const t = this.ctx.currentTime + 0.01;
            const voice = this._voice(-0.35, 1.6);
            const freq = 700 + this._rand() * 500;
            this._bloop(voice, t, freq, 0.045, 0.07);
            if (this._rand() < 0.5) {
              this._bloop(voice, t + 0.09 + this._rand() * 0.05, freq * 1.3, 0.02, 0.05);
            }
          }
          this._tapDrip();
        }
      },
      2600 + this._rand() * 4200,
    );
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    this._session(enabled);
    if (this.master) {
      this.master.gain.setTargetAtTime(enabled ? 0.9 : 0, this.ctx.currentTime, 0.05);
    }
  }
  setRain(raining) {
    this.raining = raining;
    if (this.ctx) {
      this.rainGain.gain.setTargetAtTime(
        raining ? (this.scene === "bath" ? 0.11 : 0.075) : 0,
        this.ctx.currentTime,
        0.4,
      );
    }
  }
  _voice(pan, reverbSend = 1) {
    const ctx = this.ctx;
    const input = ctx.createGain();
    let output = input;
    if (ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-0.8, Math.min(0.8, pan));
      input.connect(panner);
      output = panner;
    }
    output.connect(this.master);
    if (this.verbIn && reverbSend > 0) {
      if (reverbSend === 1) {
        output.connect(this.verbIn);
      } else {
        const sendGain = ctx.createGain();
        sendGain.gain.value = reverbSend;
        output.connect(sendGain).connect(this.verbIn);
      }
    }
    return input;
  }
  _env(gainNode, t, peak, attack, decay) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(peak, t + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }
  _burst(
    dest,
    t,
    { buf: buf, type = "bandpass", freq: freq, q = 0.7, gain: gain, attack = 0.002, decay: decay, lp = 0 },
  ) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf || this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const amp = ctx.createGain();
    this._env(amp, t, gain, attack, decay);
    let chain = src.connect(filter);
    if (lp) {
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = lp;
      chain = chain.connect(lowpass);
    }
    chain.connect(amp).connect(dest);
    src.start(t, Math.random() * 1.5, attack + decay + 0.05);
  }
  _bloop(dest, t, freq, peak, dur) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * randRange(1.45, 1.9), t + dur);
    this._env(amp, t, peak, 0.003, dur);
    osc.connect(amp).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }
  _thump(dest, t, peak) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(randRange(150, 190), t);
    osc.frequency.exponentialRampToValueAtTime(62, t + 0.09);
    this._env(amp, t, peak, 0.004, 0.1);
    osc.connect(amp).connect(dest);
    osc.start(t);
    osc.stop(t + 0.14);
  }
  splash(energy, pan = 0) {
    if (!this.ctx || !this.enabled) {
      return;
    }
    const now = this.ctx.currentTime;
    const isSurge = energy > 0.15 && energy > this.lastEnergy * 3;
    if (now - this.lastSplash < 0.05 && !isSurge) {
      return;
    }
    const isFresh = isSurge || now - this.lastSplash > 0.35;
    this.lastSplash = now;
    this.lastEnergy = energy;
    const intensity = Math.min(1, energy) * (isFresh ? 1 : 0.7);
    const t = now + 0.004;
    const voice = this._voice(pan + randRange(-0.08, 0.08));
    this._burst(voice, t, {
      freq: randRange(650, 1050),
      q: 0.8,
      gain: 0.16 + intensity * 0.38,
      attack: 0.0015,
      decay: 0.05 + intensity * 0.1,
      lp: 4200,
    });
    this._burst(voice, t + 0.002, {
      type: "highpass",
      freq: 2600,
      q: 0.5,
      gain: 0.05 + intensity * 0.12,
      attack: 0.001,
      decay: 0.03 + intensity * 0.04,
    });
    if (intensity > 0.18) {
      this._thump(voice, t, 0.08 + intensity * 0.22);
    }
    this._burst(voice, t + 0.006, {
      buf: this.dust,
      type: "highpass",
      freq: randRange(1900, 2600),
      q: 0.6,
      gain: 0.12 + intensity * 0.5,
      attack: 0.008,
      decay: 0.12 + intensity * 0.32,
    });
    const bubbleCount = Math.min(6, 1 + Math.floor(intensity * 5 + Math.random()));
    for (let i = 0; i < bubbleCount; i++) {
      const freq = randRange(480, 1500) * (1.15 - intensity * 0.35 * Math.random());
      this._bloop(
        voice,
        t + 0.012 + Math.pow(Math.random(), 1.6) * (0.06 + intensity * 0.16),
        freq,
        randRange(0.025, 0.05) + intensity * 0.035,
        randRange(0.035, 0.09),
      );
    }
    if (intensity > 0.12) {
      this._burst(voice, t + 0.03, {
        freq: randRange(5500, 7500),
        q: 0.6,
        gain: 0.02 + intensity * 0.05,
        attack: 0.05,
        decay: 0.35 + intensity * 0.5,
      });
    }
  }
  drip(size = 0.5, pan = 0) {
    if (!this.ctx || !this.enabled) {
      return;
    }
    const now = this.ctx.currentTime;
    if (now - this.lastDrip < 0.06) {
      return;
    }
    this.lastDrip = now;
    const t = now + 0.003;
    const voice = this._voice(pan, 1.4);
    this._burst(voice, t, {
      type: "highpass",
      freq: 2400,
      q: 0.7,
      gain: 0.025 + size * 0.04,
      attack: 0.001,
      decay: 0.025,
    });
    this._bloop(voice, t + 0.004, randRange(900, 1900) - size * 300, 0.035 + size * 0.05, randRange(0.05, 0.1));
    if (Math.random() < 0.35) {
      this._bloop(voice, t + randRange(0.02, 0.07), randRange(1400, 2600), 0.015 + size * 0.02, 0.04);
    }
  }
}
