/**
 * Foot details drawn in the leg shader: toenails, veins and the reinforced toe of a stocking. Everything is
 * placed in the model's rest space (meters, y up, toes toward +z, big toe toward -x), so it follows the rig for
 * free.
 */

/** How many toenails the leg shader draws. */
export const NAIL_COUNT = 5;

/**
 * skinVeins(p, n): how strongly a vein shows at rest position p with rest normal n, 0 to 1. Veins are curves
 * on the skin with a slight meander, each fading in and out along its length: on the top of the foot the arch
 * across the instep, a branch toward each gap between the toes and three veins running back to the ankle; on the
 * leg one up the inner side from ankle to thigh, one up the back of the calf and one on the front of the thigh.
 * toeNailCoord(p): position on the nearest toenail (x across, y toward the tip, the nail spans -1..1), or far
 * outside that range away from the nails. The nails come from the model as uniforms: uNailCenter (xyz, 1 / half
 * width), uNailForward (xyz toward the tip, 1 / half length) and uNailNormal.
 * toeCap(p): signed distance (m) past the edge of the stocking's reinforced toe, positive toward the toes.
 * toeSeam(p): signed distance (m) from the seam that closes the stocking across the top of the toes.
 */
export const FOOT_GLSL = `
// Smooth noise, -1 to 1.
float veinNoise(vec2 q) {
  vec2 cell = floor(q), f = fract(q);
  f = f * f * (3.0 - 2.0 * f);
  vec4 corner = fract(sin(vec4(dot(cell, vec2(127.1, 311.7)), dot(cell + vec2(1.0, 0.0), vec2(127.1, 311.7)), dot(cell + vec2(0.0, 1.0), vec2(127.1, 311.7)), dot(cell + vec2(1.0, 1.0), vec2(127.1, 311.7)))) * 43758.5453);
  return mix(mix(corner.x, corner.y, f.x), mix(corner.z, corner.w, f.x), f.y) * 2.0 - 1.0;
}
// A vein's profile: d is the distance from its center line (m), width its half width at full strength, and
// strength (0 to 1) thins it out to nothing.
float veinAt(float d, float width, float strength) {
  return (1.0 - smoothstep(width * 0.25, width * (0.4 + 0.6 * strength), abs(d))) * smoothstep(0.0, 0.35, strength);
}
// A vein on the foot running along z, at x = line, shown between z0 and z1 and in irregular stretches.
float footVein(vec2 q, float line, float z0, float z1) {
  float shown = smoothstep(z0, z0 + 0.012, q.y) * (1.0 - smoothstep(z1 - 0.012, z1, q.y));
  return veinAt(q.x - line, 0.001, shown * (0.55 + 0.6 * veinNoise(vec2(q.y * 38.0, line * 400.0))));
}
// A vein on the leg at angle "around" the leg's axis, shown between heights y0 and y1. seed tells veins apart.
float legVein(vec3 p, float angle, float radius, float around, float y0, float y1, float seed) {
  float turn = angle - around - 0.07 * sin(p.y * 23.0 + seed) - 0.04 * sin(p.y * 57.0 + seed * 2.3) - 0.02 * sin(p.y * 131.0 + seed * 4.1);
  turn -= 6.2832 * floor(turn / 6.2832 + 0.5);
  float shown = smoothstep(y0, y0 + 0.04, p.y) * (1.0 - smoothstep(y1 - 0.05, y1, p.y));
  return veinAt(turn * radius, 0.0017, shown * (0.5 + 0.65 * veinNoise(vec2(p.y * 9.0, seed))));
}
float skinVeins(vec3 p, vec3 n) {
  float vein = 0.0;
  if (p.y < 0.1) {
    if (n.y < 0.05 || p.z < 0.03 || p.z > 0.165) return 0.0;
    // Nothing runs straight: the whole layout is bent by noise first.
    vec2 q = p.xz + vec2(0.0028 * veinNoise(p.xz * 70.0) + 0.0011 * veinNoise(p.zx * 190.0), 0.0025 * veinNoise(p.zx * 60.0 + 9.0));
    // The arch across the instep, then the veins that leave it toward the toes and toward the ankle.
    float across = q.x - 0.002;
    float arch = 0.1375 - 18.0 * across * across;
    vein = veinAt((q.y - arch) / sqrt(1.0 + 1296.0 * across * across), 0.001, step(abs(across), 0.034) * (0.6 + 0.6 * veinNoise(vec2(q.x * 60.0, 3.0))));
    float ahead = step(arch, q.y), behind = 1.0 - ahead;
    float toToes = q.y - 0.14;
    vein = max(vein, ahead * max(max(footVein(q, -0.0200 + 0.08 * toToes, 0.11, 0.162), footVein(q, 0.0005 + 0.09 * toToes, 0.11, 0.163)), max(footVein(q, 0.0165 + 0.12 * toToes, 0.11, 0.156), footVein(q, 0.0320 + 0.16 * toToes, 0.10, 0.146))));
    float toAnkle = 0.13 - q.y;
    vein = max(vein, behind * max(footVein(q, -0.0300 + 0.06 * toAnkle + 1.1 * toAnkle * toAnkle, 0.035, 0.135), max(footVein(q, -0.0060 + 0.05 * toAnkle, 0.06, 0.150), footVein(q, 0.0330 + 0.12 * toAnkle, 0.06, 0.135))));
    return vein * smoothstep(0.05, 0.4, n.y);
  }
  // Around the leg's axis: 0 is the outer side, a quarter turn the front, half a turn the inner side.
  vec2 axis = vec2(0.004 - 0.005 * p.y, 0.004 + 0.029 * p.y);
  vec2 out2 = p.xz - axis;
  float angle = atan(out2.y, out2.x), radius = length(out2);
  // Up the inner side from ankle to thigh, up the back of the calf, across the back of the knee, and on the
  // front and the outer side of the thigh.
  vein = legVein(p, angle, radius, 2.95 + 0.35 * sin(6.0 * (p.y - 0.33)), 0.085, 0.84, 1.0);
  vein = max(vein, legVein(p, angle, radius, -1.5 + 0.55 * (1.0 - smoothstep(0.08, 0.25, p.y)), 0.09, 0.47, 2.0));
  vein = max(vein, legVein(p, angle, radius, -1.15 - 6.0 * (p.y - 0.44), 0.43, 0.58, 3.0));
  vein = max(vein, legVein(p, angle, radius, 2.25 + 0.2 * sin(9.0 * p.y), 0.56, 0.86, 4.0));
  vein = max(vein, legVein(p, angle, radius, 0.35 + 2.0 * (p.y - 0.6), 0.6, 0.85, 5.0));
  return vein;
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
