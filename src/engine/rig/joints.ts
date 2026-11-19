/**
 * Hip/knee/ankle/toe pivots and the GLSL skinning chunk (mirrored on the CPU in skinning.ts).
 */

export type Vec3 = [number, number, number];

/**
 * Pivot points (rest space) and the [start, end] blend ranges of each joint's weight.
 * A joint bends the surface over its range, and the side on the inside of the bend is squeezed by it: the
 * further that side is from the pivot, the longer the range has to be to bend it without a crease. So the toes
 * bend over a long stretch of the foot, and the ankle's range is longer behind the leg (ankleBackY, reached
 * over ankleBackZ from the front to the back), where the heel rises toward the calf.
 * The toes and the ankle turn their range along an arc (turnJoint); the knee blends straight toward its rotated
 * place (applyJoint).
 * Around the ankle the skin lies on tendons that run straight from the foot up the leg however the foot turns:
 * the Achilles tendon behind, the extensors in front. So everything above ankleHoldY moves as if it were at about
 * that height: it follows the foot under it up or down the leg instead of swinging around the ankle. Without
 * that, standing on tiptoe hollows the leg out above the heel and pushes the top of the instep forward into a
 * hump. The hold sets in gradually over ankleHoldEase, which rounds the heel into the tendon. Both are given
 * for the front of the leg and for the back: behind, the hold sets in over a much longer stretch (ending at
 * the same height), so the skin just above the heel still follows it back a little and the heel runs into the
 * tendon's line in one curve instead of a corner.
 */
export interface LegJoints {
  hip: Vec3;
  knee: Vec3;
  kneeY: [number, number];
  ankle: Vec3;
  ankleY: [number, number];
  ankleBackY: [number, number];
  ankleBackZ: [number, number];
  ankleHoldY: [number, number];
  ankleHoldEase: [number, number];
  toe: Vec3;
  toeZ: [number, number];
  toeY: [number, number];
}

export const LEG_JOINTS: LegJoints = {
  hip: [0, 0.9, 0.03],
  knee: [0, 0.49, 0.015],
  kneeY: [0.415, 0.565],
  ankle: [0.005, 0.075, 0.005],
  ankleY: [0.06, 0.115],
  ankleBackY: [0.05, 0.2],
  ankleBackZ: [-0.03, 0.02],
  ankleHoldY: [0.043, 0.01],
  ankleHoldEase: [0.03, 0.096],
  toe: [0, 0.03, 0.135],
  toeZ: [0.09, 0.18],
  toeY: [0.085, 0.11],
};

export const DEG2RAD = Math.PI / 180;

const glslFloat = (v: number): string => v.toFixed(4);

