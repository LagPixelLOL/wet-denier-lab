import * as THREE from "three";
import { afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { actions } from "../../../src/engine/app/actions";
import { homeView, orbit } from "../../../src/engine/app/camera";
import { pointers } from "../../../src/engine/app/input";
import { isPanelOpen, setPanel } from "../../../src/engine/app/layout";
import { shareLook, showPhoto } from "../../../src/engine/app/photo";
import { app } from "../../../src/engine/app/runtime";
import { pick } from "../../../src/engine/app/splash";
import { state } from "../../../src/engine/app/state";
import { POSE_ORDER } from "../../../src/engine/rig/poses";
import type { WaterSim } from "../../../src/engine/water/WaterSim";
import { ui } from "../../../src/state/ui";
import { bootApp, key, pointer, type Harness } from "../../helpers/appHarness";
import { seedRandom } from "../../helpers/random";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: (await import("../../helpers/rendererHook")).WebGLRendererProxy,
}));

let h: Harness;
let throwAt: MockInstance<WaterSim["throwAt"]>;

/** Client coordinates of a rest-space point on a leg, through the current camera. */
function onLeg(leg = 0, height = 0.42) {
  const p = new THREE.Vector3(...app.rig.point(leg, 0, height, 0.06)).project(app.camera);
  return { x: ((p.x + 1) / 2) * h.view.w, y: ((1 - p.y) / 2) * h.view.h };
}

/** A corner of the view where nothing is hit. */
const empty = { x: 8, y: 8 };

const countsThrown = () => throwAt.mock.calls.map((call) => call[2]?.count);

function orbitState() {
  return { yaw: orbit.yaw, pitch: orbit.pitch, dist: orbit.dist, target: orbit.target.toArray() };
}

function settle() {
  h.frames(120, 20);
}

beforeAll(async () => {
  seedRandom(7);
  h = await bootApp();
  // Past the intro splash, with the camera settled at home.
  settle();
  throwAt = vi.spyOn(app.water, "throwAt");
});

afterEach(() => {
  pointers.clear();
  app.pour = null;
  app.pinch = null;
});

