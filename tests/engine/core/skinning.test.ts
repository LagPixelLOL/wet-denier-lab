import { parse } from "@shaderfrog/glsl-parser";
import { describe, expect, it } from "vitest";
import { DEG2RAD, LEG_JOINTS, LEG_SKINNING_GLSL } from "../../../src/engine/rig/joints";
import type { Vec3 } from "../../../src/engine/rig/joints";
import { POSES, POSE_ORDER } from "../../../src/engine/rig/poses";
import {
  buildLegMatrix,
  buildLegPose,
  computeFootLift,
  lerpLegSpec,
  skinLegPoint,
  skinLegVertices,
  solveReachKnees,
} from "../../../src/engine/rig/skinning";
import type { LegPoseSpec } from "../../../src/engine/rig/skinning";
import { digestRounded } from "../../helpers/digest";
import { legModel } from "../../helpers/model";

const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const round = (values: ArrayLike<number>, decimals = 6): number[] =>
  Array.from(values, (v) => Math.round(v * 10 ** decimals) / 10 ** decimals + 0);

/** Rest mesh, foot vertices and floor height as LegRig derives them. */
function restLeg() {
  const rest = legModel().collision;
  const foot: number[] = [];
  let floorY = Infinity;
  for (let i = 0; i < rest.pos.length / 3; i++) {
    floorY = Math.min(floorY, rest.pos[i * 3 + 1]);
    if (rest.pos[i * 3 + 1] < 0.14) {
      foot.push(i);
    }
  }
  return { rest, foot, floorY };
}

