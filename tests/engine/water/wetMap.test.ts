import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MATERIALS } from "../../../src/engine/catalog/garments";
import type { SurfaceHit } from "../../../src/engine/surface/SurfaceGrid";
import type { WetMap } from "../../../src/engine/water/WetMap";
import { digest } from "../../helpers/digest";
import { describeCalls } from "../../helpers/fakeRenderer";
import { seedRandom } from "../../helpers/random";
import { waterWorld } from "../../helpers/waterWorld";
import type { WaterWorld } from "../../helpers/waterWorld";

let restoreRandom: () => void;
beforeEach(() => {
  restoreRandom = seedRandom(7);
});
afterEach(() => {
  restoreRandom();
});

function namesFor(wetmap: WetMap): Map<object, string> {
  return new Map<object, string>([
    [wetmap.posRT, "posRT"],
    [wetmap.flowRT, "flowRT"],
    [wetmap.a, "a"],
    [wetmap.b, "b"],
    [wetmap.bakeScene, "bakeScene"],
    [wetmap.quadScene, "quadScene"],
    [wetmap.stampScene, "stampScene"],
    [wetmap.cam, "cam"],
  ]);
}

/** A point on leg `leg` of the world's surface, copied out of the reused hit object. */
function surfacePoint(world: WaterWorld, leg: number, y = 0.33, z = 0.06): SurfaceHit {
  const [x, py, pz] = world.rig.point(leg, 0, y, z);
  const hit = world.rig.surface.closest(x, py, pz, 0.08);
  if (!hit) {
    throw new Error("no surface near the leg point");
  }
  return { ...hit };
}

describe("WetMap construction", () => {
  it("allocates an atlas slot per leg and half-resolution flow", () => {
    const { wetmap } = waterWorld({ size: 512 });
    expect([wetmap.width, wetmap.height, wetmap.legCount]).toEqual([1024, 512, 2]);
    expect([wetmap.flowRT.width, wetmap.flowRT.height]).toEqual([512, 256]);
    for (const target of [wetmap.posRT, wetmap.flowRT, wetmap.a, wetmap.b]) {
      expect(target.texture.type).toBe(THREE.HalfFloatType);
      expect(target.depthBuffer).toBe(false);
    }
    expect(wetmap.posRT.texture.minFilter).toBe(THREE.NearestFilter);
    expect(wetmap.a.texture.magFilter).toBe(THREE.LinearFilter);
    expect(wetmap.texture).toBe(wetmap.a.texture);
    expect(wetmap.updateMat.uniforms.uTexel.value.toArray()).toEqual([1 / 1024, 1 / 512]);
    expect(wetmap.updateMat.uniforms.uWickRate.value).toBeCloseTo(1.1, 12);
    expect(wetmap.stampMat.uniforms.uPosMap.value).toBe(wetmap.posRT.texture);
    expect([wetmap.padU, wetmap.padV]).toEqual([3 / 1024, 3 / 512]);
  });

  it("bakes each leg with its own rig uniforms and matrix into its atlas slot", () => {
    const { wetmap, target } = waterWorld();
    expect(wetmap.bakeMeshes).toHaveLength(2);
    wetmap.bakeMeshes.forEach((mesh, i) => {
      const uniforms = mesh.material.uniforms;
      expect(uniforms.uBakeSlot.value.toArray()).toEqual([0.5, i * 0.5]);
      expect(uniforms.uToeRot).toBe(target.legs[i].rig.uToeRot);
      expect(uniforms.uBakeMode).toBe(wetmap.bakeShared.uBakeMode);
      expect(mesh.userData.source).toBe(target.legs[i].matrix);
      expect(mesh.matrix.elements).toEqual(target.legs[i].matrix.elements);
    });
  });

  it("clears both wetness buffers, bakes positions and flow, and restores the clear state", () => {
    const { wetmap, renderer } = waterWorld();
    expect(describeCalls(renderer.calls, namesFor(wetmap))).toEqual([
      "clearColor #000000 0",
      "bind a",
      "clear a",
      "bind b",
      "clear b",
      "bind screen",
      "clearColor #f2eef3 1",
      "clearColor #000000 0",
      "bind posRT",
      "clear posRT",
      "render bakeScene with cam -> posRT",
      "bind flowRT",
      "clear flowRT",
      "render bakeScene with cam -> flowRT",
      "bind screen",
      "clearColor #f2eef3 1",
    ]);
    expect(wetmap.bakeShared.uBakeMode.value).toBe(1);
    expect(wetmap.bakeShared.uBakeSize.value).toBe(1024);
  });

  it("bounds each leg's UV island set with a 6 pixel margin", () => {
    const { wetmap } = waterWorld();
    // The stocking's islands start at pixel 150; the forefoot's skin continues their UVs a pixel past the seam.
    expect(wetmap.boxes).toMatchInlineSnapshot(`
      [
        [
          144,
          17,
          815,
          999,
        ],
        [
          1168,
          17,
          815,
          999,
        ],
      ]
    `);
    for (const [x, y, w, h] of wetmap.boxes) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(wetmap.width);
      expect(y + h).toBeLessThanOrEqual(wetmap.height);
    }
    expect(wetmap.boxes[1][0]).toBeGreaterThanOrEqual(wetmap.width / 2 - 6);
  });
});

