import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneSheet } from "../../../src/components/sheets/SceneSheet";
import { actions } from "../../../src/engine/app/actions";
import { thumbCanvases, THUMB_SIZE } from "../../../src/engine/app/thumbnails";
import { BACKDROP_ORDER, BACKDROPS, SCENE_ORDER } from "../../../src/engine/stage/scenes";
import { chip, chips, resetUiTest, selectedValues, setUi } from "./harness";

vi.mock("../../../src/engine/app/actions", async () => (await import("./harness")).mockActionsModule());

afterEach(resetUiTest);

const setScenes = (scene: string, backdrop = "lilac") => setUi({ scenes: { scene, backdrop } });
// Card selection has no ARIA state; the caption weight class is the only signal.
const selectedCards = () => chips("scene").filter((card) => card.classList.contains("font-semibold"));
const backdropRow = () => screen.getByText("底色").parentElement!;
const customSwatch = () => screen.getByLabelText("自选底色", { selector: "label" });
const isSwatchOn = (el: Element) => el.classList.contains("shadow-[0_0_0_2px_var(--ink)]");
const hint = () => document.querySelector("#scenes > p")!;

describe("SceneSheet cards", () => {
  it("renders a labeled card per scene in scene order", () => {
    render(<SceneSheet />);
    expect(screen.getByRole("region", { name: "场景" })).toHaveAttribute("id", "scenes");
    expect(chips("scene").map((card) => card.dataset.v)).toEqual(SCENE_ORDER);
    expect(chips("scene").map((card) => card.textContent)).toEqual(["影棚", "浴室", "夜雨街头", "泳池边"]);
  });

  it("marks the current scene's card as selected", () => {
    render(<SceneSheet />);
    expect(selectedCards()).toEqual([chip("scene", "studio")]);
    setScenes("street");
    expect(selectedCards()).toEqual([chip("scene", "street")]);
  });

  it("switches scenes by id on click", async () => {
    render(<SceneSheet />);
    await userEvent.click(screen.getByRole("button", { name: "泳池边" }));
    expect(actions.scene).toHaveBeenCalledExactlyOnceWith("pool");
  });

  it("does not preview scenes on hover", async () => {
    render(<SceneSheet />);
    await userEvent.hover(chip("scene", "bath"));
    await userEvent.unhover(chip("scene", "bath"));
    expect(actions.scene).not.toHaveBeenCalled();
    expect(actions.previewPreset).not.toHaveBeenCalled();
  });

  it("registers each card canvas as that scene's thumbnail at the thumbnail size", () => {
    render(<SceneSheet />);
    for (const id of SCENE_ORDER) {
      const canvas = chip("scene", id).querySelector("canvas")!;
      expect(thumbCanvases.scenes[id]).toBe(canvas);
      expect([canvas.width, canvas.height]).toEqual([THUMB_SIZE.w, THUMB_SIZE.h]);
    }
    expect(Object.keys(thumbCanvases.scenes).sort()).toEqual([...SCENE_ORDER].sort());
  });
});

describe("SceneSheet backdrop row", () => {
  it("is shown only in the studio", () => {
    render(<SceneSheet />);
    expect(backdropRow()).not.toHaveAttribute("hidden");
    for (const id of ["bath", "street", "pool"]) {
      setScenes(id);
      expect(backdropRow()).toHaveAttribute("hidden");
    }
    setScenes("studio");
    expect(backdropRow()).not.toHaveAttribute("hidden");
  });

  it("offers the backdrops as labeled swatches with the current one selected", () => {
    render(<SceneSheet />);
    expect(chips("backdrop").map((el) => el.dataset.v)).toEqual(BACKDROP_ORDER);
    expect(chips("backdrop").map((el) => el.getAttribute("aria-label"))).toEqual([
      "浅紫",
      "樱粉",
      "薄荷",
      "奶油",
      "天蓝",
      "夜蓝",
    ]);
    expect(chip("backdrop", "mint").style.getPropertyValue("--c")).toBe(BACKDROPS.mint.bottom);
    expect(selectedValues("backdrop")).toEqual(["lilac"]);
    setScenes("studio", "dusk");
    expect(selectedValues("backdrop")).toEqual(["dusk"]);
  });

  it("sets a backdrop by id on click", async () => {
    render(<SceneSheet />);
    await userEvent.click(within(backdropRow()).getByRole("button", { name: "薄荷" }));
    expect(actions.backdrop).toHaveBeenCalledExactlyOnceWith("mint");
  });

  it("shows a custom backdrop on the custom swatch and keeps it after a palette pick", () => {
    render(<SceneSheet />);
    expect(isSwatchOn(customSwatch())).toBe(false);
    setScenes("studio", "#334455");
    expect(selectedValues("backdrop")).toEqual([]);
    expect(isSwatchOn(customSwatch())).toBe(true);
    expect(customSwatch().style.getPropertyValue("--c")).toBe("#334455");
    setScenes("studio", "sky");
    expect(isSwatchOn(customSwatch())).toBe(false);
    expect(customSwatch().style.getPropertyValue("--c")).toBe("#334455");
  });

  it("sets the color typed into the custom input as the backdrop", () => {
    render(<SceneSheet />);
    fireEvent.input(customSwatch().querySelector("input")!, { target: { value: "#00ff88" } });
    expect(actions.backdrop).toHaveBeenCalledExactlyOnceWith("#00ff88");
  });
});

describe("SceneSheet hint", () => {
  it.each([
    ["studio", "影棚: 干净的纸背景, 底色可以换, 适合拍照。"],
    ["bath", "浴室: 「细雨」在这里是头顶的花洒, 湿地砖会映出腿的倒影。"],
    ["street", "夜雨街头: 这里一直下着雨, 霓虹的光勾在丝袜上, 也映在路面上。"],
    ["pool", "泳池边: 太阳底下, 水面的波光会晃到腿上。"],
  ])("describes the %s scene", (scene, text) => {
    render(<SceneSheet />);
    setScenes(scene);
    expect(hint().textContent).toBe(text);
  });

  it("is empty for an unknown scene id, which selects no card", () => {
    render(<SceneSheet />);
    setScenes("moon");
    expect(hint().textContent).toBe("");
    expect(selectedCards()).toEqual([]);
  });
});
