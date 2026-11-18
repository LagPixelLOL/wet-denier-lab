import { beforeAll, describe, expect, it, vi } from "vitest";
import { actions } from "../../../src/engine/app/actions";
import { setPanel } from "../../../src/engine/app/layout";
import { app } from "../../../src/engine/app/runtime";
import { state } from "../../../src/engine/app/state";
import { thumbCanvases, thumbJobs } from "../../../src/engine/app/thumbnails";
import { PRESETS } from "../../../src/engine/catalog/presets";
import { SCENE_ORDER } from "../../../src/engine/stage/scenes";
import { ui } from "../../../src/state/ui";
import { AppContext2D, bootApp, contextOf, type Harness } from "../../helpers/appHarness";
import type { CanvasOp } from "../../helpers/fakeCanvas";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: (await import("../../helpers/rendererHook")).WebGLRendererProxy,
}));

let h: Harness;

const settle = () => h.frames(60, 20);

/** Ops of the newest 2D context. */
const photoOps = (): CanvasOp[] => h.contexts.at(-1)!.ops;

function takePhoto() {
  actions.requestPhoto();
  h.frame();
}

beforeAll(async () => {
  h = await bootApp();
  settle();
});

describe("photos", () => {
  it("copies the canvas with a watermark sized to the frame", () => {
    takePhoto();
    expect(photoOps()).toMatchInlineSnapshot(`
      [
        [
          "drawImage",
          "view",
          0,
          0,
        ],
        [
          "textBaseline=",
          "alphabetic",
        ],
        [
          "fillStyle=",
          "rgba(47, 40, 56, 0.86)",
        ],
        [
          "font=",
          "76px "ZCOOL XiaoWei", "Songti SC", "STSong", "SimSun", serif",
        ],
        [
          "fillText",
          "雨丝",
          58,
          1498,
        ],
        [
          "fillStyle=",
          "rgba(92, 82, 108, 0.82)",
        ],
        [
          "font=",
          "29px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif",
        ],
        [
          "fillText",
          "WET DENIER LAB",
          58,
          1542,
        ],
      ]
    `);
    expect(ui.get().photo).toEqual({
      open: true,
      src: "data:image/jpeg;fake,canvas:2560x1600@0.93",
      saveHidden: false,
      tip: "点「保存图片」下载，或在图片上点右键另存为",
    });
    expect(document.body).toHaveClass("photo-open");
    actions.closePhoto();
  });

  it("draws the photo after the frame is rendered", () => {
    h.renderer.reset();
    actions.requestPhoto();
    let renders = 0;
    const drawImage = vi.spyOn(AppContext2D.prototype, "drawImage");
    drawImage.mockImplementation(() => {
      renders = h.renderer.ops("render").length;
    });
    h.frame();
    expect(renders).toBe(h.renderer.ops("render").length);
    expect(renders).toBeGreaterThan(0);
    drawImage.mockRestore();
    actions.closePhoto();
  });

  it("uses a light watermark on dim stages", () => {
    actions.backdrop("dusk");
    takePhoto();
    expect(
      photoOps()
        .filter(([name]) => name === "fillStyle=")
        .map((op) => op[1]),
    ).toEqual(["rgba(255, 255, 255, 0.92)", "rgba(255, 255, 255, 0.74)"]);
    actions.closePhoto();
    actions.backdrop("lilac");
  });

  it("scales the watermark with the smaller canvas side", () => {
    h.view.w = 720;
    h.view.h = 900;
    h.resizeCallbacks[0]([], new ResizeObserver(() => {}));
    takePhoto();
    // 1440 x 1800 canvas: scale 2, margin 52
    const texts = photoOps().filter(([name]) => name === "fillText" || name === "font=");
    expect(texts).toEqual([
      ["font=", '68px "ZCOOL XiaoWei", "Songti SC", "STSong", "SimSun", serif'],
      ["fillText", "雨丝", 52, 1708],
      ["font=", '26px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'],
      ["fillText", "WET DENIER LAB", 52, 1748],
    ]);
    actions.closePhoto();
    h.view.w = 1280;
    h.view.h = 800;
    h.resizeCallbacks[0]([], new ResizeObserver(() => {}));
  });

  it("hides the save button and suggests right-click inside an embedding host", () => {
    window.claude = {};
    takePhoto();
    expect(ui.get().photo).toMatchObject({ saveHidden: true, tip: "在图片上点右键，选「图片另存为」" });
    actions.closePhoto();
    delete window.claude;
  });

  it("buzzes once the user has interacted", () => {
    const vibrate = vi.fn((_pattern: VibratePattern) => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: { hasBeenActive: false } });
    takePhoto();
    expect(vibrate).not.toHaveBeenCalled();
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: { hasBeenActive: true } });
    takePhoto();
    expect(vibrate).toHaveBeenCalledWith(12);
    actions.bucket();
    expect(vibrate).toHaveBeenLastCalledWith([10, 30, 14]);
    actions.closePhoto();
  });
});