describe("WetMap.bake", () => {
  it("can skip the flow pass and follows the legs' current matrices", () => {
    const { wetmap, renderer, target } = waterWorld();
    target.legs[0].matrix.makeTranslation(0.1, 0, 0);
    renderer.reset();
    wetmap.bakeShared.uBakeMode.value = 1;
    wetmap.bake(false);
    expect(renderer.ops("render").map((call) => call.target)).toEqual([wetmap.posRT]);
    expect(wetmap.bakeShared.uBakeMode.value).toBe(0);
    expect(wetmap.bakeMeshes[0].matrix.elements).toEqual(target.legs[0].matrix.elements);
    expect(wetmap.bakeMeshes[0].matrixWorldNeedsUpdate).toBe(true);
  });
});

describe("WetMap.setLegWater", () => {
  it("feeds soak, wick and shed to the update shader and keeps the take factor", () => {
    const { wetmap } = waterWorld();
    wetmap.setLegWater(1, MATERIALS.latex.water);
    expect(wetmap.updateMat.uniforms.uLegWater.value[1].toArray()).toEqual([0, 0, 0.55, 0]);
    expect(wetmap.take).toEqual([1, 0]);
    wetmap.setLegWater(0, MATERIALS.cotton.water);
    expect(wetmap.updateMat.uniforms.uLegWater.value[0].toArray()).toEqual([3.2, 2.6, 0, 0]);
    expect(wetmap.take).toEqual([1.5, 0]);
  });
});

describe("WetMap.stamp", () => {
  it("queues one instance per UV island the spot touches, padded and scaled by the leg's take", () => {
    const world = waterWorld();
    const { wetmap } = world;
    const hit = surfacePoint(world, 1);
    wetmap.setLegWater(1, MATERIALS.cotton.water);
    wetmap.stamp(hit.x, hit.y, hit.z, 0.01, 0.8, 0.5, 1, 0.7);
    expect(wetmap.count).toBeGreaterThan(0);
    const rects = wetmap.surface.uvRects(hit.x, hit.y, hit.z, 0.014, []);
    expect(wetmap.count).toBe(rects.length);
    const at = (name: string, i: number) => [...wetmap.attr[name].array.subarray(i * 4, i * 4 + 4)];
    rects.forEach((rect, i) => {
      expect(at("aRect", i)).toEqual(
        Array.from(
          new Float32Array([
            rect[0] - wetmap.padU,
            rect[1] - wetmap.padV,
            rect[2] + wetmap.padU,
            rect[3] + wetmap.padV,
          ]),
        ),
      );
      expect(at("aA", i)).toEqual(Array.from(new Float32Array([hit.x, hit.y, hit.z, 0.01])));
      // leg 1 lives in the right half of the atlas, so cotton's take applies
      expect(at("aAmt", i).slice(0, 3)).toEqual(Array.from(new Float32Array([0.8 * 1.5, 0.5, 1])));
      expect(at("aB", i)[3]).toBeCloseTo(0.7, 6);
    });
    // bound grows by 1.5 x soak + film + 0.2 (independent of the take factor)
    expect(wetmap.wetBound).toBeCloseTo(1.5 * 0.8 + 0.5 + 0.2, 12);
  });

  it("centers a capsule stamp between its end points and caps the wet bound", () => {
    const world = waterWorld();
    const { wetmap } = world;
    const a = surfacePoint(world, 0, 0.3);
    const b = surfacePoint(world, 0, 0.32);
    for (let i = 0; i < 5; i++) {
      wetmap.stamp(a.x, a.y, a.z, 0.002, 1, 1, 0, 1, b.x, b.y, b.z);
    }
    expect(wetmap.wetBound).toBe(3.4);
    expect([...wetmap.attr.aB.array.subarray(0, 3)]).toEqual(Array.from(new Float32Array([b.x, b.y, b.z])));
  });

  it("ignores spots away from the surface and stops at the instance limit", () => {
    const world = waterWorld();
    const { wetmap } = world;
    wetmap.stamp(5, 5, 5, 0.01, 1, 1);
    expect(wetmap.count).toBe(0);
    const hit = surfacePoint(world, 0);
    while (wetmap.count < wetmap.maxStamps) {
      wetmap.stamp(hit.x, hit.y, hit.z, 0.03, 0.1, 0.1);
    }
    wetmap.stamp(hit.x, hit.y, hit.z, 0.03, 0.1, 0.1);
    expect(wetmap.count).toBe(768);
  });
});

