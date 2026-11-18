/**
 * Development-only globals installed by boot() and installDevHooks(), and host-provided globals.
 */

export {};

declare global {
  interface Window {
    /** Debug handles for the console (dev builds only). */
    __app?: Record<string, unknown>;
    /** Captures the next rendered frame to the dev server; resolves when the upload settles. */
    __capture?: (shotName?: string) => Promise<unknown>;
    /** Steps the simulation by `seconds` at a fixed frame rate. */
    __advance?: (seconds: number, fps?: number) => void;
    /** Renders one frame and uploads it to the dev server. */
    __shot?: (shotName?: string) => Promise<Response>;
    /** Set by embedding hosts where downloads are unavailable. */
    claude?: unknown;
  }

  /** Forces the device pixel ratio in dev builds. */
  var __YUSI_DPR__: number | undefined;
}