describe("keyboard shortcuts", () => {
  it("throws a bucket at both legs on Space and hides the first-run hint after the first splash", () => {
    const ev = key(" ");
    expect(ev.defaultPrevented).toBe(true);
    expect(countsThrown()).toEqual([122, 122]);
    expect(throwAt.mock.calls[1][2]).toMatchObject({ spread: 0.045, size: 1.25, lift: 0.16, wait: 0.07 });
    expect(state.splashes).toBe(1);
    expect(ui.get().hint.hidden).toBe(false);
    vi.advanceTimersByTime(1600);
    expect(ui.get().hint.hidden).toBe(true);
  });

  it("leaves Space to a focused button", () => {
    const button = document.getElementById("bucketBtn")!;
    const ev = key(" ", {}, button);
    expect(ev.defaultPrevented).toBe(false);
    expect(throwAt).not.toHaveBeenCalled();
  });

  it("switches poses with the digits 1 to 7", () => {
    POSE_ORDER.forEach((pose, i) => {
      key(String(i + 1));
      expect(app.rig.name).toBe(pose);
      expect(ui.get().wardrobe.pose).toBe(pose);
    });
    key("8");
    expect(app.rig.name).toBe("pigeon");
    key("3");
    expect(app.rig.name).toBe("step");
    settle();
  });

  it("toggles rain with R in either case", () => {
    key("r");
    expect(state.rain).toBe(true);
    expect(ui.get().rain).toBe(true);
    expect(app.water.rain).toBe(true);
    key("R");
    expect(state.rain).toBe(false);
    expect(ui.get().rain).toBe(false);
  });

  it("toggles slow motion with S and announces it", () => {
    key("s");
    expect(state.slow).toBe(true);
    expect(ui.get().slow).toBe(true);
    expect(ui.get().hint).toEqual({ key: "hint.slow", hidden: false });
    vi.advanceTimersByTime(2600);
    expect(ui.get().hint.hidden).toBe(true);
    key("s");
    expect(state.slow).toBe(false);
    expect(ui.get().hint.hidden).toBe(true);
  });

  it("dries the legs with D and restores the normal dry rate after 0.8 s", () => {
    key(" ");
    h.frames(10);
    expect(app.water.drops.length).toBeGreaterThan(0);
    key("d");
    expect(app.water.drops).toHaveLength(0);
    expect(app.water.beads).toHaveLength(0);
    expect(app.water.puddle.every((v) => v === 0)).toBe(true);
    expect(app.wetmap.updateMat.uniforms.uDryRate.value).toBe(3.6);
    expect(app.dryTimer).toBe(0.8);
    h.frames(47, 1000 / 60);
    expect(app.wetmap.updateMat.uniforms.uDryRate.value).toBe(3.6);
    h.frames(2, 1000 / 60);
    expect(app.dryTimer).toBeLessThanOrEqual(0);
    expect(app.wetmap.updateMat.uniforms.uDryRate.value).toBe(1 / 70);
  });

  it("requests a photo with P, taken on the next frame", () => {
    key("p");
    expect(app.photoRequested).toBe(true);
    h.frame();
    expect(app.photoRequested).toBe(false);
    expect(ui.get().photo.open).toBe(true);
    expect(isPanelOpen("photo")).toBe(true);
  });

  it("ignores shortcuts while the photo is open, but Escape closes it", () => {
    key("r");
    key("v");
    expect(state.rain).toBe(false);
    expect(state.mode).toBe("water");
    key("Escape");
    expect(ui.get().photo.open).toBe(false);
    expect(isPanelOpen("photo")).toBe(false);
  });

  it("switches the touch mode with V and announces each mode", () => {
    key("v");
    expect(state.mode).toBe("view");
    expect(ui.get().mode).toBe("view");
    expect(document.body).toHaveClass("view-mode");
    expect(app.canvas.style.cursor).toBe("grab");
    expect(ui.get().hint.key).toBe("hint.viewMode");
    key("v");
    expect(state.mode).toBe("water");
    expect(app.canvas.style.cursor).toBe("crosshair");
    expect(ui.get().hint.key).toBe("hint.splashMode");
  });

  it("toggles the scene sheet with C and the wardrobe with W", () => {
    key("c");
    expect(ui.get().panels).toEqual({ mat: false, scene: true, about: false });
    key("w");
    expect(ui.get().panels).toEqual({ mat: true, scene: false, about: false });
    key("w");
    expect(ui.get().panels).toEqual({ mat: false, scene: false, about: false });
  });

  it("orbits with the arrow keys", () => {
    const before = orbitState();
    expect(key("ArrowLeft").defaultPrevented).toBe(true);
    expect(orbit.yaw).toBeCloseTo(before.yaw - 14 * 0.0085, 12);
    key("ArrowRight");
    key("ArrowRight");
    expect(orbit.yaw).toBeCloseTo(before.yaw + 14 * 0.0085, 12);
    expect(key("ArrowUp").defaultPrevented).toBe(true);
    expect(orbit.pitch).toBeCloseTo(before.pitch + 0.08, 12);
    key("ArrowDown");
    key("ArrowDown");
    expect(orbit.pitch).toBeCloseTo(before.pitch - 0.08, 12);
    for (let i = 0; i < 30; i++) {
      key("ArrowUp");
    }
    expect(orbit.pitch).toBe(1.15);
    for (let i = 0; i < 60; i++) {
      key("ArrowDown");
    }
    expect(orbit.pitch).toBe(-1.3);
  });

  it("zooms with + / = / - and resets the view with 0 or Home", () => {
    key("0");
    const dist = orbit.dist;
    key("+");
    expect(orbit.dist).toBeCloseTo(dist / 1.2, 12);
    key("=");
    expect(orbit.dist).toBeCloseTo(dist / 1.44, 12);
    key("-");
    key("-");
    key("-");
    expect(orbit.dist).toBeCloseTo(dist * 1.2, 12);
    for (let i = 0; i < 20; i++) {
      key("-");
    }
    expect(orbit.dist).toBe(3.2);
    for (let i = 0; i < 40; i++) {
      key("+");
    }
    expect(orbit.dist).toBe(0.2);
    key("ArrowLeft");
    key("Home");
    expect(orbitState()).toEqual({
      yaw: homeView.yaw,
      pitch: homeView.pitch,
      dist: homeView.dist,
      target: homeView.target.toArray(),
    });
  });

  it("closes panels, the photo and the copy box with Escape", () => {
    setPanel("scene");
    showPhoto(true);
    // No clipboard API: the link goes to the copy box.
    shareLook();
    expect(ui.get().copyBox?.open).toBe(true);
    key("Escape");
    expect(ui.get().panels.scene).toBe(false);
    expect(ui.get().photo.open).toBe(false);
    expect(ui.get().copyBox?.open).toBe(false);
  });

  it("ignores shortcuts with modifier keys", () => {
    key("r", { ctrlKey: true });
    key("r", { metaKey: true });
    key("r", { altKey: true });
    expect(state.rain).toBe(false);
  });

  it("ignores shortcuts typed into form fields", () => {
    for (const tag of ["input", "textarea", "select"]) {
      const field = document.body.appendChild(document.createElement(tag));
      key("r", {}, field);
      key(" ", {}, field);
      field.remove();
    }
    expect(state.rain).toBe(false);
    expect(throwAt).not.toHaveBeenCalled();
  });
});

