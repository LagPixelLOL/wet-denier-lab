/**
 * CPU skinning of both legs, floor placement, eased pose blending and solo/away opacity fades, and the collision
 * surface over both legs, which follows whether a leg is bare.
 */
import type { Vec3 } from "./joints";
import { DEFAULT_POSE, POSES } from "./poses";
import type { PoseDefinition } from "./poses";
import {
  buildLegMatrix,
  buildLegPose,
  computeFootLift,
  lerpLegSpec,
  skinLegPoint,
  skinLegVertices,
  solveReachKnees,
} from "./skinning";
import { fadeHeight } from "../stage/shaders/leg";
import type { LegPose, LegPoseSpec } from "./skinning";
import { SurfaceGrid } from "../surface/SurfaceGrid";
import { FOREFOOT_JOIN } from "../model/forefoot";
import type { ForefootCollision } from "../model/forefoot";
import type { CollisionMesh } from "../model/legModel";

/** The part of the stage a LegRig drives. */
export interface LegRigTarget {
  setLegPose(index: number, pose: LegPose, matrix: Float64Array): void;
  setLegOpacity(index: number, opacity: number): void;
  /** World-space leg axis points, each with the radius of the leg around it. */
  setCastPoints(points: Vec3[], radii: number[]): void;
}

/** A pose with reach knees already solved for this rig's rest mesh. */
export type RigPose = Omit<PoseDefinition, "legs"> & { legs: LegPoseSpec[] };

/** Per-leg skinning state. */
export interface RigLeg {
  p: LegPose | null;
  lift: number;
  /** Column-major hip matrix. */
  m: Float64Array;
  /** World-space points along the leg axis, hip to toe. */
  axis: Vec3[];
}

/** Floor area the visible legs cover (center x/z, width, depth). */
export interface Footprint {
  x: number;
  z: number;
  w: number;
  d: number;
}

export type RigUpdateState = "moving" | "settled" | "fading" | null;

interface SettledLeg {
  spec: LegPoseSpec;
  p: LegPose;
  lift: number;
}

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

const POSE_BLEND_SECONDS = 0.55;

const LEG_FADE_SECONDS = 0.32;

const AWAY_LEG_OPACITY = 0.16;

const LEG_AXIS_POINTS: Vec3[] = [
  [0, 0.8, 0.03],
  [0, 0.62, 0.03],
  [0, 0.49, 0.02],
  [0, 0.33, 0],
  [0, 0.17, 0],
  [0.005, 0.07, 0.01],
  [0, 0.03, 0.11],
];

/**
 * Per axis point, a radius that holds the leg surface around it (measured on the shipped model: 0.128 at the thigh
 * top down to 0.075 at the shin, plus 1 cm for pose bending).
 */
const LEG_AXIS_RADII = [0.14, 0.14, 0.09, 0.085, 0.095, 0.115, 0.115];

/**
 * The triangle groups that only some legs collide with: the stocking's front, stretched over the toes (a leg in
 * a stocking) and the forefoot's skin (a bare leg). Every leg collides with the rest, group 0.
 */
const TRI_STOCKING_FRONT = 1;
const TRI_FOREFOOT_SKIN = 2;

/** The stocking's collision mesh followed by the forefoot's skin, as one mesh. */
function appendForefoot(stocking: CollisionMesh, forefoot: ForefootCollision): CollisionMesh {
  const join = (a: Float32Array, b: Float32Array): Float32Array => {
    const out = new Float32Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  };
  const vertCount = stocking.pos.length / 3;
  const idx = new Uint32Array(stocking.idx.length + forefoot.idx.length);
  idx.set(stocking.idx);
  forefoot.idx.forEach((v, i) => {
    idx[stocking.idx.length + i] = v + vertCount;
  });
  return {
    pos: join(stocking.pos, forefoot.pos),
    nrm: join(stocking.nrm, forefoot.nrm),
    uv: join(stocking.uv, forefoot.uv),
    idx,
  };
}

