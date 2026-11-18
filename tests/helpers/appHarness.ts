/**
 * Boots the real app (React <App/> plus the engine controller) in jsdom on fakes: a recording WebGL renderer,
 * fake 2D canvases, fake audio, scripted media queries, a manual requestAnimationFrame and fake timers.
 *
 * Test files must mock three themselves (vi.mock is hoisted per file):
 *
 *   vi.mock("three", async (importOriginal) => ({
 *     ...(await importOriginal<typeof import("three")>()),
 *     WebGLRenderer: (await import("../../helpers/rendererHook")).WebGLRendererProxy,
 *   }));
 */
import { render } from "@testing-library/react";
import { createElement } from "react";
import * as THREE from "three";
import { vi } from "vitest";
import { App } from "../../src/App";
import { app } from "../../src/engine/app/runtime";
import { ui } from "../../src/state/ui";
import { digest } from "./digest";
import { installFakeAudio } from "./fakeAudio";
import { FakeContext2DWithSpacing } from "./fakeCanvas";
import { FakeRenderer } from "./fakeRenderer";
import { readModelBuffer } from "./model";
import { rendererHook } from "./rendererHook";

/** FakeRenderer plus the sizing API the app controller uses. */
export class AppRenderer extends FakeRenderer {
  readonly params: unknown;
  pixelRatio = 1;
  width = 0;
  height = 0;
  readonly sizes: [width: number, height: number, pixelRatio: number][] = [];

  constructor(params?: unknown) {
    super();
    this.params = params;
  }

  setPixelRatio(value: number): void {
    this.pixelRatio = value;
  }

  override getPixelRatio(): number {
    return this.pixelRatio;
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.sizes.push([width, height, this.pixelRatio]);
    // Like the real renderer with updateStyle = false: only the drawing buffer size changes.
    const canvas = (this.params as { canvas?: HTMLCanvasElement } | undefined)?.canvas;
    if (canvas) {
      canvas.width = Math.floor(width * this.pixelRatio);
      canvas.height = Math.floor(height * this.pixelRatio);
    }
  }

  getDrawingBufferSize(target: THREE.Vector2): THREE.Vector2 {
    return target.set(this.width * this.pixelRatio, this.height * this.pixelRatio).floor();
  }
}

/** Fake 2D context with the image calls used by photos and thumbnails. */
export class AppContext2D extends FakeContext2DWithSpacing {
  drawImage(image: HTMLCanvasElement, x: number, y: number): void {
    this.ops.push(["drawImage", image.id || image.tagName, x, y]);
  }
  createImageData(width: number, height: number): ImageData {
    return { data: new Uint8ClampedArray(width * height * 4), width, height, colorSpace: "srgb" } as ImageData;
  }
  putImageData(image: ImageData, x: number, y: number): void {
    this.ops.push(["putImageData", digest(image.data), x, y]);
  }
}

/** Media features the app queries; flip them and dispatch "resize" to re-run the layout. */
export interface MediaEnv {
  coarse: boolean;
  wide: boolean;
  roomy: boolean;
  fine: boolean;
  reducedMotion: boolean;
}

const QUERY_FEATURES: Record<string, keyof MediaEnv> = {
  "(pointer: coarse)": "coarse",
  "(min-aspect-ratio: 1/1) and (min-width: 600px)": "wide",
  "(min-width: 1000px) and (min-height: 600px)": "roomy",
  "(hover: hover) and (pointer: fine)": "fine",
  "(prefers-reduced-motion: reduce)": "reducedMotion",
};

export interface HarnessOptions {
  media?: Partial<MediaEnv>;
  /** Viewport (and #view canvas) size in CSS pixels. */
  view?: { w: number; h: number };
  screen?: { w: number; h: number };
  devicePixelRatio?: number;
  /** Hash set (without a hashchange) before boot. */
  hash?: string;
  /** Make the model fetch reject. */
  fetchFails?: boolean;
}

export interface Harness {
  renderer: AppRenderer;
  media: MediaEnv;
  view: { w: number; h: number };
  contexts: AppContext2D[];
  /** Every fetch, in order (kept across tests, unlike mock.calls which Vitest clears). */
  fetches: { url: string; init?: RequestInit }[];
  resizeCallbacks: ResizeObserverCallback[];
  /** Advances fake time by `ms`, then runs the pending animation frame at the new performance.now(). */
  frame(ms?: number): void;
  frames(count: number, ms?: number): void;
  /** Lets real async work (fetch bodies, promise chains) settle without moving fake time. */
  settle(): Promise<void>;
}

const macrotask = () => new Promise<void>((resolve) => setImmediate(resolve));

