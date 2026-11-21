import * as THREE from "three";

/**
 * A target the stage's scene is drawn into: multisampled, with a depth texture (the composite reads it) and a
 * stencil buffer next to it, in which each leg marks what of it is seen through its own top (see addSeenThrough
 * in createStage.ts).
 */
export function createSceneTarget(width: number, height: number): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    samples: 4,
    stencilBuffer: true,
  });
  target.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedInt248Type);
  target.depthTexture.format = THREE.DepthStencilFormat;
  // The stencil is of no use once the scene is drawn: only color and depth are resolved out of the samples.
  target.resolveStencilBuffer = false;
  return target;
}
