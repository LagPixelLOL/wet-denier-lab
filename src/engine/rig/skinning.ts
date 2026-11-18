/**
 * CPU leg skinning: pose matrices, smooth joint blends, foot lift and knee reach solving.
 * Mirrors LEG_SKINNING_GLSL so raycasts, floor contact and droplets match the rendered legs.
 */
import { DEG2RAD, LEG_JOINTS } from "./joints";

const rotX = (angle) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};

const rotY = (angle) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};

const rotZ = (angle) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};

function mat3Mul(a, b) {
  const out = new Array(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] = a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
    }
  }
  return out;
}

const LEG_SPEC_KEYS = ["x", "z", "yaw", "roll", "pitch", "knee", "heel", "ankle", "toe"];

export function lerpLegSpec(from, to, t, out = {}) {
  for (const key of LEG_SPEC_KEYS) {
    out[key] = (from[key] || 0) + ((to[key] || 0) - (from[key] || 0)) * t;
  }
  return out;
}

export function buildLegPose(spec) {
  const yaw = (spec.yaw || 0) * DEG2RAD;
  const roll = (spec.roll || 0) * DEG2RAD;
  const pitch = (spec.pitch || 0) * DEG2RAD;
  const knee = (spec.knee || 0) * DEG2RAD;
  const heel = (spec.heel || 0) * DEG2RAD;
  const hipRot = mat3Mul(mat3Mul(rotY(yaw), rotZ(roll)), rotX(pitch));
  const shinRot = mat3Mul(hipRot, rotX(knee));
  const shinUpX = shinRot[3];
  const shinUpY = shinRot[4];
  const shinUpZ = shinRot[5];
  const shinTilt = Math.asin(Math.max(-1, Math.min(1, shinUpZ)));
  const eversion = Math.atan2(-shinUpX, shinUpY);
  const ankle = shinTilt + heel + (spec.ankle || 0) * DEG2RAD;
  const toe = -heel + (spec.toe || 0) * DEG2RAD;
  return {
    x: spec.x || 0,
    z: spec.z || 0,
    yaw: yaw,
    roll: roll,
    pitch: pitch,
    knee: knee,
    ankle: ankle,
    ev: eversion,
    toe: toe,
    T: rotX(toe),
    A: mat3Mul(rotZ(eversion), rotX(ankle)),
    K: rotX(knee),
    H: hipRot,
    on: knee || ankle || eversion || toe ? 1 : 0,
  };
}

const SKIN_OUT = {
  x: 0,
  y: 0,
  z: 0,
  J: new Float64Array(9),
};

const JACOBIAN_SCRATCH = new Float64Array(9);

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - t * 2);
}

function smoothstepDeriv(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return (t * 6 * (1 - t)) / (edge1 - edge0);
}

function applyJointBlend(rot, pivot, weight, dWeightDy, dWeightDz, withJacobian) {
  const dx = SKIN_OUT.x - pivot[0];
  const dy = SKIN_OUT.y - pivot[1];
  const dz = SKIN_OUT.z - pivot[2];
  const offX = rot[0] * dx + rot[1] * dy + rot[2] * dz - dx;
  const offY = rot[3] * dx + rot[4] * dy + rot[5] * dz - dy;
  const offZ = rot[6] * dx + rot[7] * dy + rot[8] * dz - dz;
  if (withJacobian) {
    const jac = SKIN_OUT.J;
    for (let i = 0; i < 3; i++) {
      const m0 = weight * rot[i * 3] + (i === 0 ? 1 - weight : 0);
      const m1 = weight * rot[i * 3 + 1] + (i === 1 ? 1 - weight : 0);
      const m2 = weight * rot[i * 3 + 2] + (i === 2 ? 1 - weight : 0);
      const off = i === 0 ? offX : i === 1 ? offY : offZ;
      JACOBIAN_SCRATCH[i * 3] = m0 * jac[0] + m1 * jac[3] + m2 * jac[6];
      JACOBIAN_SCRATCH[i * 3 + 1] = m0 * jac[1] + m1 * jac[4] + m2 * jac[7] + off * dWeightDy;
      JACOBIAN_SCRATCH[i * 3 + 2] = m0 * jac[2] + m1 * jac[5] + m2 * jac[8] + off * dWeightDz;
    }
    jac.set(JACOBIAN_SCRATCH);
  }
  SKIN_OUT.x += weight * offX;
  SKIN_OUT.y += weight * offY;
  SKIN_OUT.z += weight * offZ;
}

