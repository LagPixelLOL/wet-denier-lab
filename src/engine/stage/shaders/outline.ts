/**
 * Leg outline shaders.
 */
import { LEG_SKINNING_GLSL } from "../../rig/joints";
import { ANKLE_FADE_GLSL, CUFF_PRESS_GLSL, FADE_HEIGHT_GLSL, LID_GLSL, forefootClipGlsl } from "./leg";

export const OUTLINE_VERTEX_SHADER = `
${LEG_SKINNING_GLSL}${CUFF_PRESS_GLSL}attribute vec3 legTangent;
uniform vec2 uResolution;
uniform float uLineWidth, uIsSkin;
varying vec3 vRestPos, vWorldPos;
varying float vFadeHeight, vFacing;
void main() {
  mat3 jac;
  vec3 p = skinPosition(position, jac);
  vec3 n = skinNormal(jac, normal);
  // The line goes around the surface as the leg's own passes draw it, pressed in by the cuff.
  if (uIsSkin < 0.5) pressCuff(position.y, normalize(jac * legTangent), p, n);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vRestPos = position;
  vWorldPos = world.xyz;
  vFadeHeight = ${FADE_HEIGHT_GLSL};
  vec4 clip = projectionMatrix * viewMatrix * world;
  vec3 nView = normalize(mat3(viewMatrix) * mat3(modelMatrix) * n);
  vFacing = dot(nView, normalize(-(viewMatrix * world).xyz));
  vec2 dir = normalize((projectionMatrix * vec4(nView, 0.0)).xy + 1e-6);
  clip.xy += dir * uLineWidth * 2.0 / uResolution * clip.w;
  gl_Position = clip;
}
`;

export const OUTLINE_FRAGMENT_SHADER = `
uniform vec3 uOutlineColor, uSkinOutlineColor;
uniform float uCuffY, uHasCuff, uIsSkin, uFadeStart, uFadeEnd, uOpacity, uSilhouette, uClip;
varying vec3 vRestPos, vWorldPos;
varying float vFadeHeight, vFacing;
${LID_GLSL}void main() {
  ${forefootClipGlsl("vRestPos")}

  // The line is drawn from back faces. With uSilhouette, only where the surface really turns away from the
  // viewer: small folds in the skin, like the one at the base of a toenail, draw no line.
  if (uSilhouette > 0.5 && vFacing > 0.1) discard;
  float skinMix = uIsSkin > 0.5 ? 1.0 : (uHasCuff > 0.5 ? smoothstep(-0.004, 0.0, vRestPos.y - uCuffY) : 0.0);
  float alpha = (1.0 - smoothstep(uFadeStart - 0.03, uFadeEnd - 0.03, vFadeHeight)) * uOpacity;
  // No line around what is not drawn: the leg's outside, from the ankle up, seen through the leg's own top (see
  // the leg's depth shader).
  if (seenThroughTop(vWorldPos, uFadeStart)) alpha *= 1.0 - ${ANKLE_FADE_GLSL};
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(mix(uOutlineColor, uSkinOutlineColor, skinMix), alpha);
}
`;
