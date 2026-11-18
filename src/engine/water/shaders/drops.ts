/**
 * Droplet, bead decal and glint shaders (screen-space refraction, Fresnel, sparkles).
 */

export const DROPLET_VERTEX_SHADER = `
attribute float aR;
attribute float aKind;
uniform vec2 uResolution;
varying vec3 vViewNormal, vViewPos;
varying float vPixelRadius, vKind;
void main() {
  vKind = aKind;
  mat3 inst3 = mat3(instanceMatrix);
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec4 viewPos = viewMatrix * world;
  vec3 nWorld = normalize(inverse(transpose(inst3)) * normal);
  vViewNormal = normalize(mat3(viewMatrix) * nWorld);
  vViewPos = viewPos.xyz;
  vPixelRadius = aR * projectionMatrix[1][1] / max(-viewPos.z, 0.01) * 0.5 * uResolution.y;
  gl_Position = projectionMatrix * viewPos;
}
`;

export const DROPLET_FRAGMENT_SHADER = `
uniform sampler2D uSceneTex;
uniform vec2 uResolution;
uniform vec3 uLightDirView;
uniform vec3 uEnvLo, uEnvHi;
uniform vec4 uRainTint;
varying vec3 vViewNormal, vViewPos;
varying float vPixelRadius, vKind;
vec3 compressHighlights(vec3 c) {
  return mix(c, 0.82 + 0.18 * (1.0 - exp(-(c - 0.82) / 0.18)), step(0.82, c));
}
vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
void main() {
  vec3 n = normalize(vViewNormal);
  vec3 v = normalize(-vViewPos);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  vec2 screenUv = gl_FragCoord.xy / uResolution;
  vec2 refrOff = -n.xy * max(vPixelRadius, 1.5) * 0.95 / uResolution;
  vec3 bg = texture2D(uSceneTex, clamp(screenUv + refrOff, vec2(0.001), vec2(0.999))).rgb;
  vec3 col = bg * vec3(0.93, 0.975, 1.0) * (1.04 + 0.30 * ndv) + vec3(0.012, 0.018, 0.03);
  vec3 refl = reflect(-v, n);
  float sky = smoothstep(0.05, 0.55, refl.y) * smoothstep(-0.9, 0.2, refl.x);
  vec3 env = mix(uEnvLo, uEnvHi, sky);
  float fres = 0.035 + 0.965 * pow(1.0 - ndv, 4.0);
  col = mix(col, env, fres * 0.8);
  float edge = smoothstep(0.45, 0.05, ndv);
  float away = smoothstep(0.35, -0.55, dot(n, uLightDirView));
  col = mix(col, col * 0.28 + vec3(0.02, 0.035, 0.07), edge * (0.30 + 0.50 * away));
  float backGlow = smoothstep(0.45, 0.92, dot(n, normalize(-uLightDirView + v * 0.8))) * smoothstep(0.15, 0.6, ndv);
  col += vec3(0.85, 0.93, 1.0) * backGlow * 0.42;
  vec3 h = normalize(uLightDirView + v);
  float ndh = max(dot(n, h), 0.0);
  col += vec3(1.0) * (smoothstep(0.968, 0.98, ndh) * 2.4 + pow(ndh, 70.0) * 0.55);
  if (vKind > 2.5 && vKind < 3.5) col = mix(col, uRainTint.rgb, uRainTint.a * (1.0 - smoothstep(0.6, 1.0, ndv) * 0.5));
  gl_FragColor = vec4(linearToSrgb(compressHighlights(col)), 1.0);
}
`;

export const BEAD_DECAL_VERTEX_SHADER = `
uniform vec3 uDecalLightDir;
varying vec2 vCorner, vLightOffset;
void main() {
  vCorner = position.xy;
  vec3 ax = normalize(instanceMatrix[0].xyz), ay = normalize(instanceMatrix[1].xyz), az = normalize(instanceMatrix[2].xyz);
  vec3 lightT = uDecalLightDir - az * dot(uDecalLightDir, az);
  vLightOffset = vec2(dot(lightT, ax), dot(lightT, ay));
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

export const BEAD_DECAL_FRAGMENT_SHADER = `
varying vec2 vCorner, vLightOffset;
void main() {
  vec2 p = vCorner * 1.35;
  float lightLen = length(vLightOffset);
  vec2 lightDir = lightLen > 1e-3 ? vLightOffset / lightLen : vec2(0.0, 1.0);
  float shift = 0.35 + 0.5 * lightLen;
  float shadow = 1.0 - smoothstep(0.55, 1.2, length(p + lightDir * shift));
  float caustic = 1.0 - smoothstep(0.0, 0.38, length((p + lightDir * shift * 0.62) * vec2(1.0, 1.25)));
  float alpha = shadow * 0.26;
  gl_FragColor = vec4(vec3(1.0, 0.99, 0.97) * caustic * 0.42, alpha);
}
`;

export const GLINT_VERTEX_SHADER = `
attribute vec4 aG;
attribute vec2 aPhase;
uniform float uTime;
uniform vec2 uResolution;
varying vec2 vCorner;
varying float vSparkle;
void main() {
  vCorner = position.xy;
  vec4 viewPos = viewMatrix * vec4(aG.xyz, 1.0);
  viewPos.xyz += normalize(-viewPos.xyz) * aG.w * 0.9;
  float wave = sin(uTime * (2.2 + aPhase.x) + aPhase.x * 6.2831);
  vSparkle = smoothstep(-0.1, 1.0, wave) * aPhase.y;
  float size = clamp(aG.w * projectionMatrix[1][1] / max(-viewPos.z, 0.01) * 0.5 * uResolution.y * 2.5, 5.0, 21.0) * mix(0.55, 1.0, aPhase.y);
  vec4 clip = projectionMatrix * viewPos;
  clip.xy += position.xy * size * 2.0 / uResolution * clip.w;
  gl_Position = clip;
}
`;

export const GLINT_FRAGMENT_SHADER = `
varying vec2 vCorner;
varying float vSparkle;
void main() {
  vec2 p = vCorner;
  float core = exp(-dot(p, p) * 22.0);
  float plus = exp(-abs(p.x) * 30.0) * (1.0 - smoothstep(0.0, 1.0, abs(p.y))) + exp(-abs(p.y) * 30.0) * (1.0 - smoothstep(0.0, 1.0, abs(p.x)));
  vec2 q = vec2(p.x + p.y, p.x - p.y) * 0.7071;
  float diag = exp(-abs(q.x) * 44.0) * (1.0 - smoothstep(0.0, 0.55, abs(q.y))) + exp(-abs(q.y) * 44.0) * (1.0 - smoothstep(0.0, 0.55, abs(q.x)));
  float amt = (core * 1.0 + plus * 0.6 + diag * 0.22) * vSparkle;
  gl_FragColor = vec4(vec3(0.94, 0.97, 1.0) * amt, 1.0);
}
`;
