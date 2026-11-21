/**
 * Bow shaders.
 */
import { LEG_SKINNING_GLSL } from "../../rig/joints";
import { CUFF_PRESS_GLSL, ROOM_LIGHT_GLSL } from "./leg";

export const BOW_VERTEX_SHADER = `
${LEG_SKINNING_GLSL}${CUFF_PRESS_GLSL}uniform mat4 uBowMatrix;
varying vec3 vWorldPos, vNormal, vLocalPos;
varying float vFadeHeight;
void main() {
  vec3 local = (uBowMatrix * vec4(position, 1.0)).xyz;
  mat3 jac;
  vec3 p = skinPosition(local, jac);
  // The bow lies on the fabric, so it goes in and out with it where the cuff presses the leg (see pressCuff):
  // each part by as much as the fabric at its height, along the bow's own axis.
  p += skinNormal(jac, normalize(uBowMatrix[2].xyz)) * cuffProfile(local.y - uCuffY);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * skinNormal(jac, mat3(uBowMatrix) * normal));
  vLocalPos = position;
  vFadeHeight = local.y - 0.3346 * (local.x - 0.066) + 0.0157 * (local.z - 0.04);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const BOW_FRAGMENT_SHADER = `
uniform vec3 uKeyDir, uKeyColor, uFillTop, uFillBottom, uBowColor, uBowShade;
uniform float uFadeStart, uFadeEnd, uOpacity;
varying vec3 vWorldPos, vNormal, vLocalPos;
varying float vFadeHeight;
${ROOM_LIGHT_GLSL}void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(cameraPosition - vWorldPos);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float lit = smoothstep(-0.1, 0.25, dot(n, uKeyDir));
  // What the lamp does not reach is lit by the room alone.
  vec3 hemi = mix(uFillBottom, uFillTop, n.y * 0.5 + 0.5) * roomLight(dot(n, uKeyDir), 1.0);
  vec3 col = uBowColor * mix(uBowShade, vec3(1.0), lit) * hemi;
  col += uKeyColor * 0.26 * pow(max(dot(n, normalize(uKeyDir + v)), 0.0), 18.0);
  col *= 0.80 + 0.20 * smoothstep(0.0, 0.008, abs(vLocalPos.x));
  col *= mix(0.60, 1.0, smoothstep(0.05, 0.32, ndv));
  gl_FragColor = vec4(col, (1.0 - smoothstep(uFadeStart, uFadeEnd, vFadeHeight)) * uOpacity);
}
`;