function installCanvas(contexts: AppContext2D[]): void {
  const byCanvas = new WeakMap<HTMLCanvasElement, AppContext2D>();
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: function getContext(this: HTMLCanvasElement, kind: string): AppContext2D | null {
      if (kind !== "2d") {
        return null;
      }
      let ctx = byCanvas.get(this);
      if (!ctx) {
        ctx = new AppContext2D(this);
        byCanvas.set(this, ctx);
        contexts.push(ctx);
      }
      return ctx;
    },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
    configurable: true,
    writable: true,
    value: function toDataURL(this: HTMLCanvasElement, type = "image/png", quality?: number): string {
      return `data:${type};fake,${this.id || "canvas"}:${this.width}x${this.height}` + (quality ? `@${quality}` : "");
    },
  });
}

function installViewport(view: { w: number; h: number }, screenSize: { w: number; h: number }, dpr: number): void {
  const isView = (el: Element) => el.id === "view";
  Object.defineProperty(HTMLCanvasElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLCanvasElement) {
      return isView(this) ? view.w : 0;
    },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLCanvasElement) {
      return isView(this) ? view.h : 0;
    },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value: function getBoundingClientRect(this: HTMLCanvasElement) {
      const w = isView(this) ? view.w : 0;
      const h = isView(this) ? view.h : 0;
      return new DOMRect(0, 0, w, h);
    },
  });
  Object.defineProperty(window, "innerWidth", { configurable: true, get: () => view.w });
  Object.defineProperty(window, "innerHeight", { configurable: true, get: () => view.h });
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: dpr });
  Object.defineProperty(window.screen, "width", { configurable: true, value: screenSize.w });
  Object.defineProperty(window.screen, "height", { configurable: true, value: screenSize.h });
}

/** Places an element for the inset math (jsdom has no layout). */
export function placeElement(selector: string, offsetLeft: number, offsetWidth: number): void {
  const el = document.querySelector(selector);
  if (!el) {
    throw new Error(`no element ${selector}`);
  }
  Object.defineProperty(el, "offsetLeft", { configurable: true, value: offsetLeft });
  Object.defineProperty(el, "offsetWidth", { configurable: true, value: offsetWidth });
}

export async function bootApp(options: HarnessOptions = {}): Promise<Harness> {
  const media: MediaEnv = {
    coarse: false,
    wide: true,
    roomy: false,
    fine: true,
    reducedMotion: false,
    ...options.media,
  };
  const view = { ...(options.view ?? { w: 1280, h: 800 }) };
  const contexts: AppContext2D[] = [];
  const resizeCallbacks: ResizeObserverCallback[] = [];
  const rafQueue: FrameRequestCallback[] = [];
  let renderer: AppRenderer | null = null;

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  installCanvas(contexts);
  installViewport(view, options.screen ?? { w: 1920, h: 1080 }, options.devicePixelRatio ?? 2);
  installFakeAudio();
  // jsdom has no scrolling; the wardrobe tab bar scrolls the selected tab into view.
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("matchMedia", (query: string) => {
    const feature = QUERY_FEATURES[query];
    return {
      media: query,
      get matches() {
        return feature ? media[feature] : false;
      },
      addEventListener() {},
      removeEventListener() {},
    };
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => rafQueue.push(callback));
  const fetches: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit): Promise<Response> => {
    fetches.push({ url, init });
    if (url.endsWith(".glb")) {
      if (options.fetchFails) {
        throw new Error("network down");
      }
      return new Response(readModelBuffer());
    }
    return new Response("ok");
  });
  rendererHook.create = (params) => (renderer = new AppRenderer(params));
  if (options.hash) {
    history.replaceState(null, "", options.hash);
  }

  render(createElement(App));
  // Later store updates re-render outside act(); React then flushes them on its own scheduler.
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  for (let i = 0; i < 500 && !app.uiBound && ui.get().bootError === null; i++) {
    await macrotask();
  }
  if (!renderer) {
    throw new Error("the app did not create a renderer");
  }
  const created: AppRenderer = renderer;

  const runFrame = (ms = 1000 / 60) => {
    vi.advanceTimersByTime(ms);
    const callbacks = rafQueue.splice(0);
    for (const callback of callbacks) {
      callback(performance.now());
    }
  };
  return {
    renderer: created,
    media,
    view,
    contexts,
    fetches,
    resizeCallbacks,
    frame: runFrame,
    frames(count, ms) {
      for (let i = 0; i < count; i++) {
        runFrame(ms);
      }
    },
    async settle() {
      for (let i = 0; i < 5; i++) {
        await macrotask();
      }
    },
  };
}

/** The 2D context the app created for `canvas` (or undefined). */
export function contextOf(harness: Harness, canvas: HTMLCanvasElement): AppContext2D | undefined {
  return harness.contexts.find((ctx) => ctx.canvas === canvas);
}

export interface PointerInit {
  id?: number;
  x: number;
  y: number;
  button?: number;
}

/** Dispatches a pointer event on the #view canvas (jsdom lacks PointerEvent, so a MouseEvent carries pointerId). */
export function pointer(type: string, { id = 1, x, y, button = 0 }: PointerInit): void {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button });
  Object.defineProperty(ev, "pointerId", { value: id });
  app.canvas.dispatchEvent(ev);
}

export function key(keyName: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}