function skinRestPoint(pose, x, y, z, withJacobian) {
  SKIN_OUT.x = x;
  SKIN_OUT.y = y;
  SKIN_OUT.z = z;
  if (withJacobian) {
    const jac = SKIN_OUT.J;
    jac[0] = jac[4] = jac[8] = 1;
    jac[1] = jac[2] = jac[3] = jac[5] = jac[6] = jac[7] = 0;
  }
  if (!pose.on) {
    return;
  }
  const joints = LEG_JOINTS;
  if (pose.toe && z > joints.toeZ[0] && y < joints.toeY[1]) {
    const toeWeightZ = smoothstep(joints.toeZ[0], joints.toeZ[1], z);
    const toeWeightY = smoothstep(joints.toeY[0], joints.toeY[1], y);
    applyJointBlend(
      pose.T,
      joints.toe,
      toeWeightZ * (1 - toeWeightY),
      -toeWeightZ * smoothstepDeriv(joints.toeY[0], joints.toeY[1], y),
      smoothstepDeriv(joints.toeZ[0], joints.toeZ[1], z) * (1 - toeWeightY),
      withJacobian,
    );
  }
  if ((pose.ankle || pose.ev) && y < joints.ankleY[1]) {
    applyJointBlend(
      pose.A,
      joints.ankle,
      1 - smoothstep(joints.ankleY[0], joints.ankleY[1], y),
      -smoothstepDeriv(joints.ankleY[0], joints.ankleY[1], y),
      0,
      withJacobian,
    );
  }
  if (pose.knee && y < joints.kneeY[1]) {
    applyJointBlend(
      pose.K,
      joints.knee,
      1 - smoothstep(joints.kneeY[0], joints.kneeY[1], y),
      -smoothstepDeriv(joints.kneeY[0], joints.kneeY[1], y),
      0,
      withJacobian,
    );
  }
}

export function buildLegMatrix(pose, side, lift, out = new Float64Array(16)) {
  const hipRot = pose.H;
  const hip = LEG_JOINTS.hip;
  const mirror = side < 0 ? -1 : 1;
  for (let i = 0; i < 3; i++) {
    out[i * 4] = mirror * hipRot[i];
    out[i * 4 + 1] = hipRot[3 + i];
    out[i * 4 + 2] = hipRot[6 + i];
    out[i * 4 + 3] = 0;
  }
  out[12] = mirror * pose.x - mirror * (hipRot[0] * hip[0] + hipRot[1] * hip[1] + hipRot[2] * hip[2]);
  out[13] = hip[1] + lift - (hipRot[3] * hip[0] + hipRot[4] * hip[1] + hipRot[5] * hip[2]);
  out[14] = hip[2] + pose.z - (hipRot[6] * hip[0] + hipRot[7] * hip[1] + hipRot[8] * hip[2]);
  out[15] = 1;
  return out;
}

export function computeFootLift(restPos, footIndices, pose, floorY) {
  const hipRot = pose.H;
  const hip = LEG_JOINTS.hip;
  let minY = Infinity;
  for (let i = 0; i < footIndices.length; i++) {
    const base = footIndices[i] * 3;
    skinRestPoint(pose, restPos[base], restPos[base + 1], restPos[base + 2], false);
    const worldY =
      hipRot[3] * (SKIN_OUT.x - hip[0]) +
      hipRot[4] * (SKIN_OUT.y - hip[1]) +
      hipRot[5] * (SKIN_OUT.z - hip[2]) +
      hip[1];
    if (worldY < minY) {
      minY = worldY;
    }
  }
  return floorY - minY;
}