describe("WetMap.update", () => {
  it("does nothing while dry with no stamps queued", () => {
    const { wetmap, renderer } = waterWorld();
    renderer.reset();
    wetmap.update(1 / 30);
    expect(renderer.calls).toEqual([]);
  });

  it("runs the simulation over each leg's box, draws the queued stamps and swaps buffers", () => {
    const world = waterWorld();
    const { wetmap, renderer } = world;
    const hit = surfacePoint(world, 0);
    wetmap.stamp(hit.x, hit.y, hit.z, 0.01, 0.5, 0.5);
    const queued = wetmap.count;
    const [a, b] = [wetmap.a, wetmap.b];
    const scissors: number[][] = [];
    renderer.reset();
    const names = namesFor(wetmap);
    const realRender = renderer.render.bind(renderer);
    renderer.render = (scene, cam) => {
      if (scene === wetmap.quadScene) {
        scissors.push([...wetmap.b.scissor.toArray(), Number(wetmap.b.scissorTest)]);
      }
      realRender(scene, cam);
    };
    wetmap.update(0.1);
    expect(describeCalls(renderer.calls, names)).toEqual([
      "bind b",
      "render quadScene with cam -> b",
      "bind b",
      "render quadScene with cam -> b",
      "bind b",
      "render stampScene with cam -> b",
      "bind screen",
    ]);
    expect(scissors).toEqual(wetmap.boxes.map((box) => [...box, 1]));
    expect(b.scissorTest).toBe(false);
    expect(wetmap.stampGeo.instanceCount).toBe(queued);
    expect(wetmap.attr.aRect.updateRanges).toEqual([{ start: 0, count: queued * 4 }]);
    expect(wetmap.count).toBe(0);
    expect([wetmap.a, wetmap.b]).toEqual([b, a]);
    expect(wetmap.updateMat.uniforms.uWetPrev.value).toBe(a.texture);
    expect(wetmap.updateMat.uniforms.uDt.value).toBe(0.1);
    expect(wetmap.wetBound).toBeCloseTo(0.5 * 1.5 + 0.5 + 0.2 - 0.1 / 70, 12);
  });

  it("keeps updating (without stamps) until the wet bound runs out", () => {
    const world = waterWorld();
    const { wetmap, renderer } = world;
    wetmap.wetBound = 0.25;
    wetmap.updateMat.uniforms.uDryRate.value = 0.5;
    renderer.reset();
    wetmap.update(0.25);
    wetmap.update(0.25);
    expect(wetmap.wetBound).toBe(0);
    wetmap.update(0.25);
    // two updates, one pass per leg box each; never a stamp pass
    expect(renderer.ops("render").map((call) => call.scene)).toEqual(Array(4).fill(wetmap.quadScene));
  });

  it("only simulates the first leg's box in single-leg poses", () => {
    const world = waterWorld();
    world.rig.setPose("single", { instant: true });
    const { wetmap, renderer } = world;
    wetmap.wetBound = 1;
    renderer.reset();
    wetmap.update(0.016);
    expect(renderer.ops("render").map((call) => call.scene)).toEqual([wetmap.quadScene]);
  });
});

describe("WetMap.clear", () => {
  it("clears both buffers, the queue and the wet bound", () => {
    const world = waterWorld();
    const { wetmap, renderer } = world;
    const hit = surfacePoint(world, 0);
    wetmap.stamp(hit.x, hit.y, hit.z, 0.01, 0.5, 0.5);
    renderer.setClearColor(0x445566, 0.25);
    renderer.reset();
    wetmap.clear();
    expect(describeCalls(renderer.calls, namesFor(wetmap))).toEqual([
      "clearColor #000000 0",
      "bind a",
      "clear a",
      "bind b",
      "clear b",
      "bind screen",
      "clearColor #445566 0.25",
    ]);
    expect([wetmap.count, wetmap.wetBound]).toEqual([0, 0]);
  });
});

describe("WetMap stamp seeds", () => {
  it("draws one noise seed per stamp from Math.random", () => {
    const world = waterWorld();
    const { wetmap } = world;
    const hit = surfacePoint(world, 0);
    wetmap.stamp(hit.x, hit.y, hit.z, 0.004, 0.5, 0.5);
    wetmap.stamp(hit.x, hit.y, hit.z, 0.004, 0.5, 0.5);
    expect(digest(wetmap.attr.aAmt.array.subarray(0, wetmap.count * 4))).toMatchInlineSnapshot(`"5514ff0e"`);
  });
});
