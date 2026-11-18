import { beforeAll, describe, expect, it, vi } from "vitest";
import { actions } from "../../../src/engine/app/actions";
import { isPanelOpen, layout, setPanel, sheetCovers } from "../../../src/engine/app/layout";
import { app } from "../../../src/engine/app/runtime";
import { ui } from "../../../src/state/ui";
import { bootApp, placeElement, pointer, type Harness } from "../../helpers/appHarness";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: (await import("../../helpers/rendererHook")).WebGLRendererProxy,
}));

let h: Harness;

const body = () => document.body.classList;
const rootVar = (name: string) => document.documentElement.style.getPropertyValue(name);
const layoutClasses = () => ["wide", "short", "roomy", "fine"].filter((c) => body().contains(c));
const panelClasses = () =>
  ["mat-open", "scene-open", "about-open", "sheet-open"].filter((c) => body().contains(c)).join(" ");

function resizeTo(w: number, height: number) {
  h.view.w = w;
  h.view.h = height;
  window.dispatchEvent(new Event("resize"));
}

/** Lets the camera ease toward its layout goals (the easing runs at 10/s). */
const settleCamera = () => h.frames(90, 20);

beforeAll(async () => {
  // A narrow window on a desktop machine: phone layout without the mobile render budget.
  h = await bootApp({ view: { w: 390, h: 844 }, media: { wide: false, roomy: false, fine: false } });
});

describe("phone layout", () => {
  it("sets no layout classes and centers the stage", () => {
    expect(layoutClasses()).toEqual([]);
    expect(layout).toEqual({ wide: false, roomy: false, insetL: 0, insetR: 0 });
    expect(rootVar("--inset-l")).toBe("0px");
    expect(rootVar("--stage-x")).toBe("50%");
  });

  it("opens one panel at a time and mirrors it in the ui store", () => {
    actions.toggleWardrobe();
    expect(panelClasses()).toBe("mat-open sheet-open");
    expect(ui.get().panels).toEqual({ mat: true, scene: false, about: false });
    expect(sheetCovers()).toBe(true);
    actions.toggleScenes();
    expect(panelClasses()).toBe("scene-open sheet-open");
    expect(ui.get().panels).toEqual({ mat: false, scene: true, about: false });
    actions.toggleScenes();
    expect(panelClasses()).toBe("");
    actions.toggleAbout();
    expect(panelClasses()).toBe("about-open");
    expect(ui.get().panels).toEqual({ mat: false, scene: false, about: true });
    expect(sheetCovers()).toBe(false);
    actions.toggleAbout();
    expect(panelClasses()).toBe("");
    actions.toggleAbout();
    actions.closeAbout();
    expect(isPanelOpen("about")).toBe(false);
  });

  it("closes the about panel when the canvas is pressed", () => {
    setPanel("about");
    pointer("pointerdown", { x: 5, y: 5 });
    pointer("pointerup", { x: 5, y: 5 });
    expect(isPanelOpen("about")).toBe(false);
    expect(ui.get().panels.about).toBe(false);
  });

  it("zooms the camera into the upper part of the view while a sheet covers it", () => {
    settleCamera();
    expect(app.camera.view?.enabled ?? false).toBe(false);
    setPanel("mat");
    settleCamera();
    expect(app.sheetZoomGoal).toBe(1);
    expect(app.sheetZoom).toBeCloseTo(1, 6);
    const view = app.camera.view!;
    expect(view.enabled).toBe(true);
    // zoom 1.75: the full view shrinks to 390/1.75 x 844/1.75, centered and lifted by 3% of the height
    expect(view.fullWidth).toBeCloseTo(390 / 1.75, 3);
    expect(view.fullHeight).toBeCloseTo(844 / 1.75, 3);
    expect([view.width, view.height]).toEqual([390, 844]);
    expect(view.offsetX).toBeCloseTo(-(390 - 390 / 1.75) / 2, 3);
    expect(view.offsetY).toBeCloseTo(-844 * 0.03, 3);
    setPanel(null);
    settleCamera();
    expect(app.sheetZoom).toBeLessThan(0.002);
    expect(app.camera.view!.enabled).toBe(false);
  });
});