describe("pointer input in water mode", () => {
  it("splashes where a quick tap hits the leg", () => {
    const at = onLeg();
    const splashes = state.splashes;
    pointer("pointerdown", at);
    expect(app.pour).toMatchObject({ id: 1, x: at.x, y: at.y, acc: -0.14, age: 0 });
    expect(app.pour!.pending).not.toBeNull();
    const hit = app.pour!.pending!;
    pointer("pointerup", at);
    expect(app.pour).toBeNull();
    expect(throwAt).toHaveBeenCalledTimes(1);
    const [target, eye, opts] = throwAt.mock.calls[0];
    expect(target).toBe(hit);
    expect(eye).toBe(app.camera.position);
    expect(opts?.count).toBe(32);
    expect(opts?.reach).toBeCloseTo(
      Math.min(0.42, app.camera.position.distanceTo(new THREE.Vector3(hit.x, hit.y, hit.z)) * 0.55),
      12,
    );
    expect(state.splashes).toBe(splashes + 1);
    // The picked point lies on the leg surface near the projected rest point.
    const rest = new THREE.Vector3(...app.rig.point(0, 0, 0.42, 0.06));
    expect(rest.distanceTo(new THREE.Vector3(hit.x, hit.y, hit.z))).toBeLessThan(0.08);
    expect(Math.hypot(hit.nx, hit.ny, hit.nz)).toBeCloseTo(1, 5);
  });

  it("pours while the pointer is held and follows it across the leg", () => {
    const at = onLeg();
    pointer("pointerdown", at);
    h.frames(3, 1000 / 60);
    expect(throwAt).not.toHaveBeenCalled();
    h.frame(1000 / 60);
    // The delayed first splash, then pours every 0.045 s once acc (-0.14) has caught up.
    expect(countsThrown()).toEqual([32]);
    expect(app.pour!.pending).toBeNull();
    const next = onLeg(0, 0.3);
    pointer("pointermove", next);
    expect(app.pour).toMatchObject({ x: next.x, y: next.y });
    h.frames(30, 1000 / 60);
    expect(countsThrown()).toEqual([32, 8, 8, 8, 8, 8, 8, 8]);
    expect(throwAt.mock.calls[1][2]).toMatchObject({ spread: 0.007, flight: 0.13, delay: 0.03, size: 0.85 });
    pointer("pointerup", next);
    expect(app.pour).toBeNull();
    expect(throwAt).toHaveBeenCalledTimes(throwAt.mock.calls.length);
  });

  it("does not pour while the held pointer is off the leg", () => {
    pointer("pointerdown", onLeg());
    h.frames(5, 1000 / 60);
    throwAt.mockClear();
    pointer("pointermove", empty);
    h.frames(10, 1000 / 60);
    expect(throwAt).not.toHaveBeenCalled();
    pointer("pointercancel", empty);
    expect(app.pour).toBeNull();
  });

  it("orbits when the press misses the leg", () => {
    const before = orbitState();
    pointer("pointerdown", empty);
    expect(app.pour).toBeNull();
    pointer("pointermove", { x: empty.x + 20, y: empty.y + 10 });
    expect(orbit.yaw).toBeCloseTo(before.yaw - 20 * 0.0085, 12);
    expect(orbit.pitch).toBeCloseTo(before.pitch + 10 * 0.005, 12);
    pointer("pointerup", { x: empty.x + 20, y: empty.y + 10 });
    expect(pointers.size).toBe(0);
    // Moves of pointers that are not down are ignored.
    pointer("pointermove", { x: 100, y: 100 });
    expect(orbit.yaw).toBeCloseTo(before.yaw - 20 * 0.0085, 12);
  });

  it("orbits with the secondary button even over the leg", () => {
    const at = onLeg();
    const yaw = orbit.yaw;
    pointer("pointerdown", { ...at, button: 2 });
    expect(app.pour).toBeNull();
    pointer("pointermove", { x: at.x - 10, y: at.y, button: 2 });
    expect(orbit.yaw).toBeCloseTo(yaw + 10 * 0.0085, 12);
    pointer("pointerup", { x: at.x - 10, y: at.y, button: 2 });
    expect(throwAt).not.toHaveBeenCalled();
  });

  it("pans with the middle button and keeps the target in bounds", () => {
    key("0");
    settle();
    pointer("pointerdown", { x: 600, y: 400, button: 1 });
    pointer("pointermove", { x: 640, y: 380, button: 1 });
    expect(orbit.target.toArray().map((v) => +v.toFixed(5))).toMatchInlineSnapshot(`
      [
        -0.05258,
        0.39667,
        0.07664,
      ]
    `);
    pointer("pointermove", { x: 20000, y: -20000, button: 1 });
    expect(orbit.target.toArray()).toEqual([-0.25, 0.02, expect.any(Number)]);
    pointer("pointerup", { x: 20000, y: -20000, button: 1 });
    key("0");
  });

  it("prevents the middle-button autoscroll and the context menu", () => {
    const middle = new MouseEvent("mousedown", { button: 1, cancelable: true });
    app.canvas.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(true);
    const left = new MouseEvent("mousedown", { button: 0, cancelable: true });
    app.canvas.dispatchEvent(left);
    expect(left.defaultPrevented).toBe(false);
    const menu = new MouseEvent("contextmenu", { cancelable: true });
    app.canvas.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });

  it("pinch-zooms and pans with two pointers, cancelling the pour", () => {
    settle();
    const dist = orbit.dist;
    const a = onLeg();
    pointer("pointerdown", { id: 1, ...a });
    expect(app.pour).not.toBeNull();
    pointer("pointerdown", { id: 2, x: a.x + 200, y: a.y });
    expect(app.pour).toBeNull();
    expect(app.pinch).toEqual({ d: 200, mx: a.x + 100, my: a.y, dist });
    pointer("pointermove", { id: 2, x: a.x + 400, y: a.y });
    // Spread from 200 to 400 px halves the distance; the midpoint moved 100 px right.
    expect(orbit.dist).toBeCloseTo(dist / 2, 12);
    expect(app.pinch).toMatchObject({ mx: a.x + 200, my: a.y });
    pointer("pointermove", { id: 1, x: a.x - 4000, y: a.y });
    expect(orbit.dist).toBe(0.2);
    // Fingers together zoom out (to the limit).
    pointer("pointermove", { id: 1, x: a.x + 399, y: a.y });
    expect(orbit.dist).toBe(3.2);
    pointer("pointerup", { id: 2, x: a.x + 400, y: a.y });
    expect(app.pinch).toBeNull();
    // The remaining finger neither pours nor orbits, and lifting it does not splash.
    const after = orbitState();
    pointer("pointermove", { id: 1, x: a.x + 450, y: a.y + 20 });
    expect(orbitState()).toEqual(after);
    pointer("pointerup", { id: 1, x: a.x + 450, y: a.y + 20 });
    expect(throwAt).not.toHaveBeenCalled();
    key("0");
  });

  it("zooms with the wheel, toward the leg when zooming in", () => {
    settle();
    const out = new WheelEvent("wheel", { deltaY: 100, clientX: 8, clientY: 8, cancelable: true });
    app.canvas.dispatchEvent(out);
    expect(out.defaultPrevented).toBe(true);
    expect(orbit.dist).toBeCloseTo(homeView.dist * Math.exp(0.12), 12);
    expect(orbit.target.toArray()).toEqual(homeView.target.toArray());
    const at = onLeg();
    const hit = pick(at.x, at.y)!;
    app.canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: at.x, clientY: at.y }));
    expect(orbit.dist).toBeCloseTo(homeView.dist, 12);
    const expected = homeView.target.clone().lerp(new THREE.Vector3(hit.x, hit.y, hit.z), 0.18);
    expect(orbit.target.distanceTo(expected)).toBeLessThan(1e-12);
    key("0");
  });
});

