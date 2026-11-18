/**
 * GPU wetness simulation in the stocking UV atlas. Bakes texel world positions and downhill flow, then
 * ping-pongs R = soaked water, G = running surface film, B = fresh-hit highlight (flow, soak, wick, dry).
 */
import * as THREE from "three";
import {
  WET_BAKE_FRAGMENT_SHADER,
  WET_BAKE_VERTEX_SHADER,
  WET_QUAD_VERTEX_SHADER,
  WET_STAMP_FRAGMENT_SHADER,
  WET_STAMP_VERTEX_SHADER,
  WET_UPDATE_FRAGMENT_SHADER,
} from "./shaders/wet";
import type { MaterialWater } from "../catalog/garments";
import type { SurfaceGrid, UvRect } from "../surface/SurfaceGrid";

/** The per-leg stage data WetMap reads: skinning uniforms and the leg group matrix. */
export interface WetMapLeg {
  rig: Record<string, THREE.IUniform>;
  matrix: THREE.Matrix4;
}

/** Pixel scissor box in the atlas: x, y, width, height. */
export type WetBox = [number, number, number, number];

/** Instanced stamp attribute names. */
export type WetStampAttr = "aRect" | "aA" | "aB" | "aAmt";

type WetFilter = typeof THREE.NearestFilter | typeof THREE.LinearFilter;

