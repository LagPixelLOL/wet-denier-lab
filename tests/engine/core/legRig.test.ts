import { describe, expect, it, vi } from "vitest";
import { FOREFOOT_JOIN } from "../../../src/engine/model/forefoot";
import { LegRig } from "../../../src/engine/rig/LegRig";
import type { LegRigTarget, RigUpdateState } from "../../../src/engine/rig/LegRig";
import type { Vec3 } from "../../../src/engine/rig/joints";
import { DEFAULT_POSE, POSES, POSE_ORDER } from "../../../src/engine/rig/poses";
import {
  buildLegMatrix,
  buildLegPose,
  computeFootLift,
  skinLegPoint,
  skinLegVertices,
} from "../../../src/engine/rig/skinning";
import type { LegPose } from "../../../src/engine/rig/skinning";
import type { SurfaceHit } from "../../../src/engine/surface/SurfaceGrid";
import { digestRounded } from "../../helpers/digest";
import { legModel, toeGap } from "../../helpers/model";

const DT = 1 / 60;

class RecordingTarget implements LegRigTarget {
  poseCalls = 0;
  pose: (LegPose | null)[] = [null, null];
  matrix: Float64Array[] = [new Float64Array(16), new Float64Array(16)];
  opacity = [NaN, NaN];
  castPoints: Vec3[] = [];
  setLegPose(index: number, pose: LegPose, matrix: Float64Array): void {
    this.poseCalls++;
    this.pose[index] = pose;
    this.matrix[index] = Float64Array.from(matrix);
  }
  setLegOpacity(index: number, opacity: number): void {
    this.opacity[index] = opacity;
  }
  setCastPoints(points: Vec3[], _radii?: number[]): void {
    this.castPoints = points.map((p): Vec3 => [p[0], p[1], p[2]]);
  }
}

function makeRig(): { rig: LegRig; target: RecordingTarget } {
  const target = new RecordingTarget();
  return { rig: new LegRig(legModel().collision, target), target };
}

/** A rig as the app builds it: with the forefoot's skin for bare legs. */
function makeToeRig(): { rig: LegRig; target: RecordingTarget } {
  const target = new RecordingTarget();
  return { rig: new LegRig(legModel().collision, target, legModel().forefootCollision), target };
}

let shared: { rig: LegRig; target: RecordingTarget } | undefined;

/** One untouched rig for the read-only tests (constructing a rig takes tens of milliseconds). */
const sharedRig = (): { rig: LegRig; target: RecordingTarget } => (shared ??= makeRig());

/** Steps the rig until it reports anything other than "moving"; returns the states seen. */
function runUntilStill(rig: LegRig, limit = 200): RigUpdateState[] {
  const states: RigUpdateState[] = [];
  for (let i = 0; i < limit; i++) {
    const state = rig.update(DT);
    states.push(state);
    if (state !== "moving" && state !== "fading") {
      return states;
    }
  }
  throw new Error("rig never settled");
}

function minY(pos: Float32Array, from: number, to: number): number {
  let min = Infinity;
  for (let v = from; v < to; v++) {
    min = Math.min(min, pos[v * 3 + 1]);
  }
  return min;
}

describe("pose catalog", () => {
  it("lists every pose exactly once, with the default among them", () => {
    expect([...POSE_ORDER].sort()).toEqual(Object.keys(POSES).sort());
    expect(POSE_ORDER).toContain(DEFAULT_POSE);
    expect(POSES.single.solo).toBe(true);
  });

  it("builds a finite LegPose for every leg of every pose", () => {
    for (const name of POSE_ORDER) {
      for (const spec of POSES[name].legs) {
        const pose = buildLegPose(spec);
        const numbers = [pose.x, pose.z, pose.ankle, pose.ev, pose.toe, ...pose.H, ...pose.A, ...pose.K, ...pose.T];
        expect(numbers.every(Number.isFinite)).toBe(true);
      }
    }
  });
});

