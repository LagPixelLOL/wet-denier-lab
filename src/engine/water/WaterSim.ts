/**
 * Thrown, spray, drip and rain drops with gravity and drag. Impacts wet the fabric and spawn beads that
 * cling, slide, merge, drip and soak in; floor hits feed a puddle grid and ripples.
 */
import * as THREE from "three";
import {
  BEAD_DECAL_FRAGMENT_SHADER,
  BEAD_DECAL_VERTEX_SHADER,
  DROPLET_FRAGMENT_SHADER,
  DROPLET_VERTEX_SHADER,
  GLINT_FRAGMENT_SHADER,
  GLINT_VERTEX_SHADER,
} from "./shaders/drops";
import type { MaterialWater } from "../catalog/garments";
import type { SurfaceGrid, SurfaceHit } from "../surface/SurfaceGrid";
import type { WetMap } from "./WetMap";

/** A thrown drop flying on a fixed ballistic arc toward a known surface target. */
export interface ThrownDrop {
  kind: 0;
  /** Age in seconds; negative while waiting to launch. */
  t: number;
  /** Flight time to the target. */
  T: number;
  r: number;
  sx: number;
  sy: number;
  sz: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  tx: number;
  ty: number;
  tz: number;
  nx: number;
  ny: number;
  nz: number;
  leg: number;
}