const glslVec2 = (vec: readonly number[]): string => "vec2(" + vec.map(glslFloat).join(", ") + ")";

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
vec3 turnVec(vec3 v, vec3 axis, float c, float s) {
  return v * c + cross(axis, v) * s + axis * (dot(axis, v) * (1.0 - c));
}
// Turns p about pivot through the fraction "weight" of the rotation rot. Unlike applyJoint, which moves a point
// straight toward where the joint takes it, this carries it along the arc, so a bend keeps its thickness
// instead of dipping in halfway. "hold" lowers the point the move is worked out for: p moves as a point that
// far below it would.
void turnJoint(inout vec3 p, inout mat3 jac, mat3 rot, vec3 pivot, float weight, vec3 weightGrad, float hold, vec3 holdGrad) {
  vec3 axis = vec3(rot[1].z - rot[2].y, rot[2].x - rot[0].z, rot[0].y - rot[1].x);
  float sine = length(axis), angle = atan(sine, rot[0].x + rot[1].y + rot[2].z - 1.0);
  axis /= max(sine, 1e-9);
  float c = cos(angle * weight), s = sin(angle * weight);
  vec3 from = p - pivot - vec3(0.0, hold, 0.0), turned = turnVec(from, axis, c, s);
  jac = mat3(turnVec(jac[0], axis, c, s), turnVec(jac[1], axis, c, s), turnVec(jac[2], axis, c, s)) + outerProduct(cross(axis, turned) * angle, weightGrad) - outerProduct(turnVec(vec3(0.0, 1.0, 0.0), axis, c, s) - vec3(0.0, 1.0, 0.0), holdGrad);
  p += turned - from;
}
vec3 skinPosition(vec3 rest, out mat3 jac) {
  jac = mat3(1.0);
  if (uRigOn < 0.5) return rest;
  vec3 p = rest;
  float dToeZ, dToeY, dAnkle, dAnkleBack, dKnee;
  float toeZ = smoothstepD(${glslFloat(LEG_JOINTS.toeZ[0])}, ${glslFloat(LEG_JOINTS.toeZ[1])}, rest.z, dToeZ), sy = smoothstepD(${glslFloat(LEG_JOINTS.toeY[0])}, ${glslFloat(LEG_JOINTS.toeY[1])}, rest.y, dToeY);
  turnJoint(p, jac, uToeRot, ${glslVec3(LEG_JOINTS.toe)}, toeZ * (1.0 - sy), vec3(0.0, -toeZ * dToeY, dToeZ * (1.0 - sy)), 0.0, vec3(0.0));
  float ankleBack = 1.0 - smoothstepD(${glslFloat(LEG_JOINTS.ankleBackZ[0])}, ${glslFloat(LEG_JOINTS.ankleBackZ[1])}, rest.z, dAnkleBack);
  vec2 ankleY = mix(${glslVec2(LEG_JOINTS.ankleY)}, ${glslVec2(LEG_JOINTS.ankleBackY)}, ankleBack), ankleMove = ${glslVec2(LEG_JOINTS.ankleBackY)} - ${glslVec2(LEG_JOINTS.ankleY)};
  float ankleW = 1.0 - smoothstepD(ankleY.x, ankleY.y, rest.y, dAnkle);
  float ankleAt = clamp((rest.y - ankleY.x) / (ankleY.y - ankleY.x), 0.0, 1.0);
  vec2 ankleHold = mix(${glslVec2([LEG_JOINTS.ankleHoldY[0], LEG_JOINTS.ankleHoldEase[0]])}, ${glslVec2([LEG_JOINTS.ankleHoldY[1], LEG_JOINTS.ankleHoldEase[1]])}, ankleBack);
  float ankleEased = clamp(rest.y - ankleHold.x, 0.0, ankleHold.y) / ankleHold.y;
  float ankleAbove = 0.5 * ankleHold.y * ankleEased * ankleEased + max(rest.y - ankleHold.x - ankleHold.y, 0.0);
  float ankleHoldDz = dAnkleBack * (ankleEased * ${glslFloat(LEG_JOINTS.ankleHoldY[1] - LEG_JOINTS.ankleHoldY[0])} + 0.5 * ankleEased * ankleEased * ${glslFloat(LEG_JOINTS.ankleHoldEase[1] - LEG_JOINTS.ankleHoldEase[0])});
  turnJoint(p, jac, uAnkleRot, ${glslVec3(LEG_JOINTS.ankle)}, ankleW, vec3(0.0, -dAnkle, -dAnkle * dAnkleBack * mix(ankleMove.x, ankleMove.y, ankleAt)), ankleAbove, vec3(0.0, ankleEased, ankleHoldDz));
  float kneeW = 1.0 - smoothstepD(${glslFloat(LEG_JOINTS.kneeY[0])}, ${glslFloat(LEG_JOINTS.kneeY[1])}, rest.y, dKnee);
  applyJoint(p, jac, uKneeRot, ${glslVec3(LEG_JOINTS.knee)}, kneeW, vec3(0.0, -dKnee, 0.0));
  return p;
}
vec3 skinNormal(mat3 jac, vec3 n) {
  return normalize(mat3(cross(jac[1], jac[2]), cross(jac[2], jac[0]), cross(jac[0], jac[1])) * n);
}
`;
