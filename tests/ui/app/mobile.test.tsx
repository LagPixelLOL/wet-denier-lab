import * as THREE from "three";
import { beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { actions } from "../../../src/engine/app/actions";
import { orbit } from "../../../src/engine/app/camera";
import { pointers } from "../../../src/engine/app/input";
import { app } from "../../../src/engine/app/runtime";
import { dryOff } from "../../../src/engine/app/splash";
import type { WaterSim } from "../../../src/engine/water/WaterSim";
import { ui } from "../../../src/state/ui";
import { bootApp, pointer, type Harness } from "../../helpers/appHarness";
import { seedRandom } from "../../helpers/random";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: (await import("../../helpers/rendererHook")).WebGLRendererProxy,
}));

let h: Harness;
let throwAt: MockInstance<WaterSim["throwAt"]>;

function onLeg(leg = 0, height = 0.42) {
  const p = new THREE.Vector3(...app.rig.point(leg, 0, height, 0.06)).project(app.camera);
  return { x: ((p.x + 1) / 2) * h.view.w, y: ((1 - p.y) / 2) * h.view.h };
}

/** Number of frames (of `count` rAF callbacks `ms` apart) that actually stepped the app. */
function steppedFrames(count: number, ms: number) {
  let stepped = 0;
  for (let i = 0; i < count; i++) {
    const before = app.lastTime;
    h.frame(ms);
    if (app.lastTime !== before) {
      stepped++;
    }
  }
  return stepped;
}

/** Clears the water and lets everything come to rest. */
function quiet() {
  dryOff();
  h.frames(150, 20);
  dryOff();
  h.frames(2, 20);
}

beforeAll(async () => {
  seedRandom(5);
  h = await bootApp({
    view: { w: 390, h: 844 },
    screen: { w: 390, h: 844 },
    devicePixelRatio: 3,
    media: { coarse: true, wide: false, roomy: false, fine: false, reducedMotion: true },
  });
  throwAt = vi.spyOn(app.water, "throwAt");
});

describe("mobile boot", () => {
  it("uses the mobile pixel budget, wet map size and mirror scale", () => {
    expect(app.isMobile).toBe(true);
    // min(devicePixelRatio 3, mobile cap 2.5, sqrt(2.2e6 / (390 * 844)) = 2.58)
    expect(h.renderer.pixelRatio).toBe(2.5);
    expect(app.wetmap.size).toBe(1024);
    const resizeMirror = vi.spyOn(app.stage, "resizeMirror");
    h.resizeCallbacks[0]([], new ResizeObserver(() => {}));
    expect(resizeMirror).toHaveBeenCalledWith(975, 2110, 0.34);
    resizeMirror.mockRestore();
  });
});

describe("mobile frame pacing", () => {
  it("skips callbacks that arrive less than 10.5 ms after the last stepped frame", () => {
    pointer("pointerdown", { x: 8, y: 8, button: 2 });
    expect(steppedFrames(10, 8)).toBe(5);
    expect(steppedFrames(10, 16)).toBe(10);
    pointer("pointerup", { x: 8, y: 8, button: 2 });
    expect(app.idle).toBe(false);
  });

  it("drops to about 30 fps once nothing moves", () => {
    quiet();
    expect(app.idle).toBe(true);
    expect(steppedFrames(12, 16)).toBe(6);
  });

  it("wakes up for input, rain and water", () => {
    pointer("pointerdown", { x: 8, y: 8, button: 2 });
    h.frames(2, 16);
    expect(app.idle).toBe(false);
    pointer("pointerup", { x: 8, y: 8, button: 2 });
    expect(pointers.size).toBe(0);
    quiet();
    actions.toggleRain();
    h.frames(2, 16);
    expect(app.idle).toBe(false);
    actions.toggleRain();
    quiet();
    actions.bucket();
    h.frames(2, 16);
    expect(app.idle).toBe(false);
    quiet();
    actions.zoomIn();
    h.frames(2, 16);
    expect(app.idle).toBe(false);
    actions.resetView();
    quiet();
    expect(app.idle).toBe(true);
  });

  it("stays idle with reduced motion even after a long time without input", () => {
    app.idleTime = 60;
    const yaw = orbit.yaw;
    h.frames(4, 16);
    expect(app.idle).toBe(true);
    expect(orbit.yaw).toBe(yaw);
    app.shakeTime = 0.3;
    h.frames(2, 16);
    expect(app.shakeTime).toBe(0);
  });

  it("updates the wet map on every other stepped frame with the accumulated time", () => {
    const update = vi.spyOn(app.wetmap, "update");
    pointer("pointerdown", { x: 8, y: 8, button: 2 });
    h.frames(6, 20);
    pointer("pointerup", { x: 8, y: 8, button: 2 });
    expect(update).toHaveBeenCalledTimes(3);
    // The first call also carries time left over from earlier frames.
    for (const [dt] of update.mock.calls.slice(1)) {
      expect(dt).toBeCloseTo(0.04, 12);
    }
    update.mockRestore();
  });
});

describe("mobile water", () => {
  it("throws fewer drops per splash, pour and bucket", () => {
    quiet();
    throwAt.mockClear();
    const at = onLeg();
    pointer("pointerdown", at);
    pointer("pointerup", at);
    pointer("pointerdown", at);
    h.frames(30, 20);
    pointer("pointerup", at);
    actions.bucket();
    const counts = throwAt.mock.calls.map((call) => call[2]?.count);
    expect(counts[0]).toBe(26);
    expect(counts[1]).toBe(26);
    expect(counts.slice(2, -2).every((count) => count === 6)).toBe(true);
    expect(counts.length).toBeGreaterThan(4);
    expect(counts.slice(-2)).toEqual([86, 86]);
  });

  it("tells phone users to long-press the photo", () => {
    actions.requestPhoto();
    h.frame(20);
    expect(ui.get().photo).toMatchObject({ open: true, tip: "长按图片可以保存", saveHidden: false });
    actions.closePhoto();
  });
});
