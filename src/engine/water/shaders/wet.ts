/**
 * Wet map shaders: texel position bake, simulation update and wet mark stamping.
 */
import { LEG_SKINNING_GLSL } from "../../rig/joints";

const POS_Y_OFFSET = 0.44;

export const WET_BAKE_VERTEX_SHADER = `
${LEG_SKINNING_GLSL}uniform vec2 uBakeSlot;
varying vec3 vBakePos, vBakeNormal;
void main() {
  mat3 jac;
  vec3 p = skinPosition(position, jac);
  vBakePos = (modelMatrix * vec4(p, 1.0)).xyz;
  vBakeNormal = mat3(modelMatrix) * skinNormal(jac, normal);
  gl_Position = vec4((uv.x * uBakeSlot.x + uBakeSlot.y) * 2.0 - 1.0, uv.y * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const WET_BAKE_FRAGMENT_SHADER = `
uniform float uBakeMode, uBakeSize;
varying vec3 vBakePos, vBakeNormal;
void main() {
  if (uBakeMode < 0.5) {
    gl_FragColor = vec4(vBakePos - vec3(0.0, ${POS_Y_OFFSET.toFixed(2)}, 0.0), 1.0);
    return;
  }
  vec3 dpx = dFdx(vBakePos) * uBakeSize, dpy = dFdy(vBakePos) * uBakeSize;
  vec3 n = normalize(cross(dpx, dpy));
  vec3 downhill = vec3(n.x * n.y, n.y * n.y - 1.0, n.z * n.y);
  float e11 = dot(dpx, dpx), e12 = dot(dpx, dpy), e22 = dot(dpy, dpy), det = e11 * e22 - e12 * e12;
  float b1 = dot(dpx, downhill), b2 = dot(dpy, downhill);
  vec2 flow = det > 1e-12 ? vec2(e22 * b1 - e12 * b2, -e12 * b1 + e11 * b2) / det : vec2(0.0);
  float ny = normalize(vBakeNormal).y;
  gl_FragColor = vec4(clamp(flow, -4.0, 4.0), sqrt(max(0.0, 1.0 - ny * ny)), 1.0);
}
`;

export const WET_QUAD_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const WET_UPDATE_FRAGMENT_SHADER = `
uniform sampler2D uWetPrev, uPosMap, uFlowMap;
uniform vec2 uTexel, uAtlasScale;
uniform float uDt, uDryRate, uAbsorbRate, uFlowSpeed, uWickRate;
uniform vec4 uLegWater[2];
varying vec2 vUv;
void main() {
  vec4 state = texture2D(uWetPrev, vUv);
  float valid = texture2D(uPosMap, vUv).a;
  vec2 offs[4];
  offs[0] = vec2(uTexel.x, 0.0);
  offs[1] = -offs[0];
  offs[2] = vec2(0.0, uTexel.y);
  offs[3] = -offs[2];
  if (valid < 0.5) {
    vec4 sum = vec4(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 4; i++) {
      float w = texture2D(uPosMap, vUv + offs[i]).a;
      sum += texture2D(uWetPrev, vUv + offs[i]) * w;
      wsum += w;
    }
    gl_FragColor = wsum > 0.0 ? sum / wsum : vec4(0.0);
    return;
  }
  float soak = state.r, film = state.g, fresh = state.b;
  vec4 water = vUv.x < 0.5 ? uLegWater[0] : uLegWater[1];
  vec3 flow = texture2D(uFlowMap, vUv).rgb;
  float slide = smoothstep(0.35, 1.1, film) * flow.z;
  vec2 upUv = vUv - flow.xy * uAtlasScale * uFlowSpeed * slide * uDt;
  float upFilm = texture2D(uWetPrev, upUv).g * texture2D(uPosMap, upUv).a;
  film = mix(film, max(upFilm, film * 0.6), slide * 0.9);
  float absorb = min(film, uAbsorbRate * water.x * uDt);
  film -= absorb;
  soak += absorb * 0.9;
  float wick = 0.0;
  for (int i = 0; i < 4; i++) {
    float w = texture2D(uPosMap, vUv + offs[i]).a;
    wick += (texture2D(uWetPrev, vUv + offs[i]).r - state.r) * w;
  }
  soak += wick * uWickRate * water.y * uDt;
  soak = max(0.0, soak - uDryRate * uDt);
  film = max(0.0, film - (uDryRate * 1.5 + water.z) * uDt);
  fresh = max(0.0, fresh - uDt * 2.2);
  gl_FragColor = vec4(min(soak, 1.6), min(film, 1.6), fresh, 1.0);
}
`;

export const WET_STAMP_VERTEX_SHADER = `
attribute vec4 aRect, aA, aB, aAmt;
varying vec2 vUv;
varying vec4 vStampA, vStampB, vStampAmt;
void main() {
  vec2 uv = mix(aRect.xy, aRect.zw, position.xy * 0.5 + 0.5);
  vUv = uv;
  vStampA = aA;
  vStampB = aB;
  vStampAmt = aAmt;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const WET_STAMP_FRAGMENT_SHADER = `
uniform sampler2D uPosMap;
varying vec2 vUv;
varying vec4 vStampA, vStampB, vStampAmt;
float hash31(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float valueNoise3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x), mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y), mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x), mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main() {
  vec4 posTex = texture2D(uPosMap, vUv);
  if (posTex.a < 0.5) discard;
  vec3 p = posTex.xyz + vec3(0.0, ${POS_Y_OFFSET.toFixed(2)}, 0.0);
  vec3 a = vStampA.xyz, b = vStampB.xyz;
  float radius = vStampA.w;
  vec3 ap = p - a, ab = b - a;
  float t = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
  float d = length(ap - ab * t);
  if (d > radius * 1.35) discard;
  float seed = vStampAmt.w;
  float rough = vStampB.w;
  float nz = valueNoise3(p * 190.0 + seed * 7.1) * 0.62 + valueNoise3(p * 470.0 + seed * 3.3) * 0.38;
  float r = radius * mix(1.0, 0.70 + 0.62 * nz, rough);
  float mask = 1.0 - smoothstep(r * 0.80, r, d);
  float core = 1.0 - smoothstep(0.0, r, d);
  float amt = mask * (0.6 + 0.4 * core);
  gl_FragColor = vec4(vStampAmt.xyz * amt, 0.0);
}
`;
