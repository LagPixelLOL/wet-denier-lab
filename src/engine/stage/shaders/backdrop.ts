/**
 * Ray-traced backdrop environments (one branch per scene), shared by the backdrop and floor shaders.
 */

export const CAUSTICS_GLSL = `
float caustics(vec2 p, float t) {
  vec2 q = p;
  q += 0.30 * vec2(sin(q.y * 2.3 + t * 0.9), sin(q.x * 2.1 - t * 0.8));
  q += 0.18 * vec2(sin(q.y * 4.7 - t * 1.3 + 1.7), sin(q.x * 4.3 + t * 1.1 + 0.6));
  float c1 = pow(1.0 - min(abs(sin(q.x * 3.1416) * sin(q.y * 3.1416)) * 2.4, 1.0), 4.0);
  vec2 q2 = vec2(p.x * 0.8 - p.y * 0.6, p.x * 0.6 + p.y * 0.8) * 1.37 + vec2(3.1, 1.7);
  q2 += 0.25 * vec2(sin(q2.y * 2.9 + t * 1.2), sin(q2.x * 2.6 - t * 1.0));
  float c2 = pow(1.0 - min(abs(sin(q2.x * 3.1416) * sin(q2.y * 3.1416)) * 2.4, 1.0), 4.0);
  return c1 * 0.6 + c2 * 0.45 + c1 * c2 * 1.6;
}
`;

