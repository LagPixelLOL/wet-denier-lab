import { beforeAll, describe, expect, it, vi } from "vitest";
import { actions } from "../../../src/engine/app/actions";
import { homeView, orbit } from "../../../src/engine/app/camera";
import { hideHint } from "../../../src/engine/app/hud";
import { currentLook } from "../../../src/engine/app/outfit";
import { app } from "../../../src/engine/app/runtime";
import { outfit, state } from "../../../src/engine/app/state";
import { PRESETS, withLegDefaults } from "../../../src/engine/catalog/presets";
import { lookUrl } from "../../../src/engine/share/lookCodec";
import { ui } from "../../../src/state/ui";
import { bootApp, type Harness } from "../../helpers/appHarness";
import { seedRandom } from "../../helpers/random";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: (await import("../../helpers/rendererHook")).WebGLRendererProxy,
}));

let h: Harness;

const presetLegs = (index: number) => {
  const preset = PRESETS[index];
  return (preset.legs || [preset.both, preset.both]).map((spec) => withLegDefaults(spec));
};

const settle = () => h.frames(60, 20);

function setClipboard(writeText: ((text: string) => Promise<void>) | null) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

beforeAll(async () => {
  h = await bootApp();
  settle();
});

describe("simple actions", () => {
  it("switches the touch mode only when it changes", () => {
    hideHint();
    actions.setMode("water");
    expect(ui.get().hint.hidden).toBe(true);
    actions.setMode("view");
    expect(state.mode).toBe("view");
    expect(ui.get().hint.hidden).toBe(false);
    vi.advanceTimersByTime(3200);
    expect(ui.get().hint.hidden).toBe(true);
    actions.setMode("water");
    expect(state.mode).toBe("water");
  });

  it("toggles sound, rain and slow motion", () => {
    actions.toggleSound();
    expect(ui.get().soundOn).toBe(false);
    expect(app.sound.enabled).toBe(false);
    actions.toggleSound();
    expect(ui.get().soundOn).toBe(true);
    expect(app.sound.enabled).toBe(true);
    actions.toggleRain();
    expect(ui.get().rain).toBe(true);
    expect(app.sound.raining).toBe(true);
    actions.toggleRain();
    expect(ui.get().rain).toBe(false);
    actions.toggleSlow();
    expect(ui.get().slow).toBe(true);
    actions.toggleSlow();
    expect(ui.get().slow).toBe(false);
  });

  it("zooms in and out by 1.25 and resets the view", () => {
    actions.resetView();
    actions.zoomIn();
    expect(orbit.dist).toBeCloseTo(homeView.dist / 1.25, 12);
    actions.zoomOut();
    actions.zoomOut();
    expect(orbit.dist).toBeCloseTo(homeView.dist * 1.25, 12);
    actions.resetView();
    expect(orbit.dist).toBe(homeView.dist);
  });

  it("throws a bucket and dries off", () => {
    const splashes = state.splashes;
    actions.bucket();
    expect(state.splashes).toBe(splashes + 1);
    actions.dry();
    expect(app.dryTimer).toBe(0.8);
    expect(app.water.drops).toHaveLength(0);
  });

  it("requests and closes the photo", () => {
    actions.requestPhoto();
    expect(app.photoRequested).toBe(true);
    h.frame();
    expect(ui.get().photo.open).toBe(true);
    actions.closePhoto();
    expect(ui.get().photo.open).toBe(false);
    expect(document.body).not.toHaveClass("photo-open");
  });

  it("switches wardrobe tabs", () => {
    actions.showTab("color");
    expect(ui.get().wardrobe.tab).toBe("color");
    actions.showTab("pose");
  });
});

