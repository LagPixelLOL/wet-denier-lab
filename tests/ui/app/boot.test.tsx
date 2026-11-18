import { screen } from "@testing-library/react";
import * as THREE from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { actions } from "../../../src/engine/app/actions";
import { orbit } from "../../../src/engine/app/camera";
import { currentLook } from "../../../src/engine/app/outfit";
import { app } from "../../../src/engine/app/runtime";
import { outfit, state } from "../../../src/engine/app/state";
import { withLegDefaults } from "../../../src/engine/catalog/presets";
import { lookUrl, unpackLook, type Look } from "../../../src/engine/share/lookCodec";
import { ui } from "../../../src/state/ui";
import { bootApp, type Harness } from "../../helpers/appHarness";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: (await import("../../helpers/rendererHook")).WebGLRendererProxy,
}));

const hashOf = (url: string) => url.slice(url.indexOf("#"));

const bootLook: Look = {
  pose: "crossed",
  scene: "bath",
  backdrop: "mint",
  legs: [
    withLegDefaults({ color: "smoke", material: "gloss", denier: 15 }),
    withLegDefaults({ color: "#123abc", length: "knee", cuff: "rib", wetColor: "sakura" }),
  ],
  view: { yaw: 0.9, pitch: 0.2, dist: 1.5, target: [0.01, 0.4, 0.02] },
};

let h: Harness;

beforeAll(async () => {
  h = await bootApp({ hash: hashOf(lookUrl(bootLook, location.href)) });
});