export function skinLegVertices(restPos, restNrm, pose, side, lift, outPos, outNrm, offset = 0) {
  const legMatrix = buildLegMatrix(pose, side, lift);
  const count = restPos.length / 3;
  const jac = SKIN_OUT.J;
  for (let i = 0; i < count; i++) {
    const src = i * 3;
    const dst = (offset + i) * 3;
    skinRestPoint(pose, restPos[src], restPos[src + 1], restPos[src + 2], !!outNrm);
    const px = SKIN_OUT.x;
    const py = SKIN_OUT.y;
    const pz = SKIN_OUT.z;
    outPos[dst] = legMatrix[0] * px + legMatrix[4] * py + legMatrix[8] * pz + legMatrix[12];
    outPos[dst + 1] = legMatrix[1] * px + legMatrix[5] * py + legMatrix[9] * pz + legMatrix[13];
    outPos[dst + 2] = legMatrix[2] * px + legMatrix[6] * py + legMatrix[10] * pz + legMatrix[14];
    if (!outNrm) {
      continue;
    }
    const nx = restNrm[src];
    const ny = restNrm[src + 1];
    const nz = restNrm[src + 2];
    const cx =
      (jac[4] * jac[8] - jac[5] * jac[7]) * nx -
      (jac[3] * jac[8] - jac[5] * jac[6]) * ny +
      (jac[3] * jac[7] - jac[4] * jac[6]) * nz;
    const cy =
      -(jac[1] * jac[8] - jac[2] * jac[7]) * nx +
      (jac[0] * jac[8] - jac[2] * jac[6]) * ny -
      (jac[0] * jac[7] - jac[1] * jac[6]) * nz;
    const cz =
      (jac[1] * jac[5] - jac[2] * jac[4]) * nx -
      (jac[0] * jac[5] - jac[2] * jac[3]) * ny +
      (jac[0] * jac[4] - jac[1] * jac[3]) * nz;
    const wx = legMatrix[0] * cx + legMatrix[4] * cy + legMatrix[8] * cz;
    const wy = legMatrix[1] * cx + legMatrix[5] * cy + legMatrix[9] * cz;
    const wz = legMatrix[2] * cx + legMatrix[6] * cy + legMatrix[10] * cz;
    const len = Math.hypot(wx, wy, wz) || 1;
    outNrm[dst] = wx / len;
    outNrm[dst + 1] = wy / len;
    outNrm[dst + 2] = wz / len;
  }
}

export function skinLegPoint(pose, side, lift, x, y, z, out = [0, 0, 0]) {
  const legMatrix = buildLegMatrix(pose, side, lift);
  skinRestPoint(pose, x, y, z, false);
  out[0] = legMatrix[0] * SKIN_OUT.x + legMatrix[4] * SKIN_OUT.y + legMatrix[8] * SKIN_OUT.z + legMatrix[12];
  out[1] = legMatrix[1] * SKIN_OUT.x + legMatrix[5] * SKIN_OUT.y + legMatrix[9] * SKIN_OUT.z + legMatrix[13];
  out[2] = legMatrix[2] * SKIN_OUT.x + legMatrix[6] * SKIN_OUT.y + legMatrix[10] * SKIN_OUT.z + legMatrix[14];
  return out;
}

export function solveReachKnees(legSpecs, restPos, footIndices, floorY) {
  legSpecs.forEach((spec, index) => {
    if (!spec.reach) {
      return;
    }
    const targetLift = computeFootLift(restPos, footIndices, buildLegPose(legSpecs[1 - index]), floorY);
    let lo = 0;
    let hi = 80;
    if (
      computeFootLift(
        restPos,
        footIndices,
        buildLegPose({
          ...spec,
          knee: 0,
        }),
        floorY,
      ) <= targetLift
    ) {
      spec.knee = 0;
      return;
    }
    for (let iter = 0; iter < 24; iter++) {
      const mid = (lo + hi) / 2;
      if (
        computeFootLift(
          restPos,
          footIndices,
          buildLegPose({
            ...spec,
            knee: mid,
          }),
          floorY,
        ) > targetLift
      ) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    spec.knee = (lo + hi) / 2;
  });
  return legSpecs;
}