describe("outfit actions", () => {
  it("changes the pose and publishes it", () => {
    actions.pose("together");
    expect(app.rig.name).toBe("together");
    expect(app.rig.moving).toBe(true);
    expect(ui.get().wardrobe).toMatchObject({ pose: "together", solo: false });
    // Unknown and current poses are ignored.
    actions.pose("together");
    actions.pose("nope");
    expect(app.rig.name).toBe("together");
    settle();
    expect(app.rig.moving).toBe(false);
  });

  it("wears a preset on both legs", () => {
    actions.preset(1);
    expect(outfit.legs).toEqual(presetLegs(1));
    expect(ui.get().wardrobe.spec).toMatchObject({
      color: outfit.legs[0].color,
      material: outfit.legs[0].material,
    });
    const mixed = PRESETS.findIndex((preset) => preset.legs);
    expect(mixed).toBeGreaterThanOrEqual(0);
    actions.preset(mixed);
    expect(outfit.legs).toEqual(presetLegs(mixed));
  });

  it("previews presets and restores the outfit afterwards", () => {
    actions.preset(0);
    const worn = outfit.legs.slice();
    const setStocking = vi.spyOn(app.stage, "setStocking");
    actions.previewPreset(2);
    expect(outfit.legs).toEqual(presetLegs(2));
    expect(app.previewBackup).toEqual(worn);
    actions.previewPreset(3);
    expect(outfit.legs).toEqual(presetLegs(3));
    expect(app.previewBackup).toEqual(worn);
    actions.previewPreset(null);
    expect(outfit.legs).toEqual(worn);
    expect(app.previewBackup).toBeNull();
    expect(setStocking).toHaveBeenCalledTimes(6);
    actions.previewPreset(null);
    expect(setStocking).toHaveBeenCalledTimes(6);
    setStocking.mockRestore();
  });

  it("drops the preview when a preset is picked", () => {
    actions.previewPreset(2);
    actions.preset(2);
    expect(app.previewBackup).toBeNull();
    expect(outfit.legs).toEqual(presetLegs(2));
    actions.preset(0);
  });

  it("dresses only the target leg and flashes the other leg away", () => {
    actions.target(1);
    expect(outfit.target).toBe(1);
    expect(app.targetFlash).toEqual({ leg: 1, until: performance.now() + 900 });
    expect(ui.get().wardrobe.target).toBe(1);
    actions.wearChip("color", "ivory");
    expect(outfit.legs[1].color).toBe("ivory");
    expect(outfit.legs[0].color).toBe("ink");
    expect(ui.get().wardrobe.spec?.color).toBe("ivory");
    h.frame();
    expect(app.rig.away).toEqual([1, 0]);
    vi.advanceTimersByTime(900);
    h.frame();
    expect(app.rig.away).toEqual([0, 0]);
    actions.target(0);
    expect(ui.get().wardrobe.spec?.color).toBe("ink");
    const flash = app.targetFlash;
    actions.target(-1);
    expect(outfit.target).toBe(-1);
    expect(app.targetFlash).toBe(flash);
    actions.preset(0);
    settle();
  });

  it("collides with the bare toes of the legs that are bare, previews included", () => {
    // The last triangle of each leg is one of the forefoot's skin.
    const skinIndexed = () => [1, 2].map((leg) => app.surface.skip[leg * app.rig.legTris - 1] === 0);
    expect(app.rig.triGroup[app.rig.legTris - 1]).toBe(2);
    expect(app.rig.bare).toEqual([false, false]);
    expect(skinIndexed()).toEqual([false, false]);
    const setBare = vi.spyOn(app.rig, "setBare");
    actions.wearChip("length", "bare");
    expect(setBare.mock.calls).toEqual([
      [0, true],
      [1, true],
    ]);
    expect(app.rig.bare).toEqual([true, true]);
    expect(skinIndexed()).toEqual([true, true]);
    // Only the leg being dressed is told, whatever changes on it.
    actions.target(1);
    setBare.mockClear();
    actions.wearChip("length", "knee");
    actions.wearChip("color", "ivory");
    expect(setBare.mock.calls).toEqual([
      [1, false],
      [1, false],
    ]);
    expect(app.rig.bare).toEqual([true, false]);
    expect(skinIndexed()).toEqual([true, false]);
    expect(app.stage.legs.map((leg) => leg.bare)).toEqual(app.rig.bare);
    // A previewed preset is what the legs collide as, until the preview ends.
    actions.previewPreset(2);
    expect(app.rig.bare).toEqual([false, false]);
    actions.previewPreset(null);
    expect(app.rig.bare).toEqual([true, false]);
    // Presets and random outfits have no bare legs.
    actions.random();
    expect(app.rig.bare).toEqual([false, false]);
    actions.wearChip("length", "bare");
    expect(app.rig.bare).toEqual([false, true]);
    actions.target(-1);
    actions.preset(0);
    expect(app.rig.bare).toEqual([false, false]);
    expect(skinIndexed()).toEqual([false, false]);
    setBare.mockRestore();
    settle();
  });

  it("maps wardrobe chips to leg spec values", () => {
    actions.wearChip("denier", "70");
    expect(outfit.legs[0].denier).toBe(70);
    actions.wearChip("length", "knee");
    actions.wearChip("garter", "1");
    expect(outfit.legs[0]).toMatchObject({ garter: true, length: "thigh" });
    actions.wearChip("garter", "0");
    expect(outfit.legs[0]).toMatchObject({ garter: false, length: "thigh" });
    actions.wearChip("toe", "0");
    expect(outfit.legs[0].toe).toBe(false);
    actions.wearChip("toe", "1");
    expect(outfit.legs[0].toe).toBe(true);
    actions.wearChip("wetColor", "sakura");
    expect(outfit.legs[0].wetColor).toBe("sakura");
    actions.wearChip("wetColor", "");
    expect(outfit.legs[0].wetColor).toBeNull();
    actions.wearChip("pattern", "dots");
    actions.wearChip("secret", "stars");
    actions.wearChip("material", "latex");
    actions.wearChip("cuff", "bow");
    expect(outfit.legs[1]).toEqual(outfit.legs[0]);
    expect(ui.get().wardrobe.spec).toMatchObject({ pattern: "dots", secret: "stars", material: "latex", cuff: "bow" });
    actions.wearColor("#a1b2c3");
    expect(outfit.legs.map((leg) => leg.color)).toEqual(["#a1b2c3", "#a1b2c3"]);
  });

  it("dresses both legs in a solo pose whatever the target", () => {
    actions.pose("single");
    expect(ui.get().wardrobe.solo).toBe(true);
    actions.target(1);
    // No flash for a single visible leg; the sheet shows the visible leg.
    expect(app.targetFlash.until).toBeLessThan(performance.now());
    actions.wearChip("color", "smoke");
    expect(outfit.legs.map((leg) => leg.color)).toEqual(["smoke", "smoke"]);
    expect(ui.get().wardrobe.spec?.color).toBe("smoke");
    actions.target(-1);
    actions.pose("step");
    settle();
  });

  it("wears random outfits, mostly matching pairs", () => {
    const restore = seedRandom(11);
    let mixed = 0;
    for (let i = 0; i < 20; i++) {
      actions.random();
      if (JSON.stringify(outfit.legs[0]) !== JSON.stringify(outfit.legs[1])) {
        mixed++;
      }
    }
    restore();
    expect(mixed).toBeGreaterThan(0);
    expect(mixed).toBeLessThan(10);
    expect(ui.get().wardrobe.spec?.color).toBe(outfit.legs[0].color);
    actions.preset(0);
  });
});