describe("thumbnails", () => {
  it("queues preset thumbnails only while the wardrobe shows the preset tab", () => {
    actions.showTab("preset");
    expect(thumbJobs).toHaveLength(0);
    actions.showTab("pose");
    setPanel("mat");
    expect(thumbJobs).toHaveLength(0);
    actions.showTab("preset");
    expect(thumbJobs).toHaveLength(PRESETS.length);
    thumbJobs.forEach((job, i) => {
      expect(job.kind).toBe("presets");
      expect(job.canvas).toBe(thumbCanvases.presets[i]);
      expect(document.body.contains(job.canvas)).toBe(true);
    });
  });

  it("renders one thumbnail per frame offscreen and restores the stage", () => {
    const viewport = app.stage.viewport.clone();
    const line = app.stage.lineWidth.value;
    h.renderer.reset();
    h.frame();
    expect(thumbJobs).toHaveLength(PRESETS.length - 1);
    expect(app.thumbTarget).toMatchObject({ width: 180, height: 240 });
    expect(app.thumbPixels).toHaveLength(180 * 240 * 4);
    const thumbRenders = h.renderer.ops("render").filter((call) => call.camera === app.thumbCamera);
    expect(thumbRenders).toHaveLength(1);
    expect(thumbRenders[0]).toMatchObject({ scene: app.stage.scene, target: app.thumbTarget });
    expect(app.stage.viewport.equals(viewport)).toBe(true);
    expect(app.stage.lineWidth.value).toBe(line);
    expect(app.stage.uniforms.fabric.uWetMap.value).toBe(app.wetmap.texture);
    expect(app.stage.uniforms.floor.uPuddleTex.value).toBe(app.water.puddleTex);
    const ctx = contextOf(h, thumbCanvases.presets[0])!;
    expect(ctx.ops.filter(([name]) => name === "putImageData")).toHaveLength(1);
    expect(ctx.ops.at(-1)!.slice(2)).toEqual([0, 0]);
  });

  it("drains the queue and does not queue the same pose twice", () => {
    h.frames(PRESETS.length);
    expect(thumbJobs).toHaveLength(0);
    for (const canvas of thumbCanvases.presets) {
      expect(contextOf(h, canvas)!.ops.some(([name]) => name === "putImageData")).toBe(true);
    }
    setPanel(null);
    setPanel("mat");
    expect(thumbJobs).toHaveLength(0);
  });

  it("re-renders presets for a new pose once the legs stop moving", () => {
    actions.pose("tiptoe");
    expect(thumbJobs).toHaveLength(0);
    setPanel("mat");
    expect(thumbJobs).toHaveLength(PRESETS.length);
    h.frame();
    expect(app.rig.moving).toBe(true);
    expect(thumbJobs).toHaveLength(PRESETS.length);
    settle();
    expect(thumbJobs).toHaveLength(0);
  });

  it("replaces pending preset jobs when the pose changes again", () => {
    actions.pose("point");
    setPanel("mat");
    const first = thumbJobs.slice();
    expect(first).toHaveLength(PRESETS.length);
    actions.pose("tiptoe");
    setPanel("mat");
    expect(thumbJobs).toHaveLength(PRESETS.length);
    expect(thumbJobs[0]).not.toBe(first[0]);
    settle();
  });

  it("does not queue or render while a preset is previewed", () => {
    actions.previewPreset(4);
    actions.pose("step");
    setPanel("mat");
    expect(thumbJobs).toHaveLength(0);
    settle();
    actions.previewPreset(null);
    setPanel("mat");
    expect(thumbJobs).toHaveLength(PRESETS.length);
    settle();
    setPanel(null);
  });

  it("renders each scene thumbnail in its scene and switches back", async () => {
    const setScene = vi.spyOn(app.stage, "setScene");
    setPanel("scene");
    await h.settle();
    expect(thumbJobs.map((job) => job.scene).sort()).toEqual([...SCENE_ORDER].sort());
    for (const job of thumbJobs) {
      expect(job.canvas).toBe(thumbCanvases.scenes[job.scene!]);
    }
    const mirror = app.stage.uniforms.floor.uMirrorStrength.value;
    h.frames(SCENE_ORDER.length);
    expect(thumbJobs).toHaveLength(0);
    expect(setScene.mock.calls.map((call) => call[0]).sort()).toEqual(
      ["bath", "pool", "street", "studio", "studio", "studio"].sort(),
    );
    expect(state.scene).toBe("studio");
    expect(app.stage.sceneNow.id).toBe(0);
    expect(app.stage.uniforms.floor.uMirrorStrength.value).toBe(mirror);
    setScene.mockRestore();
  });

  it("re-queues scene thumbnails when the outfit changes (checked every 40 frames)", async () => {
    actions.wearChip("color", "smoke");
    expect(thumbJobs).toHaveLength(0);
    h.frames(40);
    await h.settle();
    expect(thumbJobs).toHaveLength(SCENE_ORDER.length);
    h.frames(SCENE_ORDER.length);
    expect(thumbJobs).toHaveLength(0);
    setPanel(null);
  });
});
