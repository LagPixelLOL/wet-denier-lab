/**
 * Stocking and skin shaders, plus the height used to fade the stocking top.
 */
import { LEG_SKINNING_GLSL } from "../../rig/joints";
import { CAUSTICS_GLSL } from "./backdrop";

export const fadeHeight = (x, y, z) => y - (x - 0.066) * 0.3346 + (z - 0.04) * 0.0157;

export const FADE_HEIGHT_GLSL = "position.y - 0.3346 * (position.x - 0.066) + 0.0157 * (position.z - 0.04)";

export const LEG_VERTEX_SHADER = `
invariant gl_Position;
${LEG_SKINNING_GLSL}attribute vec3 legTangent;
attribute float stretch;
attribute vec2 gapNail;
attribute vec2 skinFx;
uniform float uCuffY, uCuffBulge, uIsSkin;
varying vec3 vWorldPos, vNormal, vTangent, vRestPos, vRestNormal;
varying vec2 vUv, vSkinFx;
varying float vStretch, vGap, vNail, vTangentShift, vFadeHeight;
float cuffProfile(float dy) {
  float bulge = 0.0022 * exp(-pow((dy - 0.0065) / 0.0085, 2.0));
  float dent = -0.0011 * smoothstep(-0.05, -0.008, dy) * (1.0 - smoothstep(-0.002, 0.003, dy));
  return (bulge + dent) * uCuffBulge;
}
void main() {
  mat3 jac;
  vec3 p = skinPosition(position, jac);
  vec3 n = skinNormal(jac, normal), tang = normalize(jac * legTangent);
  vec3 rest = position;
  if (uIsSkin < 0.5) {
    float dy = position.y - uCuffY;
    float off = cuffProfile(dy);
    float slope = (cuffProfile(dy + 0.0008) - cuffProfile(dy - 0.0008)) / 0.0016;
    p += n * off;
    rest += normal * off;
    n = normalize(n - tang * slope);
  }
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  vTangent = normalize(mat3(modelMatrix) * tang);
  vTangentShift = abs(vTangent.y - legTangent.y);
  vRestPos = rest;
  vFadeHeight = ${FADE_HEIGHT_GLSL};
  vRestNormal = normal;
  vUv = uv;
  vSkinFx = skinFx;
  vStretch = stretch;
  vGap = gapNail.x;
  vNail = gapNail.y;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const LEG_DEPTH_FRAGMENT_SHADER = `
