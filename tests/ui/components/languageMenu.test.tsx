import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CornerBar } from "../../../src/components/CornerBar";
import { Dock } from "../../../src/components/Dock";
import { WardrobeSheet } from "../../../src/components/sheets/WardrobeSheet";
import { ui } from "../../../src/state/ui";
import { resetUiTest, setUi, setWardrobe } from "./harness";
import { DEFAULT_LEG_SPEC } from "../../../src/engine/catalog/presets";

vi.mock("../../../src/engine/app/actions", async () => (await import("./harness")).mockActionsModule());

afterEach(resetUiTest);

const button = () => document.querySelector<HTMLButtonElement>("#langBtn")!;
const menu = () => document.querySelector<HTMLElement>("#langMenu")!;
const items = () => within(menu()).getAllByRole("menuitemradio", { hidden: true });

describe("LanguageMenu", () => {
  it("is a closed menu button named for the current language", () => {
    render(<CornerBar />);
    expect(button()).toHaveAccessibleName("语言");
    expect(button()).toHaveAttribute("aria-haspopup", "menu");
    expect(button()).toHaveAttribute("aria-expanded", "false");
    expect(menu()).not.toBeVisible();
    setUi({ locale: "en-US" });
    expect(button()).toHaveAccessibleName("Language");
  });

  it("lists every language in its own language with the current one checked and focused", async () => {
    render(<CornerBar />);
    await userEvent.click(button());
    expect(button()).toHaveAttribute("aria-expanded", "true");
    expect(menu()).toBeVisible();
    expect(items().map((item) => [item.textContent, item.lang, item.getAttribute("aria-checked")])).toEqual([
      ["简体中文", "zh-CN", "true"],
      ["English", "en-US", "false"],
    ]);
    expect(items()[0]).toHaveFocus();
  });

  it("switches the whole UI to the picked language, closes and returns focus", async () => {
    render(
      <>
        <CornerBar />
        <Dock />
      </>,
    );
    expect(screen.getByText("衣橱")).toBeInTheDocument();
    await userEvent.click(button());
    await userEvent.click(screen.getByRole("menuitemradio", { name: "English" }));
    expect(ui.get().locale).toBe("en-US");
    expect(screen.getByText("Wardrobe")).toBeInTheDocument();
    expect(screen.queryByText("衣橱")).toBeNull();
    expect(document.querySelector("#bucketBtn")).toHaveAttribute("data-key", "Space");
    expect(menu()).not.toBeVisible();
    expect(button()).toHaveFocus();
  });

  it("moves through the items with the arrow keys and closes on Escape without reaching the app", async () => {
    const appKeys = vi.fn();
    window.addEventListener("keydown", appKeys);
    try {
      render(<CornerBar />);
      await userEvent.click(button());
      await userEvent.keyboard("{ArrowDown}");
      expect(items()[1]).toHaveFocus();
      await userEvent.keyboard("{ArrowDown}");
      expect(items()[0]).toHaveFocus();
      await userEvent.keyboard("{ArrowUp}");
      expect(items()[1]).toHaveFocus();
      await userEvent.keyboard("{Escape}");
      expect(menu()).not.toBeVisible();
      expect(button()).toHaveFocus();
      expect(appKeys).not.toHaveBeenCalled();
      expect(ui.get().locale).toBe("zh-CN");
    } finally {
      window.removeEventListener("keydown", appKeys);
    }
  });

  it("closes when pressing outside it, but not inside", async () => {
    render(<CornerBar />);
    await userEvent.click(button());
    fireEvent.pointerDown(menu());
    expect(menu()).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(menu()).not.toBeVisible();
    expect(button()).toHaveAttribute("aria-expanded", "false");
  });
});

describe("English UI", () => {
  it("labels the wardrobe rows, chips and hints in English", () => {
    setUi({ locale: "en-US" });
    setWardrobe({ tab: "material", spec: { ...DEFAULT_LEG_SPEC, material: "velvet" } });
    render(<WardrobeSheet />);
    expect(screen.getByRole("tab", { name: "Fabric" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector('[data-pane="material"] > p')).toHaveTextContent(
      "Velvet: darkens when wet. This fabric is opaque, so denier has no effect.",
    );
    expect(screen.getByRole("button", { name: "Thigh-highs", hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ink", hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Which leg to dress" })).toBeInTheDocument();
  });
});
