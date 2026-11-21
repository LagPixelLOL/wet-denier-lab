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
 * outside that range away from the nails. Only worth calling near the toes. The nails come from the model as uniforms: uNailCenter (xyz, 1 / half
 * width), uNailForward (xyz toward the tip, 1 / half length) and uNailNormal.
 * toeCap(p): signed distance (m) past the edge of the stocking's reinforced toe, positive toward the toes.
 * toeSeam(p): signed distance (m) from the seam that closes the stocking across the toes, near their tips.
 */
export const FOOT_GLSL = `
// Smooth noise, -1 to 1 (also used for the grain of fuzzy fabrics).
float valueNoise(vec2 q) {
  vec2 cell = floor(q), f = fract(q);
  f = f * f * (3.0 - 2.0 * f);
  vec4 corner = fract(sin(vec4(dot(cell, vec2(127.1, 311.7)), dot(cell + vec2(1.0, 0.0), vec2(127.1, 311.7)), dot(cell + vec2(0.0, 1.0), vec2(127.1, 311.7)), dot(cell + vec2(1.0, 1.0), vec2(127.1, 311.7)))) * 43758.5453);
  return mix(mix(corner.x, corner.y, f.x), mix(corner.z, corner.w, f.x), f.y) * 2.0 - 1.0;
}
// A vein's profile: d is the distance from its center line (m), width its half width, and strength (0 to 1)
// thins it out to nothing. A vein lies under the skin, so it has no edge: it fades out from its center line to
// well past its width.
float veinAt(float d, float width, float strength) {
  return (1.0 - smoothstep(0.0, width * (0.7 + 1.1 * strength), abs(d))) * smoothstep(0.0, 0.35, strength);
}
// Veins vary along their length with a few sine waves. All veins share the waves (wave = sin, cos of the same
// arguments) and differ by a phase, which keeps the cost the same however many veins there are.
vec3 veinWaves(vec3 waveSin, vec3 waveCos, float seed) {
  vec3 phase = seed * vec3(1.0, 2.3, 4.1);
  return waveSin * cos(phase) + waveCos * sin(phase);
}
// A vein on the foot running along z, at x = line, shown between z0 and z1 and in irregular stretches.
float footVein(vec2 q, float line, float z0, float z1, vec3 waves) {
  float shown = smoothstep(z0, z0 + 0.012, q.y) * (1.0 - smoothstep(z1 - 0.012, z1, q.y));
  return veinAt(q.x - line, 0.0014, shown * (0.55 + 0.6 * waves.x * waves.y));
}
// A vein on the leg at angle "around" the leg's axis, shown between heights y0 and y1: it meanders by the first
// set of waves and comes and goes by the second.
float legVein(float y, float turn, float radius, float y0, float y1, vec3 meander, vec3 stretch) {
  turn -= 6.2832 * floor(turn / 6.2832 + 0.5) + dot(vec3(0.07, 0.04, 0.02), meander);
  float shown = smoothstep(y0, y0 + 0.04, y) * (1.0 - smoothstep(y1 - 0.05, y1, y));
  return veinAt(turn * radius, 0.0021, shown * (0.5 + 0.65 * stretch.x * stretch.y));
}
// One way out, at the end: with a return inside the nested branches, the shader compiler some browsers use
// (Direct3D's) warned that the result might not be set.
float skinVeins(vec3 p, vec3 n) {
  float vein = 0.0;
  if (p.y < 0.1) {
    if (n.y >= 0.05 && p.z >= 0.03 && p.z <= 0.155) {
      // Nothing runs straight: the whole layout is bent by noise first.
      vec2 q = p.xz + vec2(0.0028 * valueNoise(p.xz * 70.0), 0.0025 * valueNoise(p.zx * 60.0 + 9.0)) + 0.0009 * sin(p.zx * vec2(410.0, 370.0));
      vec3 along = q.y * vec3(61.0, 27.0, 0.0), alongSin = sin(along), alongCos = cos(along);
      // The arch across the instep, then the veins that leave it toward the toes and toward the ankle.
      float across = q.x - 0.002;
      float arch = 0.130 - 18.0 * across * across;
      vein = veinAt((q.y - arch) / sqrt(1.0 + 1296.0 * across * across), 0.0014, step(abs(across), 0.034) * (0.6 + 0.6 * sin(q.x * 95.0) * sin(q.x * 41.0 + 2.0)));
      float ahead = step(arch, q.y), behind = 1.0 - ahead;
      // The branches toward the toes fade out well before the toes begin.
      float toToes = q.y - 0.13;
      vein = max(vein, ahead * max(max(footVein(q, -0.0200 + 0.08 * toToes, 0.10, 0.150, veinWaves(alongSin, alongCos, 1.0)), footVein(q, 0.0005 + 0.09 * toToes, 0.10, 0.151, veinWaves(alongSin, alongCos, 2.0))), max(footVein(q, 0.0165 + 0.12 * toToes, 0.10, 0.146, veinWaves(alongSin, alongCos, 3.0)), footVein(q, 0.0320 + 0.16 * toToes, 0.09, 0.138, veinWaves(alongSin, alongCos, 4.0)))));
      float toAnkle = 0.123 - q.y;
      vein = max(vein, behind * max(footVein(q, -0.0300 + 0.06 * toAnkle + 1.1 * toAnkle * toAnkle, 0.035, 0.128, veinWaves(alongSin, alongCos, 5.0)), max(footVein(q, -0.0060 + 0.05 * toAnkle, 0.06, 0.143, veinWaves(alongSin, alongCos, 6.0)), footVein(q, 0.0330 + 0.12 * toAnkle, 0.06, 0.128, veinWaves(alongSin, alongCos, 7.0)))));
      vein *= smoothstep(0.05, 0.4, n.y);
    }
  } else {
    // Around the leg's axis: 0 is the outer side, a quarter turn the front, half a turn the inner side.
    vec2 axis = vec2(0.004 - 0.005 * p.y, 0.004 + 0.029 * p.y);
    vec2 out2 = p.xz - axis;
    float angle = atan(out2.y, out2.x), radius = length(out2);
    vec3 bend = p.y * vec3(23.0, 57.0, 131.0), bendSin = sin(bend), bendCos = cos(bend);
    vec3 come = p.y * vec3(14.0, 5.3, 0.0), comeSin = sin(come), comeCos = cos(come);
    // Up the inner side from ankle to thigh, up the back of the calf, across the back of the knee, and on the
    // front and the outer side of the thigh.
    vein = legVein(p.y, angle - 2.95 - 0.35 * sin(6.0 * (p.y - 0.33)), radius, 0.085, 0.84, veinWaves(bendSin, bendCos, 1.0), veinWaves(comeSin, comeCos, 1.0));
    vein = max(vein, legVein(p.y, angle + 1.5 - 0.55 * (1.0 - smoothstep(0.08, 0.25, p.y)), radius, 0.09, 0.47, veinWaves(bendSin, bendCos, 2.0), veinWaves(comeSin, comeCos, 2.0)));
    vein = max(vein, legVein(p.y, angle + 1.15 + 6.0 * (p.y - 0.44), radius, 0.43, 0.58, veinWaves(bendSin, bendCos, 3.0), veinWaves(comeSin, comeCos, 3.0)));
    vein = max(vein, legVein(p.y, angle - 2.25 - 0.2 * sin(9.0 * p.y), radius, 0.56, 0.86, veinWaves(bendSin, bendCos, 4.0), veinWaves(comeSin, comeCos, 4.0)));
    vein = max(vein, legVein(p.y, angle - 0.35 - 2.0 * (p.y - 0.6), radius, 0.6, 0.85, veinWaves(bendSin, bendCos, 5.0), veinWaves(comeSin, comeCos, 5.0)));
  }
  return vein;
}
vec2 toeNailCoord(vec3 p) {
  vec2 best = vec2(9.0);
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
  // The line of the toes' tips, a little back from them: level across the first two toes, then slanting back
  // along the smaller ones, and curving around the big toe's inner side.
  float x = p.x + 0.03;
  float inner = min(x, 0.0), outer = x - 0.029;
  return p.z - 0.2068 + 12.0 * inner * inner + 0.47 * (outer + sqrt(outer * outer + 0.000036));
}
`;
