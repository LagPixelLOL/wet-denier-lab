import * as THREE from "three";
import { beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { actions } from "../../../src/engine/app/actions";
import { orbit } from "../../../src/engine/app/camera";
import { setPanel } from "../../../src/engine/app/layout";
import { holdPerf } from "../../../src/engine/app/loop";
import { app } from "../../../src/engine/app/runtime";
import { setRain } from "../../../src/engine/app/scene";
import { state } from "../../../src/engine/app/state";
import type { WaterSim } from "../../../src/engine/water/WaterSim";
import { bootApp, pointer, type Harness } from "../../helpers/appHarness";
import { seedRandom } from "../../helpers/random";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: (await import("../../helpers/rendererHook")).WebGLRendererProxy,
}));

let h: Harness;
let throwAt: MockInstance<WaterSim["throwAt"]>;

const FRAME = 1000 / 60;

beforeAll(async () => {
  seedRandom(3);
  h = await bootApp();
  throwAt = vi.spyOn(app.water, "throwAt");
});

describe("intro splash", () => {
  it("splashes the left leg once the water clock passes 1.4 s, without counting it", () => {
    while (!app.introSplashDone) {
      expect(throwAt).not.toHaveBeenCalled();
      h.frame(FRAME);
    }
    // Checked before the frame's water update, so it fires on the first frame that starts at 1.4 s or later.
    expect(app.water.time).toBeGreaterThan(1.4 + FRAME / 1000);
    expect(app.water.time).toBeLessThan(1.4 + (2 * FRAME) / 1000);
    expect(throwAt).toHaveBeenCalledTimes(1);
    expect(throwAt.mock.calls[0][2]?.count).toBe(32);
    expect(app.introSplashDone).toBe(true);
    expect(state.splashes).toBe(0);
    h.frames(30, FRAME);
    expect(throwAt).toHaveBeenCalledTimes(1);
  });

  it("is skipped when the user splashed first", () => {
    app.introSplashDone = false;
    state.splashes = 1;
    h.frame();
    expect(app.introSplashDone).toBe(true);
    expect(throwAt).not.toHaveBeenCalled();
    state.splashes = 0;
  });
});

describe("frame step", () => {
  it("renders the stage into the HDR target, then composites and draws the water on screen", () => {
    h.renderer.reset();
    h.frame();
    const calls = h.renderer.calls;
    const renders = h.renderer.ops("render");
    const stagePass = renders.findIndex((call) => call.scene === app.stage.scene && call.target === app.sceneTarget);
    expect(stagePass).toBeGreaterThanOrEqual(0);
    expect(renders.at(-1)).toMatchObject({ scene: app.water.scene, camera: app.camera, target: null });
    const stageIndex = calls.indexOf(renders[stagePass]);
    expect(calls[stageIndex - 1]).toEqual({ op: "clear", target: app.sceneTarget });
    const tail = calls.slice(stageIndex + 1);
    expect(tail.slice(0, 2)).toEqual([
      { op: "setRenderTarget", target: null },
      { op: "clear", target: null },
    ]);
    expect(app.stage.uniforms.fabric.uWetMap.value).toBe(app.wetmap.texture);
    expect(app.stage.uniforms.fabric.uTime.value).toBe(app.water.time);
    expect(app.stage.uniforms.bg.uFocusDist.value).toBeCloseTo(app.camera.position.distanceTo(orbit.cur.target), 12);
  });

  it("caps long frame gaps at 50 ms", () => {
    const t0 = app.water.time;
    h.frame(500);
    expect(app.water.time - t0).toBeCloseTo(0.05, 12);
  });

  it("runs the simulation at 0.2x in slow motion", () => {
    actions.toggleSlow();
    const t0 = app.water.time;
    h.frame(20);
    expect(app.water.time - t0).toBeCloseTo(0.004, 12);
    actions.toggleSlow();
  });

  it("eases the backdrop rain toward the rain state", () => {
    const rain = app.stage.uniforms.bg.uRain;
    expect(rain.value).toBe(0);
    setRain(true);
    h.frame(20);
    expect(rain.value).toBeCloseTo(1 - Math.exp(-0.02 * 3), 12);
    h.frames(150, 20);
    expect(rain.value).toBeGreaterThan(0.999);
    setRain(false);
    h.frames(150, 20);
    expect(rain.value).toBeLessThan(0.001);
  });

  it("orbits slowly after 9 s without input", () => {
    app.idleTime = 10;
    const yaw = orbit.yaw;
    h.frame(20);
    expect(orbit.yaw - yaw).toBeCloseTo(0.02 * 0.12 * (1.02 / 3), 12);
    app.idleTime = 30;
    const yaw2 = orbit.yaw;
    h.frame(20);
    expect(orbit.yaw - yaw2).toBeCloseTo(0.02 * 0.12, 12);
  });

  it("does not auto-orbit with reduced motion, while a pointer is down or behind a covering sheet", () => {
    const yaw = orbit.yaw;
    h.media.reducedMotion = true;
    app.idleTime = 30;
    h.frame(20);
    expect(orbit.yaw).toBe(yaw);
    h.media.reducedMotion = false;
    pointer("pointerdown", { x: 8, y: 8, button: 2 });
    app.idleTime = 30;
    h.frame(20);
    pointer("pointerup", { x: 8, y: 8, button: 2 });
    expect(orbit.yaw).toBe(yaw);
    setPanel("scene");
    app.idleTime = 30;
    h.frame(20);
    expect(orbit.yaw).toBe(yaw);
    setPanel(null);
    app.idleTime = 0;
    orbit.yaw = orbit.cur.yaw;
  });
});

