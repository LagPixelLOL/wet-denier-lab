import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BARE_SKIN_WATER, MATERIALS } from "../../../src/engine/catalog/garments";
import { AIR_DRY_RATE, NO_SKIN_ABOVE, SKIN_EDGE, skinAbove } from "../../../src/engine/water/shaders/wet";
import type { SurfaceHit } from "../../../src/engine/surface/SurfaceGrid";
import {
  WET_BAKE_FRAGMENT_SHADER,
  WET_BAKE_VERTEX_SHADER,
  WET_STAMP_FRAGMENT_SHADER,
  WET_UPDATE_FRAGMENT_SHADER,
} from "../../../src/engine/water/shaders/wet";
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
          143,
          17,
          816,
          999,
        ],
        [
          1167,
          17,
          816,
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
  it("feeds soak, wick and shed to the update shader and the take factor to the stamps", () => {
    const { wetmap } = waterWorld();
    const take = wetmap.stampMat.uniforms.uLegTake.value;
    wetmap.setLegWater(1, MATERIALS.latex.water);
    expect(wetmap.updateMat.uniforms.uLegWater.value[1].toArray()).toEqual([0, 0, 0.55, 0]);
    expect(take.toArray()).toEqual([1, 0]);
    wetmap.setLegWater(0, MATERIALS.cotton.water);
    expect(wetmap.updateMat.uniforms.uLegWater.value[0].toArray()).toEqual([3.2, 2.6, 0, 0]);
    expect(take.toArray()).toEqual([1.5, 0]);
  });

  it("has the skin above a stocking's top take water as bare skin does", () => {
    const { wetmap } = waterWorld();
    const { updateMat, stampMat } = wetmap;
    // Bare skin's way with water is always at hand, for both the simulation and the stamps.
    const skin = BARE_SKIN_WATER;
    expect(updateMat.uniforms.uSkinWater.value.toArray()).toEqual([skin.soak, skin.wick, skin.shed, 0]);
    expect(stampMat.uniforms.uSkinTake.value).toBe(skin.take);
    // Where each leg's fabric ends: one value, shared by the two shaders. None to begin with.
    const top = updateMat.uniforms.uLegTop;
    expect(stampMat.uniforms.uLegTop).toBe(top);
    expect(top.value.toArray()).toEqual([NO_SKIN_ABOVE, NO_SKIN_ABOVE]);
    wetmap.setLegWater(0, MATERIALS.cotton.water, 0.7);
    wetmap.setLegWater(1, MATERIALS.velvet.water, 0.425);
    expect(top.value.toArray()).toEqual([0.7, 0.425]);
    // Tights and a bare leg have no skin of another kind above: left out, or Infinity, the top is out of reach.
    wetmap.setLegWater(0, MATERIALS.cotton.water);
    wetmap.setLegWater(1, BARE_SKIN_WATER, Infinity);
    expect(top.value.toArray()).toEqual([NO_SKIN_ABOVE, NO_SKIN_ABOVE]);
    expect(NO_SKIN_ABOVE).toBeGreaterThan(10);
  });

  it("goes from the fabric's way with water to the skin's over a narrow band around the top, not at a line", () => {
    const top = 0.7;
    expect(skinAbove(0.2, top)).toBe(0);
    expect(skinAbove(top - SKIN_EDGE, top)).toBe(0);
    expect(skinAbove(top, top)).toBeCloseTo(0.5, 12);
    expect(skinAbove(top + SKIN_EDGE, top)).toBe(1);
    expect(skinAbove(0.85, top)).toBe(1);
    const steps = Array.from({ length: 21 }, (_, i) => skinAbove(top - SKIN_EDGE + (i / 20) * 2 * SKIN_EDGE, top));
    steps.slice(1).forEach((value, i) => {
      expect(value).toBeGreaterThan(steps[i]);
      expect(value - steps[i]).toBeLessThan(0.08);
    });
    // A few millimeters of a leg about 0.87 tall.
    expect(SKIN_EDGE).toBeGreaterThan(0.002);
    expect(SKIN_EDGE).toBeLessThan(0.015);
    expect(skinAbove(0.85, NO_SKIN_ABOVE)).toBe(0);
    // The shaders use the same band.
    for (const shader of [WET_UPDATE_FRAGMENT_SHADER, WET_STAMP_FRAGMENT_SHADER]) {
      expect(shader).toContain(
        `return smoothstep(top - ${SKIN_EDGE.toFixed(3)}, top + ${SKIN_EDGE.toFixed(3)}, posAlpha - 1.0);`,
      );
    }
  });

  it("keeps each texel's height on the leg at rest next to its position, to tell skin from fabric by", () => {
    expect(WET_BAKE_VERTEX_SHADER).toContain("vBakeRestY = position.y;");
    expect(WET_BAKE_FRAGMENT_SHADER).toContain("1.0 + max(vBakeRestY, 0.0));");
    // Alpha still says whether a texel has surface: nothing reads it as a plain 0 or 1 weight any more.
    expect(WET_UPDATE_FRAGMENT_SHADER).not.toMatch(/float w = texture2D\(uPosMap/);
    expect(WET_UPDATE_FRAGMENT_SHADER.match(/hasSurface\(texture2D\(uPosMap/g)).toHaveLength(3);
    expect(WET_UPDATE_FRAGMENT_SHADER).toContain(
      "vec4 water = mix(vUv.x < 0.5 ? uLegWater[0] : uLegWater[1], uSkinWater, skinAbove(vUv, valid));",
    );
    expect(WET_STAMP_FRAGMENT_SHADER).toContain(
      "float take = mix(vUv.x < 0.5 ? uLegTake.x : uLegTake.y, uSkinTake, skinAbove(vUv, posTex.a));",
    );
    expect(WET_STAMP_FRAGMENT_SHADER).toContain(
      "gl_FragColor = vec4(vStampAmt.x * take * amt, vStampAmt.yz * amt, 0.0);",
    );
  });
});

describe("wiping dry", () => {
  it("takes the flash of fresh water along, however much of it has piled up", () => {
    const { wetmap } = waterWorld();
    // The surface dries in the air at this rate until something wipes it.
    expect(wetmap.updateMat.uniforms.uDryRate.value).toBe(AIR_DRY_RATE);
    expect(AIR_DRY_RATE).toBeCloseTo(1 / 70, 12);
    expect(WET_UPDATE_FRAGMENT_SHADER).toContain(
      `fresh = max(0.0, fresh - uDt * 2.2) * exp(-max(uDryRate - ${AIR_DRY_RATE}, 0.0) * 3.0 * uDt);`,
    );
    // The flash only fades by a fixed amount a second by itself, and adds up where water keeps hitting: after a
    // long pour that leaves a white patch for seconds. What a wipe (dry rate 3.6 for 0.8 s) leaves of it:
    const left = (dryRate: number, seconds: number) => Math.exp(-Math.max(dryRate - AIR_DRY_RATE, 0) * 3 * seconds);
    expect(left(3.6, 0.8) * 50).toBeLessThan(0.02);
    // In the air nothing changes: the flash fades exactly as it did.
    expect(left(AIR_DRY_RATE, 10)).toBe(1);
  });
});

describe("WetMap.stamp", () => {
  it("queues one instance per UV island the spot touches, padded, with the water as it fell", () => {
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
      // How much of it soaks in is the stamp shader's to say, texel by texel: fabric, or the skin above it.
      expect(at("aAmt", i).slice(0, 3)).toEqual(Array.from(new Float32Array([0.8, 0.5, 1])));
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