export class LegRig {
  /** The stocking's collision mesh at rest, followed by the forefoot's skin if the model has one. */
  declare rest: CollisionMesh;
  declare look: LegRigTarget;
  /** Vertices per leg. */
  declare n: number;
  /** How many of them are the stocking's. They come first, and floor contact looks at them only. */
  declare stockingVerts: number;
  declare floorY: number;
  /** Rest vertex indices of the foot (used for floor contact). */
  declare foot: number[];
  declare poses: Record<string, RigPose>;
  /** Posed positions/normals of both legs (leg 1 after leg 0). */
  declare pos: Float32Array;
  declare nrm: Float32Array;
  /** Triangles per leg: the stocking's, then the forefoot's skin. */
  declare legTris: number;
  /** Per triangle of a leg: 0, or the group that only some legs collide with (TRI_STOCKING_FRONT, ...). */
  declare triGroup: Uint8Array;
  /** Per leg: whether it is bare (see setBare). */
  declare bare: boolean[];
  /** Current pose name. */
  declare name: string;
  /** Current, start and target leg poses of the blend. */
  declare spec: LegPoseSpec[];
  declare from: LegPoseSpec[];
  declare to: LegPoseSpec[];
  /** Blend progress, 1 when settled. */
  declare t: number;
  declare solo: boolean;
  declare shown: number[];
  declare presence: number[];
  declare away: number[];
  declare awayNow: number[];
  declare legs: RigLeg[];
  declare footprint: Footprint;
  /** Front-most z of the visible legs. */
  declare front: number;
  declare moving: boolean;
  declare _settled: (SettledLeg | null)[];
  /** Collision grid over the posed legs (at the target pose). */
  declare surface: SurfaceGrid;
  /**
   * `stocking` is the stocking's collision mesh and `forefoot` the skin of the forefoot under it, if the model
   * has one: then a bare leg collides with its separate toes (see setBare). Both legs start in a stocking.
   */
  constructor(stocking: CollisionMesh, look: LegRigTarget, forefoot: ForefootCollision | null = null) {
    const rest = (this.rest = forefoot ? appendForefoot(stocking, forefoot) : stocking);
    this.look = look;
    const vertCount = (this.n = rest.pos.length / 3);
    const triCount = rest.idx.length / 3;
    const stockingVerts = (this.stockingVerts = stocking.pos.length / 3);
    const stockingTris = stocking.idx.length / 3;
    this.floorY = Infinity;
    for (let i = 1; i < stocking.pos.length; i += 3) {
      this.floorY = Math.min(this.floorY, rest.pos[i]);
    }
    this.foot = [];
    for (let i = 0; i < stockingVerts; i++) {
      if (rest.pos[i * 3 + 1] < 0.14) {
        this.foot.push(i);
      }
    }
    this.triGroup = new Uint8Array(triCount);
    // Per triangle of both legs: for the forefoot's skin, the stocking triangle whose UVs it borrows.
    let islandOf: Int32Array | null = null;
    if (forefoot) {
      const borrowed = (islandOf = new Int32Array(triCount * 2).fill(-1));
      const inFront = (v: number): boolean =>
        rest.pos[v * 3 + 2] > FOREFOOT_JOIN.cut && rest.pos[v * 3 + 1] < FOREFOOT_JOIN.maxY;
      for (let t = 0; t < stockingTris; t++) {
        if (inFront(rest.idx[t * 3]) && inFront(rest.idx[t * 3 + 1]) && inFront(rest.idx[t * 3 + 2])) {
          this.triGroup[t] = TRI_STOCKING_FRONT;
        }
      }
      this.triGroup.fill(TRI_FOREFOOT_SKIN, stockingTris);
      forefoot.uvTri.forEach((tri, t) => {
        if (tri >= 0) {
          borrowed[stockingTris + t] = tri;
          borrowed[triCount + stockingTris + t] = triCount + tri;
        }
      });
    }
    this.bare = [false, false];
    this.poses = {};
    for (const [key, pose] of Object.entries<PoseDefinition>(POSES)) {
      this.poses[key] = {
        ...pose,
        legs: solveReachKnees(
          pose.legs.map((leg) => ({
            ...leg,
          })),
          rest.pos,
          this.foot,
          this.floorY,
        ),
      };
    }
    const pos = new Float32Array(vertCount * 6);
    const nrm = new Float32Array(vertCount * 6);
    const uv = new Float32Array(vertCount * 4);
    const restY = new Float32Array(vertCount * 2);
    const height = new Float32Array(vertCount * 2);
    const indices = new Uint32Array(triCount * 6);
    for (let i = 0; i < vertCount; i++) {
      uv[i * 2] = rest.uv[i * 2] * 0.5;
      uv[i * 2 + 1] = rest.uv[i * 2 + 1];
      uv[(vertCount + i) * 2] = rest.uv[i * 2] * 0.5 + 0.5;
      uv[(vertCount + i) * 2 + 1] = rest.uv[i * 2 + 1];
      restY[i] = restY[vertCount + i] = fadeHeight(rest.pos[i * 3], rest.pos[i * 3 + 1], rest.pos[i * 3 + 2]);
      height[i] = height[vertCount + i] = rest.pos[i * 3 + 1];
    }
    indices.set(rest.idx);
    for (let i = 0; i < rest.idx.length; i++) {
      indices[rest.idx.length + i] = rest.idx[i] + vertCount;
    }
    this.pos = pos;
    this.nrm = nrm;
    this.legTris = triCount;
    this.name = DEFAULT_POSE;
    const initialPose = this.poses[this.name];
    this.spec = initialPose.legs.map((leg) => ({
      ...leg,
    }));
    this.from = this.spec.map((leg) => ({
      ...leg,
    }));
    this.to = this.spec.map((leg) => ({
      ...leg,
    }));
    this.t = 1;
    this.solo = !!initialPose.solo;
    this.shown = [1, this.solo ? 0 : 1];
    this.presence = [...this.shown];
    this.away = [0, 0];
    this.awayNow = [0, 0];
    this.legs = [0, 1].map((): RigLeg => ({
      p: null,
      lift: 0,
      m: new Float64Array(16),
      axis: LEG_AXIS_POINTS.map((): Vec3 => [0, 0, 0]),
    }));
    this.footprint = {
      x: 0,
      z: 0.04,
      w: 0.3,
      d: 0.3,
    };
    this.front = 0.21;
    this.moving = false;
    this._settled = [null, null];
    this._place();
    this._collide(this.spec);
    this.surface = new SurfaceGrid({
      pos: pos,
      nrm: nrm,
      uv: uv,
      idx: indices,
      ry: restY,
      height: height,
      legTris: triCount,
      islandOf: islandOf,
    });
    this._skipTris(0);
    this._skipTris(1);
    this._index();
  }
  /** Marks the triangles of a leg that it does not collide with, bare or in a stocking. */
  _skipTris(index: number): void {
    const skip = this.surface.skip;
    const group = this.triGroup;
    const skipped = this.bare[index] ? TRI_STOCKING_FRONT : TRI_FOREFOOT_SKIN;
    for (let t = 0, offset = index * this.legTris; t < group.length; t++) {
      skip[offset + t] = group[t] === skipped ? 1 : 0;
    }
  }
  /** Re-indexes the collision grid over the legs that are shown. */
  _index(): void {
    this.surface.rebuild(this.solo ? this.legTris : this.legTris * 2);
  }
  /**
   * Sets whether a leg is bare. In front of the forefoot's join a bare leg collides with the skin and its
   * separate toes, and a leg in a stocking with the stocking stretched over them. Without a forefoot in the
   * model there is only the stocking's mesh, and nothing changes. Returns whether the collision surface changed.
   */
  setBare(index: number, bare: boolean): boolean {
    if (this.bare[index] === bare) {
      return false;
    }
    this.bare[index] = bare;
    if (this.n > this.stockingVerts) {
      this._skipTris(index);
      this._index();
      return true;
    }
    return false;
  }
  _place(): void {
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i];
      const legPose = (leg.p = buildLegPose(this.spec[i]));
      const side = i === 0 ? 1 : -1;
      leg.lift = computeFootLift(this.rest.pos, this.foot, legPose, this.floorY);
      buildLegMatrix(legPose, side, leg.lift, leg.m);
      this.look.setLegPose(i, legPose, leg.m);
      LEG_AXIS_POINTS.forEach((pt, j) => skinLegPoint(legPose, side, leg.lift, pt[0], pt[1], pt[2], leg.axis[j]));
    }
    this.look.setCastPoints(this.legs[0].axis.concat(this.legs[1].axis), LEG_AXIS_RADII.concat(LEG_AXIS_RADII));
    this.applyOpacity();
  }
  /** Pushes each leg's opacity to the stage; `ignoreAway` shows legs faded for a close-up at full opacity. */
  applyOpacity(ignoreAway = false): void {
    for (let i = 0; i < 2; i++) {
      const away = ignoreAway ? 0 : this.awayNow[i];
      this.look.setLegOpacity(i, this.presence[i] * (1 - (1 - AWAY_LEG_OPACITY) * away));
    }
  }
  _collide(specs: LegPoseSpec[]): void {
    const pos = this.pos;
    const n = this.n;
    const stockingVerts = this.stockingVerts;
    const solo = this.solo;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < 2; i++) {
      const legPose = buildLegPose(specs[i]);
      const lift = computeFootLift(this.rest.pos, this.foot, legPose, this.floorY);
      skinLegVertices(this.rest.pos, this.rest.nrm, legPose, i === 0 ? 1 : -1, lift, pos, this.nrm, i * n);
      if (i !== 1 || !solo) {
        // The stocking's vertices only: the forefoot's skin lies under them.
        for (let v = i * n, end = v + stockingVerts; v < end; v++) {
          const x = pos[v * 3];
          const z = pos[v * 3 + 2];
          if (x < minX) {
            minX = x;
          }
          if (x > maxX) {
            maxX = x;
          }
          if (z < minZ) {
            minZ = z;
          }
          if (z > maxZ) {
            maxZ = z;
          }
        }
      }
    }
    this.front = maxZ;
    const footprint = this.footprint;
    if (solo) {
      footprint.x = 0;
      footprint.z = 0.04;
      footprint.w = 0.3;
      footprint.d = 0.3;
    } else {
      footprint.x = (minX + maxX) / 2;
      footprint.z = (minZ + maxZ) / 2;
      footprint.w = Math.max(0.3, maxX - minX + 0.1);
      footprint.d = Math.max(0.3, maxZ - minZ + 0.06);
    }
  }
  /** Starts blending to a pose (or jumps with instant). Returns false for unknown or current poses. */
  setPose(poseName: string, { instant = false }: { instant?: boolean } = {}): boolean {
    const pose = this.poses[poseName];
    if (!pose || poseName === this.name) {
      return false;
    }
    const wasSolo = this.solo;
    this.name = poseName;
    this.solo = !!pose.solo;
    this.from = this.spec.map((leg) => ({
      ...leg,
    }));
    this.to = pose.legs.map((leg) => ({
      ...leg,
    }));
    if (wasSolo && !this.solo) {
      this.from[1] = {
        ...this.to[1],
      };
      this.spec[1] = {
        ...this.to[1],
      };
    }
    if (this.solo) {
      this.to[1] = {
        ...this.spec[1],
      };
    }
    this.shown = [1, this.solo ? 0 : 1];
    this.t = instant ? 1 : 0;
    if (instant) {
      this.spec = this.to.map((leg) => ({
        ...leg,
      }));
      this.presence = [...this.shown];
      this.awayNow = [...this.away];
      this._place();
    }
    this._collide(this.to);
    this._index();
    this.moving = !instant;
    return true;
  }
  setAway(legIndex: number, amount: number): void {
    this.away[legIndex] = amount;
  }
  get awayLeg(): number {
    if (this.awayNow[0] > 0.5) {
      return 0;
    } else if (this.awayNow[1] > 0.5) {
      return 1;
    } else {
      return -1;
    }
  }
  update(dt: number): RigUpdateState {
    let posed = false;
    let faded = false;
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / POSE_BLEND_SECONDS);
      const eased = easeOutCubic(this.t);
      for (let i = 0; i < 2; i++) {
        lerpLegSpec(this.from[i], this.to[i], eased, this.spec[i]);
      }
      posed = true;
    }
    const approach = (current: number, target: number, duration: number): number => {
      const diff = target - current;
      const maxStep = dt / duration;
      if (Math.abs(diff) <= maxStep) {
        return target;
      } else {
        return current + Math.sign(diff) * maxStep;
      }
    };
    for (let i = 0; i < 2; i++) {
      if (this.presence[i] !== this.shown[i]) {
        this.presence[i] = approach(this.presence[i], this.shown[i], LEG_FADE_SECONDS);
        posed = true;
      }
      if (this.awayNow[i] !== this.away[i]) {
        this.awayNow[i] = approach(this.awayNow[i], this.away[i], 0.28);
        faded = true;
      }
    }
    if (posed) {
      this._place();
    } else if (faded) {
      this.applyOpacity();
    }
    const justSettled = this.moving && !posed;
    this.moving = posed;
    if (posed) {
      return "moving";
    } else if (justSettled) {
      return "settled";
    } else if (faded) {
      return "fading";
    } else {
      return null;
    }
  }
  /** World position of a rest-space point on a leg at its target pose. */
  point(legIndex: number, lx: number, ly: number, lz: number, out: Vec3 = [0, 0, 0]): Vec3 {
    let cached = this._settled[legIndex];
    if (!cached || cached.spec !== this.to[legIndex]) {
      const legPose = buildLegPose(this.to[legIndex]);
      cached = this._settled[legIndex] = {
        spec: this.to[legIndex],
        p: legPose,
        lift: computeFootLift(this.rest.pos, this.foot, legPose, this.floorY),
      };
    }
    return skinLegPoint(cached.p, legIndex === 0 ? 1 : -1, cached.lift, lx, ly, lz, out);
  }
  distanceToLeg(legIndex: number, x: number, y: number, z: number): number {
    const axis = this.legs[legIndex].axis;
    let best = Infinity;
    for (let i = 0; i + 1 < axis.length; i++) {
      const a = axis[i];
      const b = axis[i + 1];
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const abz = b[2] - a[2];
      const t = Math.min(
        1,
        Math.max(0, ((x - a[0]) * abx + (y - a[1]) * aby + (z - a[2]) * abz) / (abx * abx + aby * aby + abz * abz)),
      );
      best = Math.min(best, Math.hypot(x - a[0] - abx * t, y - a[1] - aby * t, z - a[2] - abz * t));
    }
    return best;
  }
  get visibleLegs(): number[] {
    if (this.solo) {
      return [0];
    } else {
      return [0, 1];
    }
  }
}