describe("splash feedback", () => {
  it("plays a panned splash and shakes the camera after a heavy impact", () => {
    const splash = vi.spyOn(app.sound, "splash").mockImplementation(() => {});
    // Far to the camera's right: the stereo pan saturates.
    const right = new THREE.Vector3().setFromMatrixColumn(app.camera.matrixWorld, 0).multiplyScalar(5);
    const events = app.water.events;
    events.impacts = 2;
    events.energy = 3;
    events.ex = right.x * 3;
    events.ey = (right.y + 0.4) * 3;
    events.ez = right.z * 3;
    h.frame(20);
    expect(splash).toHaveBeenCalledTimes(1);
    expect(splash.mock.calls[0][0]).toBe(1);
    expect(splash.mock.calls[0][1]).toBeCloseTo(0.75, 12);
    expect(app.shakeTime).toBe(0.22);
    expect(events).toMatchObject({ impacts: 0, energy: 0, floor: 0, ex: 0, ey: 0, ez: 0 });
    h.frame(20);
    expect(app.shakeTime).toBeCloseTo(0.2, 12);
    splash.mockRestore();
  });

  it("does not shake in slow motion or with reduced motion", () => {
    vi.spyOn(app.sound, "splash").mockImplementation(() => {});
    h.frames(20, 20);
    expect(app.shakeTime).toBe(0);
    actions.toggleSlow();
    app.water.events.impacts = 1;
    app.water.events.energy = 3;
    h.frame(20);
    expect(app.shakeTime).toBe(0);
    actions.toggleSlow();
    app.shakeTime = 0.5;
    h.media.reducedMotion = true;
    h.frame(20);
    expect(app.shakeTime).toBe(0);
    h.media.reducedMotion = false;
    vi.mocked(app.sound.splash).mockRestore();
  });

  it("plays a drip for drops reaching the floor", () => {
    const drip = vi.spyOn(app.sound, "drip").mockImplementation(() => {});
    app.water.events.floor = 1;
    app.water.events.fx = 0;
    app.water.events.fz = 0;
    h.frame(20);
    expect(drip).toHaveBeenCalledTimes(1);
    const [size, pan] = drip.mock.calls[0];
    expect(size).toBeGreaterThanOrEqual(0);
    expect(size).toBeLessThan(1);
    expect(Math.abs(pan ?? NaN)).toBeLessThanOrEqual(0.75);
    drip.mockRestore();
  });
});