describe("scene actions", () => {
  it("fades out, swaps the scene and fades back in", async () => {
    actions.scene("pool");
    expect(document.body).toHaveClass("scene-out");
    expect(state.scene).toBe("studio");
    vi.advanceTimersByTime(220);
    await h.settle();
    expect(state.scene).toBe("pool");
    expect(app.stage.sceneNow.id).toBe(3);
    expect(ui.get().scenes.scene).toBe("pool");
    expect(ui.get().rainLabel).toBe("scene.pool.rain");
    expect(document.body).toHaveClass("scene-out");
    vi.advanceTimersByTime(60);
    expect(document.body).toHaveClass("scene-in");
    expect(document.body).not.toHaveClass("scene-out");
    vi.advanceTimersByTime(450);
    expect(document.body).not.toHaveClass("scene-in");
  });

  it("ignores unknown scenes and the current one", () => {
    actions.scene("pool");
    actions.scene("moon");
    expect(document.body).not.toHaveClass("scene-out");
  });

  it("applies only the last of overlapping scene swaps", async () => {
    const setScene = vi.spyOn(app.stage, "setScene");
    actions.scene("bath");
    vi.advanceTimersByTime(100);
    actions.scene("street");
    vi.advanceTimersByTime(220);
    await h.settle();
    expect(setScene.mock.calls.map((call) => call[0])).toEqual(["street"]);
    expect(state.scene).toBe("street");
    expect(state.rain).toBe(true);
    expect(app.autoRain).toBe(true);
    expect(document.body).toHaveClass("dim");
    // A new swap started during the 60 ms pause cancels the fade-in of the previous one.
    actions.scene("studio");
    vi.advanceTimersByTime(60);
    expect(document.body).not.toHaveClass("scene-in");
    vi.advanceTimersByTime(160);
    await h.settle();
    vi.advanceTimersByTime(60);
    expect(document.body).toHaveClass("scene-in");
    vi.advanceTimersByTime(450);
    expect(state.scene).toBe("studio");
    expect(state.rain).toBe(false);
    expect(document.body).not.toHaveClass("dim");
    setScene.mockRestore();
  });

  it("keeps manual rain on when leaving a rainy scene", async () => {
    actions.scene("street");
    vi.advanceTimersByTime(220);
    await h.settle();
    actions.toggleRain();
    actions.toggleRain();
    expect(app.autoRain).toBe(false);
    actions.scene("studio");
    vi.advanceTimersByTime(220);
    await h.settle();
    vi.advanceTimersByTime(510);
    expect(state.rain).toBe(true);
    actions.toggleRain();
  });

  it("sets palette and custom backdrops", () => {
    actions.backdrop("sky");
    expect(state.backdrop).toBe("sky");
    expect(ui.get().scenes).toEqual({ scene: "studio", backdrop: "sky" });
    expect(document.body).not.toHaveClass("dim");
    actions.backdrop("#101820");
    expect(ui.get().scenes.backdrop).toBe("#101820");
    expect(document.body).toHaveClass("dim");
    expect(document.documentElement.style.getPropertyValue("--stage")).toBe(app.stage.backdropNow.bottom);
    actions.backdrop("lilac");
    expect(document.body).not.toHaveClass("dim");
  });
});