describe("LegRig construction", () => {
  it("finds the floor and the foot vertices of the rest mesh", () => {
    const { rig } = sharedRig();
    const rest = legModel().collision;
    expect(rig.n).toBe(rest.pos.length / 3);
    expect(rig.legTris).toBe(rest.idx.length / 3);
    expect(rig.floorY).toBe(minY(rest.pos, 0, rig.n));
    expect(rig.foot.length).toBeGreaterThan(0);
    expect(rig.foot.every((v) => rest.pos[v * 3 + 1] < 0.14)).toBe(true);
    expect(rig.foot.length).toBe(
      Array.from({ length: rig.n }, (_, v) => v).filter((v) => rest.pos[v * 3 + 1] < 0.14).length,
    );
  });

  it("copies every pose and solves the reaching knee without touching the catalog", () => {
    const { rig } = sharedRig();
    expect(Object.keys(rig.poses).sort()).toEqual(Object.keys(POSES).sort());
    expect(rig.poses.point.legs[0].knee).toBeGreaterThan(0);
    expect("knee" in POSES.point.legs[0]).toBe(false);
    expect(rig.poses.step.legs[0]).not.toBe(POSES.step.legs[0]);
  });

  it("starts settled in the default pose with both legs shown and placed", () => {
    const { rig, target } = sharedRig();
    expect(rig.name).toBe(DEFAULT_POSE);
    expect([rig.t, rig.solo, rig.moving]).toEqual([1, false, false]);
    expect(rig.visibleLegs).toEqual([0, 1]);
    expect(rig.awayLeg).toBe(-1);
    expect(target.poseCalls).toBe(2);
    expect(target.opacity).toEqual([1, 1]);
    expect(target.castPoints.length).toBe(14);
    expect(rig.surface.active).toBe(rig.legTris * 2);
    for (const i of [0, 1]) {
      const pose = buildLegPose(rig.spec[i]);
      const lift = computeFootLift(rig.rest.pos, rig.foot, pose, rig.floorY);
      expect(rig.legs[i].lift).toBe(lift);
      expect([...target.matrix[i]]).toEqual([...buildLegMatrix(pose, i === 0 ? 1 : -1, lift)]);
    }
  });

  it("skins both legs into one buffer with their feet on the floor", () => {
    const { rig } = sharedRig();
    const expected = new Float32Array(rig.n * 3);
    const pose = buildLegPose(rig.spec[1]);
    skinLegVertices(
      rig.rest.pos,
      rig.rest.nrm,
      pose,
      -1,
      computeFootLift(rig.rest.pos, rig.foot, pose, rig.floorY),
      expected,
      null,
    );
    expect(rig.pos.subarray(rig.n * 3)).toEqual(expected);
    expect(minY(rig.pos, 0, rig.n)).toBeCloseTo(rig.floorY, 6);
    expect(minY(rig.pos, rig.n, rig.n * 2)).toBeCloseTo(rig.floorY, 6);
  });

  it("pins the posed mesh, footprint and cast points of the default pose", () => {
    const { rig, target } = sharedRig();
    expect({
      pos: digestRounded(rig.pos, 5),
      nrm: digestRounded(rig.nrm, 5),
      cast: digestRounded(target.castPoints.flat(), 7),
      footprint: Object.values(rig.footprint).map((v) => Math.round(v * 1e6) / 1e6),
      front: Math.round(rig.front * 1e6) / 1e6,
    }).toMatchInlineSnapshot(`
      {
        "cast": "5d694809",
        "footprint": [
          -0.002492,
          0.100821,
          0.453242,
          0.474249,
        ],
        "front": 0.307945,
        "nrm": "2b08bf71",
        "pos": "66f8a38a",
      }
    `);
  });
});

