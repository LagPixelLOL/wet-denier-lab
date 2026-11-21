/**
 * Fullscreen passes: blur, leg shadow caster and the final composite.
 */
import { LEG_SKINNING_GLSL } from "../../rig/joints";
import { FADE_HEIGHT_GLSL } from "./leg";

export const FULLSCREEN_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const BLUR_FRAGMENT_SHADER = `
uniform sampler2D uBlurTex;
uniform vec2 uBlurStep;
varying vec2 vUv;
void main() {
  float sum = 0.0, wsum = 0.0;
  for (int i = -8; i <= 8; i++) {
    float w = exp(-float(i * i) / 18.0);
    sum += texture2D(uBlurTex, vUv + uBlurStep * float(i)).r * w;
    wsum += w;
  }
  gl_FragColor = vec4(sum / wsum);
}
`;

export const CASTER_VERTEX_SHADER = `
${LEG_SKINNING_GLSL}varying float vFadeHeight;
void main() {
  mat3 jac;
  vFadeHeight = ${FADE_HEIGHT_GLSL};
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(skinPosition(position, jac), 1.0);
}
`;

// The leg's top fades out, and its shadow on the other leg with it: a part that is not seen casts none. The
// shadow map's depth says where the leg is in the light's way, and its color how much of the light the leg takes
// there (CASTER_COVER_FRAGMENT_SHADER): what has faded out altogether is in neither.
export const CASTER_FRAGMENT_SHADER = `
uniform float uFadeEnd;
varying float vFadeHeight;
void main() {
  if (vFadeHeight >= uFadeEnd) discard;
  gl_FragColor = vec4(1.0);
}
`;

// How solid the leg is where the light passes through it (red), that it is there at all (green), and how near
// the light it is (blue: one at the near end of the light's range). Drawn with the larger value kept, so of the
// walls of the leg the light passes through the most solid one counts, and the nearest. Read between texels,
// all thin out alike toward the leg's edge: red over green is how solid the leg is right there, and blue over
// green how near. The map has smaller, blurred copies of itself, for a shadow with a soft edge (see castShadow).
export const CASTER_COVER_FRAGMENT_SHADER = `
uniform float uFadeStart, uFadeEnd;
varying float vFadeHeight;
void main() {
  if (vFadeHeight >= uFadeEnd) discard;
  gl_FragColor = vec4(1.0 - smoothstep(uFadeStart, uFadeEnd, vFadeHeight), 1.0, 1.0 - gl_FragCoord.z, 1.0);
}
`;

export const COMPOSITE_FRAGMENT_SHADER = `
uniform sampler2D uColorTex, uDepthTex;
uniform vec2 uResolution;
varying vec2 vUv;
vec3 compressHighlights(vec3 c) {
  return mix(c, 0.82 + 0.18 * (1.0 - exp(-(c - 0.82) / 0.18)), step(0.82, c));
}
vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
void main() {
  vec3 col = texture2D(uColorTex, vUv).rgb;
  col = compressHighlights(col);
  vec2 cuv = vUv - 0.5;
  col *= 1.0 - dot(cuv, cuv) * 0.22;
  gl_FragColor = vec4(linearToSrgb(col), 1.0);
  gl_FragDepth = texture2D(uDepthTex, vUv).r;
}
`;
