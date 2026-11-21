import * as THREE from "three";

/** One recorded renderer call; `target` is the render target bound when the call was made. */
export type RendererCall =
  | { op: "setRenderTarget"; target: THREE.WebGLRenderTarget | null }
  | { op: "clear"; target: THREE.WebGLRenderTarget | null }
  | { op: "render"; scene: THREE.Object3D; camera: THREE.Camera; target: THREE.WebGLRenderTarget | null }
  | { op: "compileAsync"; scene: THREE.Object3D; camera: THREE.Camera; target: THREE.WebGLRenderTarget | null }
  | { op: "setClearColor"; color: number; alpha: number };

export interface FakeRendererOptions {
  /** Omit compileAsync entirely (older three versions). */
  noCompileAsync?: boolean;
  /** Make compileAsync reject. */
  compileFails?: boolean;
  maxAnisotropy?: number;
  /** Called inside every render(), e.g. to inspect uniforms while a pass is drawn. */
  onRender?: (scene: THREE.Object3D, camera: THREE.Camera, target: THREE.WebGLRenderTarget | null) => void;
}

/**
 * Stand-in for THREE.WebGLRenderer: implements the subset the stage and the water code call and records it.
 * No GL context exists; render targets are plain objects.
 */
export class FakeRenderer {
  calls: RendererCall[] = [];
  target: THREE.WebGLRenderTarget | null = null;
  clearColor = new THREE.Color(0xf2eef3);
  clearAlpha = 1;
  autoClear = true;
  readonly capabilities: { isWebGL2: boolean; maxTextures: number; precision: string; getMaxAnisotropy(): number };
  readonly extensions = { has: (_name: string): boolean => true, get: (_name: string): null => null };
  readonly domElement: { width: number; height: number };
  compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera) => Promise<THREE.Object3D>;
  private readonly options: FakeRendererOptions;

  constructor(options: FakeRendererOptions = {}) {
    this.options = options;
    const maxAnisotropy = options.maxAnisotropy ?? 16;
    this.capabilities = { isWebGL2: true, maxTextures: 16, precision: "highp", getMaxAnisotropy: () => maxAnisotropy };
    this.domElement = { width: 300, height: 150 };
    if (!options.noCompileAsync) {
      this.compileAsync = (scene, camera) => {
        this.calls.push({ op: "compileAsync", scene, camera, target: this.target });
        return options.compileFails ? Promise.reject(new Error("compile failed")) : Promise.resolve(scene);
      };
    }
  }

  /** The fake typed as the real renderer, for passing to code under test. */
  get asRenderer(): THREE.WebGLRenderer {
    return this as unknown as THREE.WebGLRenderer;
  }

  setRenderTarget(target: THREE.WebGLRenderTarget | null): void {
    this.target = target;
    this.calls.push({ op: "setRenderTarget", target });
  }

  getRenderTarget(): THREE.WebGLRenderTarget | null {
    return this.target;
  }

  clear(): void {
    this.calls.push({ op: "clear", target: this.target });
  }

  render(scene: THREE.Object3D, camera: THREE.Camera): void {
    this.calls.push({ op: "render", scene, camera, target: this.target });
    this.options.onRender?.(scene, camera, this.target);
  }

  compile(scene: THREE.Object3D): Set<THREE.Material> {
    const materials = new Set<THREE.Material>();
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        materials.add(object.material);
      }
    });
    return materials;
  }

  getClearColor(target: THREE.Color): THREE.Color {
    return target.copy(this.clearColor);
  }

  setClearColor(color: THREE.ColorRepresentation, alpha = 1): void {
    this.clearColor.set(color);
    this.clearAlpha = alpha;
    this.calls.push({ op: "setClearColor", color: this.clearColor.getHex(), alpha });
  }

  getClearAlpha(): number {
    return this.clearAlpha;
  }

  /** Set to play a lost WebGL context. */
  contextLost = false;

  getContext(): { isContextLost(): boolean } {
    return { isContextLost: () => this.contextLost };
  }

  getPixelRatio(): number {
    return 1;
  }

  readRenderTargetPixels(
    _target: THREE.WebGLRenderTarget,
    _x: number,
    _y: number,
    width: number,
    height: number,
    buffer: Uint8Array | Float32Array | Uint16Array,
  ): void {
    buffer.fill(0, 0, width * height * 4);
  }

  /** Recorded calls of one kind. */
  ops<K extends RendererCall["op"]>(op: K): Extract<RendererCall, { op: K }>[] {
    return this.calls.filter((call): call is Extract<RendererCall, { op: K }> => call.op === op);
  }

  reset(): void {
    this.calls.length = 0;
  }
}

/** Readable one-line-per-call log; objects are named through `names` (falls back to their type). */
export function describeCalls(calls: readonly RendererCall[], names: Map<object, string>): string[] {
  const nameOf = (object: object | null): string => {
    if (object === null) {
      return "screen";
    }
    const name = names.get(object);
    if (name) {
      return name;
    }
    if (object instanceof THREE.WebGLRenderTarget) {
      return `target(${object.width}x${object.height})`;
    }
    return object.constructor.name;
  };
  return calls.map((call) => {
    switch (call.op) {
      case "setRenderTarget":
        return `bind ${nameOf(call.target)}`;
      case "clear":
        return `clear ${nameOf(call.target)}`;
      case "render":
        return `render ${nameOf(call.scene)} with ${nameOf(call.camera)} -> ${nameOf(call.target)}`;
      case "compileAsync":
        return `compile ${nameOf(call.scene)} -> ${nameOf(call.target)}`;
      case "setClearColor":
        return `clearColor #${call.color.toString(16).padStart(6, "0")} ${call.alpha}`;
    }
  });
}
