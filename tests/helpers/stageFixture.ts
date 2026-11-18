import { vi } from "vitest";
import { createStage } from "../../src/engine/stage/createStage";
import type { Stage } from "../../src/engine/stage/createStage";
import { installFakeDocument } from "./fakeCanvas";
import type { FakeContext2D } from "./fakeCanvas";
import { FakeRenderer } from "./fakeRenderer";
import type { FakeRendererOptions } from "./fakeRenderer";
import { legModel } from "./model";

export interface StageFixture {
  renderer: FakeRenderer;
  stage: Stage;
  /** 2D contexts of the procedural textures (knit, decal atlas, logo). */
  contexts: FakeContext2D[];
}

/**
 * A fresh stage over the shared leg model, on a fake renderer (node environment: `document` and
 * `matchMedia` are stubbed only while createStage runs).
 */
export function buildStage(options: FakeRendererOptions & { coarsePointer?: boolean } = {}): StageFixture {
  const renderer = new FakeRenderer(options);
  const { contexts } = installFakeDocument({ coarsePointer: options.coarsePointer });
  try {
    const stage = createStage(renderer.asRenderer, legModel());
    return { renderer, stage, contexts };
  } finally {
    vi.unstubAllGlobals();
  }
}