describe("LegRig pose blending", () => {
  it("rejects unknown poses and the current pose", () => {
    const { rig } = sharedRig();
    expect(rig.setPose("moonwalk")).toBe(false);
    expect(rig.setPose(DEFAULT_POSE)).toBe(false);
    expect(rig.moving).toBe(false);
  });

  it("eases from the old to the new pose over 0.55 s, then reports settled once", () => {
    const { rig, target } = makeRig();
    const from = rig.spec[0].x!;
    expect(rig.setPose("crossed")).toBe(true);
    expect([rig.name, rig.t, rig.moving]).toEqual(["crossed", 0, true]);
    // Collision is built at the target pose immediately.
    const targetPose = buildLegPose(rig.to[0]);
    const lift = computeFootLift(rig.rest.pos, rig.foot, targetPose, rig.floorY);
    const p = skinLegPoint(targetPose, 1, lift, rig.rest.pos[0], rig.rest.pos[1], rig.rest.pos[2]);
    expect([...rig.pos.subarray(0, 3)]).toEqual(p.map(Math.fround));

    expect(rig.update(DT)).toBe("moving");
    const t = DT / 0.55;
    expect(rig.t).toBeCloseTo(t, 12);
    expect(rig.spec[0].x).toBeCloseTo(from + (0.1 - from) * (1 - (1 - t) ** 3), 12);

    const calls = target.poseCalls;
    const states = runUntilStill(rig);
    expect(states.at(-1)).toBe("settled");
    // One step already taken plus the moving steps in `states`: 0.55 s at 60 fps, give or take rounding.
    expect(states.length).toBeGreaterThanOrEqual(33);
    expect(states.length).toBeLessThanOrEqual(34);
    expect(target.poseCalls - calls).toBe((states.length - 1) * 2);
    expect(rig.t).toBe(1);
    for (const key of ["x", "yaw", "roll", "pitch", "knee"] as const) {
      expect(rig.spec[0][key]).toBeCloseTo(POSES.crossed.legs[0][key] ?? 0, 12);
    }
    expect(rig.update(DT)).toBeNull();
  });

  it("jumps straight to a pose with instant", () => {
    const { rig, target } = makeRig();
    const calls = target.poseCalls;
    expect(rig.setPose("tiptoe", { instant: true })).toBe(true);
    expect([rig.t, rig.moving]).toEqual([1, false]);
    expect(rig.spec).toEqual(rig.to);
    expect(rig.spec).not.toBe(rig.to);
    expect(target.poseCalls - calls).toBe(2);
    expect(rig.update(DT)).toBeNull();
  });

  it("can retarget in the middle of a blend", () => {
    const { rig } = makeRig();
    rig.setPose("crossed");
    rig.update(DT);
    rig.update(DT);
    const midway = rig.spec[0].x!;
    rig.setPose("pigeon");
    expect(rig.from[0].x).toBe(midway);
    runUntilStill(rig);
    expect(rig.spec[0].x).toBeCloseTo(POSES.pigeon.legs[0].x, 12);
  });

  it("settles every pose with the visible feet on the floor", () => {
    const { rig } = makeRig();
    for (const name of POSE_ORDER.filter((pose) => pose !== DEFAULT_POSE)) {
      rig.setPose(name, { instant: true });
      expect(minY(rig.pos, 0, rig.n)).toBeCloseTo(rig.floorY, 6);
      if (!rig.solo) {
        expect(minY(rig.pos, rig.n, rig.n * 2)).toBeCloseTo(rig.floorY, 6);
      }
      expect(rig.footprint.w).toBeGreaterThanOrEqual(0.3);
      expect(rig.footprint.d).toBeGreaterThanOrEqual(0.3);
    }
  });
});