describe("adaptive quality", () => {
  it("keeps full quality at 60 fps", () => {
    const setMirror = vi.spyOn(app.stage, "setMirror");
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new Event("visibilitychange"));
    h.frames(400, FRAME);
    expect(app.resolutionScale).toBe(1);
    expect(setMirror).not.toHaveBeenCalled();
    setMirror.mockRestore();
  });

  it("does not sample while the page is hidden", () => {
    holdPerf(0);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    h.frames(60, 50);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    expect(app.resolutionScale).toBe(1);
  });

  it("lowers the resolution, then drops the mirror, then lowers the resolution again at 20 fps", () => {
    const setMirror = vi.spyOn(app.stage, "setMirror");
    const steps: [string, number][] = [];
    let scale = app.resolutionScale;
    // Start a fresh 2.5 s sample window.
    holdPerf(0);
    for (let i = 1; i <= 220; i++) {
      h.frame(50);
      if (app.resolutionScale !== scale) {
        scale = app.resolutionScale;
        steps.push(["resolution", i]);
      }
      if (setMirror.mock.calls.length > steps.filter(([name]) => name === "mirror").length) {
        steps.push(["mirror", i]);
      }
    }
    // One step per 2.5 s window: 51 frames of 50 ms, since 50 x 0.05 sums to just under 2.5 in floating point.
    expect(steps).toEqual([
      ["resolution", 51],
      ["mirror", 102],
      ["resolution", 153],
    ]);
    expect(setMirror).toHaveBeenCalledWith(false);
    expect(app.resolutionScale).toBeCloseTo(0.66 * 0.66, 12);
    expect(h.renderer.pixelRatio).toBeCloseTo(Math.sqrt((4.2e6 * 0.66 * 0.66) / (1280 * 800)), 12);
    setMirror.mockRestore();
  });
});

describe("away leg", () => {
  /** Puts the camera close to `leg` at knee height, looking at it through the other leg. */
  function lookThroughOtherLeg(leg: number) {
    const far = new THREE.Vector3(...app.rig.point(leg, 0, 0.3, 0));
    const near = new THREE.Vector3(...app.rig.point(1 - leg, 0, 0.3, 0));
    orbit.target.copy(far);
    orbit.yaw = Math.atan2(near.x - far.x, near.z - far.z);
    orbit.pitch = 0;
    orbit.dist = 0.9;
    h.frames(60, 20);
  }

  it("fades out the leg that blocks a close-up of the other one and skips it when picking", () => {
    lookThroughOtherLeg(1);
    expect(app.rig.away).toEqual([1, 0]);
    expect(app.rig.awayNow).toEqual([1, 0]);
    expect(app.rig.awayLeg).toBe(0);
    // The faded leg is drawn behind and is not hit by the bucket.
    throwAt.mockClear();
    actions.bucket();
    expect(throwAt.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(throwAt.mock.calls.length).toBeLessThanOrEqual(2);
    for (const [hit] of throwAt.mock.calls) {
      const p = new THREE.Vector3(hit.x, hit.y, hit.z);
      expect(app.rig.distanceToLeg(1, p.x, p.y, p.z)).toBeLessThan(app.rig.distanceToLeg(0, p.x, p.y, p.z));
    }
    lookThroughOtherLeg(0);
    expect(app.rig.away).toEqual([0, 1]);
  });

  it("brings both legs back when the camera pulls away", () => {
    actions.resetView();
    h.frames(60, 20);
    expect(app.rig.away).toEqual([0, 0]);
    expect(app.rig.awayNow).toEqual([0, 0]);
  });
});

describe("dev hooks", () => {
  it("__advance steps the simulation at a fixed rate", () => {
    const t0 = app.water.time;
    const renders = h.renderer.ops("render").length;
    window.__advance!(0.5);
    expect(app.water.time - t0).toBeCloseTo(0.5, 9);
    expect(h.renderer.ops("render").length).toBeGreaterThan(renders);
    window.__advance!(0.1, 30);
    expect(app.water.time - t0).toBeCloseTo(0.6, 9);
  });

  it("__capture uploads the next rendered frame and resolves with the response", async () => {
    const fetches = h.fetches.length;
    const done = window.__capture!("snap");
    expect(h.fetches).toHaveLength(fetches);
    h.frame();
    expect(app.captureRequest).toBeNull();
    expect(h.fetches.at(-1)).toEqual({
      url: "/__capture?name=snap",
      init: { method: "POST", body: `data:image/png;fake,view:${app.canvas.width}x${app.canvas.height}` },
    });
    const response = await done;
    expect(response).toBeInstanceOf(Response);
    void window.__capture!();
    h.frame();
    expect(h.fetches.at(-1)!.url).toBe("/__capture?name=cap");
  });

  it("__shot renders one frame and uploads it", async () => {
    const renders = h.renderer.ops("render").length;
    const response = await window.__shot!("one");
    expect(response).toBeInstanceOf(Response);
    expect(h.renderer.ops("render").length).toBeGreaterThan(renders);
    expect(h.fetches.at(-1)!.url).toBe("/__capture?name=one");
    await window.__shot!();
    expect(h.fetches.at(-1)!.url).toBe("/__capture?name=cap");
  });
});
