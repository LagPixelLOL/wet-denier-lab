import { vi } from "vitest";
import { digest } from "./digest";

/** One recorded 2D context operation: a method call or a property assignment ("prop=value"). */
export type CanvasOp = [name: string, ...args: (number | string)[]];

/** The part of a canvas element the fake context and the code under test touch. */
export interface CanvasLike {
  width: number;
  height: number;
}

/**
 * Minimal CanvasRenderingContext2D stand-in (jsdom has no canvas backend). Records every call and
 * property set; getImageData returns bytes derived from the recorded ops, so a change in what is drawn
 * changes the pixels deterministically.
 */
export class FakeContext2D {
  readonly ops: CanvasOp[] = [];
  readonly canvas: CanvasLike;
  private state: Record<string, string | number> = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    lineCap: "butt",
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
  };

  constructor(canvas: CanvasLike) {
    this.canvas = canvas;
  }

  protected setProp(name: string, value: string | number): void {
    this.state[name] = value;
    this.ops.push([`${name}=`, value]);
  }

  protected getProp(name: string): string | number {
    return this.state[name];
  }

  get fillStyle(): string | number {
    return this.getProp("fillStyle");
  }
  set fillStyle(value: string | number) {
    this.setProp("fillStyle", value);
  }
  get strokeStyle(): string | number {
    return this.getProp("strokeStyle");
  }
  set strokeStyle(value: string | number) {
    this.setProp("strokeStyle", value);
  }
  get lineWidth(): string | number {
    return this.getProp("lineWidth");
  }
  set lineWidth(value: string | number) {
    this.setProp("lineWidth", value);
  }
  get lineCap(): string | number {
    return this.getProp("lineCap");
  }
  set lineCap(value: string | number) {
    this.setProp("lineCap", value);
  }
  get font(): string | number {
    return this.getProp("font");
  }
  set font(value: string | number) {
    this.setProp("font", value);
  }
  get textAlign(): string | number {
    return this.getProp("textAlign");
  }
  set textAlign(value: string | number) {
    this.setProp("textAlign", value);
  }
  get textBaseline(): string | number {
    return this.getProp("textBaseline");
  }
  set textBaseline(value: string | number) {
    this.setProp("textBaseline", value);
  }

  private record(name: string, args: (number | string)[]): void {
    this.ops.push([name, ...args]);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.record("fillRect", [x, y, w, h]);
  }
  beginPath(): void {
    this.record("beginPath", []);
  }
  closePath(): void {
    this.record("closePath", []);
  }
  moveTo(x: number, y: number): void {
    this.record("moveTo", [x, y]);
  }
  lineTo(x: number, y: number): void {
    this.record("lineTo", [x, y]);
  }
  bezierCurveTo(...args: number[]): void {
    this.record("bezierCurveTo", args);
  }
  ellipse(...args: number[]): void {
    this.record("ellipse", args);
  }
  stroke(): void {
    this.record("stroke", []);
  }
  fill(): void {
    this.record("fill", []);
  }
  save(): void {
    this.record("save", []);
  }
  restore(): void {
    this.record("restore", []);
  }
  translate(x: number, y: number): void {
    this.record("translate", [x, y]);
  }
  fillText(text: string, x: number, y: number): void {
    this.record("fillText", [text, x, y]);
  }

  /** Digest of everything drawn so far. */
  get opsDigest(): string {
    return digest(new TextEncoder().encode(JSON.stringify(this.ops)));
  }

  getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray; width: number; height: number } {
    this.record("getImageData", [x, y, width, height]);
    let state = parseInt(this.opsDigest, 16) >>> 0;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      data[i] = state >>> 24;
    }
    return { data, width, height };
  }
}

/** Same, plus the newer `letterSpacing` property. */
export class FakeContext2DWithSpacing extends FakeContext2D {
  get letterSpacing(): string | number {
    return this.getProp("letterSpacing") ?? "0px";
  }
  set letterSpacing(value: string | number) {
    this.setProp("letterSpacing", value);
  }
}

export interface FakeCanvasInstall {
  /** Contexts in creation order. */
  contexts: FakeContext2D[];
  restore(): void;
}

/** Patches HTMLCanvasElement.prototype.getContext (jsdom) to hand out fake 2D contexts. */
export function installFakeCanvas({ letterSpacing = true }: { letterSpacing?: boolean } = {}): FakeCanvasInstall {
  const proto = HTMLCanvasElement.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, "getContext");
  const contexts: FakeContext2D[] = [];
  const byCanvas = new WeakMap<HTMLCanvasElement, FakeContext2D>();
  Object.defineProperty(proto, "getContext", {
    configurable: true,
    writable: true,
    value: function getContext(this: HTMLCanvasElement, kind: string): FakeContext2D | null {
      if (kind !== "2d") {
        return null;
      }
      let ctx = byCanvas.get(this);
      if (!ctx) {
        ctx = letterSpacing ? new FakeContext2DWithSpacing(this) : new FakeContext2D(this);
        byCanvas.set(this, ctx);
        contexts.push(ctx);
      }
      return ctx;
    },
  });
  return {
    contexts,
    restore() {
      if (original) {
        Object.defineProperty(proto, "getContext", original);
      }
    },
  };
}

/** A detached fake canvas element for environments without a DOM. */
export class FakeCanvasElement implements CanvasLike {
  width = 300;
  height = 150;
  private context: FakeContext2D | null = null;
  private readonly onContext: (ctx: FakeContext2D) => void;
  constructor(onContext: (ctx: FakeContext2D) => void) {
    this.onContext = onContext;
  }
  getContext(kind: string): FakeContext2D | null {
    if (kind !== "2d") {
      return null;
    }
    if (!this.context) {
      this.context = new FakeContext2DWithSpacing(this);
      this.onContext(this.context);
    }
    return this.context;
  }
}

/**
 * For node test files: stubs a global `document` whose createElement("canvas") returns FakeCanvasElement,
 * and a `matchMedia`. Undo with vi.unstubAllGlobals().
 */
export function installFakeDocument({ coarsePointer = false } = {}): { contexts: FakeContext2D[] } {
  const contexts: FakeContext2D[] = [];
  vi.stubGlobal("document", {
    createElement(tag: string) {
      if (tag !== "canvas") {
        throw new Error(`fake document cannot create <${tag}>`);
      }
      return new FakeCanvasElement((ctx) => contexts.push(ctx));
    },
  });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: coarsePointer && query === "(pointer: coarse)", media: query }));
  return { contexts };
}