describe("LegRig solo and away fades", () => {
  it("fades the second leg out in 0.32 s when switching to a solo pose, keeping it in place", () => {
    const { rig, target } = makeRig();
    const leg1 = { ...rig.spec[1] };
    rig.setPose("single");
    expect(rig.solo).toBe(true);
    expect(rig.visibleLegs).toEqual([0]);
    expect(rig.shown).toEqual([1, 0]);
    expect(rig.to[1]).toEqual(leg1);
    expect(rig.surface.active).toBe(rig.legTris);
    expect(rig.footprint).toEqual({ x: 0, z: 0.04, w: 0.3, d: 0.3 });

    rig.update(DT);
    expect(rig.presence[1]).toBeCloseTo(1 - DT / 0.32, 12);
    expect(target.opacity[1]).toBeCloseTo(1 - DT / 0.32, 12);
    expect(target.opacity[0]).toBe(1);
    const states = runUntilStill(rig);
    expect(states.at(-1)).toBe("settled");
    expect(rig.presence).toEqual([1, 0]);
    expect(target.opacity[1]).toBe(0);
  });

  it("brings the second leg back at its new pose when leaving a solo pose", () => {
    const { rig, target } = makeRig();
    rig.setPose("single", { instant: true });
    expect(rig.presence).toEqual([1, 0]);
    expect(target.opacity[1]).toBe(0);
    rig.setPose("together");
    expect(rig.from[1]).toEqual(POSES.together.legs[1]);
    expect(rig.spec[1]).toEqual(POSES.together.legs[1]);
    expect(rig.surface.active).toBe(rig.legTris * 2);
    runUntilStill(rig);
    expect(rig.presence).toEqual([1, 1]);
    expect(target.opacity[1]).toBe(1);
  });

  it("dims a leg that is set away and reports which leg is away", () => {
    const { rig, target } = makeRig();
    rig.setAway(1, 1);
    expect(rig.update(DT)).toBe("fading");
    expect(rig.awayNow[1]).toBeCloseTo(DT / 0.28, 12);
    expect(target.opacity[1]).toBeCloseTo(1 - 0.84 * (DT / 0.28), 12);
    expect(rig.awayLeg).toBe(-1);
    const states = runUntilStill(rig);
    expect(states.at(-1)).toBeNull();
    expect(states.slice(0, -1).every((s) => s === "fading")).toBe(true);
    expect(rig.awayLeg).toBe(1);
    expect(target.opacity[1]).toBeCloseTo(0.16, 12);

    rig.setAway(1, 0);
    rig.setAway(0, 1);
    runUntilStill(rig);
    expect(rig.awayLeg).toBe(0);
    expect(target.opacity).toEqual([0.16, 1].map((v) => expect.closeTo(v, 12)));
  });

  it("applies the away state at once on an instant pose change", () => {
    const { rig } = makeRig();
    rig.setAway(0, 1);
    rig.setPose("point", { instant: true });
    expect(rig.awayNow).toEqual([1, 0]);
    expect(rig.awayNow).not.toBe(rig.away);
  });
});

describe("LegRig queries", () => {
  it("maps rest-space points to the target pose and caches the solved lift per target", () => {
    const { rig } = makeRig();
    const out: Vec3 = [0, 0, 0];
    expect(rig.point(1, 0.01, 0.3, 0.02, out)).toBe(out);
    const pose = buildLegPose(rig.to[1]);
    const lift = computeFootLift(rig.rest.pos, rig.foot, pose, rig.floorY);
    expect(out).toEqual(skinLegPoint(pose, -1, lift, 0.01, 0.3, 0.02));
    const cached = rig._settled[1];
    rig.point(1, 0, 0.5, 0);
    expect(rig._settled[1]).toBe(cached);

    rig.setPose("crossed");
    // Queries answer for the target pose even while the legs are still blending.
    const crossed = buildLegPose(rig.to[0]);
    const crossedLift = computeFootLift(rig.rest.pos, rig.foot, crossed, rig.floorY);
    expect(rig.point(0, 0, 0.2, 0)).toEqual(skinLegPoint(crossed, 1, crossedLift, 0, 0.2, 0));
    expect(rig._settled[0]?.spec).toBe(rig.to[0]);
  });

  it("measures the distance to the polyline through the leg axis", () => {
    const { rig } = sharedRig();
    const axis = rig.legs[0].axis;
    for (const p of axis) {
      expect(rig.distanceToLeg(0, p[0], p[1], p[2])).toBeCloseTo(0, 12);
    }
    const mid = axis[3].map((v, k) => (v + axis[4][k]) / 2);
    expect(rig.distanceToLeg(0, mid[0], mid[1], mid[2])).toBeCloseTo(0, 12);
    const away = rig.distanceToLeg(0, mid[0] + 0.1, mid[1], mid[2]);
    expect(away).toBeGreaterThan(0.09);
    expect(away).toBeLessThanOrEqual(0.1 + 1e-12);
    // Beyond the hip end the distance is to the end point.
    const top = axis[0];
    expect(rig.distanceToLeg(0, top[0], top[1] + 1, top[2])).toBeCloseTo(1, 6);
  });
});

