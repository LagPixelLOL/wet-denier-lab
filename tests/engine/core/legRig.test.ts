import { describe, expect, it } from "vitest";
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
import { digestRounded } from "../../helpers/digest";
import { legModel } from "../../helpers/model";

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
    expect(rig.poses.point.label).toBe(POSES.point.label);
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
        "cast": "81fe8d9c",
        "footprint": [
          -0.002492,
          0.102529,
          0.453242,
          0.470385,
        ],
        "front": 0.307722,
        "nrm": "5146f134",
        "pos": "be14cddb",
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