uniform float uFadeStart, uFadeEnd;
varying float vFadeHeight;
void main() {
  if (vFadeHeight > (gl_FrontFacing ? uFadeEnd : uFadeStart)) discard;
  gl_FragColor = vec4(0.0);
}
`;

export const LEG_FRAGMENT_SHADER = `
uniform vec3 uKeyDir, uKeyColor, uRimDir, uRimColor, uFillTop, uFillBottom;
uniform vec3 uRim2Dir, uRim2Color, uEnvLo, uEnvHi, uEnvAColor, uEnvADir, uEnvBColor, uEnvBDir;
uniform float uCaustic, uMirrorFlipY, uMirrorFalloff;
uniform vec3 uSkinLit, uSkinShade, uSkinScatter;
uniform vec3 uDye, uDye2, uSheenColor, uShade;
uniform float uStripe, uDenier, uPattern, uGloss, uCuffY, uHasCuff, uIsSkin, uThrough, uSheenAmount;
uniform float uCuffStyle, uBand, uGarter;
uniform float uPrint, uMirror;
uniform vec4 uMatWet;
uniform vec4 uMatKnit;
uniform vec4 uSecret;
uniform vec4 uWetDye;
uniform sampler2D uKnitTex, uWetMap, uDecalAtlas;
uniform vec2 uWetMapSlot;
uniform float uFadeStart, uFadeEnd, uTime, uOpacity;
uniform highp sampler2DShadow uCastShadowMap;
uniform mat4 uCastShadowMatrix;
uniform float uCastShadowStrength, uCastShadowTexel;
uniform float uHighlightFalloff, uKnitMean;
varying vec3 vWorldPos, vNormal, vTangent, vRestPos, vRestNormal;
varying vec2 vUv, vSkinFx;
varying float vStretch, vGap, vNail, vTangentShift, vFadeHeight;
float aaStep(float edge, float x) {
  float w = fwidth(x) * 0.75;
  return smoothstep(edge - w, edge + w, x);
}
${CAUSTICS_GLSL}float castShadow() {
  if (uCastShadowStrength < 0.004) return 0.0;
  vec4 sc = uCastShadowMatrix * vec4(vWorldPos, 1.0);
  if (sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0) return 0.0;
  float ref = sc.z - 0.0025;
  vec2 texel = vec2(uCastShadowTexel);
  float lit = texture(uCastShadowMap, vec3(sc.xy, ref)) * 2.0;
  lit += texture(uCastShadowMap, vec3(sc.xy + texel * vec2(1.5, 0.6), ref));
  lit += texture(uCastShadowMap, vec3(sc.xy + texel * vec2(-0.6, 1.5), ref));
  lit += texture(uCastShadowMap, vec3(sc.xy + texel * vec2(-1.5, -0.6), ref));
  lit += texture(uCastShadowMap, vec3(sc.xy + texel * vec2(0.6, -1.5), ref));
  return (1.0 - lit / 6.0) * uCastShadowStrength;
}
float legArcLength(vec3 p) {
  float dy = p.y - 0.105, dz = p.z - 0.075;
  if (dy >= 0.0) return p.y;
  if (dz >= 0.0) return 0.105 - 0.1335 - dz;
  return 0.105 - 0.085 * atan(-dy, -dz);
}
float atlasPattern(vec2 coord, float tile, float cell, float fill) {
  vec2 gx = dFdx(coord) / (cell * fill) * 0.5, gy = dFdy(coord) / (cell * fill) * 0.5;
  vec2 q = coord / cell;
  q.x += 0.5 * floor(q.y);
  vec2 local = (fract(q) - 0.5) / fill + 0.5;
  if (local.x <= 0.0 || local.x >= 1.0 || local.y <= 0.0 || local.y >= 1.0) return 0.0;
  vec2 tileOrigin = vec2(mod(tile, 2.0), floor(tile * 0.5));
  float sdf = textureGrad(uDecalAtlas, (tileOrigin + local) * 0.5, gx, gy).r;
  float blur = max(length(gx), length(gy)) * 2.0;
  return mix(smoothstep(0.47 - blur * 1.5, 0.53 + blur * 1.5, sdf), sdf, clamp(blur * 4.0 - 0.6, 0.0, 1.0));
}
float patternDensity(vec2 coord, float h, out float open, out float accent) {
  open = 0.0;
  accent = 0.0;
  if (uPattern < 0.5) return 1.0;
  if (uPattern < 1.5) {
    vec2 grid = coord / 0.0105;
    grid.x += 0.5 * floor(grid.y);
    vec2 cp = fract(grid) - 0.5;
    float d = length(cp) * 0.0105;
    return 1.0 + 1.8 * (1.0 - aaStep(0.0019, d));
  }
  if (uPattern < 2.5) {
    vec2 grid = vec2(coord.x + coord.y, coord.x - coord.y) / 0.028;
    vec2 cp = (0.5 - abs(fract(grid) - 0.5)) * 0.028 * 0.7071;
    float d = min(cp.x, cp.y);
    return 1.0 + 2.4 * (1.0 - aaStep(0.00055, d));
  }
  if (uPattern < 3.5) {
    vec2 grid = vec2(coord.x + coord.y, coord.x - coord.y) / 0.0125;
    vec2 cp = (0.5 - abs(fract(grid) - 0.5)) * 0.0125 * 0.7071;
    float lineW = 0.00042 + uDenier * 0.0000045;
    float thread = 1.0 - aaStep(lineW, min(cp.x, cp.y));
    thread = max(thread, 1.0 - aaStep(lineW * 1.8, length(cp)));
    open = 1.0 - thread;
    return 1.0;
  }
  if (uPattern < 4.5) {
    float hoop = 1.0 - aaStep(0.25, abs(fract(h / 0.046) - 0.5));
    accent = hoop * uPrint;
    return 1.0 + 2.4 * hoop * (1.0 - uPrint);
  }
  if (uPattern < 5.5) {
    float d = abs(fract(coord.x / 0.0105) - 0.5) * 0.0105;
    return 1.0 + 2.6 * (1.0 - aaStep(0.0009, d));
  }
  if (uPattern < 6.5) {
    float backMask = smoothstep(0.25, 0.6, -normalize(vRestNormal).z);
    float d = abs(vRestPos.x - mix(0.011, -0.004, smoothstep(0.2, 0.5, vRestPos.y)));
    float seam = (1.0 - aaStep(0.0011, d)) * smoothstep(0.03, 0.05, vRestPos.y);
    float heel = (1.0 - aaStep(mix(0.032, 0.0011, smoothstep(0.035, 0.125, vRestPos.y)), d)) * (1.0 - smoothstep(0.118, 0.126, vRestPos.y));
    return 1.0 + backMask * (5.0 * seam + 2.4 * heel);
  }
  if (uPattern < 7.5) return 1.0 + 3.2 * atlasPattern(coord, 0.0, 0.026, 0.62);
  if (uPattern < 8.5) return 1.0 + 3.2 * atlasPattern(coord, 1.0, 0.026, 0.62);
  if (uPattern < 9.5) {
    vec2 flowerGrid = coord / 0.022;
    flowerGrid.x += 0.5 * floor(flowerGrid.y);
    vec2 fp = (fract(flowerGrid) - 0.5) * 0.022;
    float r = length(fp), ang = atan(fp.y, fp.x);
    float petalR = 0.0062 * (0.62 + 0.38 * abs(cos(2.5 * ang)));
    float petal = 1.0 - aaStep(petalR, r);
    float core = 1.0 - aaStep(0.0015, r);
    float rim = petal * aaStep(petalR - 0.0008, r);
    vec2 hexUv = vec2(coord.x * 0.866 + coord.y * 0.5, coord.y) / 0.0018;
    float diamond = abs(fract(hexUv.x) - 0.5) + abs(fract(hexUv.y) - 0.5);
    float density = 0.16 + 0.34 * aaStep(0.62, diamond);
    density = max(density, petal * 0.8);
    density = mix(density, 0.2, core * 0.9);
    density = max(density, rim);
    return mix(0.35, 3.4, density);
  }
  if (uPattern < 10.5) return mix(3.2, 0.32, smoothstep(0.0, 0.66, h));
  return 1.0 + 3.2 * atlasPattern(coord, 2.0, 0.030, 0.66);
}
float laceCuff(float x, float depth, out float cut) {
  float wave = abs(sin(3.14159 * x / 0.0175));
  float edgeY = 0.0045 * (1.0 - wave);
  cut = 1.0 - aaStep(edgeY, depth);
  vec2 fp = vec2(mod(x, 0.034) - 0.017, depth - 0.027);
  float r = length(fp), ang = atan(fp.y, fp.x);
  float petalR = 0.0088 * (0.62 + 0.38 * abs(cos(2.5 * ang)));
  float petal = 1.0 - aaStep(petalR, r);
  float core = 1.0 - aaStep(0.0021, r);
  float rim = petal * aaStep(petalR - 0.0010, r);
  vec2 leafP = vec2(mod(x + 0.017, 0.034) - 0.017, depth - 0.031);
  float leaf = 1.0 - aaStep(0.0034, length(leafP * vec2(1.0, 2.1)));
  vec2 hexUv = vec2(x * 0.866 + depth * 0.5, depth) / 0.0016;
  float diamond = abs(fract(hexUv.x) - 0.5) + abs(fract(hexUv.y) - 0.5);
  float net = 0.10 + 0.20 * aaStep(0.62, diamond);
  float edgeLine = 1.0 - aaStep(0.0014, abs(depth - edgeY - 0.0011));
  float hemLine = 1.0 - aaStep(0.0021, abs(depth - 0.058));
  float density = net;
  density = max(density, petal * 0.78);
  density = mix(density, 0.12, core * 0.9);
  density = max(density, rim * 1.0);
  density = max(density, leaf * 0.7);
  density = max(density, edgeLine);
  density = max(density, hemLine);
  return mix(12.0, 190.0, density);
}
void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(cameraPosition - vWorldPos);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float ndl = dot(n, uKeyDir);
  float height = vRestPos.y;
  float lit = 1.0 - castShadow();
  float hardLit = smoothstep(-0.04, 0.10, ndl) * lit;
  vec3 hemi = mix(uFillBottom, uFillTop, n.y * uMirrorFlipY * 0.5 + 0.5);
  float rim = smoothstep(0.62, 0.86, 1.0 - ndv) * smoothstep(0.0, 0.35, dot(n, uRimDir));
  float skinLit = mix(smoothstep(-0.34, 0.46, ndl) * lit, hardLit, 0.3);
  vec3 bareSkin = mix(uSkinShade, uSkinLit, skinLit);
  float terminator = smoothstep(-0.30, -0.02, ndl) * (1.0 - smoothstep(-0.02, 0.26, ndl));
  bareSkin = mix(bareSkin, uSkinScatter, terminator * 0.2);
  bareSkin *= hemi;
  float underLit = smoothstep(-0.30, 0.42, ndl) * lit;
  vec3 underSkin = mix(uSkinShade, uSkinLit, underLit);
  underSkin = mix(underSkin, uSkinScatter, (1.0 - abs(underLit * 2.0 - 1.0)) * 0.16);
  underSkin *= hemi;
  float bulge = smoothstep(0.05, 0.95, vSkinFx.x), hollow = smoothstep(0.05, 0.95, -vSkinFx.x);
  float bumpShade = 1.0 - 0.05 * bulge + 0.03 * hollow;
  vec3 skinTint = mix(vec3(1.0), vec3(1.0, 0.86, 0.85), vSkinFx.y * 0.75) * mix(vec3(1.0), vec3(0.985, 0.945, 0.94), bulge) * (1.0 + 0.03 * hollow);
  bareSkin *= skinTint;
  underSkin *= skinTint;
  vec3 wet = vUv.x >= 0.0 ? texture2D(uWetMap, vec2(vUv.x * uWetMapSlot.x + uWetMapSlot.y, vUv.y)).rgb : vec3(0.0);
  float soak = wet.r;
  float wetness = smoothstep(0.075, 0.15, soak) * clamp(0.5 + soak * 0.7, 0.0, 1.0);
  float film = smoothstep(0.04, 0.35, wet.g);
  float fresh = wet.b;
  float cuffDy = height - uCuffY;
  float fabric = 1.0 - uIsSkin;
  float cuffDen = -1.0, cut = 0.0;
  float stripe = 0.0, rib = 0.0, bandEdge = 0.0;
  if (uHasCuff > 0.5 && fabric > 0.5 && cuffDy > -0.075) {
    float depth = -cuffDy;
    if (uCuffStyle > 0.5 && uCuffStyle < 1.5) {
      float laceDen = laceCuff(vUv.x, depth, cut);
      cuffDen = mix(laceDen, -1.0, aaStep(0.0605, depth));
    } else {
      cut = 1.0 - aaStep(0.0, depth);
      float pastBand = aaStep(uBand, depth);
      cuffDen = mix(uDenier * 2.6 + 25.0, -1.0, pastBand);
      bandEdge = (1.0 - aaStep(0.0009, abs(depth - uBand))) * uPrint;
      if (uCuffStyle > 1.5 && uCuffStyle < 2.5)
      stripe = (aaStep(0.007, depth) - aaStep(0.0125, depth) + aaStep(0.018, depth) - aaStep(0.0235, depth)) * (1.0 - pastBand);
      if (uCuffStyle > 2.5)
      rib = (1.0 - pastBand) * (1.0 - cut);
    }
    fabric *= 1.0 - cut;
    bareSkin *= mix(vec3(1.0), vec3(0.90, 0.80, 0.80), cut * exp(-max(cuffDy, 0.0) / 0.0045) * 0.75);
  }
  float open, accent;
  float patMul = patternDensity(vUv * vec2(uMirror, 1.0), legArcLength(vRestPos), open, accent);
  bool isNet = uPattern > 2.5 && uPattern < 3.5;
  accent = max(max(accent, clamp((patMul - 1.0) * 0.5, 0.0, 1.0) * uPrint), stripe);
  float denier = uDenier * pow(max(vStretch, 0.3), -0.65) * patMul;
  if (isNet) denier = mix(uDenier * 4.0, 0.0, open);
  if (cuffDen >= 0.0) denier = cuffDen;
  float ribAmt = max(rib, uMatKnit.y * fabric), ribShade = 1.0;
  if (ribAmt > 0.001) {
    float ribWave = 0.5 + 0.5 * sin(vUv.x * 6.2832 / 0.0042);
    ribShade = mix(1.0, 0.82 + 0.3 * ribWave, ribAmt);
    denier *= mix(1.0, 0.7 + 0.6 * ribWave, ribAmt);
  }
  denier *= 1.0 - uMatWet.x * wetness;
  float trans0 = exp(-denier / 50.0);
  float transView = pow(trans0, 1.0 / max(ndv, 0.035));
  float grazing = 1.0 - ndv;
  float transSoft = trans0 * (1.0 - smoothstep(0.30, 0.97, pow(grazing, 0.85)));
  float sheer = mix(transView, transSoft, 0.6);
  float knit = texture2D(uKnitTex, vUv * vec2(1150.0, 1500.0) * uMatKnit.w).r;
  float knitAmt = (isNet ? 0.0 : uMatKnit.x) * (1.0 - 0.75 * wetness);
  sheer = clamp(sheer * (1.0 + knitAmt * (0.5 - knit) * 1.6), 0.0, 1.0);
  float fabLit = smoothstep(-0.28, 0.34, ndl) * lit;
  vec3 dye = mix(uDye, uDye2, accent);
  dye = mix(dye, uWetDye.rgb, uWetDye.a * wetness);
  vec3 dyeDark = dye * (1.0 - uMatWet.y * wetness * (1.0 - 0.8 * uWetDye.a));
  vec3 fabCol = dyeDark * mix(uShade, vec3(1.0), fabLit) * hemi * mix(1.0, bumpShade, 0.6) * ribShade * (1.0 - 0.2 * bandEdge);
  fabCol += uSheenColor * pow(grazing, uMatKnit.z) * uSheenAmount * (1.0 - wetness) * mix(0.45, 1.0, fabLit);
  fabCol += (0.5 + 0.5 * cos(6.2832 * (ndv * 0.75 + vec3(0.05, 0.38, 0.70)))) * vec3(0.040, 0.030, 0.045) * uMatWet.w * mix(0.5, 1.0, fabLit);
  vec3 dyeHue = dye / max(max(dye.r, dye.g), max(dye.b, 0.02));
  vec3 throughTint = mix(vec3(1.0), dyeHue, uThrough);
  if (uSecret.a > 0.5) {
    float secret = atlasPattern(vUv * vec2(uMirror, 1.0), uSecret.a - 1.0, 0.034, 0.72) * smoothstep(0.09, 0.26, max(soak, wet.g * 0.6));
    fabCol = mix(fabCol, uSecret.rgb * mix(vec3(0.72, 0.66, 0.76), vec3(1.0), fabLit) * hemi, secret * 0.92);
    sheer *= 1.0 - 0.9 * secret;
  }
  vec3 seenSkin = underSkin * mix(vec3(1.0), vec3(0.97, 0.86, 0.86), wetness);
  float gap = smoothstep(0.0008, 0.005, vGap);
  seenSkin *= mix(vec3(1.0), vec3(0.50, 0.42, 0.48), gap);
  float nail = smoothstep(0.2, 0.8, vNail);
  vec3 nailCol = mix(underSkin, vec3(1.0, 0.93, 0.92) * hemi * mix(0.86, 1.06, underLit), 0.42);
  seenSkin = mix(seenSkin, nailCol, nail * 0.8);
  seenSkin *= 1.0 - 0.12 * vNail * (1.0 - vNail) * 4.0;
  seenSkin += vec3(0.22) * nail * pow(max(dot(n, normalize(uKeyDir + v)), 0.0), 16.0);
  throughTint = mix(throughTint, vec3(1.0), wetness * 0.6);
  vec3 stockCol = mix(fabCol, seenSkin * throughTint, sheer);
  vec3 col = mix(bareSkin * mix(vec3(1.0), vec3(0.94, 0.88, 0.88), wetness), stockCol, fabric);
  if (uGarter > 0.5 && uIsSkin < 0.5 && cuffDy > -0.014) {
    vec2 gp = vRestPos.xz - vec2(-0.004, 0.034);
    float gr = length(gp), gAng = atan(gp.x, gp.y);
    float strapD = min(abs(gAng - 0.28), abs(gAng - 1.72)) * gr;
    float strap = (1.0 - aaStep(0.0072, strapD)) * aaStep(0.004, cuffDy);
    float clip = (1.0 - aaStep(0.0098, strapD)) * aaStep(-0.011, cuffDy) * (1.0 - aaStep(0.006, cuffDy));
    vec3 strapCol = (uDye * 0.92 + 0.02) * mix(uShade, vec3(1.0), fabLit) * hemi;
    strapCol += uSheenColor * 0.16 * (1.0 - smoothstep(0.0, 0.0072, strapD)) * mix(0.4, 1.0, fabLit);
    strapCol *= 1.0 - 0.25 * smoothstep(0.0052, 0.0072, strapD);
    vec3 clipCol = vec3(0.80, 0.80, 0.86) * mix(0.55, 1.15, fabLit) * hemi + vec3(0.5) * pow(max(dot(n, normalize(uKeyDir + v)), 0.0), 30.0);
    col *= 1.0 - 0.14 * (1.0 - smoothstep(0.0072, 0.0115, strapD)) * aaStep(0.004, cuffDy) * (1.0 - strap);
    col = mix(col, strapCol, strap);
    col = mix(col, clipCol, clip);
  }
  vec3 h = normalize(uKeyDir + v);
  vec3 fiber = normalize(vTangent - n * dot(n, vTangent));
  float tdh = dot(fiber, h);
  float aniso = pow(sqrt(max(0.0, 1.0 - tdh * tdh)), 55.0) * smoothstep(-0.15, 0.35, ndl) * lit;
  float ny = normalize(vRestNormal).y;
  float side = smoothstep(0.86, 0.97, sqrt(max(0.0, 1.0 - ny * ny))) * smoothstep(0.07, 0.14, height);
  vec3 hPerp = h - fiber * tdh;
  float hdn = max(dot(n, hPerp) / max(length(hPerp), 1e-4), 0.0);
  float lobe = mix(mix(1.0, pow(hdn, 5.0), uHighlightFalloff), pow(hdn, 30.0) * 0.6, smoothstep(0.004, 0.05, vTangentShift));
  float knitMod = mix(1.0, knit / uKnitMean, isNet ? 0.0 : uMatKnit.x);
  float sheenStripe = (smoothstep(0.42, 0.78, aniso) * 0.7 + aniso * 0.3) * side * lobe * knitMod;
  col += uKeyColor * sheenStripe * uStripe * uGloss * 0.85 * fabric * (1.0 - 0.35 * sheer);
  col += uRimColor * rim * mix(0.55, 0.30, fabric);
  col += uRim2Color * smoothstep(0.55, 0.86, 1.0 - ndv) * smoothstep(-0.1, 0.4, dot(n, uRim2Dir)) * mix(0.55, 0.34, fabric);
  if (uCaustic > 0.0) col *= 1.0 + uCaustic * (caustics(vWorldPos.xz * 2.6 + vWorldPos.y * uMirrorFlipY * vec2(1.1, 0.6), uTime * 0.8) - 0.2) * smoothstep(0.85, 0.05, vWorldPos.y * uMirrorFlipY) * smoothstep(-0.2, 0.3, ndl);
  float ndh = max(dot(n, h), 0.0);
  float specAmt = max(max(max(film, wetness * 0.55), fresh * 0.8), uMatWet.z * fabric);
  float wetEdge = smoothstep(0.06, 0.085, soak) * (1.0 - smoothstep(0.085, 0.2, soak));
  float wetRing = smoothstep(0.13, 0.17, soak) * (1.0 - smoothstep(0.17, 0.26, soak));
  float edgeAmt = mix(0.3, 1.0, fabric);
  wetEdge *= edgeAmt;
  wetRing *= edgeAmt;
  col *= 1.0 - wetEdge * 0.38;
  float anisoTight = pow(sqrt(max(0.0, 1.0 - tdh * tdh)), 260.0);
  float glint = smoothstep(0.25, 0.6, anisoTight) * smoothstep(-0.2, 0.3, ndl) * lobe * mix(0.4, 1.0, lit);
  if (specAmt > 0.0) {
    float spec = smoothstep(0.962, 0.982, ndh) * 1.4 + pow(ndh, 140.0) * 0.6 + pow(ndh, 22.0) * 0.22;
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 refl = reflect(-v, n);
    vec3 env = mix(uEnvLo, uEnvHi, smoothstep(-0.05, 0.6, refl.y * uMirrorFlipY));
    env += uEnvAColor * pow(max(dot(refl, uEnvADir), 0.0), 5.0) + uEnvBColor * pow(max(dot(refl, uEnvBDir), 0.0), 5.0);
    col += (uKeyColor * (spec * mix(0.4, 1.0, lit) + glint * 1.15) + env * fres * 0.9) * specAmt;
  }
  col += uKeyColor * wetRing * 0.22 * smoothstep(-0.3, 0.4, ndl) * lit;
  float pearl = uMatWet.w * fabric;
  vec2 gridUv = vUv * 260.0;
  float fw = max(fwidth(gridUv.x), fwidth(gridUv.y));
  float sparkAmt = max(max(film, wetness * 0.22), pearl * 0.8);
  if (sparkAmt > 0.2) {
    vec2 cell = floor(gridUv);
    vec2 rnd = fract(sin(vec2(dot(cell, vec2(127.1, 311.7)), dot(cell, vec2(269.5, 183.3)))) * 43758.5453);
    float sparkR = max(0.07, fw * 0.9);
    float d = length(fract(gridUv) - 0.5 - (rnd - 0.5) * 0.6);
    float twinkle = smoothstep(0.55, 0.95, sin(dot(v, vec3(rnd * 37.0, 11.0)) * 3.0 + rnd.y * 6.28));
    float spark = (1.0 - smoothstep(sparkR * 0.5, sparkR, d)) * twinkle * step(0.78 - 0.3 * pearl, rnd.x) * smoothstep(0.2, 0.6, sparkAmt);
    col += mix(vec3(1.05), 0.75 + 0.5 * cos(6.2832 * (rnd.y + vec3(0.0, 0.33, 0.67))), pearl * 0.7) * spark * smoothstep(-0.4, 0.3, ndl) * mix(0.4, 1.0, lit);
  }
  float fade = smoothstep(uFadeStart, uFadeEnd, vFadeHeight);
  if (!gl_FrontFacing && height > 0.3) fade = max(fade, mix(0.92, 1.0, smoothstep(uFadeStart - 0.10, uFadeStart, vFadeHeight)));
  gl_FragColor = vec4(col, (1.0 - fade) * uOpacity * exp(-max(vWorldPos.y * uMirrorFlipY, 0.0) * uMirrorFalloff));
}
`;
