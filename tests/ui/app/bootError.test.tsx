import { screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { actions } from "../../../src/engine/app/actions";
import { setPanel } from "../../../src/engine/app/layout";
import { app } from "../../../src/engine/app/runtime";
import { publishScenes, publishWardrobe } from "../../../src/engine/app/sheets";
import { thumbJobs } from "../../../src/engine/app/thumbnails";
import { initialUiState, ui } from "../../../src/state/ui";
import { bootApp, type Harness } from "../../helpers/appHarness";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: (await import("../../helpers/rendererHook")).WebGLRendererProxy,
}));

let h: Harness;
let consoleError: MockInstance<typeof console.error>;
let loggedErrors: unknown[][];

beforeAll(async () => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  // A small screen with a fine pointer still counts as mobile.
  h = await bootApp({ fetchFails: true, screen: { w: 375, h: 812 }, media: { coarse: false, fine: true } });
  loggedErrors = consoleError.mock.calls.slice();
});

describe("boot failure", () => {
  it("reports the error message in the ui store and logs the error", () => {
    expect(ui.get().bootError).toBe("network down");
    expect(loggedErrors).toHaveLength(1);
    expect(loggedErrors[0][0]).toBeInstanceOf(Error);
    expect(h.fetches).toHaveLength(1);
  });

  it("shows the failure in the loading overlay", async () => {
    await h.settle();
    expect(screen.getByText(/三维画面启动失败: network down/)).toBeInTheDocument();
  });

  it("created the renderer and camera but never bound the UI or started frames", () => {
    expect(app.isMobile).toBe(true);
    expect(app.renderer).toBe(h.renderer);
    expect(app.uiBound).toBe(false);
    expect(app.stage).toBeUndefined();
    vi.advanceTimersByTime(1000);
    expect(document.body).not.toHaveClass("ready");
    expect(h.renderer.ops("render")).toHaveLength(0);
  });

  it("ignores UI actions until the engine is bound", () => {
    const before = ui.get();
    actions.bucket();
    actions.toggleRain();
    actions.toggleSlow();
    actions.toggleSound();
    actions.setMode("view");
    actions.toggleWardrobe();
    actions.preset(0);
    actions.scene("bath");
    actions.share();
    publishWardrobe();
    publishScenes();
    expect(ui.get()).toBe(before);
    expect(before.wardrobe).toEqual(initialUiState.wardrobe);
  });

  it("does not queue thumbnails before the UI is bound", () => {
    setPanel("scene");
    setPanel("mat");
    expect(thumbJobs).toHaveLength(0);
    setPanel(null);
  });
});