/** A freely integrated drop: 1 = spray, 2 = drip, 3 = rain. */
export interface FreeDrop {
  kind: 1 | 2 | 3;
  t: number;
  r: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export type Drop = ThrownDrop | FreeDrop;

/** A water bead clinging to the fabric. */
export interface Bead {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  leg: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  age: number;
  /** Last position a trail stamp was laid from. */
  lx: number;
  ly: number;
  lz: number;
  wob: number;
  soakT: number;
  /** Glint strength, assigned in sync for glint candidates. */
  glow?: number;
}

/** Floor ripple: x, z, start time, strength. */
export type Ripple = THREE.Vector4;

export interface WaterCaps {
  /** [single leg, two legs]. */
  drops: [number, number];
  beads: [number, number];
  glints: number;
  keep: number;
}

/** Rain spawn area over the floor footprint. */
export interface RainArea {
  x: number;
  z: number;
  w: number;
  d: number;
  rate: number;
}

export type RainStyle = "rain" | "shower";

export type BeadWater = Pick<MaterialWater, "bead" | "slip">;

/** Per-frame accumulators read (and reset) by the app loop. */
export interface WaterEvents {
  impacts: number;
  energy: number;
  floor: number;
  /** Energy-weighted impact position sums. */
  ex: number;
  ey: number;
  ez: number;
  /** Last floor hit position. */
  fx: number;
  fz: number;
}

/** Scene-dependent droplet shading. */
export interface WaterLook {
  envLo: readonly [number, number, number];
  envHi: readonly [number, number, number];
  rain: readonly [number, number, number, number];
}

export interface WaterSimOptions {
  surface: SurfaceGrid;
  wetmap: WetMap;
  mobile: boolean;
}

/** Surface point a throw aims at. */
export type ThrowTarget = Pick<SurfaceHit, "x" | "y" | "z" | "nx" | "ny" | "nz">;

export interface ThrowOptions {
  count?: number;
  spread?: number;
  size?: number;
  flight?: number;
  lift?: number;
  reach?: number;
  delay?: number;
  wait?: number;
}

type DropMesh = THREE.InstancedMesh<THREE.IcosahedronGeometry, THREE.ShaderMaterial>;

const GRAVITY = 9.81;

const BEAD_PIN_RADIUS = 0.0021;

const PUDDLE_RES = 96;

const PUDDLE_SIZE = 0.8;

function gaussianRandom(): number {
  return Math.sqrt(Math.log(Math.random() + 1e-9) * -2) * Math.cos(Math.random() * 6.2831853);
}

export class WaterSim {
  declare surface: SurfaceGrid;
  declare wetmap: WetMap;
  declare mobile: boolean;
  declare drops: Drop[];
  declare beads: Bead[];
  declare caps: WaterCaps;
  declare maxDrops: number;
  declare maxBeads: number;
  declare time: number;
  declare rain: boolean;
  declare rainAcc: number;
  declare rainStyle: RainStyle;
  declare rainOver: RainArea;
  declare legWater: BeadWater[];
  declare events: WaterEvents;
  declare material: THREE.ShaderMaterial;
  declare beadMesh: DropMesh;
  declare dropMesh: DropMesh;
  declare keyWorld: THREE.Vector3;
  declare decalMat: THREE.ShaderMaterial;
  declare decalMesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  declare maxGlints: number;
  declare keepGlints: number;
  declare glintPos: THREE.InstancedBufferAttribute;
  declare glintPhase: THREE.InstancedBufferAttribute;
  declare glintGeo: THREE.InstancedBufferGeometry;
  declare glintMat: THREE.ShaderMaterial;
  declare glintMesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  declare scene: THREE.Scene;
  /** Floor puddle water levels, PUDDLE_RES x PUDDLE_RES. */
  declare puddle: Float32Array;
  declare puddleBytes: Uint8Array;
  declare puddleTex: THREE.DataTexture;
  declare puddleCenter: [number, number];
  declare puddleRect: THREE.Vector4;
  declare ripples: Ripple[];
  declare rippleIdx: number;
  declare puddleTimer: number;
  /** Whether any bead moved noticeably last update (unset before the first update). */
  declare sliding?: boolean;
  declare _pudWasWet?: boolean;
  constructor({ surface, wetmap, mobile }: WaterSimOptions) {
    this.surface = surface;
    this.wetmap = wetmap;
    this.mobile = mobile;
    this.drops = [];
    this.beads = [];
    this.caps = mobile
      ? {
          drops: [560, 820],
          beads: [300, 470],
          glints: 6,
          keep: 2,
        }
      : {
          drops: [1100, 1600],
          beads: [520, 820],
          glints: 9,
          keep: 3,
        };
    this.maxDrops = this.caps.drops[1];
    this.maxBeads = this.caps.beads[1];
    this.time = 0;
    this.rain = false;
    this.rainAcc = 0;
    this.rainStyle = "rain";
    this.rainOver = {
      x: 0,
      z: 0.04,
      w: 0.3,
      d: 0.3,
      rate: 1,
    };
    this.legWater = [
      {
        bead: 1,
        slip: 1,
      },
      {
        bead: 1,
        slip: 1,
      },
    ];
    this.events = {
      impacts: 0,
      energy: 0,
      floor: 0,
      ex: 0,
      ey: 0,
      ez: 0,
      fx: 0,
      fz: 0,
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: DROPLET_VERTEX_SHADER,
      fragmentShader: DROPLET_FRAGMENT_SHADER,
      uniforms: {
        uSceneTex: {
          value: null,
        },
        uResolution: {
          value: new THREE.Vector2(1, 1),
        },
        uLightDirView: {
          value: new THREE.Vector3(0, 1, 0),
        },
        uEnvLo: {
          value: new THREE.Vector3(0.2, 0.19, 0.25),
        },
        uEnvHi: {
          value: new THREE.Vector3(1.45, 1.43, 1.5),
        },
        uRainTint: {
          value: new THREE.Vector4(0.42, 0.5, 0.66, 0.42),
        },
      },
    });
    const makeDropMesh = (detail: number, capacity: number): DropMesh => {
      const geo = new THREE.IcosahedronGeometry(1, detail);
      const mesh = new THREE.InstancedMesh(geo, this.material, capacity);
      for (const attrName of ["aR", "aKind"]) {
        const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
        attr.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute(attrName, attr);
      }
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      return mesh;
    };
    this.beadMesh = makeDropMesh(mobile ? 2 : 3, this.maxBeads);
    this.dropMesh = makeDropMesh(mobile ? 1 : 2, this.maxDrops);
    this.setLegCount(1);
    this.keyWorld = new THREE.Vector3(0, 1, 0);
    this.decalMat = new THREE.ShaderMaterial({
      vertexShader: BEAD_DECAL_VERTEX_SHADER,
      fragmentShader: BEAD_DECAL_FRAGMENT_SHADER,
      uniforms: {
        uDecalLightDir: {
          value: this.keyWorld,
        },
      },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.decalMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), this.decalMat, this.maxBeads);
    this.decalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.decalMesh.count = 0;
    this.decalMesh.frustumCulled = false;
    this.decalMesh.renderOrder = -1;
    this.maxGlints = this.caps.glints;
    this.keepGlints = this.caps.keep;
    const glintGeo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(2, 2);
    glintGeo.index = quad.index;
    glintGeo.setAttribute("position", quad.attributes.position);
    this.glintPos = new THREE.InstancedBufferAttribute(new Float32Array(this.maxGlints * 2 * 4), 4);
    this.glintPhase = new THREE.InstancedBufferAttribute(new Float32Array(this.maxGlints * 2 * 2), 2);
    this.glintPos.setUsage(THREE.DynamicDrawUsage);
    this.glintPhase.setUsage(THREE.DynamicDrawUsage);
    glintGeo.setAttribute("aG", this.glintPos);
    glintGeo.setAttribute("aPhase", this.glintPhase);
    glintGeo.instanceCount = 0;
    this.glintGeo = glintGeo;
    this.glintMat = new THREE.ShaderMaterial({
      vertexShader: GLINT_VERTEX_SHADER,
      fragmentShader: GLINT_FRAGMENT_SHADER,
      uniforms: {
        uTime: {
          value: 0,
        },
        uResolution: this.material.uniforms.uResolution,
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glintMesh = new THREE.Mesh(glintGeo, this.glintMat);
    this.glintMesh.frustumCulled = false;
    this.glintMesh.renderOrder = 5;
    this.scene = new THREE.Scene();
    this.scene.add(this.decalMesh, this.beadMesh, this.dropMesh, this.glintMesh);
    this.puddle = new Float32Array(PUDDLE_RES * PUDDLE_RES);
    this.puddleBytes = new Uint8Array(PUDDLE_RES * PUDDLE_RES);
    this.puddleTex = new THREE.DataTexture(
      this.puddleBytes,
      PUDDLE_RES,
      PUDDLE_RES,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    this.puddleTex.minFilter = this.puddleTex.magFilter = THREE.LinearFilter;
    this.puddleTex.needsUpdate = true;
    this.puddleCenter = [0, 0.03];
    this.puddleRect = new THREE.Vector4(
      this.puddleCenter[0] - PUDDLE_SIZE / 2,
      this.puddleCenter[1] - PUDDLE_SIZE / 2,
      PUDDLE_SIZE,
      PUDDLE_SIZE,
    );
    this.ripples = Array.from(
      {
        length: 16,
      },
      () => new THREE.Vector4(0, 0, -10, 0),
    );
    this.rippleIdx = 0;
    this.puddleTimer = 0;
  }
  throwAt(
    hit: ThrowTarget,
    fromPos: THREE.Vector3Like,
    {
      count = 30,
      spread = 0.016,
      size = 1,
      flight = 0.17,
      lift = 0.1,
      reach = 0.42,
      delay = 0.045,
      wait = 0,
    }: ThrowOptions = {},
  ): void {
    const normal = [hit.nx, hit.ny, hit.nz];
    let toSource = [fromPos.x - hit.x, fromPos.y - hit.y, fromPos.z - hit.z];
    const sourceDist = Math.hypot(...toSource);
    toSource = toSource.map((c) => c / sourceDist);
    const hitPos = [hit.x, hit.y, hit.z];
    const launchPoint = (normalBlend: number, dist: number, rise: number): number[] =>
      [0, 1, 2].map(
        (axis) =>
          hitPos[axis] +
          (toSource[axis] * (1 - normalBlend) + normal[axis] * normalBlend) * dist +
          (axis === 1 ? rise : 0),
      );
    const blockedAt = (point: number[]): number => {
      const dist = Math.hypot(point[0] - hitPos[0], point[1] - hitPos[1], point[2] - hitPos[2]);
      const rayHit = this.surface.raycast(
        hitPos[0] + normal[0] * 0.004,
        hitPos[1] + normal[1] * 0.004,
        hitPos[2] + normal[2] * 0.004,
        (point[0] - hitPos[0]) / dist,
        (point[1] - hitPos[1]) / dist,
        (point[2] - hitPos[2]) / dist,
        dist,
      );
      if (rayHit) {
        return rayHit.t;
      } else {
        return -1;
      }
    };
    let launch = launchPoint(0.3, reach, lift);
    if (blockedAt(launch) >= 0) {
      launch = launchPoint(0, reach, lift);
      const blockT = blockedAt(launch);
      if (blockT >= 0) {
        launch = launchPoint(0, Math.max(0.04, blockT - 0.03), lift * 0.3);
      }
    }
    let tangent = Math.abs(normal[1]) < 0.9 ? [normal[2], 0, -normal[0]] : [1, 0, 0];
    const tangentLen = Math.hypot(...tangent);
    tangent = tangent.map((c) => c / tangentLen);
    const bitangent = [
      normal[1] * tangent[2] - normal[2] * tangent[1],
      normal[2] * tangent[0] - normal[0] * tangent[2],
      normal[0] * tangent[1] - normal[1] * tangent[0],
    ];
    for (let i = 0; i < count && !(this.drops.length >= this.maxDrops); i++) {
      const du = gaussianRandom() * spread;
      const dv = gaussianRandom() * spread * 1.15;
      const px = hit.x + tangent[0] * du + bitangent[0] * dv;
      const py = hit.y + tangent[1] * du + bitangent[1] * dv;
      const pz = hit.z + tangent[2] * du + bitangent[2] * dv;
      const target = this.surface.closest(px, py, pz, spread * 2.5 + 0.02);
      if (!target) {
        continue;
      }
      const radius = (0.0007 + Math.pow(Math.random(), 1.9) * 0.0038) * size;
      const flightTime = flight * (0.82 + Math.random() * 0.4);
      const sx = launch[0] + gaussianRandom() * 0.01;
      const sy = launch[1] + gaussianRandom() * 0.01;
      const sz = launch[2] + gaussianRandom() * 0.01;
      this.drops.push({
        kind: 0,
        t: -wait - Math.random() * delay,
        T: flightTime,
        r: radius,
        sx: sx,
        sy: sy,
        sz: sz,
        x: sx,
        y: sy,
        z: sz,
        vx: (target.x - sx) / flightTime,
        vy: (target.y - sy) / flightTime + GRAVITY * 0.5 * flightTime,
        vz: (target.z - sz) / flightTime,
        tx: target.x,
        ty: target.y,
        tz: target.z,
        nx: target.nx,
        ny: target.ny,
        nz: target.nz,
        leg: target.leg,
      });
    }
  }
  setRain(enabled: boolean): void {
    this.rain = enabled;
  }
  setLegCount(legCount: number): void {
    const tier = legCount > 1 ? 1 : 0;
    this.maxDrops = this.caps.drops[tier];
    this.maxBeads = this.caps.beads[tier];
  }
  setRainStyle(style: RainStyle): void {
    this.rainStyle = style;
  }
  setLook(look: WaterLook): void {
    const uniforms = this.material.uniforms;
    uniforms.uEnvLo.value.set(...look.envLo);
    uniforms.uEnvHi.value.set(...look.envHi);
    uniforms.uRainTint.value.set(...look.rain);
  }
  setLegWater(legIndex: number, water: BeadWater): void {
    this.legWater[legIndex].bead = water.bead;
    this.legWater[legIndex].slip = water.slip;
  }
  setFootprint(x: number, z: number, width: number, depth: number): void {
    const area = this.rainOver;
    area.x = x;
    area.z = z;
    area.w = width;
    area.d = depth;
    area.rate = Math.sqrt((width * depth) / 0.09);
  }
  shakeOff(): void {
    for (const bead of this.beads) {
      if (bead.r > 0.0008) {
        this._drip(bead);
      }
    }
    this.beads.length = 0;
  }
  dryAll(): void {
    this.drops.length = 0;
    this.beads.length = 0;
    this.puddle.fill(0);
    this.wetmap.clear();
  }
  _impact(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    vx: number,
    vy: number,
    vz: number,
    radius: number,
    isSplash: boolean,
    leg = 0,
  ): void {
    const speed = Math.hypot(vx, vy, vz);
    const normalSpeed = vx * nx + vy * ny + vz * nz;
    const events = this.events;
    const energy = speed * speed * radius * radius * radius * 1000000;
    events.impacts++;
    events.energy += energy;
    events.ex += x * energy;
    events.ey += y * energy;
    events.ez += z * energy;
    const spotRadius = radius * (2.5 + speed * 0.55) + 0.0015;
    this.wetmap.stamp(x, y, z, spotRadius, 0.5 + radius * 130, 0.95, isSplash ? 1 : 0.5, 1);
    if (radius > 0.0006 && Math.random() < Math.min(1, this.legWater[leg].bead * 2) * 0.85) {
      this._addBead(x, y, z, nx, ny, nz, radius * 0.92, leg);
    }
    if (isSplash && this.beads.length < this.maxBeads - 40) {
      let tx = nz;
      const ty = 0;
      let tz = -nx;
      const tangentLen = Math.hypot(tx, tz) || 1;
      tx /= tangentLen;
      tz /= tangentLen;
      const bx = ny * tz - nz * ty;
      const by = nz * tx - nx * tz;
      const bz = nx * ty - ny * tx;
      for (let i = 0, n = this.mobile ? 2 : 3; i < n; i++) {
        const du = gaussianRandom() * spotRadius * 0.55;
        const dv = gaussianRandom() * spotRadius * 0.55;
        const spot = this.surface.closest(
          x + tx * du + bx * dv,
          y + ty * du + by * dv,
          z + tz * du + bz * dv,
          spotRadius + 0.012,
        );
        if (spot) {
          this._addBead(spot.x, spot.y, spot.z, spot.nx, spot.ny, spot.nz, 0.0005 + Math.random() * 0.0008, spot.leg);
        }
      }
    }
    if (speed > 1 && this.drops.length < this.maxDrops - 8) {
      const sprayCount = Math.min(isSplash ? 6 : 2, Math.round(speed * radius * 1200));
      const tvx = vx - normalSpeed * nx;
      const tvy = vy - normalSpeed * ny;
      const tvz = vz - normalSpeed * nz;
      for (let i = 0; i < sprayCount; i++) {
        let rx = gaussianRandom();
        let ry = gaussianRandom();
        let rz = gaussianRandom();
        const rn = rx * nx + ry * ny + rz * nz;
        rx -= rn * nx;
        ry -= rn * ny;
        rz -= rn * nz;
        const rLen = Math.hypot(rx, ry, rz) || 1;
        const sideSpeed = speed * (0.18 + Math.random() * 0.42);
        const upSpeed = speed * (0.12 + Math.random() * 0.3);
        const childR = radius * (0.22 + Math.random() * 0.35);
        if (!(childR < 0.00025)) {
          this.drops.push({
            kind: 1,
            t: 0,
            r: childR,
            x: x + nx * 0.002,
            y: y + ny * 0.002,
            z: z + nz * 0.002,
            vx: tvx * 0.3 + (rx / rLen) * sideSpeed + nx * upSpeed,
            vy: tvy * 0.3 + (ry / rLen) * sideSpeed + ny * upSpeed,
            vz: tvz * 0.3 + (rz / rLen) * sideSpeed + nz * upSpeed,
          });
        }
      }
    }
  }
  _addBead(x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, leg = 0): void {
    if (this.beads.length >= this.maxBeads) {
      let nearest: Bead | null = null;
      let bestDist = 0.02;
      for (const bead of this.beads) {
        const d = Math.hypot(bead.x - x, bead.y - y, bead.z - z);
        if (d < bestDist) {
          bestDist = d;
          nearest = bead;
        }
      }
      if (nearest) {
        nearest.r = Math.cbrt(nearest.r ** 3 + r ** 3 * 0.8);
      }
      return;
    }
    this.beads.push({
      x: x,
      y: y,
      z: z,
      nx: nx,
      ny: ny,
      nz: nz,
      leg: leg,
      vx: 0,
      vy: 0,
      vz: 0,
      r: r,
      age: 0,
      lx: x,
      ly: y,
      lz: z,
      wob: Math.random() * 6.28,
      soakT: Math.random(),
    });
  }
  _floorHit(x: number, z: number, r: number, speed: number): void {
    this.events.floor++;
    this.events.fx = x;
    this.events.fz = z;
    const [cx, cz] = this.puddleCenter;
    const gx = ((x - cx) / PUDDLE_SIZE + 0.5) * PUDDLE_RES;
    const gy = ((z - cz) / PUDDLE_SIZE + 0.5) * PUDDLE_RES;
    const amount = Math.min(0.6, (r / 0.002) ** 3 * 0.16);
    const spread = 1.4 + r * 700;
    for (let row = Math.floor(gy - spread * 2); row <= gy + spread * 2; row++) {
      for (let col = Math.floor(gx - spread * 2); col <= gx + spread * 2; col++) {
        if (col < 0 || row < 0 || col >= PUDDLE_RES || row >= PUDDLE_RES) {
          continue;
        }
        const d2 = ((col - gx) ** 2 + (row - gy) ** 2) / (spread * spread);
        this.puddle[row * PUDDLE_RES + col] += amount * Math.exp(-d2);
      }
    }
    if (r > 0.0007 || Math.random() < 0.25) {
      this.ripples[this.rippleIdx++ % this.ripples.length].set(
        x,
        z,
        this.time,
        Math.min(1, 0.35 + r * 300 + speed * 0.1),
      );
    }
    if (speed > 1.5 && r > 0.0008 && this.drops.length < this.maxDrops - 3) {
      for (let i = 0; i < 2; i++) {
        const angle = Math.random() * 6.283;
        const outSpeed = 0.25 + Math.random() * 0.5;
        this.drops.push({
          kind: 1,
          t: 0,
          r: r * 0.3,
          x: x,
          y: 0.002,
          z: z,
          vx: Math.cos(angle) * outSpeed,
          vy: 0.6 + Math.random() * 0.6,
          vz: Math.sin(angle) * outSpeed,
        });
      }
    }
  }
  update(dt: number): void {
    this.time += dt;
    const surface = this.surface;
    const wetmap = this.wetmap;
    if (this.rain) {
      this._spawnRain(dt);
    }
    const drops = this.drops;
    for (let i = drops.length - 1; i >= 0; i--) {
      const drop = drops[i];
      let dead = false;
      drop.t += dt;
      if (drop.kind === 0) {
        if (drop.t < 0) {
          continue;
        }
        if (drop.t >= drop.T) {
          const vx = drop.vx;
          const vy = drop.vy - GRAVITY * drop.T;
          const vz = drop.vz;
          this._impact(drop.tx, drop.ty, drop.tz, drop.nx, drop.ny, drop.nz, vx, vy, vz, drop.r, true, drop.leg || 0);
          dead = true;
        } else {
          drop.x = drop.sx + drop.vx * drop.t;
          drop.y = drop.sy + drop.vy * drop.t - GRAVITY * 0.5 * drop.t * drop.t;
          drop.z = drop.sz + drop.vz * drop.t;
        }
      } else {
        const substeps = Math.hypot(drop.vx, drop.vy, drop.vz) * dt > 0.006 ? 3 : 1;
        const h = dt / substeps;
        for (let s = 0; s < substeps && !dead; s++) {
          drop.vy -= GRAVITY * h;
          const drag = 1 - h * 0.8;
          drop.vx *= drag;
          drop.vy *= drag;
          drop.vz *= drag;
          drop.x += drop.vx * h;
          drop.y += drop.vy * h;
          drop.z += drop.vz * h;
          if (drop.y < drop.r) {
            this._floorHit(drop.x, drop.z, drop.r, Math.hypot(drop.vx, drop.vy, drop.vz));
            dead = true;
            break;
          }
          const speed = Math.hypot(drop.vx, drop.vy, drop.vz);
          if (drop.t > 0.025 && surface.inBounds(drop.x, drop.y, drop.z, 0.01)) {
            const hit = surface.closest(drop.x, drop.y, drop.z, drop.r + speed * h + 0.004);
            if (hit && (hit.dist < drop.r || hit.side < 0)) {
              if (speed > 1.4) {
                this._impact(
                  hit.x,
                  hit.y,
                  hit.z,
                  hit.nx,
                  hit.ny,
                  hit.nz,
                  drop.vx,
                  drop.vy,
                  drop.vz,
                  drop.r,
                  false,
                  hit.leg,
                );
              } else {
                wetmap.stamp(hit.x, hit.y, hit.z, drop.r * 2.2 + 0.001, 0.35, 0.6, 0.2, 0.8);
                this._addBead(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, drop.r, hit.leg);
              }
              dead = true;
            }
          }
        }
        if (drop.t > 4) {
          dead = true;
        }
      }
      if (dead) {
        drops[i] = drops[drops.length - 1];
        drops.pop();
      }
    }
    this._updateBeads(dt);
    this._updatePuddle(dt);
  }
  _updateBeads(dt: number): void {
    const surface = this.surface;
    const wetmap = this.wetmap;
    const beads = this.beads;
    this.sliding = false;
    for (let i = beads.length - 1; i >= 0; i--) {
      const bead = beads[i];
      bead.age += dt;
      let dead = false;
      const gn = -GRAVITY * bead.ny;
      let gx = -gn * bead.nx;
      let gy = -GRAVITY - gn * bead.ny;
      let gz = -gn * bead.nz;
      const gt = Math.hypot(gx, gy, gz);
      const slope = gt / GRAVITY;
      const water = this.legWater[bead.leg || 0];
      const pinRadius = BEAD_PIN_RADIUS / water.slip;
      const slide = slope > 0.03 ? Math.min(2.5, Math.max(0, (bead.r * Math.sqrt(slope) - pinRadius) / pinRadius)) : 0;
      if (slide > 0) {
        gx /= gt;
        gy /= gt;
        gz /= gt;
        bead.wob += dt * (1.6 + Math.random() * 2.4);
        const wobble =
          Math.sin(bead.wob) * 0.55 + Math.sin(bead.wob * 2.7 + bead.r * 4000) * 0.25 + (Math.random() - 0.5) * 0.6;
        const sx = bead.ny * gz - bead.nz * gy;
        const sy = bead.nz * gx - bead.nx * gz;
        const sz = bead.nx * gy - bead.ny * gx;
        const accel = GRAVITY * 0.32 * slide;
        bead.vx += (gx + sx * wobble) * accel * dt;
        bead.vy += (gy + sy * wobble) * accel * dt;
        bead.vz += (gz + sz * wobble) * accel * dt;
      }
      const damping = Math.exp(-dt * (slide > 0 ? 6.5 : 30));
      bead.vx *= damping;
      bead.vy *= damping;
      bead.vz *= damping;
      const vn = bead.vx * bead.nx + bead.vy * bead.ny + bead.vz * bead.nz;
      bead.vx -= vn * bead.nx;
      bead.vy -= vn * bead.ny;
      bead.vz -= vn * bead.nz;
      let speed = Math.hypot(bead.vx, bead.vy, bead.vz);
      if (speed > 0.55) {
        const scale = 0.55 / speed;
        bead.vx *= scale;
        bead.vy *= scale;
        bead.vz *= scale;
        speed = 0.55;
      }
      if (speed > 0.0001) {
        if (speed > 0.004) {
          this.sliding = true;
        }
        const hit = surface.closest(bead.x + bead.vx * dt, bead.y + bead.vy * dt, bead.z + bead.vz * dt, 0.02);
        if (!hit) {
          this._drip(bead);
          dead = true;
        } else {
          bead.x = hit.x;
          bead.y = hit.y;
          bead.z = hit.z;
          bead.nx = hit.nx;
          bead.ny = hit.ny;
          bead.nz = hit.nz;
          bead.leg = hit.leg;
          const moved = Math.hypot(bead.x - bead.lx, bead.y - bead.ly, bead.z - bead.lz);
          if (moved > 0.0016) {
            wetmap.stamp(bead.lx, bead.ly, bead.lz, bead.r * 0.62, 0.2, 0.5, 0.08, 0.18, bead.x, bead.y, bead.z);
            bead.r -= moved * 0.0085;
            bead.lx = bead.x;
            bead.ly = bead.y;
            bead.lz = bead.z;
          }
          if (bead.ny < -0.45 && bead.r > 0.0016 && speed > 0.02) {
            this._drip(bead);
            dead = true;
          }
        }
      }
      bead.r -= (dt * 0.000035) / (water.bead * water.bead);
      bead.soakT += dt;
      if (bead.soakT > 0.6) {
        bead.soakT = 0;
        wetmap.stamp(bead.x, bead.y, bead.z, bead.r * 1.25, 0.06, 0.05, 0, 0.4);
      }
      if (bead.y < bead.r * 0.6 + 0.0015) {
        this._floorHit(bead.x, bead.z, bead.r, 0.2);
        dead = true;
      }
      if (bead.r < 0.00045) {
        dead = true;
      }
      if (dead) {
        beads[i] = beads[beads.length - 1];
        beads.pop();
      }
    }
    for (let i = 0; i < beads.length; i++) {
      const a = beads[i];
      for (let j = i + 1; j < beads.length; j++) {
        const b = beads[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        const mergeDist = (a.r + b.r) * 0.85;
        if (dx * dx + dy * dy + dz * dz > mergeDist * mergeDist) {
          continue;
        }
        const volA = a.r ** 3;
        const volB = b.r ** 3;
        const vol = volA + volB;
        const bigger = volA >= volB ? a : b;
        a.x = (a.x * volA + b.x * volB) / vol;
        a.y = (a.y * volA + b.y * volB) / vol;
        a.z = (a.z * volA + b.z * volB) / vol;
        a.vx = (a.vx * volA + b.vx * volB) / vol;
        a.vy = (a.vy * volA + b.vy * volB) / vol;
        a.vz = (a.vz * volA + b.vz * volB) / vol;
        a.nx = bigger.nx;
        a.ny = bigger.ny;
        a.nz = bigger.nz;
        a.r = Math.cbrt(vol);
        a.age = Math.min(a.age, b.age) + 0.05;
        beads[j] = beads[beads.length - 1];
        beads.pop();
        j--;
      }
    }
  }
  _drip(bead: Bead): void {
    if (!(this.drops.length >= this.maxDrops)) {
      this.drops.push({
        kind: 2,
        t: 0,
        r: bead.r * 0.95,
        x: bead.x + bead.nx * bead.r,
        y: bead.y + bead.ny * bead.r,
        z: bead.z + bead.nz * bead.r,
        vx: bead.vx,
        vy: bead.vy - 0.05,
        vz: bead.vz,
      });
    }
  }
  _spawnRain(dt: number): void {
    const area = this.rainOver;
    const shower = this.rainStyle === "shower";
    for (
      this.rainAcc += dt * (this.mobile ? 110 : 170) * (shower ? 1.5 : area.rate);
      this.rainAcc > 1 && this.drops.length < this.maxDrops;
    ) {
      this.rainAcc -= 1;
      if (shower) {
        const angle = Math.random() * 6.2832;
        const rad = Math.sqrt(Math.random());
        const rx = 0.11 + area.w * 0.5;
        const rz = 0.11 + area.d * 0.5;
        this.drops.push({
          kind: 3,
          t: 0,
          r: 0.0007 + Math.random() * 0.001,
          x: area.x + Math.cos(angle) * rad * rx,
          y: 1.02 + Math.random() * 0.35,
          z: area.z + Math.sin(angle) * rad * rz,
          vx: Math.cos(angle) * rad * 0.22,
          vy: -4.3,
          vz: Math.sin(angle) * rad * 0.22,
        });
        continue;
      }
      const wide = Math.random() < 0.45;
      const x = area.x + (Math.random() - 0.5) * (area.w + (wide ? 0.65 : 0));
      const z = area.z + (Math.random() - 0.5) * (area.d + (wide ? 0.6 : 0));
      this.drops.push({
        kind: 3,
        t: 0,
        r: 0.0006 + Math.random() * 0.0009,
        x: x,
        y: 1 + Math.random() * 0.35,
        z: z,
        vx: 0.1,
        vy: -3.8,
        vz: 0.05,
      });
    }
  }
  _updatePuddle(dt: number): void {
    this.puddleTimer += dt;
    if (this.puddleTimer < 1 / 20) {
      return;
    }
    const step = this.puddleTimer;
    this.puddleTimer = 0;
    const puddle = this.puddle;
    const bytes = this.puddleBytes;
    const n = PUDDLE_RES;
    const diffusion = Math.min(0.2, step * 1.5);
    let anyWet = false;
    for (let y = 1; y < n - 1; y++) {
      for (let x = 1; x < n - 1; x++) {
        const idx = y * n + x;
        const v = puddle[idx];
        const lap = puddle[idx - 1] + puddle[idx + 1] + puddle[idx - n] + puddle[idx + n] - v * 4;
        puddle[idx] = Math.max(0, v + lap * diffusion * 0.25 - step * 0.012);
      }
    }
    for (let i = 0; i < puddle.length; i++) {
      const level = Math.min(255, puddle[i] * 255);
      bytes[i] = level;
      if (level > 0) {
        anyWet = true;
      }
    }
    if (anyWet || this._pudWasWet) {
      this.puddleTex.needsUpdate = true;
    }
    this._pudWasWet = anyWet;
  }
  sync(
    camera: THREE.Camera,
    sceneTexture: THREE.Texture | null,
    resolution: THREE.Vector2,
    lightDir: THREE.Vector3,
  ): void {
    const uniforms = this.material.uniforms;
    uniforms.uSceneTex.value = sceneTexture;
    uniforms.uResolution.value.copy(resolution);
    uniforms.uLightDirView.value.copy(lightDir).transformDirection(camera.matrixWorldInverse);
    const mat = new THREE.Matrix4();
    const fwd = new THREE.Vector3();
    const up = new THREE.Vector3();
    const side = new THREE.Vector3();
    this.keyWorld.copy(lightDir);
    this.glintMat.uniforms.uTime.value = this.time;
    let n = 0;
    const beadMesh = this.beadMesh;
    const beadRadii = beadMesh.geometry.attributes.aR.array;
    const beadMatrices = beadMesh.instanceMatrix.array;
    const decalMatrices = this.decalMesh.instanceMatrix.array;
    for (const bead of this.beads) {
      up.set(bead.nx, bead.ny, bead.nz);
      const speed = Math.hypot(bead.vx, bead.vy, bead.vz);
      if (speed > 0.01) {
        fwd.set(bead.vx / speed, bead.vy / speed, bead.vz / speed);
      } else {
        fwd.set(bead.nx * bead.ny, -1 + bead.ny * bead.ny, bead.nz * bead.ny);
        if (fwd.lengthSq() < 0.000001) {
          fwd.set(1, 0, 0).cross(up);
        }
        fwd.normalize();
      }
      side.crossVectors(fwd, up).normalize();
      fwd.crossVectors(up, side).normalize();
      const grow = Math.min(1, 0.55 + bead.age * 9);
      const stretch =
        Math.min(0.85, speed / 0.14) + (speed <= 0.01 ? Math.sqrt(Math.max(0, 1 - bead.ny * bead.ny)) * 0.12 : 0);
      const r = bead.r * grow;
      const lenFwd = r * (1 + stretch);
      const lenUp = r * 0.64;
      const lenSide = r * (1 - stretch * 0.12);
      const px = bead.x - bead.nx * r * 0.16 + fwd.x * r * stretch * 0.2;
      const py = bead.y - bead.ny * r * 0.16 + fwd.y * r * stretch * 0.2;
      const pz = bead.z - bead.nz * r * 0.16 + fwd.z * r * stretch * 0.2;
      mat.set(
        fwd.x * lenFwd,
        up.x * lenUp,
        side.x * lenSide,
        px,
        fwd.y * lenFwd,
        up.y * lenUp,
        side.y * lenSide,
        py,
        fwd.z * lenFwd,
        up.z * lenUp,
        side.z * lenSide,
        pz,
        0,
        0,
        0,
        1,
      );
      mat.toArray(beadMatrices, n * 16);
      beadRadii[n] = r;
      const decalR = r * 1.35;
      const decalLen = decalR * (1 + stretch);
      mat.set(
        fwd.x * decalLen,
        side.x * decalR,
        up.x,
        bead.x + bead.nx * 0.0003,
        fwd.y * decalLen,
        side.y * decalR,
        up.y,
        bead.y + bead.ny * 0.0003,
        fwd.z * decalLen,
        side.z * decalR,
        up.z,
        bead.z + bead.nz * 0.0003,
        0,
        0,
        0,
        1,
      );
      mat.toArray(decalMatrices, n * 16);
      n++;
    }
    beadMesh.count = n;
    beadMesh.instanceMatrix.needsUpdate = true;
    beadMesh.geometry.attributes.aR.needsUpdate = true;
    this.decalMesh.count = n;
    this.decalMesh.instanceMatrix.needsUpdate = true;
    const camPos = camera.position;
    const light = lightDir;
    const candidates = this.beads.filter(
      (b) => b.r > 0.0012 && b.age > 0.15 && b.nx * light.x + b.ny * light.y + b.nz * light.z > -0.15,
    );
    candidates.sort((a, b) => b.r - a.r);
    const keptPerLeg: number[] = [0, 0];
    const glintsPerLeg: number[] = [0, 0];
    for (const bead of candidates) {
      const fade = bead.age < 1.2 ? 1 : Math.max(0, 1 - (bead.age - 1.2) / 3);
      const leg = bead.leg || 0;
      const keep = keptPerLeg[leg] < this.keepGlints && bead.r > 0.0015 ? 0.3 : 0;
      if (keep > fade) {
        keptPerLeg[leg]++;
      }
      bead.glow = Math.max(fade, keep);
    }
    const glinting = candidates.filter((b) => b.glow! > 0.02).sort((a, b) => b.glow! * b.r - a.glow! * a.r);
    const glintPosArr = this.glintPos.array;
    const glintPhaseArr = this.glintPhase.array;
    let glintCount = 0;
    for (const bead of glinting) {
      const leg = bead.leg || 0;
      if (glintsPerLeg[leg] >= this.maxGlints) {
        continue;
      }
      glintsPerLeg[leg]++;
      const lift = bead.r * 0.32;
      const px = bead.x + bead.nx * lift;
      const py = bead.y + bead.ny * lift;
      const pz = bead.z + bead.nz * lift;
      const toCamX = camPos.x - px;
      const toCamY = camPos.y - py;
      const toCamZ = camPos.z - pz;
      const camDist = Math.hypot(toCamX, toCamY, toCamZ) || 1;
      const hx = light.x + toCamX / camDist;
      const hy = light.y + toCamY / camDist;
      const hz = light.z + toCamZ / camDist;
      const hLen = Math.hypot(hx, hy, hz) || 1;
      glintPosArr[glintCount * 4] = px + (hx / hLen) * bead.r * 0.55;
      glintPosArr[glintCount * 4 + 1] = py + (hy / hLen) * bead.r * 0.55;
      glintPosArr[glintCount * 4 + 2] = pz + (hz / hLen) * bead.r * 0.55;
      glintPosArr[glintCount * 4 + 3] = bead.r;
      glintPhaseArr[glintCount * 2] = (bead.wob % 6.2831) / 6.2831;
      glintPhaseArr[glintCount * 2 + 1] = bead.glow!;
      glintCount++;
    }
    this.glintGeo.instanceCount = glintCount;
    this.glintPos.needsUpdate = true;
    this.glintPhase.needsUpdate = true;
    n = 0;
    const dropMesh = this.dropMesh;
    const dropRadii = dropMesh.geometry.attributes.aR.array;
    const dropMatrices = dropMesh.instanceMatrix.array;
    const dropKinds = dropMesh.geometry.attributes.aKind.array;
    for (const drop of this.drops) {
      if (drop.t < 0) {
        continue;
      }
      const vx = drop.vx;
      let vy = drop.vy;
      const vz = drop.vz;
      if (drop.kind === 0) {
        vy = drop.vy - GRAVITY * drop.t;
      }
      const speed = Math.hypot(vx, vy, vz) || 1;
      fwd.set(vx / speed, vy / speed, vz / speed);
      up.set(0, 1, 0);
      if (Math.abs(fwd.y) > 0.95) {
        up.set(1, 0, 0);
      }
      side.crossVectors(fwd, up).normalize();
      up.crossVectors(side, fwd).normalize();
      const stretch = Math.min(drop.kind === 3 ? 16 : 4.5, (speed * (drop.kind === 3 ? 0.014 : 0.009)) / drop.r);
      const len = drop.r * (1 + stretch);
      const thick = drop.r * (drop.kind === 3 ? 1.25 : 1);
      const back = len - thick;
      mat.set(
        fwd.x * len,
        up.x * thick,
        side.x * thick,
        drop.x - fwd.x * back,
        fwd.y * len,
        up.y * thick,
        side.y * thick,
        drop.y - fwd.y * back,
        fwd.z * len,
        up.z * thick,
        side.z * thick,
        drop.z - fwd.z * back,
        0,
        0,
        0,
        1,
      );
      mat.toArray(dropMatrices, n * 16);
      dropRadii[n] = thick;
      dropKinds[n] = drop.kind;
      n++;
    }
    dropMesh.count = n;
    dropMesh.instanceMatrix.needsUpdate = true;
    dropMesh.geometry.attributes.aR.needsUpdate = true;
    dropMesh.geometry.attributes.aKind.needsUpdate = true;
  }
}