describe("wide layout", () => {
  it("adds the wide and fine classes on resize and insets the stage past the dock", () => {
    h.media.wide = true;
    h.media.fine = true;
    placeElement(".dock", 14, 80);
    placeElement("#materials", 900, 360);
    placeElement("#scenes", 880, 380);
    resizeTo(1280, 800);
    expect(layoutClasses()).toEqual(["wide", "fine"]);
    expect(layout.insetL).toBe(104);
    expect(layout.insetR).toBe(0);
    expect(rootVar("--inset-l")).toBe("104px");
    expect(rootVar("--stage-x")).toBe("692px");
  });

  it("keeps the sheet beside the stage instead of zooming", () => {
    actions.toggleWardrobe();
    expect(layout.insetR).toBe(390);
    expect(rootVar("--stage-x")).toBe("497px");
    expect(sheetCovers()).toBe(true);
    actions.toggleScenes();
    expect(panelClasses()).toBe("scene-open sheet-open");
    expect(layout.insetR).toBe(410);
    settleCamera();
    expect(app.sheetZoomGoal).toBe(0);
    expect(app.insetShiftGoal).toBe(153);
    // Snaps to the goal once within 0.4 px.
    expect(app.insetShift).toBe(153);
    expect(app.camera.view).toMatchObject({ enabled: true, offsetX: 153, offsetY: 0, width: 1280, height: 800 });
    actions.toggleScenes();
    settleCamera();
    expect(app.insetShiftGoal).toBe(-52);
    expect(app.camera.view!.offsetX).toBe(-52);
  });

  it("marks short wide windows", () => {
    resizeTo(1280, 540);
    expect(layoutClasses()).toEqual(["wide", "short", "fine"]);
    resizeTo(1280, 800);
    expect(layoutClasses()).toEqual(["wide", "fine"]);
  });
});

describe("roomy layout", () => {
  it("opens both sheets when the window becomes roomy and drops the about panel", () => {
    setPanel("about");
    h.media.roomy = true;
    placeElement(".side", 1040, 344);
    resizeTo(1400, 900);
    expect(layoutClasses()).toEqual(["wide", "roomy", "fine"]);
    expect(panelClasses()).toBe("mat-open scene-open sheet-open");
    expect(ui.get().panels).toEqual({ mat: true, scene: true, about: false });
    expect(layout.insetR).toBe(370);
    expect(rootVar("--stage-x")).toBe("567px");
    expect(sheetCovers()).toBe(false);
  });

  it("toggles each sheet independently and overlays the about panel", () => {
    actions.toggleWardrobe();
    expect(panelClasses()).toBe("scene-open sheet-open");
    actions.toggleScenes();
    expect(panelClasses()).toBe("");
    expect(layout.insetR).toBe(0);
    actions.toggleWardrobe();
    actions.toggleScenes();
    expect(panelClasses()).toBe("mat-open scene-open sheet-open");
    actions.toggleAbout();
    expect(panelClasses()).toBe("mat-open scene-open about-open sheet-open");
    expect(ui.get().panels).toEqual({ mat: true, scene: true, about: true });
    actions.toggleAbout();
    expect(panelClasses()).toBe("mat-open scene-open sheet-open");
  });

  it("keeps the sheets open on resizes that stay roomy", () => {
    resizeTo(1500, 900);
    expect(panelClasses()).toBe("mat-open scene-open sheet-open");
    expect(layout.insetR).toBe(470);
  });

  it("closes every panel when the window stops being roomy", () => {
    h.media.roomy = false;
    resizeTo(1280, 800);
    expect(layoutClasses()).toEqual(["wide", "fine"]);
    expect(panelClasses()).toBe("");
    expect(ui.get().panels).toEqual({ mat: false, scene: false, about: false });
  });

  it("returns to the phone layout", () => {
    h.media.wide = false;
    h.media.fine = false;
    resizeTo(390, 844);
    expect(layoutClasses()).toEqual([]);
    expect(rootVar("--inset-l")).toBe("0px");
    expect(rootVar("--stage-x")).toBe("50%");
  });
});
