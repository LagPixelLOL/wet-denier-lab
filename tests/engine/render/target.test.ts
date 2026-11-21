import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createSceneTarget } from "../../../src/engine/stage/target";

describe("the target the stage's scene is drawn into", () => {
  it("is multisampled, with a depth texture to read and a stencil buffer that is not resolved", () => {
    const target = createSceneTarget(640, 360);
    expect([target.width, target.height, target.samples]).toEqual([640, 360, 4]);
    expect(target.texture.type).toBe(THREE.HalfFloatType);
    // The legs mark in the stencil what of a leg is seen through its own top (see addSeenThrough).
    expect(target.stencilBuffer).toBe(true);
    expect([target.depthTexture!.format, target.depthTexture!.type]).toEqual([
      THREE.DepthStencilFormat,
      THREE.UnsignedInt248Type,
    ]);
    // Resolving the stencil out of the samples costs milliseconds a frame, and nothing reads it afterwards.
    expect(target.resolveStencilBuffer).toBe(false);
    expect(target.resolveDepthBuffer).toBe(true);
  });
});