export class WetMap {
  declare renderer: THREE.WebGLRenderer;
  declare surface: SurfaceGrid;
  declare size: number;
  declare legCount: number;
  declare width: number;
  declare height: number;
  /** Baked texel world positions. */
  declare posRT: THREE.WebGLRenderTarget;
  /** Baked downhill flow, half resolution. */
  declare flowRT: THREE.WebGLRenderTarget;
  /** Current wetness (read). */
  declare a: THREE.WebGLRenderTarget;
  /** Next wetness (write). */
  declare b: THREE.WebGLRenderTarget;
  declare cam: THREE.OrthographicCamera;
  declare bakeShared: { uBakeMode: THREE.IUniform<number>; uBakeSize: THREE.IUniform<number> };
  declare bakeScene: THREE.Scene;
  declare bakeMeshes: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[];
  declare updateMat: THREE.ShaderMaterial;
  declare quadScene: THREE.Scene;
  declare maxStamps: number;
  declare attr: Record<string, THREE.InstancedBufferAttribute>;
  declare stampGeo: THREE.InstancedBufferGeometry;
  declare stampMat: THREE.ShaderMaterial;
  declare stampScene: THREE.Scene;
  /** Stamps queued for the next update. */
  declare count: number;
  /** Per-leg soak multiplier. */
  declare take: number[];
  /** Upper bound on remaining wetness; the update is skipped once it reaches zero. */
  declare wetBound: number;
  declare boxes: WetBox[];
  declare _rects: UvRect[];
  declare padU: number;
  declare padV: number;
  constructor(
    renderer: THREE.WebGLRenderer,
    geometry: THREE.BufferGeometry,
    surface: SurfaceGrid,
    size: number,
    legs: readonly WetMapLeg[],
  ) {
    this.renderer = renderer;
    this.surface = surface;
    this.size = size;
    const legCount = (this.legCount = legs.length);
    const width = (this.width = size * legCount);
    const height = (this.height = size);
    const makeTarget = (filter: WetFilter, w = width, h = height) =>
      new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        minFilter: filter,
        magFilter: filter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
      });
    this.posRT = makeTarget(THREE.NearestFilter);
    this.flowRT = makeTarget(THREE.LinearFilter, width / 2, height / 2);
    this.a = makeTarget(THREE.LinearFilter);
    this.b = makeTarget(THREE.LinearFilter);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.bakeShared = {
      uBakeMode: {
        value: 0,
      },
      uBakeSize: {
        value: size,
      },
    };
    this.bakeScene = new THREE.Scene();
    this.bakeMeshes = legs.map((leg, legIndex) => {
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.ShaderMaterial({
          vertexShader: WET_BAKE_VERTEX_SHADER,
          fragmentShader: WET_BAKE_FRAGMENT_SHADER,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
          uniforms: {
            ...this.bakeShared,
            ...leg.rig,
            uBakeSlot: {
              value: new THREE.Vector2(1 / legCount, legIndex / legCount),
            },
          },
        }),
      );
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.userData.source = leg.matrix;
      this.bakeScene.add(mesh);
      return mesh;
    });
    this.updateMat = new THREE.ShaderMaterial({
      vertexShader: WET_QUAD_VERTEX_SHADER,
      fragmentShader: WET_UPDATE_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uWetPrev: {
          value: null,
        },
        uPosMap: {
          value: this.posRT.texture,
        },
        uFlowMap: {
          value: this.flowRT.texture,
        },
        uTexel: {
          value: new THREE.Vector2(1 / width, 1 / height),
        },
        uAtlasScale: {
          value: new THREE.Vector2(1 / legCount, 1),
        },
        uDt: {
          value: 0,
        },
        uDryRate: {
          value: 1 / 70,
        },
        uAbsorbRate: {
          value: 0.22,
        },
        uFlowSpeed: {
          value: 0.05,
        },
        uWickRate: {
          value: (size / 1024) * 2.2,
        },
        uLegWater: {
          value: [new THREE.Vector4(1, 1, 0, 0), new THREE.Vector4(1, 1, 0, 0)],
        },
      },
    });
    this.quadScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.updateMat);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
    this.maxStamps = 768;
    const stampGeo = new THREE.InstancedBufferGeometry();
    stampGeo.index = new THREE.PlaneGeometry(2, 2).index;
    stampGeo.setAttribute("position", new THREE.PlaneGeometry(2, 2).attributes.position);
    this.attr = {};
    for (const attrName of ["aRect", "aA", "aB", "aAmt"]) {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(this.maxStamps * 4), 4);
      attr.setUsage(THREE.DynamicDrawUsage);
      stampGeo.setAttribute(attrName, attr);
      this.attr[attrName] = attr;
    }
    stampGeo.instanceCount = 0;
    this.stampGeo = stampGeo;
    this.stampMat = new THREE.ShaderMaterial({
      vertexShader: WET_STAMP_VERTEX_SHADER,
      fragmentShader: WET_STAMP_FRAGMENT_SHADER,
      uniforms: {
        uPosMap: {
          value: this.posRT.texture,
        },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    this.stampScene = new THREE.Scene();
    const stampMesh = new THREE.Mesh(stampGeo, this.stampMat);
    stampMesh.frustumCulled = false;
    this.stampScene.add(stampMesh);
    this.count = 0;
    this.take = [1, 1];
    this.wetBound = 0;
    this.boxes = legs.map((_leg, legIndex): WetBox => {
      let minU = 1;
      let minV = 1;
      let maxU = 0;
      let maxV = 0;
      const triUV = surface.triUV;
      const triStart = legIndex === 0 ? 0 : surface.legTris;
      const triEnd = legIndex === 0 ? Math.min(surface.triCount, surface.legTris) : surface.triCount;
      for (let tri = triStart; tri < triEnd; tri++) {
        minU = Math.min(minU, triUV[tri * 4]);
        minV = Math.min(minV, triUV[tri * 4 + 1]);
        maxU = Math.max(maxU, triUV[tri * 4 + 2]);
        maxV = Math.max(maxV, triUV[tri * 4 + 3]);
      }
      const x0 = Math.max(0, Math.floor(minU * width) - 6);
      const y0 = Math.max(0, Math.floor(minV * height) - 6);
      return [
        x0,
        y0,
        Math.min(width, Math.ceil(maxU * width) + 6) - x0,
        Math.min(height, Math.ceil(maxV * height) + 6) - y0,
      ];
    });
    this._rects = [];
    this.padU = 3 / width;
    this.padV = 3 / height;
    const prevClearColor = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0, 0);
    for (const target of [this.a, this.b]) {
      renderer.setRenderTarget(target);
      renderer.clear();
    }
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    this.bake();
  }
  get texture(): THREE.Texture {
    return this.a.texture;
  }
  setLegWater(legIndex: number, water: MaterialWater): void {
    this.updateMat.uniforms.uLegWater.value[legIndex].set(water.soak, water.wick, water.shed || 0, 0);
    this.take[legIndex] = water.take;
  }
  bake(withFlow = true): void {
    const renderer = this.renderer;
    for (const mesh of this.bakeMeshes) {
      mesh.matrix.copy(mesh.userData.source);
      mesh.matrixWorldNeedsUpdate = true;
    }
    const prevClearColor = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0, 0);
    this.bakeShared.uBakeMode.value = 0;
    renderer.setRenderTarget(this.posRT);
    renderer.clear();
    renderer.render(this.bakeScene, this.cam);
    if (withFlow) {
      this.bakeShared.uBakeMode.value = 1;
      this.bakeShared.uBakeSize.value = this.size / 2;
      renderer.setRenderTarget(this.flowRT);
      renderer.clear();
      renderer.render(this.bakeScene, this.cam);
      this.bakeShared.uBakeSize.value = this.size;
    }
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
  }
  stamp(
    x: number,
    y: number,
    z: number,
    radius: number,
    soak: number,
    film: number,
    fresh = 0,
    roughness = 1,
    x2 = x,
    y2 = y,
    z2 = z,
  ): void {
    this.wetBound = Math.min(3.4, this.wetBound + soak * 1.5 + film + 0.2);
    const cx = (x + x2) / 2;
    const cy = (y + y2) / 2;
    const cz = (z + z2) / 2;
    const reach = radius * 1.4 + Math.hypot(x2 - x, y2 - y, z2 - z) / 2;
    const rects = this.surface.uvRects(cx, cy, cz, reach, this._rects);
    const seed = Math.random() * 100;
    for (const rect of rects) {
      if (this.count >= this.maxStamps) {
        return;
      }
      const offset = this.count++ * 4;
      this.attr.aRect.array.set(
        [rect[0] - this.padU, rect[1] - this.padV, rect[2] + this.padU, rect[3] + this.padV],
        offset,
      );
      this.attr.aA.array.set([x, y, z, radius], offset);
      this.attr.aB.array.set([x2, y2, z2, roughness], offset);
      this.attr.aAmt.array.set([soak * this.take[rect[0] >= 0.5 ? 1 : 0], film, fresh, seed], offset);
    }
  }
  update(dt: number): void {
    const renderer = this.renderer;
    if (this.wetBound <= 0 && this.count === 0) {
      return;
    }
    this.wetBound -= this.updateMat.uniforms.uDryRate.value * dt;
    this.updateMat.uniforms.uWetPrev.value = this.a.texture;
    this.updateMat.uniforms.uDt.value = dt;
    const activeLegs = this.surface.active > this.surface.legTris ? this.legCount : 1;
    this.b.scissorTest = true;
    for (let i = 0; i < activeLegs; i++) {
      this.b.scissor.set(...this.boxes[i]);
      renderer.setRenderTarget(this.b);
      renderer.render(this.quadScene, this.cam);
    }
    this.b.scissorTest = false;
    renderer.setRenderTarget(this.b);
    if (this.count > 0) {
      for (const attr of Object.values(this.attr)) {
        attr.needsUpdate = true;
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, this.count * 4);
      }
      this.stampGeo.instanceCount = this.count;
      renderer.render(this.stampScene, this.cam);
      this.count = 0;
    }
    renderer.setRenderTarget(null);
    [this.a, this.b] = [this.b, this.a];
  }
  clear(): void {
    this.wetBound = 0;
    const renderer = this.renderer;
    const prevClearColor = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0, 0);
    for (const target of [this.a, this.b]) {
      renderer.setRenderTarget(target);
      renderer.clear();
    }
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    this.count = 0;
  }
}
