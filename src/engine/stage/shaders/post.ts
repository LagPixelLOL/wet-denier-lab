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
// shadow map holds one depth per texel, so the top thins out texel by texel (an ordered 4 x 4 pattern), which
// the soft lookup on the other leg evens out.
export const CASTER_FRAGMENT_SHADER = `
uniform float uFadeStart, uFadeEnd;
varying float vFadeHeight;
const int THIN_OUT[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
void main() {
  float fade = smoothstep(uFadeStart, uFadeEnd, vFadeHeight);
  ivec2 cell = ivec2(gl_FragCoord.xy) & 3;
  if (fade * 16.0 > float(THIN_OUT[cell.y * 4 + cell.x]) + 0.5) discard;
  gl_FragColor = vec4(1.0);
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
