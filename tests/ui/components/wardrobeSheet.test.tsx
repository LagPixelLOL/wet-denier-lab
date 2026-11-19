import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WardrobeSheet } from "../../../src/components/sheets/WardrobeSheet";
import { actions } from "../../../src/engine/app/actions";
import { thumbCanvases, THUMB_SIZE } from "../../../src/engine/app/thumbnails";
import { COLOR_ORDER, COLORS } from "../../../src/engine/catalog/colors";
import { PATTERN_ORDER, SECRET_DECAL_ORDER } from "../../../src/engine/catalog/garments";
import { DEFAULT_LEG_SPEC, PRESETS } from "../../../src/engine/catalog/presets";
import { POSE_ORDER } from "../../../src/engine/rig/poses";
import { zhCN } from "../../../src/i18n/messages/zh-CN";
import type { WardrobeSpec, WardrobeTab } from "../../../src/state/ui";
import { chip, chips, isChipDimmed, resetUiTest, selectedValues, setWardrobe } from "./harness";

vi.mock("../../../src/engine/app/actions", async () => (await import("./harness")).mockActionsModule());

const TAB_ORDER: WardrobeTab[] = ["pose", "preset", "style", "color", "material", "pattern", "fun"];

const spec = (patch: Partial<WardrobeSpec> = {}): WardrobeSpec => ({ ...DEFAULT_LEG_SPEC, ...patch });

const tab = (id: WardrobeTab) => document.querySelector<HTMLElement>(`[role="tab"][data-tab="${id}"]`)!;
const visiblePanes = () =>
  [...document.querySelectorAll<HTMLElement>('[role="tabpanel"]')].filter((pane) => !pane.hidden);
const dimmedValues = (group: string) =>
  chips(group)
    .filter(isChipDimmed)
    .map((el) => el.dataset.v!);
const customSwatch = () => screen.getByLabelText("自选颜色", { selector: "label" });
const isSwatchOn = (el: Element) => el.classList.contains("shadow-[0_0_0_2px_var(--ink)]");
const targetGroup = () => screen.getByRole("radiogroup", { name: "穿在哪条腿上", hidden: true });

const scrollIntoView = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>();