describe("share links", () => {
  it("leaves the copy box alone until it is first needed", () => {
    actions.closeCopyBox();
    expect(ui.get().copyBox).toBeNull();
  });

  it("copies the look link and confirms with a hint", async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    setClipboard(writeText);
    hideHint();
    actions.share();
    expect(writeText).toHaveBeenCalledWith(lookUrl(currentLook(), location.href));
    // The link points at the page the app runs on and ends with the camera view.
    const url = writeText.mock.calls[0][0];
    expect(url.startsWith(location.href.split("#")[0] + "#look=1~")).toBe(true);
    expect(url.split("~").at(-1)).toMatch(/^-?[\d.]+(,-?[\d.]+){5}$/);
    await h.settle();
    expect(ui.get().hint).toEqual({ key: "hint.copied", hidden: false });
    expect(ui.get().copyBox).toBeNull();
    vi.advanceTimersByTime(3400);
    expect(ui.get().hint.hidden).toBe(true);
  });

  it("falls back to the copy box when the clipboard refuses", async () => {
    setClipboard(() => Promise.reject(new Error("denied")));
    actions.share();
    await h.settle();
    expect(ui.get().copyBox).toEqual({ url: lookUrl(currentLook(), location.href), open: true });
    actions.closeCopyBox();
    expect(ui.get().copyBox).toEqual({ url: lookUrl(currentLook(), location.href), open: false });
  });

  it("falls back to the copy box without a clipboard API", () => {
    setClipboard(null);
    actions.wearChip("color", "ivory");
    actions.share();
    expect(ui.get().copyBox).toEqual({ url: lookUrl(currentLook(), location.href), open: true });
    expect(ui.get().copyBox!.url).toContain("ivory");
  });
});