describe("startApp", () => {
  it("creates the renderer on the #view canvas with fixed options", () => {
    expect(h.renderer.params).toEqual({
      canvas: document.getElementById("view"),
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    expect(h.renderer.autoClear).toBe(false);
    expect(h.renderer.ops("setClearColor")[0]).toEqual({ op: "setClearColor", color: 0xf2eef3, alpha: 1 });
    expect(app.isMobile).toBe(false);
    expect(app.sceneTarget.depthTexture).toBeInstanceOf(THREE.DepthTexture);
    expect(app.thumbCamera.aspect).toBe(180 / 240);
  });

  it("fetches the model once and builds the runtime objects", () => {
    expect(h.fetches).toHaveLength(1);
    expect(h.fetches[0].url).toMatch(/legs\.glb$/);
    expect(app.uiBound).toBe(true);
    expect(app.surface).toBe(app.rig.surface);
    expect(app.stage.uniforms.floor.uPuddleTex.value).toBe(app.water.puddleTex);
    expect(app.stage.uniforms.floor.uRipples.value).toBe(app.water.ripples);
    expect(ui.get().bootError).toBeNull();
  });

  it("sizes the renderer within the desktop pixel budget", () => {
    // min(devicePixelRatio 2, cap 2, sqrt(4.2e6 / (1280 * 800)) = 2.03)
    expect(h.renderer.pixelRatio).toBe(2);
    expect(h.renderer.sizes.at(-1)).toEqual([1280, 800, 2]);
    expect(app.camera.aspect).toBe(1.6);
    expect(app.camera.fov).toBe(30);
    expect([app.sceneTarget.width, app.sceneTarget.height]).toEqual([2560, 1600]);
    expect(app.stage.viewport.toArray()).toEqual([2560, 1600]);
  });

  it("re-sizes from the ResizeObserver, with a wider fov in portrait", () => {
    expect(h.resizeCallbacks).toHaveLength(1);
    h.view.w = 600;
    h.view.h = 1000;
    h.resizeCallbacks[0]([], new ResizeObserver(() => {}));
    // sqrt(4.2e6 / 6e5) = 2.65 > 2, so the device ratio wins
    expect(h.renderer.sizes.at(-1)).toEqual([600, 1000, 2]);
    expect(app.camera.fov).toBe(34);
    expect(app.stage.viewport.toArray()).toEqual([1200, 2000]);
    h.view.w = 3000;
    h.view.h = 2000;
    h.resizeCallbacks[0]([], new ResizeObserver(() => {}));
    expect(h.renderer.pixelRatio).toBeCloseTo(Math.sqrt(4.2e6 / 6e6), 12);
    expect(app.camera.fov).toBe(30);
    h.view.w = 1280;
    h.view.h = 800;
    h.resizeCallbacks[0]([], new ResizeObserver(() => {}));
    expect(h.renderer.pixelRatio).toBe(2);
  });

  it("honors the __YUSI_DPR__ override in dev builds", () => {
    globalThis.__YUSI_DPR__ = 1.25;
    h.resizeCallbacks[0]([], new ResizeObserver(() => {}));
    expect(h.renderer.pixelRatio).toBe(1.25);
    globalThis.__YUSI_DPR__ = undefined;
    h.resizeCallbacks[0]([], new ResizeObserver(() => {}));
    expect(h.renderer.pixelRatio).toBe(2);
  });

  it("marks the body ready 120 ms after boot and keeps requesting frames", () => {
    expect(document.body).not.toHaveClass("ready");
    vi.advanceTimersByTime(119);
    expect(document.body).not.toHaveClass("ready");
    vi.advanceTimersByTime(1);
    expect(document.body).toHaveClass("ready");
    const before = h.renderer.ops("render").length;
    h.frames(2);
    expect(h.renderer.ops("render").length).toBeGreaterThan(before);
  });

  it("binds the UI in water mode with the first-run hint", () => {
    expect(state.mode).toBe("water");
    expect(app.canvas.style.cursor).toBe("crosshair");
    expect(document.body).not.toHaveClass("view-mode");
    expect(ui.get().hint).toEqual({ text: "点丝袜任意位置泼水 · 按住拖动连续浇", hidden: false });
    // The boot hint has no timeout.
    vi.advanceTimersByTime(10_000);
    expect(ui.get().hint.hidden).toBe(false);
  });

  it("installs the dev console handles", () => {
    const handles = window.__app!;
    expect(Object.keys(handles).join(" ")).toMatchInlineSnapshot(
      `"THREE renderer camera view look leg body surface wetmap water state pick splashAt setPose wear wearPreset wearRandom setScene setBackdrop setRain setPanel applyLayout currentLook applyLook lookUrl unpackLook layout SCENES outfit PRESETS audio legMs thumbJobs ui"`,
    );
    expect(handles.renderer).toBe(app.renderer);
    expect(handles.water).toBe(app.water);
    expect(typeof handles.legMs).toBe("number");
    expect(typeof window.__advance).toBe("function");
    expect(typeof window.__capture).toBe("function");
    expect(typeof window.__shot).toBe("function");
  });

  it("renders the loading text until the canvas is ready", () => {
    expect(screen.getByText("正在准备丝袜与水…")).toBeInTheDocument();
  });
});

describe("share links at boot", () => {
  it("applies the #look= hash present at boot", () => {
    expect(currentLook()).toEqual(bootLook);
    expect([orbit.yaw, orbit.pitch, orbit.dist, ...orbit.target.toArray()]).toEqual([0.9, 0.2, 1.5, 0.01, 0.4, 0.02]);
    expect(state.scene).toBe("bath");
    expect(ui.get().scenes).toEqual({ scene: "bath", backdrop: "mint" });
    expect(ui.get().rainLabel).toBe("花洒");
    expect(ui.get().wardrobe.pose).toBe("crossed");
    // The bath is lit, so the stage tone follows the scene fade and the body is not dim.
    expect(document.body).not.toHaveClass("dim");
    expect(document.documentElement.style.getPropertyValue("--stage")).toBe(app.stage.sceneNow.fade);
  });

  it("round-trips currentLook through lookUrl", () => {
    const url = lookUrl(currentLook(), location.href);
    expect(hashOf(url)).toMatchInlineSnapshot(
      `"#look=1~crossed~bath~mint~thigh.lace.0.gloss.15.none.smoke.none.-~knee.rib.0.sheer.40.none.x123abc.none.sakura~0.9,0.2,1.5,0.01,0.4,0.02"`,
    );
    const parsed = unpackLook(hashOf(url));
    expect(parsed).toEqual({ ...bootLook, legs: [...bootLook.legs] });
  });

  it("applies a new look on hashchange and ignores hashes without one", () => {
    const next: Look = {
      pose: "single",
      scene: "street",
      backdrop: "#202020",
      legs: [withLegDefaults({ color: "ivory" }), withLegDefaults({ color: "ivory" })],
    };
    history.replaceState(null, "", hashOf(lookUrl(next, location.href)));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    // A link without a view leaves the camera where it is.
    expect(currentLook()).toEqual({ ...next, view: bootLook.view });
    expect(app.rig.solo).toBe(true);
    // The night street is dark and rains on its own.
    expect(document.body).toHaveClass("dim");
    expect(state.rain).toBe(true);
    expect(app.autoRain).toBe(true);
    expect(ui.get().rain).toBe(true);

    history.replaceState(null, "", "#about");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    // A link without a view leaves the camera where it is.
    expect(currentLook()).toEqual({ ...next, view: bootLook.view });
  });

  it("turns automatic rain off again when a linked look leaves the rainy scene", () => {
    history.replaceState(
      null,
      "",
      hashOf(lookUrl({ ...currentLook(), scene: "studio", backdrop: "dusk" }, location.href)),
    );
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(state.scene).toBe("studio");
    expect(state.rain).toBe(false);
    expect(app.autoRain).toBe(false);
    // The dusk backdrop is dark; in the studio the stage tone is the backdrop bottom color.
    expect(document.body).toHaveClass("dim");
    expect(document.documentElement.style.getPropertyValue("--stage")).toBe(app.stage.backdropNow.bottom);
    expect(outfit.legs[0].color).toBe("ivory");
  });

  it("moves the camera to a linked view the short way round, within the usual limits", () => {
    orbit.cur.yaw = 20;
    const look = { ...currentLook(), view: { yaw: 1, pitch: 5, dist: 99, target: [9, -1, 0.1] as const } };
    history.replaceState(null, "", hashOf(lookUrl(look, location.href)));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(orbit.yaw).toBeCloseTo(1 + Math.PI * 6, 12);
    expect([orbit.pitch, orbit.dist, ...orbit.target.toArray()]).toEqual([1.15, 3.2, 0.25, 0.02, 0.1]);
    h.frames(120, 16);
    expect(orbit.cur.yaw).toBeCloseTo(orbit.yaw, 6);
    // The copied link carries the wrapped yaw back.
    expect(unpackLook(hashOf(lookUrl(currentLook(), location.href)))?.view?.yaw).toBe(1);
  });

  it("re-applies a pasted link the page already shows, which only fires popstate", () => {
    orbit.cur.yaw = 0.5;
    const linked: Look = {
      ...currentLook(),
      pose: "step",
      view: { yaw: 0.5, pitch: 0.3, dist: 2, target: [0, 0.43, 0.035] },
    };
    history.replaceState(null, "", hashOf(lookUrl(linked, location.href)));
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(currentLook()).toEqual(linked);
    // The user moves on; pasting the same link again brings the linked look back.
    actions.pose("pair");
    orbit.yaw = 2;
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(currentLook()).toEqual(linked);
  });

  it("applies a hash navigation once, although it fires popstate and then hashchange", () => {
    const setPose = vi.spyOn(app.rig, "setPose");
    history.replaceState(null, "", hashOf(lookUrl({ ...currentLook(), pose: "crossed" }, location.href)));
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(setPose).toHaveBeenCalledTimes(1);
    // A later hashchange on its own (no popstate before it) is applied again.
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(setPose).toHaveBeenCalledTimes(2);
    // Back/forward to an entry without a look changes nothing.
    history.replaceState(null, "", "#about");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(setPose).toHaveBeenCalledTimes(2);
    setPose.mockRestore();
  });

  it("applies only the legs of a link whose pose, scene and backdrop are unknown", () => {
    const before = currentLook();
    history.replaceState(null, "", "#look=1~moonwalk~moon~nope~knee.plain.0.matte.70.none.ink.none.-");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(currentLook()).toEqual({
      ...before,
      legs: [
        withLegDefaults({ length: "knee", cuff: "plain", material: "matte", denier: 70, color: "ink" }),
        withLegDefaults({ length: "knee", cuff: "plain", material: "matte", denier: 70, color: "ink" }),
      ],
    });
  });
});