beforeEach(() => {
  // jsdom has no layout, so scrollIntoView is missing; the sheet calls it on tab changes.
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  resetUiTest();
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

describe("WardrobeSheet tabs", () => {
  it("lists the seven tabs in order and selects the store tab", () => {
    render(<WardrobeSheet />);
    const tabs = within(screen.getByRole("tablist", { name: "衣橱分类" })).getAllByRole("tab");
    expect(tabs.map((el) => el.dataset.tab)).toEqual(TAB_ORDER);
    expect(tabs.map((el) => el.textContent)).toEqual(["姿势", "套装", "款式", "颜色", "材质", "花纹", "彩蛋"]);
    expect(tabs.filter((el) => el.getAttribute("aria-selected") === "true")).toEqual([tab("pose")]);
  });

  it("asks the engine to switch tabs instead of switching locally", async () => {
    render(<WardrobeSheet />);
    await userEvent.click(screen.getByRole("tab", { name: "材质" }));
    expect(actions.showTab).toHaveBeenCalledExactlyOnceWith("material");
    expect(tab("pose")).toHaveAttribute("aria-selected", "true");
    expect(tab("material")).toHaveAttribute("aria-selected", "false");
  });

  it.each(TAB_ORDER)("shows exactly the %s pane when that tab is current", (id) => {
    render(<WardrobeSheet />);
    setWardrobe({ tab: id });
    expect(visiblePanes().map((pane) => pane.dataset.pane)).toEqual([id]);
    expect(tab(id)).toHaveAttribute("aria-selected", "true");
    expect(document.querySelectorAll('[role="tab"][aria-selected="true"]')).toHaveLength(1);
  });

  it("does not scroll the tab bar on mount", () => {
    setWardrobe({ tab: "fun" });
    render(<WardrobeSheet />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("scrolls the newly selected tab into view when the tab changes", () => {
    render(<WardrobeSheet />);
    setWardrobe({ tab: "fun" });
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "nearest", inline: "nearest" });
    expect(scrollIntoView.mock.contexts[0]).toBe(tab("fun"));
  });

  it("does not scroll again when other wardrobe state changes", () => {
    render(<WardrobeSheet />);
    setWardrobe({ tab: "style" });
    setWardrobe({ spec: spec({ length: "knee" }), target: 1 });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

describe("WardrobeSheet pose pane", () => {
  it("offers every pose and selects none until a spec is published", () => {
    render(<WardrobeSheet />);
    setWardrobe({ pose: "crossed" });
    expect(chips("pose").map((el) => el.dataset.v)).toEqual(POSE_ORDER);
    expect(selectedValues("pose")).toEqual([]);
    setWardrobe({ spec: spec() });
    expect(selectedValues("pose")).toEqual(["crossed"]);
  });

  it("sets the pose on click", async () => {
    render(<WardrobeSheet />);
    await userEvent.click(screen.getByRole("button", { name: "踮脚" }));
    expect(actions.pose).toHaveBeenCalledExactlyOnceWith("tiptoe");
  });
});

describe("WardrobeSheet preset pane", () => {
  beforeEach(() => setWardrobe({ tab: "preset" }));

  it("renders one card per preset and wears the clicked one by index", async () => {
    render(<WardrobeSheet />);
    expect(chips("preset").map((el) => el.textContent)).toEqual(PRESETS.map((preset) => zhCN[`preset.${preset.id}`]));
    await userEvent.click(screen.getByRole("button", { name: "蓝白条纹" }));
    expect(actions.preset).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("keeps the cards' 3px press room inside the pane's scroll area in the roomy layout", () => {
    // The row's own ring margin would stick 3px out of the scroll area and make it scroll both ways; the pane
    // provides the room instead, so nothing overflows (and a scrollbar cannot come and go on press).
    render(<WardrobeSheet />);
    const row = document.querySelector('[data-key="preset"]')!;
    const pane = row.closest('[role="tabpanel"]')!.parentElement!;
    expect(row).toHaveClass("-m-[3px]", "p-[3px]", "roomy:m-0", "roomy:p-0");
    expect(pane).toHaveClass("roomy:-mx-[3px]", "roomy:px-[3px]", "py-0.5");
  });

  it("registers every card canvas as a preset thumbnail at the thumbnail size", () => {
    render(<WardrobeSheet />);
    const canvases = chips("preset").map((card) => card.querySelector("canvas")!);
    expect(thumbCanvases.presets).toHaveLength(PRESETS.length);
    canvases.forEach((canvas, i) => {
      expect(thumbCanvases.presets[i]).toBe(canvas);
      expect(canvas.width).toBe(THUMB_SIZE.w);
      expect(canvas.height).toBe(THUMB_SIZE.h);
      expect(canvas).toHaveAttribute("aria-hidden", "true");
    });
    expect([THUMB_SIZE.w, THUMB_SIZE.h]).toEqual([180, 240]);
  });

  it("previews a preset while a mouse hovers its card, including its children", async () => {
    render(<WardrobeSheet />);
    await userEvent.hover(chip("preset", "2"));
    expect(actions.previewPreset).toHaveBeenLastCalledWith(2);
    fireEvent.pointerOver(chip("preset", "5").querySelector("canvas")!, { pointerType: "mouse" });
    expect(actions.previewPreset).toHaveBeenLastCalledWith(5);
  });

  it("ends the preview when the mouse leaves the cards", async () => {
    render(<WardrobeSheet />);
    await userEvent.hover(chip("preset", "1"));
    await userEvent.unhover(chip("preset", "1"));
    expect(actions.previewPreset).toHaveBeenLastCalledWith(null);
  });

  it("ignores touch and pen pointers", () => {
    render(<WardrobeSheet />);
    const card = chip("preset", "4");
    fireEvent.pointerOver(card, { pointerType: "touch" });
    fireEvent.pointerOut(card, { pointerType: "touch", relatedTarget: document.body });
    fireEvent.pointerOver(card, { pointerType: "pen" });
    expect(actions.previewPreset).not.toHaveBeenCalled();
  });

  it("ignores hovering the gaps between cards", () => {
    render(<WardrobeSheet />);
    fireEvent.pointerOver(document.querySelector('[data-key="preset"]')!, { pointerType: "mouse" });
    expect(actions.previewPreset).not.toHaveBeenCalled();
  });
});

describe("WardrobeSheet style pane", () => {
  beforeEach(() => setWardrobe({ tab: "style" }));

  it("selects nothing and dims nothing without a spec", () => {
    render(<WardrobeSheet />);
    for (const group of ["length", "cuff", "garter", "toe"]) {
      expect(selectedValues(group)).toEqual([]);
      expect(dimmedValues(group)).toEqual([]);
    }
  });

  it("selects the length, cuff and garter chips from the spec", () => {
    render(<WardrobeSheet />);
    setWardrobe({ spec: spec({ length: "over", cuff: "bow", garter: false }) });
    expect(selectedValues("length")).toEqual(["over"]);
    expect(selectedValues("cuff")).toEqual(["bow"]);
    expect(selectedValues("garter")).toEqual(["0"]);
    setWardrobe({ spec: spec({ garter: true }) });
    expect(selectedValues("garter")).toEqual(["1"]);
  });

  it("keeps cuff and garter active on thigh-highs", () => {
    render(<WardrobeSheet />);
    setWardrobe({ spec: spec({ length: "thigh" }) });
    expect(dimmedValues("cuff")).toEqual([]);
    expect(dimmedValues("garter")).toEqual([]);
    expect(dimmedValues("length")).toEqual([]);
  });

  it("dims the unselected garter chips unless the length is thigh", () => {
    render(<WardrobeSheet />);
    setWardrobe({ spec: spec({ length: "knee", garter: false }) });
    expect(dimmedValues("garter")).toEqual(["1"]);
    expect(dimmedValues("cuff")).toEqual([]);
  });

  it("selects the toe chip from the spec, and dims the other one where a reinforced toe does not show", () => {
    render(<WardrobeSheet />);
    setWardrobe({ spec: spec({ toe: true }) });
    expect(selectedValues("toe")).toEqual(["1"]);
    expect(dimmedValues("toe")).toEqual([]);
    setWardrobe({ spec: spec({ toe: false }) });
    expect(selectedValues("toe")).toEqual(["0"]);
    setWardrobe({ spec: spec({ toe: false, material: "cotton" }) });
    expect(dimmedValues("toe")).toEqual(["1"]);
    setWardrobe({ spec: spec({ toe: true, pattern: "net" }) });
    expect(dimmedValues("toe")).toEqual(["0"]);
  });

  it("dims the unselected cuff chips for tights", () => {
    render(<WardrobeSheet />);
    setWardrobe({ spec: spec({ length: "tights", cuff: "rib" }) });
    expect(dimmedValues("cuff")).toEqual(["lace", "plain", "stripes", "bow"]);
    expect(isChipDimmed(chip("cuff", "rib"))).toBe(false);
    expect(dimmedValues("garter")).toEqual(["1"]);
  });

  it.each([
    ["length", "knee", "及膝袜"],
    ["cuff", "stripes", "双条纹"],
    ["garter", "1", "要 (大腿袜)"],
    ["garter", "0", "不要"],
    ["toe", "1", "加固 (丝袜)"],
    ["toe", "0", "无加固"],
  ])("wears %s=%s from the %s chip", async (group, value, label) => {
    render(<WardrobeSheet />);
    await userEvent.click(within(document.querySelector<HTMLElement>(`[data-key="${group}"]`)!).getByText(label));
    expect(actions.wearChip).toHaveBeenCalledExactlyOnceWith(group, value);
  });
});

describe("WardrobeSheet color pane", () => {
  beforeEach(() => setWardrobe({ tab: "color" }));

  it("renders the palette as labeled swatches in palette order", () => {
    render(<WardrobeSheet />);
    const swatches = chips("color");
    expect(swatches.map((el) => el.dataset.v)).toEqual(COLOR_ORDER);
    expect(swatches.map((el) => el.getAttribute("aria-label"))).toEqual(COLOR_ORDER.map((key) => zhCN[`color.${key}`]));
    expect(swatches[0].style.getPropertyValue("--c")).toBe(COLORS.ink.dye);
  });

  it("selects the palette color from the spec and leaves the custom swatch off", () => {
    render(<WardrobeSheet />);
    setWardrobe({ spec: spec({ color: "mist" }) });
    expect(selectedValues("color")).toEqual(["mist"]);
    expect(isSwatchOn(customSwatch())).toBe(false);
    expect(customSwatch().style.getPropertyValue("--c")).toBe("");
  });

  it("wears a palette color through wearChip", async () => {
    render(<WardrobeSheet />);
    await userEvent.click(screen.getByRole("button", { name: "雾蓝" }));
    expect(actions.wearChip).toHaveBeenCalledExactlyOnceWith("color", "mist");
  });

  it("turns the custom swatch on for a non-palette color", () => {
    render(<WardrobeSheet />);
    setWardrobe({ spec: spec({ color: "#123456" }) });
    expect(selectedValues("color")).toEqual([]);
    expect(isSwatchOn(customSwatch())).toBe(true);
    expect(customSwatch().style.getPropertyValue("--c")).toBe("#123456");
  });

  it("keeps showing the last custom color after a palette color is picked", () => {
    render(<WardrobeSheet />);
    setWardrobe({ spec: spec({ color: "#123456" }) });
    setWardrobe({ spec: spec({ color: "ink" }) });
    expect(isSwatchOn(customSwatch())).toBe(false);
    expect(customSwatch().style.getPropertyValue("--c")).toBe("#123456");
    setWardrobe({ spec: spec({ color: "#abcdef" }) });
    expect(customSwatch().style.getPropertyValue("--c")).toBe("#abcdef");
  });

  it("wears the color typed into the color input", () => {
    render(<WardrobeSheet />);
    const input = customSwatch().querySelector("input")!;
    expect(input).toHaveAttribute("type", "color");
    fireEvent.input(input, { target: { value: "#ff0000" } });
    expect(actions.wearColor).toHaveBeenCalledExactlyOnceWith("#ff0000");
  });
});

describe("WardrobeSheet material pane", () => {
  beforeEach(() => setWardrobe({ tab: "material" }));

  const hint = () => document.querySelector('[data-pane="material"] > p')!;

  it("selects the material and denier chips from the spec", () => {
    render(<WardrobeSheet />);
    setWardrobe({ spec: spec({ material: "pearl", denier: 70 }) });
    expect(selectedValues("material")).toEqual(["pearl"]);
    expect(selectedValues("denier")).toEqual(["70"]);
    expect(chips("denier").map((el) => el.textContent)).toEqual(["15D", "40D", "70D", "120D"]);
  });

  it("keeps denier active for sheer materials", () => {
    render(<WardrobeSheet />);
    setWardrobe({ spec: spec({ material: "sheer" }) });
    expect(dimmedValues("denier")).toEqual([]);
  });

  it.each(["velvet", "cotton", "latex"] as const)("dims the unselected denier chips for opaque %s", (material) => {
    render(<WardrobeSheet />);
    setWardrobe({ spec: spec({ material, denier: 40 }) });
    expect(dimmedValues("denier")).toEqual(["15", "70", "120"]);
    expect(dimmedValues("material")).toEqual([]);
  });

  it("explains the material, adding the opacity note only when denier has no effect", () => {
    render(<WardrobeSheet />);
    expect(hint()).toHaveTextContent(/^$/);
    setWardrobe({ spec: spec({ material: "sheer" }) });
    expect(hint().textContent).toBe("薄丝: 遇水变透。");
    setWardrobe({ spec: spec({ material: "velvet" }) });
    expect(hint().textContent).toBe("天鹅绒: 遇水变深。这种料子不透, 厚度不起作用。");
  });

  it("wears material and denier chips as strings", async () => {
    render(<WardrobeSheet />);
    await userEvent.click(screen.getByRole("button", { name: "漆皮" }));
    await userEvent.click(screen.getByRole("button", { name: "120D" }));
    expect(vi.mocked(actions.wearChip).mock.calls).toEqual([
      ["material", "latex"],
      ["denier", "120"],
    ]);
  });
});

describe("WardrobeSheet pattern and fun panes", () => {
  it("selects and wears patterns", async () => {
    setWardrobe({ tab: "pattern", spec: spec({ pattern: "dots" }) });
    render(<WardrobeSheet />);
    expect(chips("pattern").map((el) => el.dataset.v)).toEqual(PATTERN_ORDER);
    expect(selectedValues("pattern")).toEqual(["dots"]);
    await userEvent.click(screen.getByRole("button", { name: "猫爪" }));
    expect(actions.wearChip).toHaveBeenCalledExactlyOnceWith("pattern", "paws");
  });

  it("labels the secret decals and selects the current one", () => {
    setWardrobe({ tab: "fun", spec: spec({ secret: "stars" }) });
    render(<WardrobeSheet />);
    expect(chips("secret").map((el) => el.dataset.v)).toEqual(SECRET_DECAL_ORDER);
    expect(chips("secret").map((el) => el.textContent)).toEqual(["无", "藏爱心", "藏星星", "藏猫爪", "藏雨丝"]);
    expect(selectedValues("secret")).toEqual(["stars"]);
  });

  it("maps a missing wet color to the unchanged chip", () => {
    setWardrobe({ tab: "fun", spec: spec({ wetColor: null }) });
    render(<WardrobeSheet />);
    expect(selectedValues("wetColor")).toEqual([""]);
    setWardrobe({ spec: spec({ wetColor: "taro" }) });
    expect(selectedValues("wetColor")).toEqual(["taro"]);
  });

  it("wears secret and wet color chips", async () => {
    setWardrobe({ tab: "fun" });
    render(<WardrobeSheet />);
    await userEvent.click(screen.getByRole("button", { name: "藏雨丝" }));
    await userEvent.click(screen.getByRole("button", { name: "不变" }));
    await userEvent.click(screen.getByRole("button", { name: "变正红" }));
    expect(vi.mocked(actions.wearChip).mock.calls).toEqual([
      ["secret", "words"],
      ["wetColor", ""],
      ["wetColor", "cherry"],
    ]);
  });
});

describe("WardrobeSheet bare legs", () => {
  const FABRIC_GROUPS = ["cuff", "garter", "toe", "color", "material", "denier", "pattern", "secret", "wetColor"];
  const BARE_HINT = "光腿没穿袜子, 这些选项用不上。";
  const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled && el.classList.contains("opacity-35");

  it("offers bare legs as the first length", () => {
    render(<WardrobeSheet />);
    expect(chips("length")[0].dataset.v).toBe("bare");
    expect(chips("length")[0].textContent).toBe("光腿");
  });

  it("greys out every fabric option but keeps the lengths", () => {
    render(<WardrobeSheet />);
    setWardrobe({ spec: spec({ length: "bare" }) });
    for (const group of FABRIC_GROUPS) {
      expect(chips(group).every(isDisabled)).toBe(true);
    }
    expect(within(customSwatch()).getByDisplayValue("#7fb9c9")).toBeDisabled();
    expect(customSwatch()).toHaveClass("opacity-35");
    expect(chips("length").some((el) => (el as HTMLButtonElement).disabled)).toBe(false);
    expect(selectedValues("length")).toEqual(["bare"]);
  });

  it("ignores clicks on the greyed-out options and still wears a length", async () => {
    setWardrobe({ tab: "style", spec: spec({ length: "bare" }) });
    render(<WardrobeSheet />);
    await userEvent.click(chip("cuff", "bow"));
    await userEvent.click(chip("garter", "1"));
    await userEvent.click(chip("length", "knee"));
    expect(actions.wearChip).toHaveBeenCalledExactlyOnceWith("length", "knee");
  });

  it("explains why in the affected panes and restores the usual hints with stockings", () => {
    render(<WardrobeSheet />);
    setWardrobe({ spec: spec({ length: "bare" }) });
    const hintPanes = () =>
      [...document.querySelectorAll<HTMLElement>("[data-pane] > p")]
        .filter((p) => p.textContent === BARE_HINT)
        .map((p) => p.closest<HTMLElement>("[data-pane]")!.dataset.pane);
    expect(hintPanes()).toEqual(["style", "color", "material", "pattern", "fun"]);
    setWardrobe({ spec: spec({ length: "thigh" }) });
    expect(hintPanes()).toEqual([]);
    expect(document.querySelector('[data-pane="material"] > p')!.textContent).toBe("薄丝: 遇水变透。");
    for (const group of FABRIC_GROUPS) {
      expect(chips(group).some((el) => (el as HTMLButtonElement).disabled)).toBe(false);
    }
  });
});

describe("WardrobeSheet leg target", () => {
  // The segment is kept in the layout and hidden with a class; that class is the only signal.
  const isHidden = () => targetGroup().classList.contains("invisible");

  it("is hidden on the pose tab and shown on the other tabs", () => {
    render(<WardrobeSheet />);
    expect(isHidden()).toBe(true);
    setWardrobe({ tab: "color" });
    expect(isHidden()).toBe(false);
  });

  it("is hidden in the solo pose on any tab", () => {
    setWardrobe({ tab: "style", solo: true });
    render(<WardrobeSheet />);
    expect(isHidden()).toBe(true);
  });

  it("leaves aria-checked unset until a spec is published", () => {
    setWardrobe({ tab: "style" });
    render(<WardrobeSheet />);
    for (const radio of within(targetGroup()).getAllByRole("radio")) {
      expect(radio).not.toHaveAttribute("aria-checked");
    }
  });

  it("checks the target leg, or both legs when solo", () => {
    setWardrobe({ tab: "style", spec: spec(), target: 0 });
    render(<WardrobeSheet />);
    const checked = () =>
      within(targetGroup())
        .getAllByRole("radio")
        .filter((radio) => radio.getAttribute("aria-checked") === "true")
        .map((radio) => radio.textContent);
    expect(checked()).toEqual(["左腿"]);
    setWardrobe({ target: -1 });
    expect(checked()).toEqual(["双腿"]);
    setWardrobe({ target: 1, solo: true });
    expect(checked()).toEqual(["双腿"]);
  });

  it.each([
    ["双腿", -1],
    ["左腿", 0],
    ["右腿", 1],
  ])("targets %s as leg %i", async (name, leg) => {
    setWardrobe({ tab: "style" });
    render(<WardrobeSheet />);
    await userEvent.click(within(targetGroup()).getByRole("radio", { name }));
    expect(actions.target).toHaveBeenCalledExactlyOnceWith(leg);
  });
});

describe("WardrobeSheet footer", () => {
  it("wears a random outfit", async () => {
    render(<WardrobeSheet />);
    await userEvent.click(screen.getByRole("button", { name: "随机一双" }));
    expect(actions.random).toHaveBeenCalledTimes(1);
  });

  it("shares the look", async () => {
    render(<WardrobeSheet />);
    const share = screen.getByRole("button", { name: "复制链接" });
    expect(share).toHaveAttribute("title", "把这一双连同姿势和场景生成一个链接");
    await userEvent.click(share);
    expect(actions.share).toHaveBeenCalledTimes(1);
  });

  it("is labeled as the wardrobe region", () => {
    render(<WardrobeSheet />);
    expect(screen.getByRole("region", { name: "衣橱" })).toHaveAttribute("id", "materials");
  });
});
