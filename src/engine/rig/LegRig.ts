/**
 * CPU skinning of both legs, floor placement, eased pose blending and solo/away opacity fades.
 */
import { DEFAULT_POSE, POSES } from "./poses";
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
import { SurfaceGrid } from "../surface/SurfaceGrid";

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

const POSE_BLEND_SECONDS = 0.55;

const LEG_FADE_SECONDS = 0.32;

const AWAY_LEG_OPACITY = 0.16;

const LEG_AXIS_POINTS = [
  [0, 0.8, 0.03],
  [0, 0.62, 0.03],
  [0, 0.49, 0.02],
  [0, 0.33, 0],
  [0, 0.17, 0],
  [0.005, 0.07, 0.01],
  [0, 0.03, 0.11],
];

export class LegRig {
  constructor(rest, look) {
    this.rest = rest;
    this.look = look;
    const vertCount = (this.n = rest.pos.length / 3);
    const triCount = rest.idx.length / 3;
    this.floorY = Infinity;
    for (let i = 1; i < rest.pos.length; i += 3) {
      this.floorY = Math.min(this.floorY, rest.pos[i]);
    }
    this.foot = [];
    for (let i = 0; i < vertCount; i++) {
      if (rest.pos[i * 3 + 1] < 0.14) {
        this.foot.push(i);
      }
    }
    this.poses = {};
    for (const [key, pose] of Object.entries(POSES)) {
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
    const indices = new Uint32Array(triCount * 6);
    for (let i = 0; i < vertCount; i++) {
      uv[i * 2] = rest.uv[i * 2] * 0.5;
      uv[i * 2 + 1] = rest.uv[i * 2 + 1];
      uv[(vertCount + i) * 2] = rest.uv[i * 2] * 0.5 + 0.5;
      uv[(vertCount + i) * 2 + 1] = rest.uv[i * 2 + 1];
      restY[i] = restY[vertCount + i] = fadeHeight(rest.pos[i * 3], rest.pos[i * 3 + 1], rest.pos[i * 3 + 2]);
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
    this.legs = [0, 1].map(() => ({
      p: null,
      lift: 0,
      m: new Float64Array(16),
      axis: LEG_AXIS_POINTS.map(() => [0, 0, 0]),
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
      legTris: triCount,
    });
    this.surface.rebuild(this.solo ? triCount : triCount * 2);
  }
  _place() {
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i];
      const legPose = (leg.p = buildLegPose(this.spec[i]));
      const side = i === 0 ? 1 : -1;
      leg.lift = computeFootLift(this.rest.pos, this.foot, legPose, this.floorY);
      buildLegMatrix(legPose, side, leg.lift, leg.m);
      this.look.setLegPose(i, legPose, leg.m);
      LEG_AXIS_POINTS.forEach((pt, j) => skinLegPoint(legPose, side, leg.lift, pt[0], pt[1], pt[2], leg.axis[j]));
    }
    this.look.setCastPoints(this.legs[0].axis.concat(this.legs[1].axis));
    this._fade();
  }
  _fade() {
    for (let i = 0; i < 2; i++) {
      this.look.setLegOpacity(i, this.presence[i] * (1 - (1 - AWAY_LEG_OPACITY) * this.awayNow[i]));
    }
  }
  _collide(specs) {
    const pos = this.pos;
    const n = this.n;
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
        for (let v = i * n, end = v + n; v < end; v++) {
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
  setPose(poseName, { instant = false } = {}) {
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
    this.surface.rebuild(this.solo ? this.legTris : this.legTris * 2);
    this.moving = !instant;
    return true;
  }
  setAway(legIndex, amount) {
    this.away[legIndex] = amount;
  }
  get awayLeg() {
    if (this.awayNow[0] > 0.5) {
      return 0;
    } else if (this.awayNow[1] > 0.5) {
      return 1;
    } else {
      return -1;
    }
  }
  update(dt) {
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
    const approach = (current, target, duration) => {
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
      this._fade();
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
  point(legIndex, lx, ly, lz, out = [0, 0, 0]) {
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
  distanceToLeg(legIndex, x, y, z) {
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
  get visibleLegs() {
    if (this.solo) {
      return [0];
    } else {
      return [0, 1];
    }
  }
}
