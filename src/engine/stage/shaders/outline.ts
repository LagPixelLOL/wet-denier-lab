/**
 * Leg outline shaders.
 */
import { LEG_SKINNING_GLSL } from "../../rig/joints";
import { ANKLE_FADE_GLSL, CUFF_PRESS_GLSL, FADE_HEIGHT_GLSL, LID_GLSL, LID_NEAR, forefootClipGlsl } from "./leg";

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
  vec2 push = dir * uLineWidth * 2.0 / uResolution * clip.w;
  clip.xy += push;
  // Where the line is in the world: pushed out as well, so that what the eye sees it through is told for the
  // line of sight through the pixel it is drawn at.
  vWorldPos += vec3(push.x / projectionMatrix[0][0], push.y / projectionMatrix[1][1], 0.0) * mat3(viewMatrix);
  gl_Position = clip;
}
`;

export const OUTLINE_FRAGMENT_SHADER = `
uniform vec3 uOutlineColor, uSkinOutlineColor;
uniform float uCuffY, uHasCuff, uIsSkin, uFadeStart, uFadeEnd, uOpacity, uSilhouette, uClip;
varying vec3 vRestPos, vWorldPos;
varying float vFadeHeight, vFacing;
// The line fades out this much (m) below the leg's top, and the line around the top begins this much below
// where the top begins to fade.
const float LINE_FADES_BELOW = 0.03, TOP_LINE_BELOW = ${LID_NEAR[1].toFixed(3)};
${LID_GLSL}void main() {
  ${forefootClipGlsl("vRestPos")}

  // The line is drawn from back faces. With uSilhouette, only where the surface really turns away from the
  // viewer: small folds in the skin, like the one at the base of a toenail, draw no line.
  if (uSilhouette > 0.5 && vFacing > 0.1) discard;
  // The line around a leg that fades out at its top is drawn in two passes: around the solid leg, and around
  // its top (see addOutline in createStage). The top's begins where the lid tells everything that is seen
  // through the leg's top, and the line has not begun to fade.
#ifdef SOLID_LINE
  if (vFadeHeight > uFadeStart - TOP_LINE_BELOW) discard;
#endif
#ifdef TOP_LINE
  if (vFadeHeight <= uFadeStart - TOP_LINE_BELOW) discard;
#endif
  float skinMix = uIsSkin > 0.5 ? 1.0 : (uHasCuff > 0.5 ? smoothstep(-0.004, 0.0, vRestPos.y - uCuffY) : 0.0);
  float alpha = (1.0 - smoothstep(uFadeStart - LINE_FADES_BELOW, uFadeEnd - LINE_FADES_BELOW, vFadeHeight)) * uOpacity;
  // No line around what is not drawn: the leg's outside, from the ankle up, seen through the leg's own top (see
  // the leg's depth shader).
  if (seenThroughTop(vWorldPos, uFadeStart)) alpha *= 1.0 - ${ANKLE_FADE_GLSL};
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(mix(uOutlineColor, uSkinOutlineColor, skinMix), alpha);
}
`;