describe("pointer input in view mode", () => {
  it("orbits on drag instead of splashing", () => {
    actions.setMode("view");
    settle();
    const at = onLeg();
    const yaw = orbit.yaw;
    pointer("pointerdown", at);
    expect(app.pour).toBeNull();
    pointer("pointermove", { x: at.x + 40, y: at.y });
    pointer("pointerup", { x: at.x + 40, y: at.y });
    expect(orbit.yaw).toBeCloseTo(yaw - 40 * 0.0085, 12);
    expect(throwAt).not.toHaveBeenCalled();
    key("0");
  });

  it("zooms onto the tapped point", () => {
    settle();
    const at = onLeg(1, 0.5);
    pointer("pointerdown", at);
    vi.advanceTimersByTime(100);
    pointer("pointerup", { x: at.x + 3, y: at.y + 3 });
    expect(orbit.dist).toBe(0.65);
    const rest = new THREE.Vector3(...app.rig.point(1, 0, 0.5, 0.06));
    expect(orbit.target.distanceTo(rest)).toBeLessThan(0.08);
    key("0");
  });

  it("does not zoom on slow taps, long drags, cancels or taps that miss", () => {
    settle();
    const at = onLeg();
    pointer("pointerdown", at);
    vi.advanceTimersByTime(400);
    pointer("pointerup", at);
    pointer("pointerdown", at);
    pointer("pointermove", { x: at.x + 7, y: at.y });
    pointer("pointerup", { x: at.x + 7, y: at.y });
    pointer("pointerdown", at);
    pointer("pointercancel", at);
    pointer("pointerdown", empty);
    pointer("pointerup", empty);
    pointer("pointerup", { id: 9, ...at });
    expect(orbit.dist).toBe(homeView.dist);
    expect(orbit.target.toArray()).toEqual(homeView.target.toArray());
    actions.setMode("water");
  });
});

describe("window listeners", () => {
  it("unlocks audio on the first gesture", () => {
    expect(app.sound.ctx).not.toBeNull();
    expect(app.sound.ctx!.state).toBe("running");
  });

  it("blurs buttons after mouse clicks but not after keyboard activation", () => {
    const button = document.getElementById("rainBtn")!;
    button.focus();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect(document.activeElement).toBe(button);
    expect(state.rain).toBe(true);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(document.activeElement).not.toBe(button);
    expect(state.rain).toBe(false);
  });
});
