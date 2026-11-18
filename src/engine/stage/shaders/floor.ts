/**
 * Floor (reflection, puddles, ripples, logo) and baked floor shadow shaders.
 */
import { LEG_SKINNING_GLSL } from "../../rig/joints";
import { BACKDROP_GLSL } from "./backdrop";

export const FLOOR_VERTEX_SHADER = `
varying vec3 vWorldPos;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const FLOOR_FRAGMENT_SHADER = `
${BACKDROP_GLSL}uniform sampler2D uFloorShadow, uContactShadow, uPuddleTex, uLogoTex;
uniform vec4 uShadowRect, uContactRect, uPuddleRect, uLogoRect;
uniform vec3 uFloorColor, uShadowColor;
uniform vec2 uSpotCenter;
uniform vec4 uRipples[16];
uniform float uTime, uFloorFade;
varying vec3 vWorldPos;
#if SCENE == 0
void main() {
  vec3 bg = studioGradient(gl_FragCoord.xy);
  if (uFloorFade > 0.999) {
    gl_FragColor = vec4(bg, 1.0);
    return;
  }
  float r = length(vWorldPos.xz - uSpotCenter);
  float spot = 1.0 - smoothstep(0.32, 0.95, r);
  vec2 shadowUv = (vWorldPos.xz - uShadowRect.xy) / uShadowRect.zw;
  shadowUv.y = 1.0 - shadowUv.y;
  vec2 contactUv = (vWorldPos.xz - uContactRect.xy) / uContactRect.zw;
  contactUv.y = 1.0 - contactUv.y;
  float shd = texture2D(uFloorShadow, shadowUv).r;
  float contact = texture2D(uContactShadow, contactUv).r;
  vec3 col = mix(bg, uFloorColor, spot * 0.85);
  col = mix(col, uShadowColor, clamp(shd * 0.55 + contact * 0.42, 0.0, 0.8) * (0.35 + 0.65 * spot));
  vec2 logoUv = (vWorldPos.xz - uLogoRect.xy) / uLogoRect.zw;
  if (logoUv.x > 0.0 && logoUv.x < 1.0 && logoUv.y > 0.0 && logoUv.y < 1.0) col = mix(col, uShadowColor, texture2D(uLogoTex, vec2(logoUv.x, 1.0 - logoUv.y)).a * 0.5);
  vec2 puddleUv = (vWorldPos.xz - uPuddleRect.xy) / uPuddleRect.zw;
  vec2 edgeFade = smoothstep(vec2(0.0), vec2(0.12), puddleUv) * smoothstep(vec2(1.0), vec2(0.88), puddleUv);
  float puddle = texture2D(uPuddleTex, puddleUv).r * edgeFade.x * edgeFade.y;
  float wet = smoothstep(0.07, 0.24, puddle);
  float ripple = 0.0;
  for (int i = 0; i < 16; i++) {
    vec4 rp = uRipples[i];
    float age = uTime - rp.z;
    if (age < 0.0 || age > 1.1) continue;
    float radius = 0.005 + age * 0.12;
    float d = length(vWorldPos.xz - rp.xy);
    ripple += exp(-pow((d - radius) / (0.0022 + age * 0.0045), 2.0)) * (1.0 - age / 1.1) * rp.w;
  }
  col = mix(col, col * vec3(0.80, 0.80, 0.88), wet * 0.75);
  float puddleRim = smoothstep(0.07, 0.12, puddle) * (1.0 - smoothstep(0.12, 0.24, puddle));
  col += vec3(1.0) * (wet * 0.05 + puddleRim * 0.10 + ripple * 0.42 * (0.35 + 0.65 * wet));
  gl_FragColor = vec4(mix(col, bg, uFloorFade), 1.0);
}
#else
uniform sampler2D uMirror;
uniform float uMirrorStrength, uPuddleLight;
uniform vec4 uMarkColor;
void main() {
  vec3 ro = cameraPosition, rd = normalize(vWorldPos - ro);
  float dist = length(vWorldPos - ro);
  if (floorOccluded(ro, rd, dist)) discard;
  vec3 col = floorColor(vWorldPos, rd, dist);
  vec2 shadowUv = (vWorldPos.xz - uShadowRect.xy) / uShadowRect.zw;
  shadowUv.y = 1.0 - shadowUv.y;
  vec2 contactUv = (vWorldPos.xz - uContactRect.xy) / uContactRect.zw;
  contactUv.y = 1.0 - contactUv.y;
  float shd = texture2D(uFloorShadow, shadowUv).r, contact = texture2D(uContactShadow, contactUv).r;
  col = mix(col, uShadowColor, clamp(shd * 0.55 + contact * 0.42, 0.0, 0.8));
  vec2 logoUv = (vWorldPos.xz - uLogoRect.xy) / uLogoRect.zw;
  if (logoUv.x > 0.0 && logoUv.x < 1.0 && logoUv.y > 0.0 && logoUv.y < 1.0) col = mix(col, uMarkColor.rgb, texture2D(uLogoTex, vec2(logoUv.x, 1.0 - logoUv.y)).a * uMarkColor.a);
  vec2 puddleUv = (vWorldPos.xz - uPuddleRect.xy) / uPuddleRect.zw;
  vec2 edgeFade = smoothstep(vec2(0.0), vec2(0.12), puddleUv) * smoothstep(vec2(1.0), vec2(0.88), puddleUv);
  float puddle = texture2D(uPuddleTex, puddleUv).r * edgeFade.x * edgeFade.y;
  float wet = smoothstep(0.07, 0.24, puddle);
  float ripple = 0.0;
  vec2 rippleGrad = vec2(0.0);
  for (int i = 0; i < 16; i++) {
    vec4 rp = uRipples[i];
    float age = uTime - rp.z;
    if (age < 0.0 || age > 1.1) continue;
    float radius = 0.005 + age * 0.12;
    vec2 dv = vWorldPos.xz - rp.xy;
    float d = length(dv);
    float ring = exp(-pow((d - radius) / (0.0022 + age * 0.0045), 2.0)) * (1.0 - age / 1.1) * rp.w;
    ripple += ring;
    rippleGrad += dv / max(d, 1e-4) * ring;
  }
  col = mix(col, col * vec3(0.80, 0.80, 0.88), wet * 0.75);
  if (uMirrorStrength > 0.0) {
    vec2 px = 1.0 / uResolution, mirrorUv = gl_FragCoord.xy * px + rippleGrad * px * 9.0;
    vec4 refl = texture2D(uMirror, mirrorUv) * 0.28 + (texture2D(uMirror, mirrorUv + px * vec2(2.6, 1.0)) + texture2D(uMirror, mirrorUv - px * vec2(2.6, 1.0)) + texture2D(uMirror, mirrorUv + px * vec2(-1.0, 3.4)) + texture2D(uMirror, mirrorUv - px * vec2(-1.0, 3.4))) * 0.18;
    float fres = (0.22 + 0.78 * pow(1.0 - clamp(-rd.y, 0.0, 1.0), 3.0)) * uMirrorStrength * mix(1.0, 1.25, wet);
    col = col * (1.0 - min(refl.a * fres, 1.0)) + refl.rgb * fres;
  }
  float puddleRim = smoothstep(0.07, 0.12, puddle) * (1.0 - smoothstep(0.12, 0.24, puddle));
  col += vec3(1.0) * ((wet * 0.05 + puddleRim * 0.10) * uPuddleLight + ripple * 0.42 * (0.35 + 0.65 * wet));
  col = applyAtmosphere(col, rd, gl_FragCoord.xy);
  if (uFloorFade > 0.0) col = mix(col, applyAtmosphere(traceEnvironment(ro, rd, false), rd, gl_FragCoord.xy), uFloorFade);
  gl_FragColor = vec4(col, 1.0);
}
#endif
`;

export const FLOOR_SHADOW_VERTEX_SHADER = `
${LEG_SKINNING_GLSL}uniform vec3 uProjDir;
varying float vHeight;
void main() {
  mat3 jac;
  vec4 world = modelMatrix * vec4(skinPosition(position, jac), 1.0);
  vHeight = world.y;
  vec3 p = world.xyz - uProjDir * (world.y / max(uProjDir.y, 0.2));
  p.y = 0.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const FLOOR_SHADOW_FRAGMENT_SHADER = `
uniform float uContactMode, uOpacity;
varying float vHeight;
void main() {
  gl_FragColor = vec4((uContactMode > 0.5 ? exp(-max(vHeight, 0.0) / 0.028) : 1.0) * uOpacity);
}
`;