/** Column-major 4x4 times point. */
function transform(m: Float64Array, p: readonly number[]): number[] {
  return [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
}

const ALL_JOINTS: LegPoseSpec = {
  x: 0.05,
  z: 0.01,
  yaw: 12,
  roll: -9,
  pitch: -14,
  knee: 25,
  heel: 20,
  ankle: 8,
  toe: -15,
};

describe("joint constants and the GLSL skinning chunk", () => {
  it("defines degrees-to-radians", () => {
    expect(DEG2RAD * 180).toBe(Math.PI);
  });

  it("bakes every pivot and blend range into the shader with four decimals", () => {
    const f = (v: number): string => v.toFixed(4);
    const vec = (v: readonly number[]): string => `vec${v.length}(` + v.map(f).join(", ") + ")";
    const expected = [
      `smoothstepD(${f(LEG_JOINTS.toeZ[0])}, ${f(LEG_JOINTS.toeZ[1])}, rest.z, dToeZ)`,
      `smoothstepD(${f(LEG_JOINTS.toeY[0])}, ${f(LEG_JOINTS.toeY[1])}, rest.y, dToeY)`,
      `uToeRot, ${vec(LEG_JOINTS.toe)}`,
      `smoothstepD(${f(LEG_JOINTS.ankleBackZ[0])}, ${f(LEG_JOINTS.ankleBackZ[1])}, rest.z, dAnkleBack)`,
      `mix(${vec(LEG_JOINTS.ankleY)}, ${vec(LEG_JOINTS.ankleBackY)}, ankleBack)`,
      `mix(${vec([LEG_JOINTS.ankleHoldY[0], LEG_JOINTS.ankleHoldEase[0]])}, ${vec([LEG_JOINTS.ankleHoldY[1], LEG_JOINTS.ankleHoldEase[1]])}, ankleBack)`,
      `uAnkleRot, ${vec(LEG_JOINTS.ankle)}`,
      `smoothstepD(${f(LEG_JOINTS.kneeY[0])}, ${f(LEG_JOINTS.kneeY[1])}, rest.y, dKnee)`,
      `uKneeRot, ${vec(LEG_JOINTS.knee)}`,
    ];
    for (const snippet of expected) {
      expect(LEG_SKINNING_GLSL).toContain(snippet);
    }
    expect(LEG_SKINNING_GLSL).toContain("smoothstepD(0.4150, 0.5650, rest.y, dKnee)");
    expect(LEG_SKINNING_GLSL).toContain("vec3(0.0000, 0.4900, 0.0150)");
  });

  it("is valid GLSL ES 3.00", () => {
    const source =
      "#version 300 es\nprecision highp float;\nin vec3 position;\n" +
      LEG_SKINNING_GLSL +
      "void main() { mat3 jac; vec3 p = skinPosition(position, jac); gl_Position = vec4(p + skinNormal(jac, p), 1.0); }\n";
    expect(() => parse(source, { stage: "vertex", quiet: true, failOnWarn: true })).not.toThrow();
  });
});

describe("lerpLegSpec", () => {
  it("interpolates every key, treating missing keys as 0", () => {
    const out = lerpLegSpec({ x: 0.1, knee: 10 }, { x: 0.3, yaw: 20 }, 0.25);
    expect(round([out.x!, out.knee!, out.yaw!, out.z!, out.toe!])).toEqual([0.15, 7.5, 5, 0, 0]);
    expect(Object.keys(out).sort()).toEqual(["ankle", "heel", "knee", "pitch", "roll", "toe", "x", "yaw", "z"]);
  });

  it("writes into and returns the given output", () => {
    const out: LegPoseSpec = { reach: true };
    expect(lerpLegSpec({ heel: 30 }, { heel: 10 }, 1, out)).toBe(out);
    expect(out.heel).toBe(10);
    expect(out.reach).toBe(true);
  });
});

describe("buildLegPose", () => {
  it("resolves an empty spec to the rest pose", () => {
    const pose = buildLegPose({});
    expect([pose.x, pose.z, pose.yaw, pose.roll, pose.pitch, pose.knee, pose.ankle, pose.toe, pose.on]).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    for (const m of [pose.T, pose.A, pose.K, pose.H]) {
      expect(round(m)).toEqual(IDENTITY3);
    }
  });

  it("only turns the joints on when something below the hip rotates", () => {
    expect(buildLegPose({ x: 0.1, z: 0.2, yaw: 30 }).on).toBe(0);
    expect(buildLegPose({ knee: 5 }).on).toBe(1);
    expect(buildLegPose({ toe: 5 }).on).toBe(1);
    expect(buildLegPose({ pitch: 5 }).on).toBe(1);
  });

  it("counter-rotates the ankle against hip pitch and roll and splits heel into ankle and toe", () => {
    const pitched = buildLegPose({ pitch: 10 });
    expect(pitched.ankle).toBeCloseTo(-10 * DEG2RAD, 12);
    const rolled = buildLegPose({ roll: 10 });
    expect(rolled.ev).toBeCloseTo(-10 * DEG2RAD, 12);
    const heel = buildLegPose({ heel: 30, toe: 5, ankle: 2 });
    expect(heel.ankle).toBeCloseTo(32 * DEG2RAD, 12);
    expect(heel.toe).toBeCloseTo(-25 * DEG2RAD, 12);
  });

  it("keeps the sole level whatever the hip and knee do (when heel and ankle are 0)", () => {
    for (const spec of [
      { pitch: -17, roll: 6, yaw: 13, knee: 20 },
      { roll: -16, pitch: -15, knee: 12 },
      { knee: 40 },
    ]) {
      const pose = buildLegPose(spec);
      const heights = [
        [0, 0.01, 0],
        [0.03, 0.01, 0.06],
        [-0.02, 0.03, 0.1],
      ].map((p) => skinLegPoint(pose, 1, 0, p[0], p[1], p[2])[1]);
      expect(heights[1] - heights[0]).toBeCloseTo(0, 12);
      expect(heights[2] - heights[0]).toBeCloseTo(0.02, 12);
    }
  });

  it("pins a fully articulated pose", () => {
    const pose = buildLegPose(ALL_JOINTS);
    expect(
      digestRounded(
        [
          pose.yaw,
          pose.roll,
          pose.pitch,
          pose.knee,
          pose.ankle,
          pose.ev,
          pose.toe,
          ...pose.T,
          ...pose.A,
          ...pose.K,
          ...pose.H,
        ],
        9,
      ),
    ).toMatchInlineSnapshot(`"3bbf00a0"`);
  });
});

describe("buildLegMatrix", () => {
  it("is a pure lift for the rest pose and mirrors x for the other side", () => {
    const rest = buildLegPose({});
    expect(round(buildLegMatrix(rest, 1, 0.02))).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0.02, 0, 1]);
    expect(round(buildLegMatrix(rest, -1, 0))).toEqual([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it("rotates about the hip and moves it by (side * x, lift, z)", () => {
    const pose = buildLegPose(ALL_JOINTS);
    for (const side of [1, -1]) {
      const m = buildLegMatrix(pose, side, 0.03);
      const hip = transform(m, LEG_JOINTS.hip);
      expect(hip[0]).toBeCloseTo(side * 0.05, 12);
      expect(hip[1]).toBeCloseTo(LEG_JOINTS.hip[1] + 0.03, 12);
      expect(hip[2]).toBeCloseTo(LEG_JOINTS.hip[2] + 0.01, 12);
    }
  });

  it("writes into the given array", () => {
    const out = new Float64Array(16);
    expect(buildLegMatrix(buildLegPose({}), 1, 0, out)).toBe(out);
    expect(out[15]).toBe(1);
  });
});

describe("skinLegPoint", () => {
  it("is the identity for the rest pose and mirrors x on the other side", () => {
    const rest = buildLegPose({});
    expect(skinLegPoint(rest, 1, 0, 0.01, 0.2, 0.03)).toEqual([0.01, 0.2, 0.03]);
    const out: Vec3 = [0, 0, 0];
    expect(skinLegPoint(rest, -1, 0.5, 0.01, 0.2, 0.03, out)).toBe(out);
    expect(round(out)).toEqual([-0.01, 0.7, 0.03]);
  });

  it("matches the plain hip matrix above the knee blend and bends below it", () => {
    const pose = buildLegPose(ALL_JOINTS);
    const m = buildLegMatrix(pose, -1, 0.01);
    const thigh = [0.02, LEG_JOINTS.kneeY[1] + 0.001, 0.04];
    expect(round(skinLegPoint(pose, -1, 0.01, thigh[0], thigh[1], thigh[2]), 12)).toEqual(
      round(transform(m, thigh), 12),
    );
    const shin = [0.02, 0.3, 0.04];
    const skinned = skinLegPoint(pose, -1, 0.01, shin[0], shin[1], shin[2]);
    const rigid = transform(m, shin);
    expect(Math.hypot(skinned[0] - rigid[0], skinned[1] - rigid[1], skinned[2] - rigid[2])).toBeGreaterThan(0.01);
  });

  it("bends the toes only in front of the toe joint and below its blend height", () => {
    const pose = buildLegPose({ toe: 30 });
    const behind = skinLegPoint(pose, 1, 0, 0, 0.01, LEG_JOINTS.toeZ[0] - 0.001);
    expect(behind).toEqual([0, 0.01, LEG_JOINTS.toeZ[0] - 0.001]);
    const above = skinLegPoint(pose, 1, 0, 0, LEG_JOINTS.toeY[1] + 0.001, 0.18);
    expect(above).toEqual([0, LEG_JOINTS.toeY[1] + 0.001, 0.18]);
    const tip = skinLegPoint(pose, 1, 0, 0, 0.01, 0.2);
    expect(tip[1]).toBeLessThan(0.01);
  });

  it("turns the toes along an arc about their pivot, so the bend keeps its thickness", () => {
    const pose = buildLegPose({ toe: -38 });
    const [, pivotY, pivotZ] = LEG_JOINTS.toe;
    for (const z of [0.1, 0.12, 0.135, 0.15, 0.17, 0.2]) {
      for (const y of [0.002, 0.03, 0.055]) {
        const out = skinLegPoint(pose, 1, 0, 0.01, y, z);
        expect(Math.hypot(out[1] - pivotY, out[2] - pivotZ)).toBeCloseTo(Math.hypot(y - pivotY, z - pivotZ), 12);
        expect(out[0]).toBeCloseTo(0.01, 12);
      }
    }
  });

  it("moves the skin around the ankle with the foot under it instead of swinging it around the ankle", () => {
    const pose = buildLegPose({ ankle: 38 });
    const z = -0.045;
    // Behind the leg, from the top of the heel up to the calf: the skin over the Achilles tendon.
    let last = skinLegPoint(pose, 1, 0, 0, 0.07, z);
    for (let y = 0.08; y < LEG_JOINTS.ankleBackY[1]; y += 0.01) {
      const out = skinLegPoint(pose, 1, 0, 0, y, z);
      // It follows the heel back, less and less up the leg and never forward, and keeps its order up the leg.
      expect(out[2]).toBeLessThanOrEqual(z);
      expect(out[2]).toBeGreaterThan(z - 0.016);
      expect(out[2]).toBeGreaterThan(last[2] - 0.0005);
      expect(out[1]).toBeGreaterThan(last[1]);
      expect(out[1]).toBeGreaterThanOrEqual(y);
      last = out;
    }
    // The heel itself turns with the foot, up and back.
    const heel = skinLegPoint(pose, 1, 0, 0, 0.03, -0.055);
    expect(heel[1]).toBeGreaterThan(0.06);
    expect(heel[2]).toBeLessThan(-0.065);
    // In front of the leg the top of the instep goes down with the foot, and never forward of where it was.
    for (let y = 0.08; y < LEG_JOINTS.ankleY[1]; y += 0.01) {
      const front = skinLegPoint(pose, 1, 0, 0, y, 0.05);
      expect(front[1]).toBeLessThan(y);
      expect(front[2]).toBeLessThanOrEqual(0.05);
    }
    // Below the hold the foot turns about the ankle as one piece.
    const [, pivotY, pivotZ] = LEG_JOINTS.ankle;
    const sole = skinLegPoint(pose, 1, 0, 0, 0.02, 0.08);
    expect(Math.hypot(sole[1] - pivotY, sole[2] - pivotZ)).toBeCloseTo(Math.hypot(0.02 - pivotY, 0.08 - pivotZ), 12);
    expect(skinLegPoint(pose, 1, 0, 0, LEG_JOINTS.ankleBackY[1] + 0.001, z)).toEqual([
      0,
      LEG_JOINTS.ankleBackY[1] + 0.001,
      z,
    ]);
  });
});

describe("skinLegVertices", () => {
  it("writes the same positions as skinLegPoint, starting at the given vertex offset", () => {
    const { rest } = restLeg();
    const pose = buildLegPose(ALL_JOINTS);
    const count = rest.pos.length / 3;
    const out = new Float32Array(rest.pos.length * 2);
    skinLegVertices(rest.pos, rest.nrm, pose, -1, 0.02, out, null, count);
    expect(out.subarray(0, count * 3).every((v) => v === 0)).toBe(true);
    for (let i = 0; i < count; i += 397) {
      const p = skinLegPoint(pose, -1, 0.02, rest.pos[i * 3], rest.pos[i * 3 + 1], rest.pos[i * 3 + 2]);
      expect([...out.subarray((count + i) * 3, (count + i) * 3 + 3)]).toEqual(p.map(Math.fround));
    }
  });

  it("returns the rest mesh unchanged for the rest pose", () => {
    const { rest } = restLeg();
    const pos = new Float32Array(rest.pos.length);
    const nrm = new Float32Array(rest.nrm.length);
    skinLegVertices(rest.pos, rest.nrm, buildLegPose({}), 1, 0, pos, nrm);
    expect(pos).toEqual(rest.pos);
    for (let i = 0; i < nrm.length; i++) {
      if (Math.abs(nrm[i] - rest.nrm[i]) > 1e-6) {
        throw new Error("normal changed at " + i);
      }
    }
  });

  it("leaves zero normals at zero instead of NaN", () => {
    const nrm = new Float32Array(3).fill(7);
    skinLegVertices([0, 0.3, 0], [0, 0, 0], buildLegPose(ALL_JOINTS), 1, 0, new Float32Array(3), nrm);
    expect([...nrm]).toEqual([0, 0, 0]);
  });

  it("transforms normals like the finite-difference surface tangents (Jacobian check)", () => {
    const pose = buildLegPose(ALL_JOINTS);
    const probes: Vec3[] = [
      [0.01, 0.06, 0.137], // toe blend in both z and y
      [0.0, 0.02, 0.06], // fully weighted foot
      [0.01, 0.09, 0.0], // ankle blend
      [0.0, 0.12, -0.04], // behind the ankle, held to the heel's height
      [0.01, 0.06, -0.02], // where the hold sets in, between the front and the back
      [0.0, 0.09, 0.05], // in front of the ankle, held
      [0.0, 0.03, 0.13], // toe blend in z only
      [0.0, 0.49, 0.05], // knee blend
      [0.03, 0.7, 0.0], // thigh, hip only
    ];
    const n0 = [0.3, 0.5, 0.8].map((v) => v / Math.hypot(0.3, 0.5, 0.8));
    // Two tangents perpendicular to n0.
    const t1 = [n0[1], -n0[0], 0].map((v) => v / Math.hypot(n0[0], n0[1]));
    const t2 = [n0[1] * t1[2] - n0[2] * t1[1], n0[2] * t1[0] - n0[0] * t1[2], n0[0] * t1[1] - n0[1] * t1[0]];
    const eps = 1e-6;
    for (const side of [1, -1]) {
      for (const p of probes) {
        const nrm = new Float32Array(3);
        skinLegVertices(p, n0, pose, side, 0, new Float32Array(3), nrm);
        const at = (t: number[], s: number): Vec3 =>
          skinLegPoint(pose, side, 0, p[0] + t[0] * s, p[1] + t[1] * s, p[2] + t[2] * s);
        const a0 = at(t1, -eps);
        const a1 = at(t1, eps);
        const b0 = at(t2, -eps);
        const b1 = at(t2, eps);
        const da = [0, 1, 2].map((k) => a1[k] - a0[k]);
        const db = [0, 1, 2].map((k) => b1[k] - b0[k]);
        const cross = [da[1] * db[2] - da[2] * db[1], da[2] * db[0] - da[0] * db[2], da[0] * db[1] - da[1] * db[0]];
        const len = Math.hypot(cross[0], cross[1], cross[2]);
        const dot = (cross[0] * nrm[0] + cross[1] * nrm[1] + cross[2] * nrm[2]) / len;
        // Mirroring flips the tangent frame's handedness but the skinned normal stays outward.
        expect(dot * side).toBeGreaterThan(0.99999);
      }
    }
  });
});

describe("computeFootLift", () => {
  it("is zero for the rest pose", () => {
    const { rest, foot, floorY } = restLeg();
    expect(computeFootLift(rest.pos, foot, buildLegPose({}), floorY)).toBe(0);
    expect(computeFootLift(rest.pos, foot, buildLegPose({}), floorY + 0.1)).toBeCloseTo(0.1, 12);
  });

  it("puts the lowest foot point of every authored pose exactly on the floor", () => {
    const { rest, foot, floorY } = restLeg();
    const lifts: number[] = [];
    for (const name of POSE_ORDER) {
      POSES[name].legs.forEach((spec: LegPoseSpec, index) => {
        const pose = buildLegPose(spec);
        const lift = computeFootLift(rest.pos, foot, pose, floorY);
        lifts.push(lift);
        let lowest = Infinity;
        for (const v of foot) {
          lowest = Math.min(
            lowest,
            skinLegPoint(
              pose,
              index === 0 ? 1 : -1,
              lift,
              rest.pos[v * 3],
              rest.pos[v * 3 + 1],
              rest.pos[v * 3 + 2],
            )[1],
          );
        }
        expect(lowest).toBeCloseTo(floorY, 12);
      });
    }
    expect(digestRounded(lifts, 9)).toMatchInlineSnapshot(`"2214e999"`);
  });
});

describe("solveReachKnees", () => {
  it("bends a reaching knee until its foot lift matches the other leg", () => {
    const { rest, foot, floorY } = restLeg();
    const legs: LegPoseSpec[] = POSES.point.legs.map((leg) => ({ ...leg }));
    expect(solveReachKnees(legs, rest.pos, foot, floorY)).toBe(legs);
    expect(legs[1]).toEqual(POSES.point.legs[1]);
    const knee = legs[0].knee!;
    expect(knee).toBeGreaterThan(0);
    const lift = (spec: LegPoseSpec): number => computeFootLift(rest.pos, foot, buildLegPose(spec), floorY);
    expect(lift(legs[0])).toBeCloseTo(lift(legs[1]), 5);
    expect(Math.round(knee * 1e5) / 1e5).toMatchInlineSnapshot(`46.30426`);
  });

  it("leaves the knee straight when the foot already reaches the floor", () => {
    const { rest, foot, floorY } = restLeg();
    const legs: LegPoseSpec[] = [{}, { reach: true, knee: 30 }];
    solveReachKnees(legs, rest.pos, foot, floorY);
    expect(legs[1].knee).toBe(0);
    expect(legs[0]).toEqual({});
  });
});