const BACKDROP_GLSL_SOURCE = `
uniform vec3 uTopColor, uBottomColor, uGlowColor;
uniform vec2 uResolution;
vec3 studioGradient(vec2 fragCoord) {
  vec2 st = fragCoord / uResolution;
  vec3 col = mix(uBottomColor, uTopColor, smoothstep(0.0, 1.0, st.y));
  vec2 d = (st - vec2(0.5, 0.58)) * vec2(uResolution.x / uResolution.y, 1.0);
  col += uGlowColor * exp(-dot(d, d) * 3.2);
  return col;
}
#if SCENE > 0
uniform float uBackdropTime;
uniform float uPixelAngle;
uniform float uFocusDist;
uniform float uRain;
uint hashU32(vec2 p) {
  uvec2 bits = floatBitsToUint(p);
  uint h = (bits.x * 0x9E3779B1u) ^ ((bits.y + 0x85EBCA6Bu) * 0xC2B2AE35u);
  h ^= h >> 15;
  h *= 0x2C1B3C6Du;
  h ^= h >> 12;
  h *= 0x297A2D39u;
  h ^= h >> 15;
  return h;
}
float hash21(vec2 p) {
  return float(hashU32(p) >> 8) * (1.0 / 16777216.0);
}
vec2 hash22(vec2 p) {
  uint h = hashU32(p);
  return vec2(float(h >> 8), float((h * 0x9E3779B1u) >> 8)) * (1.0 / 16777216.0);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float amp = 0.5, sum = 0.0;
  for (int i = 0; i < 4; i++) {
    sum += amp * valueNoise(p);
    p = vec2(p.x * 1.6 - p.y * 1.2, p.x * 1.2 + p.y * 1.6) + 7.3;
    amp *= 0.5;
  }
  return sum;
}
float lineIntegral(float x, float period, float halfWidth) {
  float cell = floor(x / period), r = x - cell * period;
  return cell * 2.0 * halfWidth + min(r, halfWidth) + max(r - (period - halfWidth), 0.0);
}
float filteredLines(float x, float period, float halfWidth, float fw) {
  return (lineIntegral(x + 0.5 * fw, period, halfWidth) - lineIntegral(x - 0.5 * fw, period, halfWidth)) / fw;
}
float filteredGrid(vec2 p, float period, float halfWidth, float fw) {
  float lx = filteredLines(p.x, period, halfWidth, fw), ly = filteredLines(p.y, period, halfWidth, fw);
  return lx + ly - lx * ly;
}
float filteredBand(float x, float lo, float hi, float fw) {
  return clamp((min(x + 0.5 * fw, hi) - max(x - 0.5 * fw, lo)) / fw, 0.0, 1.0);
}
float footprint(float t, float cosTheta, float defocus) {
  return t * uPixelAngle / max(cosTheta, 0.07) + defocus * abs(t - uFocusDist) + 1e-5;
}
float sdRoundBox(vec2 p, vec2 center, vec2 halfSize, float radius) {
  vec2 q = abs(p - center) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}
float sdEllipse(vec2 p, vec2 center, vec2 radii) {
  return (length((p - center) / radii) - 1.0) * min(radii.x, radii.y);
}
${CAUSTICS_GLSL}bool onFloorDisk(vec3 p) {
  return dot(p.xz, p.xz) < 1.59 * 1.59;
}
bool hitFloorDisk = false;
bool intersectBox(vec3 ro, vec3 rd, vec3 boxMin, vec3 boxMax, out float t, out vec3 n) {
  vec3 t0 = (boxMin - ro) / rd, t1 = (boxMax - ro) / rd;
  vec3 tNear = min(t0, t1), tFar = max(t0, t1);
  t = max(tNear.x, max(tNear.y, tNear.z));
  n = -sign(rd) * step(tNear.yzx, tNear.xyz) * step(tNear.zxy, tNear.xyz);
  return t < min(tFar.x, min(tFar.y, tFar.z)) && t > 0.0;
}
#endif
#if SCENE == 1
const vec3 ROOM_MIN = vec3(-1.45, 0.0, -1.30), ROOM_MAX = vec3(2.3, 2.5, 2.9);
const vec3 TUB_MIN = vec3(-1.45, 0.0, -1.30), TUB_MAX = vec3(0.62, 0.56, -0.56);
const float DEFOCUS = 0.011;
vec3 wallColor(vec3 p, vec3 n, float fw, bool detail) {
  vec2 st = vec2(abs(n.x) > 0.5 ? p.z : p.x, p.y);
  float lower = 1.0 - filteredBand(st.y, 1.05, 9.0, fw);
  float trim = filteredBand(st.y, 1.05, 1.125, fw);
  vec3 col = mix(vec3(0.930, 0.925, 0.915), vec3(0.640, 0.835, 0.875), lower);
  col = mix(col, vec3(0.36, 0.64, 0.74), trim);
  if (detail) {
    col *= 1.0 + (hash21(floor(st / 0.15) + n.xz * 31.0) - 0.5) * 0.06 * clamp(1.0 - fw / 0.08, 0.0, 1.0);
    col = mix(col, mix(vec3(0.83), vec3(0.88, 0.93, 0.94), lower), filteredGrid(st, 0.15, 0.0022, fw) * 0.85);
  }
  col *= mix(0.80, 1.05, smoothstep(0.0, 2.0, p.y));
  vec2 cornerDist = min(abs(p.xz - ROOM_MIN.xz), abs(p.xz - ROOM_MAX.xz));
  col *= 1.0 - 0.16 * exp(-(abs(n.x) > 0.5 ? cornerDist.y : cornerDist.x) / 0.22) - 0.14 * exp(-p.y / 0.10);
  return col;
}
vec3 tubColor(vec3 p, vec3 n, float fw) {
  vec3 enamel = vec3(0.955, 0.955, 0.965), col;
  if (n.y > 0.5) {
    vec2 edge = min(p.xz - TUB_MIN.xz, TUB_MAX.xz - p.xz);
    float rimDist = min(edge.x, edge.y) - 0.075;
    vec3 waterCol = vec3(0.60, 0.90, 0.93) + vec3(0.32, 0.20, 0.16) * caustics(p.xz * 2.6, uBackdropTime * 0.6) * clamp(1.0 - fw / 0.05, 0.0, 1.0);
    waterCol *= 1.0 - 0.22 * exp(-max(rimDist, 0.0) / 0.035);
    col = mix(enamel * 1.02, waterCol, smoothstep(-fw, fw, rimDist));
  } else {
    float hFrac = (p.y - TUB_MIN.y) / (TUB_MAX.y - TUB_MIN.y);
    col = enamel * mix(0.78, 1.0, smoothstep(0.0, 0.9, hFrac));
    col *= 1.0 - 0.14 * exp(-p.y / 0.07);
    col += vec3(0.05) * smoothstep(0.93, 0.985, hFrac);
    if (n.x > 0.5) col *= 0.93;
  }
  return col;
}
vec4 shelfItems(vec2 st, float fw) {
  float aa = max(fw, 0.0015);
  vec4 acc = vec4(0.0);
#define PUT(dist, rgb) acc = mix(acc, vec4(rgb, 1.0), 1.0 - smoothstep(-aa, aa, dist));
  PUT(sdRoundBox(st, vec2(-0.545, 1.36), vec2(0.007, 0.57), 0.006), vec3(0.80, 0.83, 0.86))
  PUT(sdRoundBox(st, vec2(-0.47, 1.93), vec2(0.085, 0.012), 0.01), vec3(0.82, 0.85, 0.88))
  PUT(sdRoundBox(st, vec2(-0.56, 0.755), vec2(0.012, 0.03), 0.006), vec3(0.76, 0.79, 0.83))
  PUT(sdRoundBox(st, vec2(-0.56, 0.80), vec2(0.085, 0.020), 0.018), vec3(0.84, 0.87, 0.90))
  PUT(sdEllipse(st, vec2(-0.655, 0.80), vec2(0.027, 0.027)), vec3(0.91, 0.93, 0.95))
  PUT(sdEllipse(st, vec2(-0.465, 0.80), vec2(0.027, 0.027)), vec3(0.91, 0.93, 0.95))
  PUT(sdEllipse(st, vec2(-0.655, 0.80), vec2(0.009, 0.009)), vec3(0.92, 0.32, 0.32))
  PUT(sdEllipse(st, vec2(-0.465, 0.80), vec2(0.009, 0.009)), vec3(0.26, 0.52, 0.92))
  PUT(sdRoundBox(st, vec2(-1.23, 0.665), vec2(0.036, 0.105), 0.018), vec3(0.98, 0.60, 0.70))
  PUT(sdRoundBox(st, vec2(-1.23, 0.79), vec2(0.019, 0.024), 0.006), vec3(0.97, 0.97, 0.98))
  PUT(sdRoundBox(st, vec2(-1.105, 0.645), vec2(0.043, 0.085), 0.02), vec3(0.72, 0.64, 0.95))
  PUT(sdRoundBox(st, vec2(-1.105, 0.755), vec2(0.008, 0.03), 0.004), vec3(0.95, 0.95, 0.97))
  PUT(sdRoundBox(st, vec2(-1.085, 0.787), vec2(0.03, 0.008), 0.004), vec3(0.95, 0.95, 0.97))
  PUT(sdEllipse(st, vec2(-0.31, 0.607), vec2(0.064, 0.047)), vec3(1.0, 0.80, 0.22))
  PUT(sdEllipse(st, vec2(-0.268, 0.668), vec2(0.034, 0.034)), vec3(1.0, 0.82, 0.24))
  PUT(sdEllipse(st, vec2(-0.228, 0.664), vec2(0.017, 0.009)), vec3(1.0, 0.50, 0.16))
  PUT(sdEllipse(st, vec2(-0.258, 0.678), vec2(0.0055, 0.0055)), vec3(0.16, 0.12, 0.12))return acc;
}
vec3 traceRoom(vec3 ro, vec3 rd, float fwBias, bool detail, out float t, out bool hitFloor) {
  vec3 dir = rd + (1.0 - abs(sign(rd))) * 1e-5;
  vec3 tWall = (mix(ROOM_MIN, ROOM_MAX, step(0.0, dir)) - ro) / dir;
  t = max(min(tWall.x, min(tWall.y, tWall.z)), 0.3);
  vec3 p = ro + dir * t, col;
  hitFloor = false;
  if (tWall.y < tWall.x && tWall.y < tWall.z) {
    if (dir.y < 0.0) {
      hitFloor = true;
      col = vec3(0.8);
    } else col = vec3(0.97, 0.965, 0.95) * (0.86 + 0.5 * exp(-dot(p.xz - vec2(0.3, 0.6), p.xz - vec2(0.3, 0.6)) / 0.9));
  } else {
    vec3 n = tWall.x < tWall.z ? vec3(-sign(dir.x), 0.0, 0.0) : vec3(0.0, 0.0, -sign(dir.z));
    col = wallColor(p, n, footprint(t, abs(dot(dir, n)), DEFOCUS) + fwBias, detail);
  }
  float tTub;
  vec3 tubN;
  if (intersectBox(ro, dir, TUB_MIN, TUB_MAX, tTub, tubN) && tTub < t) {
    t = tTub;
    hitFloor = false;
    col = tubColor(ro + dir * tTub, tubN, footprint(tTub, abs(dot(dir, tubN)), DEFOCUS) + fwBias);
  }
  float tShelf = (-1.262 - ro.z) / dir.z;
  if (detail && tShelf > 0.0 && tShelf < t && ro.z > -1.262) {
    vec2 st = (ro + dir * tShelf).xy;
    if (st.x > -1.32 && st.x < -0.2 && st.y > 0.5 && st.y < 2.0) {
      vec4 deco = shelfItems(st, footprint(tShelf, 1.0, DEFOCUS) + fwBias);
      col = mix(col, deco.rgb * 0.97, deco.a);
    }
  }
  return col;
}
vec3 floorColor(vec3 p, vec3 rd, float t) {
  float fw = footprint(t, -rd.y, DEFOCUS);
  vec2 st = p.xz + vec2(0.05, 0.02);
  float grout = filteredGrid(st, 0.20, 0.0028, fw);
  vec3 tileCol = vec3(0.690, 0.735, 0.780) * (1.0 + (hash21(floor(st / 0.20)) - 0.5) * 0.05 * clamp(1.0 - fw / 0.1, 0.0, 1.0));
  vec3 col = mix(tileCol, vec3(0.90, 0.92, 0.94), grout * 0.8);
  vec2 edge = min(p.xz - ROOM_MIN.xz, ROOM_MAX.xz - p.xz);
  col *= 1.0 - 0.16 * exp(-min(edge.x, edge.y) / 0.14) - 0.20 * exp(-max(p.z - TUB_MAX.z, 0.0) / 0.10) * step(p.x, TUB_MAX.x + 0.05);
  float fresnel = 0.05 + 0.95 * pow(1.0 - clamp(-rd.y, 0.0, 1.0), 5.0);
  float refl = fresnel * 0.42 * smoothstep(0.055, 0.11, fresnel);
  if (refl > 0.0) {
    float tRefl;
    bool hitFloor;
    col = mix(col, traceRoom(vec3(p.x, 0.002, p.z), vec3(rd.x, -rd.y, rd.z), 0.03, false, tRefl, hitFloor), refl);
  }
  return col;
}
bool floorOccluded(vec3 ro, vec3 rd, float tMax) {
  float t;
  vec3 n;
  return intersectBox(ro, rd + (1.0 - abs(sign(rd))) * 1e-5, TUB_MIN, TUB_MAX, t, n) && t < tMax;
}
vec3 traceEnvironment(vec3 ro, vec3 rd, bool cutFloor) {
  vec3 col = vec3(0.0);
  float tFloor = -ro.y / min(rd.y, -1e-4);
  vec3 hit = ro + rd * tFloor;
  if (cutFloor && ro.y > 0.0 && rd.y < -1e-4 && onFloorDisk(hit) && all(greaterThan(hit.xz, ROOM_MIN.xz)) && all(lessThan(hit.xz, ROOM_MAX.xz)) && !floorOccluded(ro, rd, tFloor)) hitFloorDisk = true;
  else {
    float t;
    bool hitFloor;
    col = traceRoom(ro, rd, 0.0, true, t, hitFloor);
    if (hitFloor && ro.y > 0.0) col = floorColor(ro + rd * t, rd, t);
    else if (hitFloor) col = vec3(0.86, 0.88, 0.90);
  }
  return col;
}
vec3 applyAtmosphere(vec3 col, vec3 rd, vec2 fragCoord) {
  vec2 st = fragCoord / uResolution;
  float n0 = valueNoise(vec2(st.x * 2.6 + uBackdropTime * 0.02 + 0.25 * sin(st.y * 5.0 - uBackdropTime * 0.07), st.y * 2.0 - uBackdropTime * 0.06));
  float steam = (0.10 + 0.16 * uRain) * smoothstep(0.15, 1.0, st.y) * (0.45 + 0.9 * n0);
  return mix(col, vec3(0.96, 0.97, 0.98), steam);
}
#endif
#if SCENE == 2
const float DEFOCUS = 0.02;
vec3 neonPalette(float h) {
  return h < 0.27 ? vec3(1.0, 0.20, 0.50) : h < 0.54 ? vec3(0.13, 0.78, 1.0) : h < 0.74 ? vec3(1.0, 0.58, 0.18) : h < 0.88 ? vec3(0.62, 0.36, 1.0) : vec3(1.0, 0.92, 0.78);
}
vec3 bokehLights(float az, float el, float stretch) {
  vec3 acc = vec3(0.0);
  const float count = 64.0, cellW = 6.2831853 / count;
  float cellF = az / cellW, cell = floor(cellF), side = fract(cellF) > 0.5 ? 1.0 : -1.0;
  for (int layer = 0; layer < 3; layer++) {
    float elBase = layer == 0 ? 0.008 : layer == 1 ? 0.07 : 0.16, elRange = layer == 0 ? 0.05 : layer == 1 ? 0.08 : 0.15;
    if (el < elBase - 0.026 || (stretch == 0.0 && el > elBase + elRange + 0.026)) continue;
    for (int k = 0; k < 2; k++) {
      float id = cell + float(k) * side;
      vec2 key = vec2(mod(id, count), float(layer));
      uint h = hashU32(key + 9.2);
      if (float(h & 1023u) < (layer == 0 ? 123.0 : layer == 1 ? 256.0 : 460.0)) continue;
      float az0 = (id + 0.1 + 0.8 * float((h >> 10) & 1023u) / 1023.0) * cellW;
      if (abs(az - az0) > 0.0255) continue;
      uint h2 = hashU32(key + 3.7);
      float el0 = elBase + elRange * float((h >> 20) & 1023u) / 1023.0;
      float radius = 0.008 + 0.017 * float(h2 & 1023u) / 1023.0;
      float dy = el - el0, fade = 1.0;
      if (stretch > 0.0 && dy > 0.0) {
        fade = exp(-dy * 3.2);
        dy /= 1.0 + stretch;
      }
      float d = length(vec2(az - az0, dy));
      float disc = (1.0 - smoothstep(radius * 0.80, radius, d)) * (0.66 + 0.34 * smoothstep(radius * 0.45, radius * 0.8, d));
      acc += neonPalette(float((h2 >> 10) & 1023u) / 1023.0) * disc * fade * (0.55 + 1.25 * float((h2 >> 20) & 1023u) / 1023.0);
    }
  }
  return acc;
}
vec3 neonSigns(float az, float el, float stretch) {
  vec3 acc = vec3(0.0);
  if (el < 0.08 || (stretch == 0.0 && el > 0.42)) return acc;
  const float count = 30.0, cellW = 6.2831853 / count;
  float cellF = az / cellW, cell = floor(cellF), side = fract(cellF) > 0.5 ? 1.0 : -1.0;
  for (int k = 0; k < 2; k++) {
    float id = cell + float(k) * side;
    uint h = hashU32(vec2(mod(id, count), 4.4));
    if (float(h & 255u) < 56.0) continue;
    float r1 = float((h >> 8) & 255u) / 255.0, r2 = float((h >> 16) & 255u) / 255.0;
    float az0 = (id + 0.2 + 0.6 * r1) * cellW, el0 = 0.17 + 0.12 * r2;
    vec2 halfSize = vec2(0.010 + 0.008 * r2, 0.045 + 0.04 * r1);
    float dy = el - el0, fade = 1.0;
    if (stretch > 0.0 && dy > 0.0) {
      fade = exp(-dy * 2.4);
      dy /= 1.0 + stretch;
    }
    float d = sdRoundBox(vec2(az, dy + el0), vec2(az0, el0), halfSize, 0.008);
    acc += neonPalette(float(h >> 24) / 255.0) * ((1.0 - smoothstep(-0.008, 0.008, d)) * 1.5 + exp(-max(d, 0.0) * 34.0) * 0.30) * fade;
  }
  return acc;
}
vec3 nightSkyGradient(float el) {
  return mix(vec3(0.105, 0.070, 0.180), vec3(0.022, 0.026, 0.066), smoothstep(-0.02, 0.6, el));
}
vec3 skyColor(vec3 rd) {
  float el = asin(clamp(rd.y, -1.0, 1.0)), az = atan(rd.x, rd.z);
  vec3 col = nightSkyGradient(el);
  float bx = az / 0.17, bldg = floor(bx);
  float roofEl = 0.15 + 0.30 * hash21(vec2(bldg, 2.0)) * (0.5 + 0.5 * hash21(vec2(floor(bx * 0.37), 5.0)));
  float edgeDist = min(fract(bx), 1.0 - fract(bx)) * 0.17;
  float mask = (1.0 - smoothstep(roofEl - 0.010, roofEl + 0.010, el)) * smoothstep(0.0, 0.010, edgeDist);
  vec3 facade = mix(vec3(0.040, 0.040, 0.078), vec3(0.070, 0.052, 0.110), hash21(vec2(bldg, 8.0)));
  vec2 win = vec2(az / 0.0125, el / 0.019), winCell = floor(win), winF = abs(fract(win) - 0.5);
  float lit = step(0.76, hash21(winCell + bldg * 13.0)) * (1.0 - smoothstep(0.05, 0.42, winF.x)) * (1.0 - smoothstep(0.04, 0.42, winF.y));
  facade += mix(vec3(0.60, 0.42, 0.22), vec3(0.30, 0.42, 0.60), step(0.8, hash21(winCell + 3.0))) * lit * 0.42;
  col = mix(col, facade, mask);
  col += bokehLights(az, el, 0.0) + neonSigns(az, el, 0.0);
  return mix(col, vec3(0.16, 0.11, 0.25), exp(-max(el, 0.0) * 9.0) * 0.55);
}
vec3 floorColor(vec3 p, vec3 rd, float t) {
  float fw = footprint(t, -rd.y, DEFOCUS);
  float detail = clamp(1.0 - fw / 0.06, 0.0, 1.0);
  float n0 = detail > 0.0 ? valueNoise(p.xz * 26.0) : 0.5;
  vec3 col = vec3(0.040, 0.043, 0.062) * (0.8 + 0.4 * n0 * detail);
  float stripe = filteredLines(p.x + 0.42, 0.84, 0.21, fw) * filteredBand(p.z, -3.3, -1.25, fw);
  col = mix(col, vec3(0.26, 0.27, 0.32) * (0.75 + 0.35 * n0), stripe * 0.75);
  float puddle = smoothstep(0.40, 0.66, valueNoise(p.xz * 1.5 + 3.0) * 0.8 + 0.1 + 0.1 * sin(p.x * 9.0 + 2.0 * sin(p.z * 7.0)));
  float el = asin(clamp(-rd.y, 0.0, 1.0)), az = atan(rd.x, rd.z) + (n0 - 0.5) * 0.03 * (1.0 - 0.7 * puddle);
  float fresnel = (0.05 + 0.95 * pow(1.0 - clamp(-rd.y, 0.0, 1.0), 4.0)) * mix(0.45, 0.95, puddle);
  col = mix(col, nightSkyGradient(el) + bokehLights(az, el, 6.0) + neonSigns(az, el, 5.0), fresnel);
  if (uRain > 0.0 && detail > 0.0) {
    vec2 cellF = p.xz / 0.17, cell = floor(cellF);
    vec2 rnd = hash22(cell);
    float phase = uBackdropTime * (0.8 + 0.5 * rnd.x) + rnd.y, age = fract(phase);
    float ripple = exp(-pow((length(fract(cellF) - 0.5 - (rnd - 0.5) * 0.5) * 0.17 - age * 0.05) / 0.003, 2.0)) * (1.0 - age) * (1.0 - age) * step(0.62, hash21(cell + floor(phase) * 7.0));
    col += vec3(0.22, 0.26, 0.40) * ripple * detail * uRain;
  }
  return mix(col, vec3(0.115, 0.080, 0.185), 1.0 - exp(-t / 30.0));
}
vec3 traceEnvironment(vec3 ro, vec3 rd, bool cutFloor) {
  vec3 col = vec3(0.0);
  if (ro.y > 0.0 && rd.y < -1e-4) {
    float t = -ro.y / rd.y;
    vec3 p = ro + rd * t;
    if (cutFloor && onFloorDisk(p)) hitFloorDisk = true;
    else col = floorColor(p, rd, t);
  } else col = skyColor(rd.y < 0.0 ? vec3(rd.x, -rd.y, rd.z) : rd);
  return col;
}
bool floorOccluded(vec3 ro, vec3 rd, float tMax) {
  return false;
}
vec3 applyAtmosphere(vec3 col, vec3 rd, vec2 fragCoord) {
  if (uRain > 0.0) {
    vec2 st = fragCoord / uResolution.y;
    vec2 q = vec2((st.x + st.y * 0.12) * 110.0, st.y * 4.0 + uBackdropTime * 3.6);
    float h = hash21(vec2(floor(q.x), floor(q.y + hash21(vec2(floor(q.x), 1.0)) * 7.0)));
    float streak = step(0.94, h) * (1.0 - smoothstep(0.0, 0.5, abs(fract(q.x) - 0.5)));
    col += vec3(0.22, 0.24, 0.36) * streak * 0.20 * uRain;
  }
  return col;
}
#endif
#if SCENE == 3
const float DEFOCUS = 0.014;
const float POOL_EDGE_Z = -0.60, COPING_WIDTH = 0.17, POOL_FAR_Z = -17.0;
vec3 daySkyGradient(float el) {
  return mix(vec3(0.70, 0.88, 1.0), vec3(0.20, 0.52, 0.96), smoothstep(0.0, 0.85, el));
}
vec3 skyColor(vec3 rd) {
  float el = asin(clamp(rd.y, -1.0, 1.0)), az = atan(rd.x, rd.z);
  vec3 col = daySkyGradient(el);
  if (el > 0.05 && el < 0.60) {
    float cloud = smoothstep(0.46, 0.70, fbm(vec2(az * 1.7, el * 6.5) + 4.0));
    col = mix(col, vec3(1.0), cloud * smoothstep(0.05, 0.14, el) * (1.0 - smoothstep(0.30, 0.60, el)) * 0.9);
  }
  if (el < 0.16) {
    float hedgeEl = 0.112 + 0.022 * valueNoise(vec2(az * 13.0, 2.0)) + 0.010 * valueNoise(vec2(az * 31.0, 7.0));
    vec3 hedgeCol = mix(vec3(0.20, 0.44, 0.25), vec3(0.38, 0.62, 0.32), valueNoise(vec2(az * 24.0, el * 34.0)) * 0.65 + valueNoise(vec2(az * 55.0, el * 70.0)) * 0.35);
    hedgeCol *= mix(0.80, 1.06, smoothstep(0.06, 0.13, el));
    col = mix(col, hedgeCol, 1.0 - smoothstep(hedgeEl - 0.014, hedgeEl + 0.014, el));
    col = mix(col, vec3(0.97, 0.96, 0.93) * mix(0.86, 1.0, smoothstep(0.0, 0.06, el)), 1.0 - smoothstep(0.058, 0.064, el));
  }
  return col;
}
vec3 floorColor(vec3 p, vec3 rd, float t) {
  float fw = footprint(t, -rd.y, DEFOCUS);
  float detail = clamp(1.0 - fw / 0.08, 0.0, 1.0);
  vec2 st = p.xz + vec2(0.17, 0.05);
  float grout = filteredGrid(st, 0.45, 0.0028, fw);
  vec3 deck = vec3(0.905, 0.865, 0.790) * (1.0 + (hash21(floor(st / 0.45)) - 0.5) * 0.07 * clamp(1.0 - fw / 0.2, 0.0, 1.0)) * (0.955 + 0.09 * valueNoise(p.xz * 34.0) * detail);
  deck = mix(deck, vec3(0.66, 0.62, 0.56), grout * 0.75);
  float coping = filteredBand(p.z, POOL_EDGE_Z - COPING_WIDTH, POOL_EDGE_Z, fw);
  vec3 copingCol = vec3(0.975, 0.97, 0.955) * (1.0 - 0.10 * filteredLines(p.x + 0.2, 0.6, 0.002, fw)) * (1.0 - 0.07 * smoothstep(POOL_EDGE_Z - 0.02, POOL_EDGE_Z, p.z));
  vec3 col = mix(deck, copingCol, coping);
  float inPool = filteredBand(p.z, POOL_FAR_Z, POOL_EDGE_Z - COPING_WIDTH, fw);
  if (inPool > 0.0) {
    float depth = smoothstep(0.0, 7.0, POOL_EDGE_Z - COPING_WIDTH - p.z);
    vec3 waterCol = mix(vec3(0.34, 0.86, 0.90), vec3(0.07, 0.50, 0.82), depth);
    vec2 wp = p.xz + 0.03 * vec2(sin(p.z * 9.0 + uBackdropTime * 1.3), sin(p.x * 8.0 - uBackdropTime * 1.1));
    waterCol *= 1.0 - 0.13 * filteredGrid(wp, 0.25, 0.007, fw) * (1.0 - depth);
    waterCol += vec3(0.60, 0.52, 0.40) * caustics(p.xz * 1.5, uBackdropTime * 0.8) * clamp(1.0 - fw / 0.16, 0.0, 1.0) * (1.0 - 0.55 * depth);
    float fresnel = 0.02 + 0.98 * pow(1.0 - clamp(-rd.y, 0.0, 1.0), 5.0);
    waterCol = mix(waterCol, daySkyGradient(asin(clamp(-rd.y, 0.0, 1.0))), fresnel * 0.8);
    vec2 sparkF = p.xz * vec2(7.0, 3.0), sparkCell = floor(sparkF);
    vec2 rnd = hash22(sparkCell);
    float spark = smoothstep(0.86, 1.0, sin(uBackdropTime * (2.0 + 3.0 * rnd.x) + rnd.y * 6.28)) * step(0.6, rnd.x);
    waterCol += vec3(1.0) * spark * (1.0 - smoothstep(0.0, 0.32, length(fract(sparkF) - 0.5 - (rnd - 0.5) * 0.4))) * 0.9 * clamp(1.0 - fw / 0.5, 0.0, 1.0);
    waterCol *= 1.0 - 0.34 * exp(-(POOL_EDGE_Z - COPING_WIDTH - p.z) / 0.045);
    vec2 ringP = p.xz - vec2(-1.37 + 0.06 * sin(uBackdropTime * 0.21), -3.16 + 0.05 * sin(uBackdropTime * 0.17 + 1.0));
    float ringR = length(ringP), aa = fw + 0.004;
    float ring = (1.0 - smoothstep(0.225 - aa, 0.225 + aa, ringR)) * smoothstep(0.115 - aa, 0.115 + aa, ringR);
    vec3 ringCol = mix(vec3(0.97, 0.97, 0.96), vec3(0.96, 0.33, 0.30), smoothstep(-0.25, 0.25, sin(atan(ringP.y, ringP.x) * 4.0 + 0.6 + uBackdropTime * 0.05) / max(aa * 14.0, 0.2)));
    ringCol *= 0.84 + 0.22 * (1.0 - abs(ringR - 0.17) / 0.055);
    waterCol *= 1.0 - 0.20 * (1.0 - smoothstep(0.225, 0.29, length(ringP - vec2(0.03, 0.02))));
    waterCol = mix(waterCol, ringCol, ring);
    col = mix(col, waterCol, inPool);
  }
  return mix(col, vec3(0.80, 0.90, 0.96), (1.0 - exp(-t / 60.0)) * 0.8);
}
vec3 traceEnvironment(vec3 ro, vec3 rd, bool cutFloor) {
  vec3 col = vec3(0.0);
  if (ro.y > 0.0 && rd.y < -1e-4) {
    float t = -ro.y / rd.y;
    vec3 p = ro + rd * t;
    if (cutFloor && onFloorDisk(p)) hitFloorDisk = true;
    else col = floorColor(p, rd, t);
  } else col = skyColor(rd.y < 0.0 ? vec3(rd.x, -rd.y, rd.z) : rd);
  return col;
}
bool floorOccluded(vec3 ro, vec3 rd, float tMax) {
  return false;
}
vec3 applyAtmosphere(vec3 col, vec3 rd, vec2 fragCoord) {
  return col;
}
#endif
`;

export const BACKDROP_GLSL = BACKDROP_GLSL_SOURCE;

export const BACKDROP_VERTEX_SHADER = `
varying vec3 vRayDir;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
  vec4 farPt = inverse(projectionMatrix) * vec4(position.xy, 1.0, 1.0);
  vRayDir = transpose(mat3(viewMatrix)) * (farPt.xyz / farPt.w);
}
`;

export const BACKDROP_FRAGMENT_SHADER = `
${BACKDROP_GLSL}uniform float uFloorFade;
varying vec3 vRayDir;
void main() {
#if SCENE == 0
  gl_FragColor = vec4(studioGradient(gl_FragCoord.xy), 1.0);
#else
  vec3 rd = normalize(vRayDir);
  vec3 col = traceEnvironment(cameraPosition, rd, uFloorFade <= 0.0);
  gl_FragColor = vec4(hitFloorDisk ? col : applyAtmosphere(col, rd, gl_FragCoord.xy), 1.0);
#endif
}
`;
