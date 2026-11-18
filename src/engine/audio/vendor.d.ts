/** Vendor-prefixed and not-yet-standard audio globals. */

interface WebkitAudioSession {
  type: "auto" | "playback" | "transient" | "transient-solo" | "ambient" | "play-and-record";
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
  interface Navigator {
    /** Audio Session API (Safari). */
    audioSession?: WebkitAudioSession;
  }
}

export {};
