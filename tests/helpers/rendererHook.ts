/**
 * Indirection for vi.mock("three"): the mocked WebGLRenderer constructor hands back whatever `rendererHook.create`
 * builds. This module must not import three (it is loaded from inside the three mock factory).
 */
export const rendererHook: { create: ((params: unknown) => object) | null } = { create: null };

export class WebGLRendererProxy {
  constructor(params?: unknown) {
    if (!rendererHook.create) {
      throw new Error("rendererHook.create is not set");
    }
    return rendererHook.create(params);
  }
}
