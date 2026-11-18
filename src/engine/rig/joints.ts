/**
 * Hip/knee/ankle/toe pivots and the GLSL skinning chunk (mirrored on the CPU in skinning.ts).
 */

export type Vec3 = [number, number, number];

/** Pivot points (rest space) and the [start, end] blend ranges of each joint's weight. */
export interface LegJoints {
  hip: Vec3;
  knee: Vec3;
  kneeY: [number, number];
  ankle: Vec3;
  ankleY: [number, number];
  toe: Vec3;
  toeZ: [number, number];
  toeY: [number, number];
}

export const LEG_JOINTS: LegJoints = {
  hip: [0, 0.9, 0.03],
  knee: [0, 0.49, 0.015],
  kneeY: [0.415, 0.565],
  ankle: [0.005, 0.075, 0.005],
  ankleY: [0.06, 0.125],
  toe: [0, 0.022, 0.135],
  toeZ: [0.12, 0.155],
  toeY: [0.05, 0.07],
};

export const DEG2RAD = Math.PI / 180;

const glslFloat = (v: number): string => v.toFixed(4);

const glslVec3 = (vec: readonly number[]): string => "vec3(" + vec.map(glslFloat).join(", ") + ")";

export const LEG_SKINNING_GLSL = `
uniform mat3 uToeRot, uAnkleRot, uKneeRot;
uniform float uRigOn;
float smoothstepD(float edge0, float edge1, float x, out float deriv) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  deriv = 6.0 * t * (1.0 - t) / (edge1 - edge0);
  return t * t * (3.0 - 2.0 * t);
}
void applyJoint(inout vec3 p, inout mat3 jac, mat3 rot, vec3 pivot, float weight, vec3 weightGrad) {
  vec3 off = rot * (p - pivot) - (p - pivot);
  jac = (mat3(1.0) + weight * (rot - mat3(1.0))) * jac + outerProduct(off, weightGrad);
  p += weight * off;
}
vec3 skinPosition(vec3 rest, out mat3 jac) {
  jac = mat3(1.0);
  if (uRigOn < 0.5) return rest;
  vec3 p = rest;
  float dToeZ, dToeY, dAnkle, dKnee;
  float toeZ = smoothstepD(${glslFloat(LEG_JOINTS.toeZ[0])}, ${glslFloat(LEG_JOINTS.toeZ[1])}, rest.z, dToeZ), sy = smoothstepD(${glslFloat(LEG_JOINTS.toeY[0])}, ${glslFloat(LEG_JOINTS.toeY[1])}, rest.y, dToeY);
  applyJoint(p, jac, uToeRot, ${glslVec3(LEG_JOINTS.toe)}, toeZ * (1.0 - sy), vec3(0.0, -toeZ * dToeY, dToeZ * (1.0 - sy)));
  float ankleW = 1.0 - smoothstepD(${glslFloat(LEG_JOINTS.ankleY[0])}, ${glslFloat(LEG_JOINTS.ankleY[1])}, rest.y, dAnkle);
  applyJoint(p, jac, uAnkleRot, ${glslVec3(LEG_JOINTS.ankle)}, ankleW, vec3(0.0, -dAnkle, 0.0));
  float kneeW = 1.0 - smoothstepD(${glslFloat(LEG_JOINTS.kneeY[0])}, ${glslFloat(LEG_JOINTS.kneeY[1])}, rest.y, dKnee);
  applyJoint(p, jac, uKneeRot, ${glslVec3(LEG_JOINTS.knee)}, kneeW, vec3(0.0, -dKnee, 0.0));
  return p;
}
vec3 skinNormal(mat3 jac, vec3 n) {
  return normalize(mat3(cross(jac[1], jac[2]), cross(jac[2], jac[0]), cross(jac[0], jac[1])) * n);
}
`;
