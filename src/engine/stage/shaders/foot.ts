/**
 * Foot details drawn in the leg shader: toenails, veins and the reinforced toe of a stocking. Everything is
 * placed in the model's rest space (meters, y up, toes toward +z, big toe toward -x), so it follows the rig for
 * free.
 */

type Vec3 = readonly [number, number, number];

/**
 * Veins on the top of the foot, as paths just under the skin: the arch across the instep, a branch toward each
 * gap between the toes, and the veins running back from the arch along both sides and the middle of the foot.
 */
export const FOOT_VEINS: readonly (readonly Vec3[])[] = [
  [
    [-0.03, 0.0561, 0.118],
    [-0.021, 0.0491, 0.131],
    [-0.006, 0.0413, 0.138],
    [0.01, 0.036, 0.136],
    [0.023, 0.0369, 0.127],
    [0.033, 0.0396, 0.113],
  ],
  [
    [-0.021, 0.0491, 0.131],
    [-0.02, 0.0402, 0.146],
    [-0.0185, 0.0342, 0.158],
  ],
  [
    [-0.004, 0.0409, 0.138],
    [0, 0.0347, 0.15],
    [0.002, 0.0314, 0.158],
  ],
  [
    [0.012, 0.0358, 0.1355],
    [0.016, 0.0315, 0.144],
    [0.0185, 0.0295, 0.15],
  ],
  [
    [0.025, 0.037, 0.125],
    [0.031, 0.0324, 0.133],
    [0.035, 0.0287, 0.139],
  ],
  [
    [-0.03, 0.0561, 0.118],
    [-0.034, 0.0577, 0.1],
    [-0.033, 0.0636, 0.08],
    [-0.028, 0.0743, 0.06],
    [-0.022, 0.094, 0.042],
  ],
  [
    [-0.006, 0.0413, 0.138],
    [-0.008, 0.0528, 0.118],
    [-0.004, 0.0641, 0.098],
    [0.002, 0.0783, 0.078],
  ],
  [
    [0.033, 0.0396, 0.113],
    [0.039, 0.0435, 0.096],
    [0.042, 0.0424, 0.078],
  ],
];

const glslVec3 = (v: Vec3): string => `vec3(${v.map((x) => x.toFixed(4)).join(", ")})`;

/** How many toenails the leg shader draws. */
export const NAIL_COUNT = 5;

const veinLines = FOOT_VEINS.flatMap((path) =>
  path.slice(1).map((end, i) => `  d = min(d, veinSegment(p, ${glslVec3(path[i])}, ${glslVec3(end)}));\n`),
).join("");

/**
 * footVeins(p): squared distance (m2) from p to the nearest vein, or a large value away from the top of the foot.
 * toeNailCoord(p): position on the nearest toenail (x across, y toward the tip, the nail spans -1..1), or far
 * outside that range away from the nails. The nails come from the model as uniforms: uNailCenter (xyz, 1 / half
 * width), uNailForward (xyz toward the tip, 1 / half length) and uNailNormal.
 * toeCap(p): signed distance (m) past the edge of the stocking's reinforced toe, positive toward the toes.
 * toeSeam(p): signed distance (m) from the seam that closes the stocking across the top of the toes.
 */
export const FOOT_GLSL = `
float veinSegment(vec3 p, vec3 a, vec3 b) {
  vec3 pa = p - a, ba = b - a;
  vec3 off = pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return dot(off, off);
}
float footVeins(vec3 p) {
  float d = 1.0;
  if (p.y > 0.11 || p.z < 0.03 || p.z > 0.165) return d;
${veinLines}  return d;
}
vec2 toeNailCoord(vec3 p) {
  vec2 best = vec2(9.0);
  if (p.z < 0.15 || p.y > 0.05) return best;
  for (int i = 0; i < ${NAIL_COUNT}; i++) {
    vec3 d = p - uNailCenter[i].xyz;
    vec2 q = vec2(dot(d, cross(uNailNormal[i], uNailForward[i].xyz)) * uNailCenter[i].w, dot(d, uNailForward[i].xyz) * uNailForward[i].w);
    // Only near the nail's own plane: the front of the toe just below it is not nail.
    if (dot(q, q) < dot(best, best) && dot(d, uNailNormal[i]) > -0.0008 - 0.3 / uNailCenter[i].w) best = q;
  }
  return best;
}
float toeCap(vec3 p) {
  float x = p.x + 0.03;
  return p.z - 0.150 + 0.25 * x + 1.5 * x * x + 0.35 * (p.y - 0.03);
}
float toeSeam(vec3 p) {
  float x = p.x + 0.03;
  return p.z - 0.186 + 0.30 * x + 2.2 * x * x;
}
`;