/** A ray straight down through a leg's toe gap at its target pose, from 6 cm above the sole to 1 cm below it. */
function shootThroughGap(rig: LegRig, leg: number): SurfaceHit | null {
  const { x, z } = toeGap();
  const from = rig.point(leg, x, 0.06, z);
  const to = rig.point(leg, x, -0.01, z);
  const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const hit = rig.surface.raycast(
    from[0],
    from[1],
    from[2],
    (to[0] - from[0]) / length,
    (to[1] - from[1]) / length,
    (to[2] - from[2]) / length,
    length,
  );
  return hit && { ...hit };
}

describe("LegRig with the forefoot's skin", () => {
  it("appends the skin to each leg's mesh, the stocking's vertices and triangles first", () => {
    const { rig } = makeToeRig();
    const { collision, forefootCollision } = legModel();
    const skin = forefootCollision!;
    const stockingVerts = collision.pos.length / 3;
    const stockingTris = collision.idx.length / 3;
    expect(rig.stockingVerts).toBe(stockingVerts);
    expect(rig.n).toBe(stockingVerts + skin.pos.length / 3);
    expect(rig.legTris).toBe(stockingTris + skin.idx.length / 3);
    expect(rig.rest.pos.subarray(0, stockingVerts * 3)).toEqual(collision.pos);
    expect(rig.rest.pos.subarray(stockingVerts * 3)).toEqual(skin.pos);
    expect(rig.rest.nrm.subarray(stockingVerts * 3)).toEqual(skin.nrm);
    expect(rig.rest.uv.subarray(stockingVerts * 2)).toEqual(skin.uv);
    expect(rig.rest.idx.subarray(0, stockingTris * 3)).toEqual(collision.idx);
    expect(rig.rest.idx.subarray(stockingTris * 3)).toEqual(skin.idx.map((v) => v + stockingVerts));
    expect(rig.pos.length).toBe(rig.n * 6);
    expect(rig.surface.triCount).toBe(rig.legTris * 2);
    expect(rig.surface.legTris).toBe(rig.legTris);
    // The model's own collision mesh is left alone.
    expect(rig.rest).not.toBe(collision);
    expect(makeRig().rig.rest).toBe(collision);
  });

  it("stands, poses and skins the stocking exactly as a rig without the skin does", () => {
    const { rig, target } = makeToeRig();
    const plain = sharedRig();
    expect(rig.floorY).toBe(plain.rig.floorY);
    expect(rig.foot).toEqual(plain.rig.foot);
    expect(rig.poses).toEqual(plain.rig.poses);
    expect(rig.legs.map((leg) => leg.lift)).toEqual(plain.rig.legs.map((leg) => leg.lift));
    expect(target.matrix).toEqual(plain.target.matrix);
    expect(target.castPoints).toEqual(plain.target.castPoints);
    expect(rig.footprint).toEqual(plain.rig.footprint);
    expect(rig.front).toBe(plain.rig.front);
    const stocking = rig.stockingVerts * 3;
    for (const leg of [0, 1]) {
      const from = leg * rig.n * 3;
      expect(rig.pos.subarray(from, from + stocking)).toEqual(
        plain.rig.pos.subarray(leg * stocking, (leg + 1) * stocking),
      );
      expect(rig.nrm.subarray(from, from + stocking)).toEqual(
        plain.rig.nrm.subarray(leg * stocking, (leg + 1) * stocking),
      );
      // The skin is skinned like every other vertex.
      const skin = legModel().forefootCollision!;
      const expected = new Float32Array(skin.pos.length);
      const normals = new Float32Array(skin.pos.length);
      skinLegVertices(
        skin.pos,
        skin.nrm,
        buildLegPose(rig.spec[leg]),
        leg === 0 ? 1 : -1,
        rig.legs[leg].lift,
        expected,
        normals,
      );
      expect(rig.pos.subarray(from + stocking, from + rig.n * 3)).toEqual(expected);
      expect(rig.nrm.subarray(from + stocking, from + rig.n * 3)).toEqual(normals);
    }
    // In every pose too, the solved knee and the lifts included.
    const other = makeRig().rig;
    for (const name of POSE_ORDER.filter((pose) => pose !== DEFAULT_POSE)) {
      rig.setPose(name, { instant: true });
      other.setPose(name, { instant: true });
      expect(rig.legs.map((leg) => leg.lift)).toEqual(other.legs.map((leg) => leg.lift));
      expect(rig.footprint).toEqual(other.footprint);
      expect(rig.front).toBe(other.front);
      expect(rig.point(0, 0.01, 0.02, 0.18)).toEqual(other.point(0, 0.01, 0.02, 0.18));
    }
  });

  it("sorts the triangles into the stocking behind the join, its front and the skin", () => {
    const { rig } = makeToeRig();
    const { collision } = legModel();
    const stockingTris = collision.idx.length / 3;
    const counts = [0, 0, 0];
    for (let t = 0; t < rig.legTris; t++) {
      const group = rig.triGroup[t];
      counts[group]++;
      const corners = [rig.rest.idx[t * 3], rig.rest.idx[t * 3 + 1], rig.rest.idx[t * 3 + 2]];
      const inFront = corners.every(
        (v) => rig.rest.pos[v * 3 + 2] > FOREFOOT_JOIN.cut && rig.rest.pos[v * 3 + 1] < FOREFOOT_JOIN.maxY,
      );
      if (t >= stockingTris ? group !== 2 : group !== (inFront ? 1 : 0)) {
        throw new Error("triangle " + t + " is in group " + group);
      }
    }
    expect(counts[0] + counts[1]).toBe(stockingTris);
    // The front of the foot is a good part of the stocking's mesh, and the shin above it is not in it.
    expect(counts[1]).toBeGreaterThan(stockingTris / 8);
    expect(counts[1]).toBeLessThan(stockingTris / 2);
    expect(counts[2]).toBeGreaterThan(1000);
    // Both legs start in a stocking: the skin is left out, the stocking's front is in.
    expect(rig.bare).toEqual([false, false]);
    for (const leg of [0, 1]) {
      const skip = rig.surface.skip.subarray(leg * rig.legTris, (leg + 1) * rig.legTris);
      expect(skip).toEqual(rig.triGroup.map((group) => (group === 2 ? 1 : 0)));
    }
    expect(rig.surface.active).toBe(rig.legTris * 2);
    // The skin borrows the stocking's UVs, so it adds no UV island.
    expect(rig.surface.islandCount).toBe(sharedRig().rig.surface.islandCount);
  });

  it("collides like a rig without the skin while both legs wear a stocking", () => {
    const { rig } = makeToeRig();
    const plain = sharedRig().rig;
    expect(rig.surface.dims).toEqual(plain.surface.dims);
    expect(rig.surface.min).toEqual(plain.surface.min);
    expect(rig.surface.max).toEqual(plain.surface.max);
    const { x, z } = toeGap();
    const fields = (hit: SurfaceHit | null): number[] | null =>
      hit && [hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, hit.u, hit.v, hit.dist, hit.side, hit.leg, hit.ry];
    for (const leg of [0, 1]) {
      for (const y of [0.005, 0.012, 0.03]) {
        const p = rig.point(leg, x, y, z);
        expect(fields(rig.surface.closest(p[0], p[1], p[2], 0.03))).toEqual(
          fields(plain.surface.closest(p[0], p[1], p[2], 0.03)),
        );
        expect(fields(rig.surface.raycast(p[0], p[1] + 0.2, p[2], 0, -1, 0))).toEqual(
          fields(plain.surface.raycast(p[0], p[1] + 0.2, p[2], 0, -1, 0)),
        );
      }
    }
  });

  it("lets a ray through between the toes of a bare leg, and stops it on the stocking stretched over them", () => {
    const { rig } = makeToeRig();
    const covered = shootThroughGap(rig, 0)!;
    // The stocking spans the gap about level with the tops of the toes, 3 cm under the ray's start.
    expect(covered.leg).toBe(0);
    expect(covered.t).toBeGreaterThan(0.025);
    expect(covered.t).toBeLessThan(0.04);
    expect(covered.ny).toBeGreaterThan(0.8);
    expect(rig.triGroup[covered.tri]).toBe(1);

    rig.setBare(0, true);
    expect(rig.bare).toEqual([true, false]);
    // Between the toes: all the way through, or onto the side of a toe well below the stocking.
    const bare = shootThroughGap(rig, 0);
    if (bare && (bare.t < covered.t + 0.004 || rig.triGroup[bare.tri] !== 2)) {
      throw new Error("the ray stopped on " + JSON.stringify(bare));
    }
    // The other leg still wears its stocking.
    const other = shootThroughGap(rig, 1)!;
    expect(other.leg).toBe(1);
    // The toes bend a little along their length, and the two legs of the pose bend them differently.
    expect(other.t).toBeCloseTo(covered.t, 3);
    expect(rig.triGroup[other.tri - rig.legTris]).toBe(1);

    rig.setBare(1, true);
    const otherBare = shootThroughGap(rig, 1);
    expect(otherBare === null || otherBare.t > other.t + 0.004).toBe(true);
    rig.setBare(0, false);
    expect(shootThroughGap(rig, 0)).toEqual(covered);
    rig.setBare(1, false);
    expect(shootThroughGap(rig, 1)).toEqual(other);
  });

  it("finds the side of a toe from inside the gap of a bare leg, in the leg's own half of the UVs", () => {
    const { rig } = makeToeRig();
    const { x, z } = toeGap();
    const across = [0, 1].map((leg) => {
      const a = rig.point(leg, x - 0.001, 0.012, z);
      const b = rig.point(leg, x + 0.001, 0.012, z);
      return [b[0] - a[0], b[1] - a[1], b[2] - a[2]].map((c) => c / 0.002);
    });
    const sideways = (leg: number): { hit: SurfaceHit; turn: number; rects: number } => {
      const p = rig.point(leg, x, 0.012, z);
      const hit = { ...rig.surface.closest(p[0], p[1], p[2], 0.03)! };
      const rects = rig.surface.uvRects(p[0], p[1], p[2], 0.01, []).length;
      return {
        hit,
        turn: Math.abs(hit.nx * across[leg][0] + hit.ny * across[leg][1] + hit.nz * across[leg][2]),
        rects,
      };
    };
    for (const leg of [0, 1]) {
      // Inside the stocking, its sole is the nearest surface: below, facing down.
      const covered = sideways(leg);
      expect([covered.hit.leg, covered.hit.side]).toEqual([leg, -1]);
      expect(covered.turn).toBeLessThan(0.4);
      rig.setBare(leg, true);
      // Between two bare toes it is the flank of one of them, nearer and facing across the gap.
      const bare = sideways(leg);
      expect([bare.hit.leg, bare.hit.side]).toEqual([leg, 1]);
      expect(bare.turn).toBeGreaterThan(0.8);
      expect(bare.hit.dist).toBeLessThan(covered.hit.dist);
      expect(rig.triGroup[bare.hit.tri - leg * rig.legTris]).toBe(2);
      expect(Math.floor(bare.hit.u * 2)).toBe(leg);
      expect(Math.abs(bare.hit.u - covered.hit.u)).toBeLessThan(0.05);
      expect(Math.abs(bare.hit.v - covered.hit.v)).toBeLessThan(0.05);
      // One stamp rectangle, as on the stocking: the skin is part of the stocking's UV island.
      expect([covered.rects, bare.rects]).toEqual([1, 1]);
    }
  });

  it("stamps the stocking and the skin of a bare leg as one UV island where they join", () => {
    const { rig } = makeToeRig();
    // On the instep at the cut, where the stocking's mesh ends and the skin begins.
    const above = rig.point(0, 0, 0.1, FOREFOOT_JOIN.cut);
    const join = { ...rig.surface.raycast(above[0], above[1], above[2], 0, -1, 0)! };
    const covered = rig.surface.uvRects(join.x, join.y, join.z, 0.01, []);
    rig.setBare(0, true);
    // Both meshes are within reach: triangles behind the cut and triangles of the skin.
    const groups = new Set<number>();
    for (const dz of [-0.008, -0.004, 0, 0.004, 0.008]) {
      groups.add(rig.triGroup[rig.surface.closest(join.x, join.y, join.z + dz, 0.01)!.tri]);
    }
    expect([...groups].sort()).toEqual([0, 2]);
    const bare = rig.surface.uvRects(join.x, join.y, join.z, 0.01, []);
    expect(bare).toHaveLength(1);
    expect(covered).toHaveLength(1);
    // About the same patch of the wet map either way.
    for (let k = 0; k < 4; k++) {
      expect(Math.abs(bare[0][k] - covered[0][k])).toBeLessThan(0.01);
    }
  });

  it("keeps a bare leg's state through pose changes, and still drops the second leg in solo poses", () => {
    const { rig } = makeToeRig();
    rig.setBare(1, true);
    rig.setPose("crossed", { instant: true });
    expect(shootThroughGap(rig, 0)?.leg).toBe(0);
    const bare = shootThroughGap(rig, 1);
    expect(bare === null || rig.triGroup[bare.tri - rig.legTris] === 2).toBe(true);

    rig.setPose("single", { instant: true });
    expect(rig.surface.active).toBe(rig.legTris);
    const { x, z } = toeGap();
    const hidden = rig.point(1, x + 0.01, 0.02, z);
    expect(rig.surface.closest(hidden[0], hidden[1], hidden[2], 0.02)?.leg ?? 0).toBe(0);
    // Changing the hidden leg re-indexes the first leg only.
    rig.setBare(1, false);
    expect(rig.surface.active).toBe(rig.legTris);
    rig.setBare(1, true);
    rig.setBare(0, true);
    expect(rig.surface.active).toBe(rig.legTris);
    expect(shootThroughGap(rig, 0)?.t ?? Infinity).toBeGreaterThan(0.04);

    rig.setPose("together", { instant: true });
    expect(rig.surface.active).toBe(rig.legTris * 2);
    expect(rig.bare).toEqual([true, true]);
    const back = rig.point(1, x + 0.01, 0.02, z);
    const toe = rig.surface.closest(back[0], back[1], back[2], 0.02)!;
    expect(toe.leg).toBe(1);
    expect(rig.triGroup[toe.tri - rig.legTris]).toBe(2);
  });

  it("re-indexes the surface only when a leg's state changes", () => {
    const { rig } = makeToeRig();
    const rebuild = vi.spyOn(rig.surface, "rebuild");
    rig.setBare(0, false);
    expect(rebuild).not.toHaveBeenCalled();
    rig.setBare(0, true);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(rebuild).toHaveBeenLastCalledWith(rig.legTris * 2);
    rig.setBare(0, true);
    expect(rebuild).toHaveBeenCalledTimes(1);
    rig.setBare(0, false);
    expect(rebuild).toHaveBeenCalledTimes(2);
  });

  it("has nothing to switch without the skin", () => {
    const { rig } = makeRig();
    expect(rig.stockingVerts).toBe(rig.n);
    expect(new Set(rig.triGroup)).toEqual(new Set([0]));
    const rebuild = vi.spyOn(rig.surface, "rebuild");
    const covered = shootThroughGap(rig, 0);
    rig.setBare(0, true);
    expect(rig.bare).toEqual([true, false]);
    expect(rebuild).not.toHaveBeenCalled();
    expect(new Set(rig.surface.skip)).toEqual(new Set([0]));
    expect(shootThroughGap(rig, 0)).toEqual(covered);
    expect(covered?.leg).toBe(0);
  });
});
